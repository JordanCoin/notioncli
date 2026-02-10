module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      resolveDb,
      buildFilter,
      getDbSchema,
      paginate,
      pagesToRows,
      outputFormatted,
      getGlobalJson,
      runCommand,
    } = ctx;

    program
      .command('query <database>')
      .description('Query a database by alias or ID (e.g. notion query projects --filter Status=Active)')
      .option('--filter <key=value...>', 'Filter by property — repeatable, supports operators: =, !=, >, <, >=, <= (e.g. --filter Status=Active --filter Day>5)', (v, prev) => prev.concat([v]), [])
      .option('--sort <key:direction>', 'Sort by property (e.g. Date:desc)')
      .option('--limit <n>', 'Max results (default: all)')
      .option('--output <format>', 'Output format: table, csv, json, yaml (default: table)')
      .action(async (db, opts, cmd) => runCommand('Query', async () => {
        const notion = getNotion();
        const dbIds = resolveDb(db);
        const limit = opts.limit == null ? null : parseInt(opts.limit, 10);
        if (opts.limit != null && (!Number.isFinite(limit) || limit < 0)) {
          console.error(`Invalid --limit value: ${opts.limit}`);
          process.exit(1);
        }
        const params = { data_source_id: dbIds.data_source_id };

        if (opts.filter && opts.filter.length > 0) {
          params.filter = await buildFilter(dbIds, opts.filter);
        }

        if (opts.sort) {
          const [key, dir] = opts.sort.split(':');
          const schema = await getDbSchema(dbIds);
          const entry = schema[key.toLowerCase()];
          if (!entry) {
            console.error(`Sort property "${key}" not found.`);
            console.error(`Available: ${Object.values(schema).map(s => s.name).join(', ')}`);
            process.exit(1);
          }
          params.sorts = [{ property: entry.name, direction: dir === 'desc' ? 'descending' : 'ascending' }];
        }

        const { results, response, truncated } = await paginate(
          ({ start_cursor, page_size }) => notion.dataSources.query({ ...params, start_cursor, page_size }),
          { limit, pageSizeLimit: 100 },
        );
        if (truncated) {
          console.error(`Warning: results truncated to ${limit}. Use --limit to increase or omit to fetch all results.`);
        }

        // Determine output format: --output takes precedence, --json is shorthand
        const format = opts.output || (getGlobalJson(cmd) ? 'json' : 'table');

        if (format === 'json') {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        const rows = pagesToRows(results);
        if (rows.length === 0) {
          console.log('(no results)');
          return;
        }
        const columns = Object.keys(rows[0]);
        outputFormatted(rows, columns, format);
      }));
  },
};
