module.exports = {
  register(program, ctx) {
    const {
      CONFIG_PATH,
      loadConfig,
      saveConfig,
      getWorkspaceName,
      getWorkspaceConfig,
      getNotion,
      createNotionClient,
      richTextToPlain,
      printTable,
      runCommand,
    } = ctx;

    // ─── init ──────────────────────────────────────────────────────────────────
    program
      .command('init')
      .description('Initialize notioncli with your API key and discover databases')
      .option('--key <api-key>', 'Notion integration API key (starts with ntn_)')
      .action(async (opts) => runCommand('Init', async () => {
        const config = loadConfig();
        const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
        const apiKey = opts.key || process.env.NOTION_API_KEY;

        if (!apiKey) {
          console.error('Error: Provide an API key with --key or set NOTION_API_KEY env var.');
          console.error('');
          console.error('To create an integration:');
          console.error('  1. Go to https://www.notion.so/profile/integrations');
          console.error('  2. Click "New integration"');
          console.error('  3. Copy the API key (starts with ntn_)');
          console.error('  4. Share your databases with the integration');
          console.error('');
          console.error('Then run: notion init --key ntn_your_api_key');
          console.error('  Or with workspace: notion init --workspace work --key ntn_your_api_key');
          process.exit(1);
        }

        if (!config.workspaces) config.workspaces = {};
        if (!config.workspaces[wsName]) config.workspaces[wsName] = { aliases: {} };
        config.workspaces[wsName].apiKey = apiKey;
        config.activeWorkspace = wsName;
        saveConfig(config);
        console.log(`✅ API key saved to workspace "${wsName}" in ${CONFIG_PATH}`);
        console.log('');

        // Discover databases
        const notion = createNotionClient(apiKey);
        try {
          const res = await notion.search({
            filter: { value: 'data_source', property: 'object' },
            page_size: 100,
          });

          if (res.results.length === 0) {
            console.log('No databases found. Make sure you\'ve shared databases with your integration.');
            console.log('In Notion: open a database → ••• menu → Connections → Add your integration');
            return;
          }

          const aliases = config.workspaces[wsName].aliases || {};

          console.log(`Found ${res.results.length} database${res.results.length !== 1 ? 's' : ''}:\n`);

          const added = [];
          for (const db of res.results) {
            const title = richTextToPlain(db.title) || '';
            const dsId = db.id;
            const dbId = (db.parent && db.parent.type === 'database_id' && db.parent.database_id) || db.database_id || dsId;

            // Auto-generate a slug from the title
            let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
            if (!slug) slug = `db-${dsId.slice(0, 8)}`;

            // Avoid collisions — append a number if needed
            let finalSlug = slug;
            let counter = 2;
            while (aliases[finalSlug] && aliases[finalSlug].data_source_id !== dsId) {
              finalSlug = `${slug}-${counter}`;
              counter++;
            }

            aliases[finalSlug] = {
              database_id: dbId,
              data_source_id: dsId,
            };

            console.log(`  ✅ ${finalSlug.padEnd(25)} → ${title || '(untitled)'}`);
            added.push(finalSlug);
          }

          config.workspaces[wsName].aliases = aliases;
          saveConfig(config);
          console.log('');
          console.log(`${added.length} alias${added.length !== 1 ? 'es' : ''} saved to workspace "${wsName}".`);
          console.log('');
          console.log('Ready! Try:');
          if (added.length > 0) {
            console.log(`  notion query ${added[0]}`);
            console.log(`  notion add ${added[0]} --prop "Name=Hello World"`);
          }
          console.log('');
          console.log('Manage aliases:');
          console.log('  notion alias list              — see all aliases');
          console.log('  notion alias rename <old> <new> — rename an alias');
          console.log('  notion alias remove <name>     — remove an alias');
        } catch (err) {
          console.error(`Failed to discover databases: ${err.message}`);
          console.error('Your API key was saved. You can add databases manually with: notion alias add <name> <id>');
        }
      }));

    // ─── alias ─────────────────────────────────────────────────────────────────
    const alias = program
      .command('alias')
      .description('Manage database aliases for quick access');

    alias
      .command('add <name> <database-id>')
      .description('Add a database alias (auto-discovers data_source_id)')
      .action(async (name, databaseId) => runCommand('Alias add', async () => {
        const config = loadConfig();
        const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
        if (!config.workspaces[wsName]) config.workspaces[wsName] = { aliases: {} };
        const aliases = config.workspaces[wsName].aliases || {};

        // Try to discover the data_source_id by searching for this database
        const notion = getNotion();
        let dataSourceId = databaseId;

        try {
          const res = await notion.search({
            filter: { value: 'data_source', property: 'object' },
            page_size: 100,
          });

          const match = res.results.find(db => {
            // Match by data_source_id or database_id
            return db.id === databaseId ||
                   db.id.replace(/-/g, '') === databaseId.replace(/-/g, '');
          });

          if (match) {
            dataSourceId = match.id;
            // The database_id might differ from data_source_id — check parent
            const dbId = (match.parent && match.parent.type === 'database_id' && match.parent.database_id) || match.database_id || databaseId;
            aliases[name] = {
              database_id: dbId,
              data_source_id: dataSourceId,
            };
            const title = richTextToPlain(match.title) || '(untitled)';
            console.log(`✅ Added alias "${name}" → ${title}`);
            console.log(`   database_id:    ${dbId}`);
            console.log(`   data_source_id: ${dataSourceId}`);
          } else {
            // Couldn't find via search — use the ID for both
            aliases[name] = {
              database_id: databaseId,
              data_source_id: databaseId,
            };
            console.log(`✅ Added alias "${name}" → ${databaseId}`);
            console.log('   (Could not auto-discover data_source_id — using same ID for both)');
          }
        } catch (err) {
          // Fallback: use same ID for both
          aliases[name] = {
            database_id: databaseId,
            data_source_id: databaseId,
          };
          console.log(`✅ Added alias "${name}" → ${databaseId}`);
          console.log(`   (Auto-discovery failed: ${err.message})`);
        }

        config.workspaces[wsName].aliases = aliases;
        saveConfig(config);
      }));

    alias
      .command('list')
      .description('Show all configured database aliases')
      .action(() => {
        const ws = getWorkspaceConfig();
        const aliases = ws.aliases || {};
        const names = Object.keys(aliases);

        if (names.length === 0) {
          console.log(`No aliases in workspace "${ws.name}".`);
          console.log('Add one with: notion alias add <name> <database-id>');
          return;
        }

        console.log(`Workspace: ${ws.name}\n`);
        const rows = names.map(name => ({
          alias: name,
          database_id: aliases[name].database_id,
          data_source_id: aliases[name].data_source_id,
        }));
        printTable(rows, ['alias', 'database_id', 'data_source_id']);
      });

    alias
      .command('remove <name>')
      .description('Remove a database alias')
      .action((name) => {
        const config = loadConfig();
        const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
        const aliases = config.workspaces[wsName]?.aliases || {};
        if (!aliases[name]) {
          console.error(`Alias "${name}" not found in workspace "${wsName}".`);
          const names = Object.keys(aliases);
          if (names.length > 0) {
            console.error(`Available: ${names.join(', ')}`);
          }
          process.exit(1);
        }
        delete aliases[name];
        config.workspaces[wsName].aliases = aliases;
        saveConfig(config);
        console.log(`✅ Removed alias "${name}" from workspace "${wsName}"`);
      });

    alias
      .command('rename <old-name> <new-name>')
      .description('Rename a database alias')
      .action((oldName, newName) => {
        const config = loadConfig();
        const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
        const aliases = config.workspaces[wsName]?.aliases || {};
        if (!aliases[oldName]) {
          console.error(`Alias "${oldName}" not found in workspace "${wsName}".`);
          const names = Object.keys(aliases);
          if (names.length > 0) {
            console.error(`Available: ${names.join(', ')}`);
          }
          process.exit(1);
        }
        if (aliases[newName]) {
          console.error(`Alias "${newName}" already exists. Remove it first or pick a different name.`);
          process.exit(1);
        }
        aliases[newName] = aliases[oldName];
        delete aliases[oldName];
        config.workspaces[wsName].aliases = aliases;
        saveConfig(config);
        console.log(`✅ Renamed "${oldName}" → "${newName}" in workspace "${wsName}"`);
      });

    // ─── workspace ─────────────────────────────────────────────────────────────
    const workspace = program
      .command('workspace')
      .description('Manage workspace profiles (multiple Notion accounts)');

    workspace
      .command('add <name>')
      .description('Add a new workspace profile')
      .requiredOption('--key <api-key>', 'Notion API key for this workspace')
      .action(async (name, opts) => runCommand('Workspace add', async () => {
        const config = loadConfig();
        if (config.workspaces[name]) {
          console.error(`Workspace "${name}" already exists. Use "notion init --workspace ${name} --key ..." to update it.`);
          process.exit(1);
        }
        config.workspaces[name] = { apiKey: opts.key, aliases: {} };
        saveConfig(config);
        console.log(`✅ Added workspace "${name}"`);
        console.log('');
        console.log(`Discover databases: notion init --workspace ${name}`);
        console.log(`Or set as active:   notion workspace use ${name}`);
      }));

    workspace
      .command('list')
      .description('List all workspace profiles')
      .action(() => {
        const config = loadConfig();
        const names = Object.keys(config.workspaces || {});
        if (names.length === 0) {
          console.log('No workspaces configured. Run: notion init --key ntn_...');
          return;
        }
        for (const name of names) {
          const ws = config.workspaces[name];
          const active = name === config.activeWorkspace ? ' ← active' : '';
          const aliasCount = Object.keys(ws.aliases || {}).length;
          const keyPreview = ws.apiKey ? `${ws.apiKey.slice(0, 8)}...` : '(no key)';
          console.log(`  ${name}${active}`);
          console.log(`    Key: ${keyPreview} | Aliases: ${aliasCount}`);
        }
      });

    workspace
      .command('use <name>')
      .description('Set the active workspace')
      .action((name) => {
        const config = loadConfig();
        if (!config.workspaces[name]) {
          console.error(`Workspace "${name}" not found.`);
          const names = Object.keys(config.workspaces || {});
          if (names.length > 0) {
            console.error(`Available: ${names.join(', ')}`);
          }
          process.exit(1);
        }
        config.activeWorkspace = name;
        saveConfig(config);
        console.log(`✅ Active workspace: ${name}`);
      });

    workspace
      .command('remove <name>')
      .description('Remove a workspace profile')
      .action((name) => {
        const config = loadConfig();
        if (!config.workspaces[name]) {
          console.error(`Workspace "${name}" not found.`);
          process.exit(1);
        }
        if (name === config.activeWorkspace) {
          console.error('Cannot remove the active workspace. Switch first: notion workspace use <other>');
          process.exit(1);
        }
        delete config.workspaces[name];
        saveConfig(config);
        console.log(`✅ Removed workspace "${name}"`);
      });
  },
};
