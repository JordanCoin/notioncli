module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      resolveDb,
      loadConfig,
      saveConfig,
      getWorkspaceName,
      jsonOutput,
      richTextToPlain,
      propValue,
      printTable,
      paginate,
      runCommand,
    } = ctx;

    // ─── dbs ────────────────────────────────────────────────────────────────
    program
      .command('dbs')
      .description('List all databases shared with your integration')
      .action(async (opts, cmd) => runCommand('List databases', async () => {
        const notion = getNotion();
        const { results, response } = await paginate(
          ({ start_cursor, page_size }) => notion.search({
            filter: { value: 'data_source', property: 'object' },
            start_cursor,
            page_size,
          }),
          { pageSizeLimit: 100 },
        );
        if (jsonOutput(cmd, response)) return;
        const rows = results.map(db => ({
          id: db.id,
          title: richTextToPlain(db.title),
          url: db.url || '',
        }));
        if (rows.length === 0) {
          console.log('No databases found. Make sure you\'ve shared databases with your integration.');
          console.log('In Notion: open a database → ••• menu → Connections → Add your integration');
          return;
        }
        printTable(rows, ['id', 'title', 'url']);
      }));

    // ─── templates ───────────────────────────────────────────────────────────
    program
      .command('templates <database>')
      .description('List page templates available for a database')
      .action(async (db, opts, cmd) => runCommand('Templates', async () => {
        const notion = getNotion();
        const dbIds = resolveDb(db);
        const res = await notion.dataSources.listTemplates({
          data_source_id: dbIds.data_source_id,
        });
        if (jsonOutput(cmd, res)) return;
        if (!res.results || res.results.length === 0) {
          console.log('No templates found for this database.');
          return;
        }
        const rows = res.results.map(t => {
          let title = '';
          if (t.properties) {
            for (const [, prop] of Object.entries(t.properties)) {
              if (prop.type === 'title') {
                title = propValue(prop);
                break;
              }
            }
          }
          return {
            id: t.id,
            title: title || '(untitled)',
            url: t.url || '',
          };
        });
        printTable(rows, ['id', 'title', 'url']);
      }));

    // ─── db-create ───────────────────────────────────────────────────────────
    program
      .command('db-create <parent-page-id> <title>')
      .description('Create a new database under a page')
      .option('--prop <name:type...>', 'Property definition — repeatable (e.g. --prop "Status:select" --prop "Priority:number")', (v, prev) => prev.concat([v]), [])
      .option('--alias <name>', 'Auto-create an alias for the new database')
      .action(async (parentPageId, title, opts, cmd) => runCommand('Database create', async () => {
        const notion = getNotion();

        // Build properties — always include a title property
        const properties = {};
        let hasTitleProp = false;

        for (const kv of opts.prop) {
          const colonIdx = kv.indexOf(':');
          if (colonIdx === -1) {
            console.error(`Invalid property format: ${kv} (expected name:type)`);
            console.error('Supported types: title, rich_text, number, select, multi_select, date, checkbox, url, email, phone_number, status');
            process.exit(1);
          }
          const name = kv.slice(0, colonIdx);
          const type = kv.slice(colonIdx + 1).toLowerCase();
          if (type === 'title') hasTitleProp = true;
          properties[name] = { [type]: {} };
        }

        // Ensure there's a title property
        if (!hasTitleProp) {
          properties['Name'] = { title: {} };
        }

        // 2025 API: databases.create() only handles title property reliably.
        // Non-title properties must be added via dataSources.update() after creation.
        const titleProps = {};
        const extraProps = {};
        for (const [name, prop] of Object.entries(properties)) {
          if (prop.title) {
            titleProps[name] = prop;
          } else {
            extraProps[name] = prop;
          }
        }
        // Ensure title property exists in create call
        if (Object.keys(titleProps).length === 0) {
          titleProps['Name'] = { title: {} };
        }

        const res = await notion.databases.create({
          parent: { type: 'page_id', page_id: parentPageId },
          title: [{ text: { content: title } }],
          properties: titleProps,
        });

        // Extract correct dual IDs from response
        const databaseId = res.id;
        const dataSourceId = (res.data_sources && res.data_sources[0])
          ? res.data_sources[0].id
          : res.id;

        // Add non-title properties via dataSources.update()
        if (Object.keys(extraProps).length > 0) {
          await notion.dataSources.update({
            data_source_id: dataSourceId,
            properties: extraProps,
          });
        }

        if (jsonOutput(cmd, res)) return;

        console.log(`✅ Created database: ${databaseId.slice(0, 8)}…`);
        console.log(`   Title: ${title}`);
        console.log(`   Properties: ${Object.keys(properties).join(', ')}`);

        // Auto-create alias if requested
        if (opts.alias) {
          const config = loadConfig();
          const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
          if (!config.workspaces[wsName]) config.workspaces[wsName] = { aliases: {} };
          if (!config.workspaces[wsName].aliases) config.workspaces[wsName].aliases = {};
          config.workspaces[wsName].aliases[opts.alias] = {
            database_id: databaseId,
            data_source_id: dataSourceId,
          };
          saveConfig(config);
          console.log(`   Alias: ${opts.alias}`);
        }
      }));

    // ─── db-update ───────────────────────────────────────────────────────────
    program
      .command('db-update <database>')
      .description('Update a database title or add properties')
      .option('--title <text>', 'New database title')
      .option('--add-prop <name:type...>', 'Add a property (e.g. --add-prop "Priority:number")', (v, prev) => prev.concat([v]), [])
      .option('--remove-prop <name...>', 'Remove a property by name', (v, prev) => prev.concat([v]), [])
      .action(async (db, opts, cmd) => runCommand('Database update', async () => {
        const notion = getNotion();
        const dbIds = resolveDb(db);

        // 2025 API: property changes go through dataSources.update(), NOT databases.update().
        // databases.update() silently ignores property modifications.
        // Title changes still go through databases.update().
        let canonicalId = dbIds.database_id;
        const dataSourceId = dbIds.data_source_id;

        // Resolve canonical database_id if both IDs are the same
        if (canonicalId === dataSourceId) {
          try {
            const ds = await notion.dataSources.retrieve({ data_source_id: canonicalId });
            if (ds.parent && ds.parent.type === 'database_id') {
              canonicalId = ds.parent.database_id;
            }
          } catch (_) { /* fall through with what we have */ }
        }

        // Build property changes for dataSources.update()
        let propChanges = null;
        if (opts.addProp.length > 0 || opts.removeProp.length > 0) {
          propChanges = {};

          for (const kv of opts.addProp) {
            const colonIdx = kv.indexOf(':');
            if (colonIdx === -1) {
              console.error(`Invalid property format: ${kv} (expected name:type)`);
              process.exit(1);
            }
            const name = kv.slice(0, colonIdx);
            const type = kv.slice(colonIdx + 1).toLowerCase();
            propChanges[name] = { [type]: {} };
          }

          for (const name of opts.removeProp) {
            propChanges[name] = null;
          }
        }

        let res;

        // Title changes go through databases.update()
        if (opts.title) {
          res = await notion.databases.update({
            database_id: canonicalId,
            title: [{ text: { content: opts.title } }],
          });
        }

        // Property changes go through dataSources.update()
        if (propChanges) {
          res = await notion.dataSources.update({
            data_source_id: dataSourceId,
            properties: propChanges,
          });
        }

        if (jsonOutput(cmd, res)) return;

        console.log(`✅ Updated database: ${(dbIds.database_id || dbIds.data_source_id).slice(0, 8)}…`);
        if (opts.title) console.log(`   Title: ${opts.title}`);
        if (opts.addProp.length > 0) console.log(`   Added: ${opts.addProp.join(', ')}`);
        if (opts.removeProp.length > 0) console.log(`   Removed: ${opts.removeProp.join(', ')}`);
      }));
  },
};
