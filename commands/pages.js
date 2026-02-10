module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      getWorkspaceConfig,
      resolvePageId,
      UUID_REGEX,
      jsonOutput,
      propValue,
      printTable,
      runCommand,
    } = ctx;

    // ─── relations ───────────────────────────────────────────────────────────
    program
      .command('relations <page-or-alias>')
      .description('Show all relation and rollup properties with resolved titles')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, opts, cmd) => runCommand('Relations', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        const page = await notion.pages.retrieve({ page_id: pageId });

        if (jsonOutput(cmd, page)) return;

        let found = false;

        for (const [name, prop] of Object.entries(page.properties)) {
          if (prop.type === 'relation') {
            const rels = prop.relation || [];
            if (rels.length === 0) {
              console.log(`\n${name}: (no linked pages)`);
              continue;
            }
            found = true;
            console.log(`\n${name}: ${rels.length} linked page${rels.length !== 1 ? 's' : ''}`);

            // Resolve each related page title
            const rows = [];
            for (const rel of rels) {
              try {
                const linked = await notion.pages.retrieve({ page_id: rel.id });
                let title = '';
                for (const [, p] of Object.entries(linked.properties)) {
                  if (p.type === 'title') {
                    title = propValue(p);
                    break;
                  }
                }
                rows.push({
                  id: rel.id.slice(0, 8) + '…',
                  title: title || '(untitled)',
                  url: linked.url || '',
                });
              } catch {
                rows.push({ id: rel.id.slice(0, 8) + '…', title: '(access denied)', url: '' });
              }
            }
            printTable(rows, ['id', 'title', 'url']);
          }

          if (prop.type === 'rollup') {
            found = true;
            const r = prop.rollup;
            console.log(`\n${name} (rollup):`);
            if (!r) {
              console.log('  (empty)');
              continue;
            }
            if (r.type === 'number') {
              console.log(`  ${r.function || 'value'}: ${r.number}`);
            } else if (r.type === 'date') {
              console.log(`  ${r.date ? r.date.start : '(empty)'}`);
            } else if (r.type === 'array' && r.array) {
              for (const item of r.array) {
                console.log(`  • ${propValue(item)}`);
              }
            } else {
              console.log(`  ${JSON.stringify(r)}`);
            }
          }
        }

        if (!found) {
          console.log('This page has no relation or rollup properties.');
        }
      }));

    // ─── move ────────────────────────────────────────────────────────────────
    program
      .command('move <page-or-alias>')
      .description('Move a page to a new parent (page or database)')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .option('--to <parent-id-or-alias>', 'Destination parent (page ID, database alias, or database ID)')
      .action(async (target, opts, cmd) => runCommand('Move', async () => {
        if (!opts.to) {
          console.error('--to is required. Specify a parent page ID or database alias.');
          process.exit(1);
        }
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);

        // Resolve --to target
        let parent;
        const ws = getWorkspaceConfig();
        if (ws.aliases && ws.aliases[opts.to]) {
          const db = ws.aliases[opts.to];
          // pages.move() requires data_source_id parent, not database_id
          parent = { type: 'data_source_id', data_source_id: db.data_source_id };
        } else if (UUID_REGEX.test(opts.to)) {
          // Assume page ID — user can also pass a database_id
          parent = { type: 'page_id', page_id: opts.to };
        } else {
          console.error(`Unknown destination: "${opts.to}". Use a page ID or database alias.`);
          const aliasNames = ws.aliases ? Object.keys(ws.aliases) : [];
          if (aliasNames.length > 0) {
            console.error(`Available aliases: ${aliasNames.join(', ')}`);
          }
          process.exit(1);
        }

        const res = await notion.pages.move({ page_id: pageId, parent });
        if (jsonOutput(cmd, res)) return;
        console.log(`✅ Moved page: ${pageId.slice(0, 8)}…`);
        if (res.url) console.log(`   URL: ${res.url}`);
      }));

    // ─── props ───────────────────────────────────────────────────────────────
    program
      .command('props <page-or-alias>')
      .description('List all properties with full paginated values')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, opts, cmd) => runCommand('Props', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        const page = await notion.pages.retrieve({ page_id: pageId });

        if (jsonOutput(cmd, page)) return;

        console.log(`Page: ${page.id}`);
        console.log(`URL:  ${page.url}\n`);

        for (const [name, prop] of Object.entries(page.properties)) {
          // For paginated properties (relation, rollup, rich_text, title, people),
          // use the property retrieval endpoint to get full values
          const needsPagination = ['relation', 'rollup', 'rich_text', 'title', 'people'].includes(prop.type);

          if (needsPagination && prop.id) {
            try {
              const fullProp = await notion.pages.properties.retrieve({
                page_id: pageId,
                property_id: prop.id,
              });

              if (fullProp.results) {
                // Paginated property — collect all results
                const items = fullProp.results;
                if (prop.type === 'relation') {
                  if (items.length === 0) {
                    console.log(`  ${name}: (none)`);
                  } else {
                    const titles = [];
                    for (const item of items) {
                      const relId = item.relation?.id;
                      if (relId) {
                        try {
                          const linked = await notion.pages.retrieve({ page_id: relId });
                          let t = '';
                          for (const [, p] of Object.entries(linked.properties)) {
                            if (p.type === 'title') { t = propValue(p); break; }
                          }
                          titles.push(t || relId.slice(0, 8) + '…');
                        } catch {
                          titles.push(relId.slice(0, 8) + '…');
                        }
                      }
                    }
                    console.log(`  ${name}: ${titles.join(', ')}`);
                  }
                } else if (prop.type === 'rich_text' || prop.type === 'title') {
                  const text = items.map(i => i[prop.type]?.plain_text || '').join('');
                  console.log(`  ${name}: ${text}`);
                } else if (prop.type === 'people') {
                  const people = items.map(i => i.people?.name || i.people?.id || '').join(', ');
                  console.log(`  ${name}: ${people}`);
                } else {
                  console.log(`  ${name}: ${JSON.stringify(items)}`);
                }
              } else {
                // Non-paginated response
                console.log(`  ${name}: ${propValue(fullProp)}`);
              }
            } catch {
              // Fallback to basic propValue
              console.log(`  ${name}: ${propValue(prop)}`);
            }
          } else {
            console.log(`  ${name}: ${propValue(prop)}`);
          }
        }
      }));
  },
};
