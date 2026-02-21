module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      resolvePageId,
      paginate,
      jsonOutput,
      richTextToPlain,
      runCommand,
      getWorkspaceConfig,
      parseInlineFormatting,
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
          
          // Handle child_page and child_database specially
          if (type === 'child_page') {
            text = content?.title || '(untitled)';
            const idTag = opts.ids ? `[${block.id}] ` : '';
            console.log(`${idTag}📄 ${text}`);
            continue;
          }
          if (type === 'child_database') {
            text = content?.title || '(untitled database)';
            const idTag = opts.ids ? `[${block.id}] ` : '';
            console.log(`${idTag}🗄️  ${text}`);
            continue;
          }
          if (type === 'divider') {
            console.log('---');
            continue;
          }
          
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

    // ─── children ─────────────────────────────────────────────────────────────
    program
      .command('children <page-or-alias>')
      .description('List child pages and databases under a page')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .action(async (target, opts, cmd) => runCommand('Children', async () => {
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
        
        const children = results.filter(b => b.type === 'child_page' || b.type === 'child_database');
        if (children.length === 0) {
          console.log('(no child pages or databases)');
          return;
        }
        
        console.log('');
        for (const block of children) {
          const type = block.type;
          const content = block[type];
          const title = content?.title || '(untitled)';
          const icon = type === 'child_page' ? '📄' : '🗄️';
          console.log(`${icon} ${title}`);
          console.log(`   ID: ${block.id}`);
          console.log('');
        }
        console.log(`${children.length} child item(s)`);
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
      .description('Append a block to a page by ID or alias + filter')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .option('--type <type>', 'Block type: paragraph, to_do, heading_1, heading_2, heading_3, bulleted_list_item, numbered_list_item, divider (default: paragraph)')
      .option('--checked', 'For to_do blocks: mark as checked')
      .action(async (target, text, opts, cmd) => runCommand('Append', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        
        const blockType = opts.type || 'paragraph';
        let block;
        
        // Parse markdown inline formatting (**bold**, *italic*, `code`, [links](url))
        const richText = parseInlineFormatting ? parseInlineFormatting(text) : [{ type: 'text', text: { content: text } }];
        
        if (blockType === 'divider') {
          block = { object: 'block', type: 'divider', divider: {} };
        } else if (blockType === 'to_do') {
          block = {
            object: 'block',
            type: 'to_do',
            to_do: {
              rich_text: richText,
              checked: opts.checked || false,
            },
          };
        } else if (['heading_1', 'heading_2', 'heading_3'].includes(blockType)) {
          block = {
            object: 'block',
            type: blockType,
            [blockType]: {
              rich_text: richText,
            },
          };
        } else if (['bulleted_list_item', 'numbered_list_item'].includes(blockType)) {
          block = {
            object: 'block',
            type: blockType,
            [blockType]: {
              rich_text: richText,
            },
          };
        } else {
          // Default: paragraph
          block = {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: richText,
            },
          };
        }
        
        const res = await notion.blocks.children.append({
          block_id: pageId,
          children: [block],
        });
        if (jsonOutput(cmd, res)) return;
        console.log(`✅ Appended ${blockType} block to page ${pageId}`);
      }));

    // ─── table ───────────────────────────────────────────────────────────────
    program
      .command('table <page-or-alias>')
      .description('Create a table in a page. Provide rows as --row "cell1|cell2|cell3"')
      .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
      .option('--row <cells>', 'Table row with cells separated by |. First --row is the header. Repeat for each row.', (val, prev) => prev.concat([val]), [])
      .option('--header', 'First row has column headers (default: true)')
      .action(async (target, opts, cmd) => runCommand('Table', async () => {
        const notion = getNotion();
        const { pageId } = await resolvePageId(target, opts.filter);
        
        if (!opts.row || opts.row.length === 0) {
          console.error('Error: At least one --row is required');
          console.error('Example: notion table workouts --filter "Name=PUSH #8" --row "Exercise|Sets|Reps|Weight" --row "Bench Press|3|8|32.5lb"');
          process.exit(1);
        }
        
        // Parse rows into cells
        const rows = opts.row.map(r => r.split('|').map(cell => cell.trim()));
        const columnCount = rows[0].length;
        
        // Validate all rows have same column count
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].length !== columnCount) {
            console.error(`Error: Row ${i + 1} has ${rows[i].length} cells, expected ${columnCount}`);
            process.exit(1);
          }
        }
        
        // Build table_row blocks
        const tableRows = rows.map(row => ({
          object: 'block',
          type: 'table_row',
          table_row: {
            cells: row.map(cellText => [{ type: 'text', text: { content: cellText } }]),
          },
        }));
        
        // Create table block with children
        const hasHeader = opts.header !== false; // default true
        const res = await notion.blocks.children.append({
          block_id: pageId,
          children: [{
            object: 'block',
            type: 'table',
            table: {
              table_width: columnCount,
              has_column_header: hasHeader,
              has_row_header: false,
              children: tableRows,
            },
          }],
        });
        
        if (jsonOutput(cmd, res)) return;
        console.log(`✅ Created table with ${rows.length} rows × ${columnCount} columns in page ${pageId}`);
      }));

    // ─── table-read ──────────────────────────────────────────────────────────
    program
      .command('table-read <table-block-id>')
      .description('Read table contents as CSV or JSON')
      .option('--output <format>', 'Output format: table, csv, json (default: table)')
      .action(async (tableBlockId, opts, cmd) => runCommand('Table read', async () => {
        const notion = getNotion();
        
        // Fetch table block children (rows)
        const { results } = await paginate(
          ({ start_cursor, page_size }) => notion.blocks.children.list({
            block_id: tableBlockId,
            start_cursor,
            page_size,
          }),
          { pageSizeLimit: 100 },
        );
        
        if (results.length === 0) {
          console.log('(empty table)');
          return;
        }
        
        // Parse rows
        const rows = results.map(row => {
          if (row.type !== 'table_row') return null;
          return row.table_row.cells.map(cell => 
            cell.map(rt => rt.plain_text || '').join('')
          );
        }).filter(Boolean);
        
        if (opts.output === 'json') {
          // Convert to array of objects using first row as headers
          const headers = rows[0];
          const data = rows.slice(1).map(row => {
            const obj = {};
            headers.forEach((h, i) => obj[h] = row[i] || '');
            return obj;
          });
          console.log(JSON.stringify(data, null, 2));
        } else if (opts.output === 'csv') {
          rows.forEach(row => console.log(row.join(',')));
        } else {
          // Default: formatted table
          const colWidths = rows[0].map((_, i) => 
            Math.max(...rows.map(r => (r[i] || '').length))
          );
          rows.forEach((row, ri) => {
            const line = row.map((cell, i) => cell.padEnd(colWidths[i])).join(' │ ');
            console.log(line);
            if (ri === 0) {
              console.log(colWidths.map(w => '─'.repeat(w)).join('─┼─'));
            }
          });
        }
      }));

    // ─── workout-next ────────────────────────────────────────────────────────
    program
      .command('workout-next <workout-type>')
      .description('Generate next workout with progressive overload. Type: PUSH, PULL, LEGS')
      .option('--preview', 'Show what would be created without creating it')
      .action(async (workoutType, opts, cmd) => runCommand('Workout next', async () => {
        const notion = getNotion();
        const type = workoutType.toUpperCase();
        
        if (!['PUSH', 'PULL', 'LEGS'].includes(type)) {
          console.error('Error: Workout type must be PUSH, PULL, or LEGS');
          process.exit(1);
        }
        
        // Find the workouts database using context
        const wsConfig = getWorkspaceConfig();
        const aliases = wsConfig.aliases || {};
        if (!aliases.workouts) {
          console.error('Error: No "workouts" database alias found. Run: notion alias add workouts <db-id>');
          process.exit(1);
        }
        
        // Query last completed workout of this type
        const { results } = await paginate(
          ({ start_cursor, page_size }) => notion.dataSources.query({
            data_source_id: aliases.workouts.data_source_id,
            start_cursor,
            page_size,
            filter: {
              and: [
                { property: 'Workout', select: { equals: type } },
                { property: 'Status', select: { equals: 'Complete' } },
              ],
            },
            sorts: [{ property: 'Date', direction: 'descending' }],
          }),
          { pageSizeLimit: 1 },
        );
        
        if (results.length === 0) {
          console.error(`No completed ${type} workouts found to base progression on.`);
          process.exit(1);
        }
        
        const lastWorkout = results[0];
        const lastDate = lastWorkout.properties.Date?.date?.start;
        const lastName = lastWorkout.properties.Name?.title?.[0]?.plain_text || type;
        const lastNotes = lastWorkout.properties.Notes?.rich_text?.[0]?.plain_text || '';
        
        // Find the table in the last workout
        const { results: blocks } = await paginate(
          ({ start_cursor, page_size }) => notion.blocks.children.list({
            block_id: lastWorkout.id,
            start_cursor,
            page_size,
          }),
          { pageSizeLimit: 100 },
        );
        
        const tableBlock = blocks.find(b => b.type === 'table');
        let headers, exercises;
        
        if (tableBlock) {
          // New format: read from table
          const { results: tableRows } = await paginate(
            ({ start_cursor, page_size }) => notion.blocks.children.list({
              block_id: tableBlock.id,
              start_cursor,
              page_size,
            }),
            { pageSizeLimit: 100 },
          );
          
          const rows = tableRows.map(row => {
            if (row.type !== 'table_row') return null;
            return row.table_row.cells.map(cell => 
              cell.map(rt => rt.plain_text || '').join('')
            );
          }).filter(Boolean);
          
          if (rows.length < 2) {
            console.error('Table has no exercise rows.');
            process.exit(1);
          }
          
          headers = rows[0];
          exercises = rows.slice(1);
        } else if (lastNotes) {
          // Old format: parse Notes field
          // Format: "PUSH #7 ✅ | Bench 30lb 3x10 | OHP Bar+25lb 3x8 | ..."
          headers = ['Exercise', 'Sets × Reps', 'Target Weight', 'Actual', '✓'];
          exercises = [];
          
          // Split by | and parse each exercise
          const parts = lastNotes.split('|').map(p => p.trim()).filter(p => p);
          for (const part of parts) {
            // Skip title/header parts
            if (part.includes('#') || part.includes('Progressive') || part.includes('Goal')) continue;
            
            // Parse: "Bench 30lb 3x10" or "Bench (DB) 32.5lb 3x8"
            const match = part.match(/^(.+?)\s+([\d.]+(?:lb)?)\s*(\d+)[×x](\d+)/i);
            if (match) {
              const exercise = match[1].trim();
              const weight = match[2];
              const sets = match[3];
              const reps = match[4];
              // Check if it was completed (✅ in the original notes often indicates completion)
              const completed = lastNotes.includes('✅') ? '✓' : '';
              exercises.push([exercise, `${sets}×${reps}`, weight, completed, completed]);
            }
          }
          
          if (exercises.length === 0) {
            console.error('Could not parse exercises from Notes field.');
            console.log('Notes:', lastNotes);
            process.exit(1);
          }
        } else {
          console.error('Last workout has no table and no Notes. Cannot calculate progression.');
          process.exit(1);
        }
        
        // Calculate progression
        // Progressive overload: if you hit target reps, add weight; else add reps
        const progression = exercises.map(row => {
          const exercise = row[0];
          const setsReps = row[1]; // e.g., "3×8"
          const targetWeight = row[2]; // e.g., "32.5lb each"
          const actual = row[3] || ''; // What they actually did
          
          // Parse sets×reps
          const match = setsReps.match(/(\d+)[×x](\d+)/i);
          const sets = match ? parseInt(match[1]) : 3;
          const reps = match ? parseInt(match[2]) : 8;
          
          // Parse weight (extract number)
          const weightMatch = targetWeight.match(/([\d.]+)/);
          const weight = weightMatch ? parseFloat(weightMatch[1]) : 0;
          const weightUnit = targetWeight.replace(/[\d.]+/, '').trim() || 'lb';
          
          // Progression logic
          let newSets = sets;
          let newReps = reps;
          let newWeight = weight;
          let note = '';
          
          if (actual && actual.toLowerCase().includes('✓')) {
            // Hit the target - progress!
            if (reps < 10) {
              newReps = reps + 2; // Build to 3×10
              note = 'build reps';
            } else {
              newWeight = weight + 2.5; // Add weight
              newReps = 8; // Reset reps
              note = 'weight bump';
            }
          } else if (actual) {
            // Didn't hit target - repeat
            note = 'repeat';
          } else {
            // No data - assume progression
            note = 'target';
          }
          
          return {
            exercise,
            sets: newSets,
            reps: newReps,
            weight: newWeight,
            weightUnit,
            note,
            original: { setsReps, targetWeight },
          };
        });
        
        // Find the highest workout number for this type
        const { results: allWorkouts } = await paginate(
          ({ start_cursor, page_size }) => notion.dataSources.query({
            data_source_id: aliases.workouts.data_source_id,
            start_cursor,
            page_size,
            filter: { property: 'Workout', select: { equals: type } },
          }),
          { pageSizeLimit: 100 },
        );
        
        let maxNum = 0;
        for (const w of allWorkouts) {
          const name = w.properties.Name?.title?.[0]?.plain_text || '';
          const numMatch = name.match(/#(\d+)/);
          if (numMatch) {
            maxNum = Math.max(maxNum, parseInt(numMatch[1]));
          }
        }
        const nextNum = maxNum + 1;
        const nextName = `${type} #${nextNum}`;
        
        // Calculate next date (find next scheduled workout of this type or add days)
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + 1); // Default: tomorrow
        const nextDateStr = nextDate.toISOString().split('T')[0];
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const nextDay = dayNames[nextDate.getDay()];
        
        if (opts.preview) {
          console.log(`\\n📋 ${nextName} (Preview)\\n`);
          console.log(`Based on: ${lastName} (${lastDate})\\n`);
          console.log('Progression:');
          progression.forEach(p => {
            console.log(`  ${p.exercise}: ${p.sets}×${p.reps} @ ${p.weight}${p.weightUnit} (${p.note})`);
          });
          console.log('\\nRun without --preview to create this workout.');
          return;
        }
        
        // Create the new workout page
        const newPage = await notion.pages.create({
          parent: { database_id: aliases.workouts.database_id },
          properties: {
            Name: { title: [{ text: { content: nextName } }] },
            Date: { date: { start: nextDateStr } },
            Day: { select: { name: nextDay } },
            Status: { select: { name: 'Scheduled' } },
            Workout: { select: { name: type } },
          },
        });
        
        // Add heading
        await notion.blocks.children.append({
          block_id: newPage.id,
          children: [{
            object: 'block',
            type: 'heading_2',
            heading_2: { rich_text: [{ text: { content: '🎯 Workout Plan' } }] },
          }],
        });
        
        // Add table with progression
        const tableRowBlocks = [
          // Header
          {
            object: 'block',
            type: 'table_row',
            table_row: {
              cells: headers.map(h => [{ type: 'text', text: { content: h } }]),
            },
          },
          // Exercise rows
          ...progression.map(p => ({
            object: 'block',
            type: 'table_row',
            table_row: {
              cells: [
                [{ type: 'text', text: { content: p.exercise } }],
                [{ type: 'text', text: { content: `${p.sets}×${p.reps}` } }],
                [{ type: 'text', text: { content: `${p.weight}${p.weightUnit}` } }],
                [{ type: 'text', text: { content: '' } }], // Actual
                [{ type: 'text', text: { content: '' } }], // Checkmark
              ],
            },
          })),
        ];
        
        await notion.blocks.children.append({
          block_id: newPage.id,
          children: [{
            object: 'block',
            type: 'table',
            table: {
              table_width: 5,
              has_column_header: true,
              has_row_header: false,
              children: tableRowBlocks,
            },
          }],
        });
        
        // Add goal and notes section
        const goalText = progression.some(p => p.note === 'weight bump')
          ? 'Weight bumps this session! Focus on form with new weights.'
          : progression.some(p => p.note === 'build reps')
          ? 'Building reps toward 3×10 before next weight increase.'
          : 'Progressive overload in action. Get after it!';
        
        await notion.blocks.children.append({
          block_id: newPage.id,
          children: [
            { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: `Goal: ${goalText}` } }] } },
            { object: 'block', type: 'divider', divider: {} },
            { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: '📝 Session Notes' } }] } },
          ],
        });
        
        console.log(`\\n✅ Created ${nextName}`);
        console.log(`   Date: ${nextDateStr} (${nextDay})`);
        console.log(`   Based on: ${lastName}\\n`);
        console.log('Progression:');
        progression.forEach(p => {
          console.log(`   ${p.exercise}: ${p.sets}×${p.reps} @ ${p.weight}${p.weightUnit} (${p.note})`);
        });
        console.log(`\\n   URL: ${newPage.url}`);
      }));
  },
};
