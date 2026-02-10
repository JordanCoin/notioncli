const fs = require('fs');
const path = require('path');

module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      resolveDb,
      resolvePageId,
      getDbSchema,
      buildProperties,
      jsonOutput,
      richTextToPlain,
      propValue,
      extractDynamicProps,
      markdownToBlocks,
      runCommand,
    } = ctx;

    // ─── add ──────────────────────────────────────────────────────────────────
    program
      .command('add <database>')
      .description('Add a new page to a database (e.g. notion add tasks --name "Ship it" --status "Done")')
      .option('--prop <key=value...>', 'Property value — repeatable (e.g. --prop "Name=Hello")', (v, prev) => prev.concat([v]), [])
      .option('--from <file>', 'Import content from a .md file as page body')
      .allowUnknownOption()
      .allowExcessArguments()
      .action(async (db, opts, cmd) => runCommand('Add', async () => {
        const notion = getNotion();
        const dbIds = resolveDb(db);

        // Merge --prop flags with dynamic property flags (--name, --status, etc.)
        const schema = await getDbSchema(dbIds);
        const knownFlags = ['prop', 'from', 'json', 'workspace', 'w', 'filter', 'limit', 'sort', 'output'];
        const dynamicProps = extractDynamicProps(process.argv, knownFlags, schema);
        const allProps = [...(opts.prop || []), ...dynamicProps];

        if (allProps.length === 0) {
          console.error('No properties provided. Use property flags or --prop:');
          console.error(`  notion add ${db} --name "My Page" --status "Active"`);
          console.error(`  notion add ${db} --prop "Name=My Page" --prop "Status=Active"`);
          const propNames = Object.values(schema).map(s => `--${s.name.toLowerCase().replace(/\s+/g, '-')}`);
          console.error(`\nAvailable: ${propNames.join(', ')}`);
          process.exit(1);
        }

        const properties = await buildProperties(dbIds, allProps);
        const res = await notion.pages.create({
          parent: { type: 'data_source_id', data_source_id: dbIds.data_source_id },
          properties,
        });

        // If --from file, parse and append blocks
        if (opts.from) {
          const filePath = path.resolve(opts.from);
          if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            process.exit(1);
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          const ext = path.extname(filePath).toLowerCase();

          let blocks;
          if (ext === '.md' || ext === '.markdown') {
            blocks = markdownToBlocks(content);
          } else {
            // Treat as plain text
            blocks = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } }];
          }

          // Notion API limits to 100 blocks per append call
          for (let i = 0; i < blocks.length; i += 100) {
            await notion.blocks.children.append({
              block_id: res.id,
              children: blocks.slice(i, i + 100),
            });
          }
        }

        if (jsonOutput(cmd, res)) return;
        console.log(`✅ Created page: ${res.id}`);
        console.log(`   URL: ${res.url}`);
        if (opts.from) console.log(`   Content imported from: ${opts.from}`);
      }));

    // ─── update ────────────────────────────────────────────────────────────────
    program
      .command('update <page-or-alias>')
      .description('Update a page\'s properties by ID or alias + filter (e.g. notion update tasks --filter "Name=Ship it" --status "Done")')
      .option('--filter <key=value...>', 'Filter to find the page — repeatable for AND (required with alias)', (v, prev) => prev.concat([v]), [])
      .option('--prop <key=value...>', 'Property value — repeatable', (v, prev) => prev.concat([v]), [])
      .allowUnknownOption()
      .allowExcessArguments()
      .action(async (target, opts, cmd) => runCommand('Update', async () => {
        const notion = getNotion();
        const { pageId, dbIds: resolvedDbIds } = await resolvePageId(target, opts.filter);
        let dbIds = resolvedDbIds;
        if (!dbIds) {
          const page = await notion.pages.retrieve({ page_id: pageId });
          const dsId = page.parent?.data_source_id;
          if (!dsId) {
            console.error('Page is not in a database — cannot auto-detect property types.');
            process.exit(1);
          }
          dbIds = { data_source_id: dsId, database_id: page.parent?.database_id || dsId };
        }
        // Merge --prop flags with dynamic property flags
        const schema = await getDbSchema(dbIds);
        const knownFlags = ['prop', 'filter', 'json', 'workspace', 'w', 'limit', 'sort', 'output'];
        const dynamicProps = extractDynamicProps(process.argv, knownFlags, schema);
        const allProps = [...(opts.prop || []), ...dynamicProps];

        if (allProps.length === 0) {
          console.error('No properties to update. Use property flags or --prop:');
          console.error(`  notion update ${target} --filter "Name=..." --status "Done"`);
          process.exit(1);
        }

        const properties = await buildProperties(dbIds, allProps);
        const res = await notion.pages.update({ page_id: pageId, properties });
        if (jsonOutput(cmd, res)) return;
        console.log(`✅ Updated page: ${res.id}`);
      }));

    // ─── delete (archive) ──────────────────────────────────────────────────────
    program
      .command('delete <page-or-alias>')
      .description('Delete (archive) a page by ID or alias + filter')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, opts, cmd) => runCommand('Delete', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        const res = await notion.pages.update({ page_id: pageId, archived: true });
        if (jsonOutput(cmd, res)) return;
        console.log('🗑️  Archived page: ' + res.id);
        console.log('   (Restore it from the trash in Notion if needed)');
      }));

    // ─── get ──────────────────────────────────────────────────────────────────
    program
      .command('get <page-or-alias>')
      .description('Get a page\'s properties by ID or alias + filter')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, opts, cmd) => runCommand('Get', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        const page = await notion.pages.retrieve({ page_id: pageId });
        if (jsonOutput(cmd, page)) return;
        console.log(`Page: ${page.id}`);
        console.log(`URL:  ${page.url}`);
        console.log(`Created: ${page.created_time}`);
        console.log(`Updated: ${page.last_edited_time}`);
        console.log('');
        console.log('Properties:');
        for (const [name, prop] of Object.entries(page.properties)) {
          if (prop.type === 'relation') {
            const rels = prop.relation || [];
            if (rels.length === 0) {
              console.log(`  ${name}: (none)`);
            } else {
              // Resolve relation titles
              const titles = [];
              for (const rel of rels) {
                try {
                  const linked = await notion.pages.retrieve({ page_id: rel.id });
                  let t = '';
                  for (const [, p] of Object.entries(linked.properties)) {
                    if (p.type === 'title') { t = propValue(p); break; }
                  }
                  titles.push(t || rel.id.slice(0, 8) + '…');
                } catch {
                  titles.push(rel.id.slice(0, 8) + '…');
                }
              }
              console.log(`  ${name}: ${titles.join(', ')}`);
            }
          } else if (prop.type === 'rollup') {
            const r = prop.rollup;
            if (!r) {
              console.log(`  ${name}: (empty)`);
            } else if (r.type === 'number') {
              console.log(`  ${name}: ${r.number != null ? r.number : '(empty)'}`);
            } else if (r.type === 'date') {
              console.log(`  ${name}: ${r.date ? r.date.start : '(empty)'}`);
            } else if (r.type === 'array' && r.array) {
              console.log(`  ${name}: ${r.array.map(item => propValue(item)).join(', ')}`);
            } else {
              console.log(`  ${name}: ${JSON.stringify(r)}`);
            }
          } else {
            console.log(`  ${name}: ${propValue(prop)}`);
          }
        }
      }));
  },
};
