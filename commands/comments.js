module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      resolvePageId,
      paginate,
      jsonOutput,
      richTextToPlain,
      printTable,
      runCommand,
    } = ctx;

    // ─── comments ────────────────────────────────────────────────────────────
    program
      .command('comments <page-or-alias>')
      .description('List comments on a page by ID or alias + filter')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, opts, cmd) => runCommand('Comments', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        const { results, response } = await paginate(
          ({ start_cursor, page_size }) => notion.comments.list({
            block_id: pageId,
            start_cursor,
            page_size,
          }),
          { pageSizeLimit: 100 },
        );
        if (jsonOutput(cmd, response)) return;
        if (results.length === 0) {
          console.log('(no comments)');
          return;
        }
        const rows = results.map(c => ({
          id: c.id,
          text: richTextToPlain(c.rich_text),
          created: c.created_time || '',
          author: c.created_by?.name || c.created_by?.id || '',
        }));
        printTable(rows, ['id', 'text', 'created', 'author']);
      }));

    // ─── comment ─────────────────────────────────────────────────────────────
    program
      .command('comment <page-or-alias> <text>')
      .description('Add a comment to a page by ID or alias + filter')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, text, opts, cmd) => runCommand('Comment', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        const res = await notion.comments.create({
          parent: { page_id: pageId },
          rich_text: [{ text: { content: text } }],
        });
        if (jsonOutput(cmd, res)) return;
        console.log(`✅ Comment added: ${res.id}`);
      }));
  },
};
