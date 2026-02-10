module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      paginate,
      jsonOutput,
      richTextToPlain,
      propValue,
      printTable,
      runCommand,
    } = ctx;

    program
      .command('search <query>')
      .description('Search across all pages and databases shared with your integration')
      .action(async (query, opts, cmd) => runCommand('Search', async () => {
        const notion = getNotion();
        const { results, response } = await paginate(
          ({ start_cursor, page_size }) => notion.search({ query, start_cursor, page_size }),
          { pageSizeLimit: 100 },
        );
        if (jsonOutput(cmd, response)) return;
        const rows = results.map(r => {
          let title = '';
          if (r.object === 'data_source' || r.object === 'database') {
            title = richTextToPlain(r.title);
          } else if (r.properties) {
            for (const [, prop] of Object.entries(r.properties)) {
              if (prop.type === 'title') {
                title = propValue(prop);
                break;
              }
            }
          }
          return {
            id: r.id,
            type: r.object,
            title: title || '(untitled)',
            url: r.url || '',
          };
        });
        printTable(rows, ['id', 'type', 'title', 'url']);
      }));
  },
};
