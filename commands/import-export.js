const fs = require('fs');
const path = require('path');

module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      resolveDb,
      getDbSchema,
      buildProperties,
      parseCsv,
      markdownToBlocks,
      blocksToMarkdown,
      runCommand,
    } = ctx;

    // ─── import ──────────────────────────────────────────────────────────────
    program
      .command('import <file>')
      .description('Import data from a file (.csv/.json → database pages, .md → page content)')
      .option('--to <database>', 'Target database alias for CSV/JSON import')
      .option('--parent <page-id>', 'Parent page for markdown import')
      .option('--title <text>', 'Page title for markdown import')
      .action(async (file, opts, cmd) => runCommand('Import', async () => {
        const filePath = path.resolve(file);
        if (!fs.existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }

        const ext = path.extname(filePath).toLowerCase();
        const content = fs.readFileSync(filePath, 'utf-8');

        if (ext === '.csv' || ext === '.json') {
          // Database import: CSV/JSON → pages
          if (!opts.to) {
            console.error('--to <database> is required for CSV/JSON import.');
            console.error('Example: notion import data.csv --to tasks');
            process.exit(1);
          }

          const notion = getNotion();
          const dbIds = resolveDb(opts.to);
          const schema = await getDbSchema(dbIds);

          let rows;
          if (ext === '.csv') {
            rows = parseCsv(content);
          } else {
            const parsed = JSON.parse(content);
            rows = Array.isArray(parsed) ? parsed : [parsed];
          }

          if (rows.length === 0) {
            console.error('No data found in file.');
            process.exit(1);
          }

          console.log(`Importing ${rows.length} row${rows.length !== 1 ? 's' : ''} to ${opts.to}...`);

          let created = 0;
          let failed = 0;
          for (const row of rows) {
            try {
              // Map row keys to schema properties
              const propStrs = [];
              for (const [key, value] of Object.entries(row)) {
                if (value === '' || value === null || value === undefined) continue;
                const schemaEntry = schema[key.toLowerCase()];
                if (schemaEntry) {
                  propStrs.push(`${schemaEntry.name}=${value}`);
                }
              }
              if (propStrs.length === 0) continue;

              const properties = await buildProperties(dbIds, propStrs);
              await notion.pages.create({
                parent: { type: 'data_source_id', data_source_id: dbIds.data_source_id },
                properties,
              });
              created++;
            } catch (err) {
              failed++;
              if (failed <= 3) console.error(`  Row failed: ${err.message}`);
            }
          }

          console.log(`✅ Imported ${created} page${created !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`);

        } else if (ext === '.md' || ext === '.markdown') {
          // Page import: Markdown → page with blocks
          const notion = getNotion();
          const title = opts.title || path.basename(filePath, ext);

          let parentId = opts.parent;
          if (!parentId && opts.to) {
            // If --to is an alias, create as a database page
            const dbIds = resolveDb(opts.to);
            const properties = await buildProperties(dbIds, [`Name=${title}`]);
            const res = await notion.pages.create({
              parent: { type: 'data_source_id', data_source_id: dbIds.data_source_id },
              properties,
            });
            parentId = res.id;
            console.log(`✅ Created page: ${res.id}`);
          } else if (parentId) {
            // Create as a child page
            const res = await notion.pages.create({
              parent: { type: 'page_id', page_id: parentId },
              properties: { title: { title: [{ text: { content: title } }] } },
            });
            parentId = res.id;
            console.log(`✅ Created page: ${res.id}`);
          } else {
            console.error('Specify --to <database> or --parent <page-id> for markdown import.');
            process.exit(1);
          }

          // Parse markdown and append blocks
          const blocks = markdownToBlocks(content);
          for (let i = 0; i < blocks.length; i += 100) {
            await notion.blocks.children.append({
              block_id: parentId,
              children: blocks.slice(i, i + 100),
            });
          }

          console.log(`   Imported ${blocks.length} block${blocks.length !== 1 ? 's' : ''} from ${path.basename(filePath)}`);
        } else {
          console.error(`Unsupported file type: ${ext}`);
          console.error('Supported: .csv, .json (→ database), .md (→ page)');
          process.exit(1);
        }
      }));

    // ─── export ──────────────────────────────────────────────────────────────
    program
      .command('export <page-or-alias>')
      .description('Export page content as markdown')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, opts, cmd) => runCommand('Export', async () => {
        const notion = getNotion();
        const { pageId } = await ctx.resolvePageId(target, opts.filter);

        // Fetch all blocks
        let blocks = [];
        let cursor;
        do {
          const res = await notion.blocks.children.list({
            block_id: pageId,
            start_cursor: cursor,
            page_size: 100,
          });
          blocks = blocks.concat(res.results);
          cursor = res.has_more ? res.next_cursor : null;
        } while (cursor);

        const md = blocksToMarkdown(blocks);
        console.log(md);
      }));
  },
};
