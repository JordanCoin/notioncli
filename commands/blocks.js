module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      resolvePageId,
      paginate,
      jsonOutput,
      richTextToPlain,
      runCommand,
    } = ctx;

    // ─── blocks ───────────────────────────────────────────────────────────────
    program
      .command('blocks <page-or-alias>')
      .description('Get page content as rendered blocks by ID or alias + filter')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .option('--ids', 'Show block IDs alongside content (for editing/deleting)')
      .action(async (target, opts, cmd) => runCommand('Blocks', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        const { results, response } = await paginate(
          ({ start_cursor, page_size }) => notion.blocks.children.list({
            block_id: pageId,
            start_cursor,
            page_size,
          }),
          { pageSizeLimit: 100 },
        );
        if (jsonOutput(cmd, response)) return;
        if (results.length === 0) {
          console.log('(no blocks)');
          return;
        }
        for (const block of results) {
          const type = block.type;
          const content = block[type];
          let text = '';
          if (content?.rich_text) {
            text = richTextToPlain(content.rich_text);
          } else if (content?.text) {
            text = richTextToPlain(content.text);
          }
          const prefix = type === 'heading_1' ? '# '
            : type === 'heading_2' ? '## '
            : type === 'heading_3' ? '### '
            : type === 'bulleted_list_item' ? '• '
            : type === 'numbered_list_item' ? '  1. '
            : type === 'to_do' ? (content?.checked ? '☑ ' : '☐ ')
            : type === 'code' ? '```\n'
            : '';
          const suffix = type === 'code' ? '\n```' : '';
          const idTag = opts.ids ? `[${block.id.slice(0, 8)}] ` : '';
          console.log(`${idTag}${prefix}${text}${suffix}`);
        }
      }));

    // ─── block-edit ───────────────────────────────────────────────────────────
    program
      .command('block-edit <block-id> <text>')
      .description('Update a block\'s text content')
      .action(async (blockId, text, opts, cmd) => runCommand('Block edit', async () => {
        const notion = getNotion();
        // First retrieve the block to know its type
        const block = await notion.blocks.retrieve({ block_id: blockId });
        const type = block.type;

        // Build the update payload based on block type
        const supportedTextTypes = [
          'paragraph', 'heading_1', 'heading_2', 'heading_3',
          'bulleted_list_item', 'numbered_list_item', 'quote', 'callout', 'toggle',
        ];

        if (type === 'to_do') {
          const res = await notion.blocks.update({
            block_id: blockId,
            to_do: {
              rich_text: [{ text: { content: text } }],
              checked: block.to_do?.checked || false,
            },
          });
          if (jsonOutput(cmd, res)) return;
          console.log(`✅ Updated ${type} block: ${blockId.slice(0, 8)}…`);
        } else if (supportedTextTypes.includes(type)) {
          const res = await notion.blocks.update({
            block_id: blockId,
            [type]: {
              rich_text: [{ text: { content: text } }],
            },
          });
          if (jsonOutput(cmd, res)) return;
          console.log(`✅ Updated ${type} block: ${blockId.slice(0, 8)}…`);
        } else if (type === 'code') {
          const res = await notion.blocks.update({
            block_id: blockId,
            code: {
              rich_text: [{ text: { content: text } }],
              language: block.code?.language || 'plain text',
            },
          });
          if (jsonOutput(cmd, res)) return;
          console.log(`✅ Updated code block: ${blockId.slice(0, 8)}…`);
        } else {
          console.error(`Block type "${type}" doesn't support text editing.`);
          console.error('Supported types: paragraph, headings, lists, to_do, quote, callout, toggle, code');
          process.exit(1);
        }
      }));

    // ─── block-delete ─────────────────────────────────────────────────────────
    program
      .command('block-delete <block-id>')
      .description('Delete a block from a page')
      .action(async (blockId, opts, cmd) => runCommand('Block delete', async () => {
        const notion = getNotion();
        const res = await notion.blocks.delete({ block_id: blockId });
        if (jsonOutput(cmd, res)) return;
        console.log(`🗑️  Deleted block: ${blockId.slice(0, 8)}…`);
      }));

    // ─── append ──────────────────────────────────────────────────────────────
    program
      .command('append <page-or-alias> <text>')
      .description('Append a text block to a page by ID or alias + filter')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, text, opts, cmd) => runCommand('Append', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        const res = await notion.blocks.children.append({
          block_id: pageId,
          children: [{
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ text: { content: text } }],
            },
          }],
        });
        if (jsonOutput(cmd, res)) return;
        console.log(`✅ Appended text block to page ${pageId}`);
      }));
  },
};
