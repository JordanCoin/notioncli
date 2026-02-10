// lib/markdown.js — Markdown/CSV parsing and conversion

const { richTextToPlain } = require('./format');

/**
 * Parse markdown text into Notion block objects.
 * Handles: headings, paragraphs, bullet lists, numbered lists, code blocks, quotes, dividers.
 */
function markdownToBlocks(md) {
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block (fenced)
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || 'plain text';
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
          language: lang,
        },
      });
      continue;
    }

    // Divider
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      i++;
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      blocks.push({
        object: 'block', type: 'heading_3',
        heading_3: { rich_text: parseInlineFormatting(line.slice(4)) },
      });
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({
        object: 'block', type: 'heading_2',
        heading_2: { rich_text: parseInlineFormatting(line.slice(3)) },
      });
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block', type: 'heading_1',
        heading_1: { rich_text: parseInlineFormatting(line.slice(2)) },
      });
      i++;
      continue;
    }

    // Quote
    if (line.startsWith('> ')) {
      blocks.push({
        object: 'block', type: 'quote',
        quote: { rich_text: parseInlineFormatting(line.slice(2)) },
      });
      i++;
      continue;
    }

    // Todo/checkbox (must check BEFORE bullet list since both start with -)
    if (line.startsWith('- [ ] ') || line.startsWith('- [x] ')) {
      const checked = line.startsWith('- [x] ');
      blocks.push({
        object: 'block', type: 'to_do',
        to_do: {
          rich_text: parseInlineFormatting(line.slice(6)),
          checked,
        },
      });
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*] /.test(line)) {
      blocks.push({
        object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: parseInlineFormatting(line.replace(/^[-*] /, '')) },
      });
      i++;
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      blocks.push({
        object: 'block', type: 'numbered_list_item',
        numbered_list_item: { rich_text: parseInlineFormatting(line.replace(/^\d+\.\s/, '')) },
      });
      i++;
      continue;
    }

    // Empty line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Default: paragraph
    blocks.push({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: parseInlineFormatting(line) },
    });
    i++;
  }

  return blocks;
}

/**
 * Parse inline markdown formatting (bold, italic, code, links) into rich_text array.
 */
function parseInlineFormatting(text) {
  const segments = [];
  // Simple regex-based parser for **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add plain text before match
    if (match.index > lastIdx) {
      segments.push({ type: 'text', text: { content: text.slice(lastIdx, match.index) } });
    }

    if (match[2]) {
      // **bold**
      segments.push({ type: 'text', text: { content: match[2] }, annotations: { bold: true } });
    } else if (match[3]) {
      // *italic*
      segments.push({ type: 'text', text: { content: match[3] }, annotations: { italic: true } });
    } else if (match[4]) {
      // `code`
      segments.push({ type: 'text', text: { content: match[4] }, annotations: { code: true } });
    } else if (match[5] && match[6]) {
      // [text](url)
      segments.push({ type: 'text', text: { content: match[5], link: { url: match[6] } } });
    }

    lastIdx = match.index + match[0].length;
  }

  // Add remaining plain text
  if (lastIdx < text.length) {
    segments.push({ type: 'text', text: { content: text.slice(lastIdx) } });
  }

  // If no formatting found, return simple text
  if (segments.length === 0) {
    return [{ type: 'text', text: { content: text } }];
  }

  return segments;
}

/**
 * Parse Notion blocks into markdown text.
 */
function blocksToMarkdown(blocks) {
  const lines = [];
  for (const block of blocks) {
    const type = block.type;
    switch (type) {
      case 'heading_1':
        lines.push(`# ${richTextToPlain(block.heading_1?.rich_text)}`);
        break;
      case 'heading_2':
        lines.push(`## ${richTextToPlain(block.heading_2?.rich_text)}`);
        break;
      case 'heading_3':
        lines.push(`### ${richTextToPlain(block.heading_3?.rich_text)}`);
        break;
      case 'paragraph':
        lines.push(richTextToPlain(block.paragraph?.rich_text));
        break;
      case 'bulleted_list_item':
        lines.push(`- ${richTextToPlain(block.bulleted_list_item?.rich_text)}`);
        break;
      case 'numbered_list_item':
        lines.push(`1. ${richTextToPlain(block.numbered_list_item?.rich_text)}`);
        break;
      case 'to_do': {
        const check = block.to_do?.checked ? 'x' : ' ';
        lines.push(`- [${check}] ${richTextToPlain(block.to_do?.rich_text)}`);
        break;
      }
      case 'quote':
        lines.push(`> ${richTextToPlain(block.quote?.rich_text)}`);
        break;
      case 'code':
        lines.push(`\`\`\`${block.code?.language || ''}`);
        lines.push(richTextToPlain(block.code?.rich_text));
        lines.push('```');
        break;
      case 'divider':
        lines.push('---');
        break;
      default:
        // Attempt generic rich_text extraction
        if (block[type]?.rich_text) {
          lines.push(richTextToPlain(block[type].rich_text));
        }
        break;
    }
  }
  return lines.join('\n');
}

/**
 * Parse CSV text into array of objects (rows).
 * First line is headers.
 */
function parseCsv(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

/** Parse a single CSV line, handling quoted fields */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Convert kebab-case flag name to a schema property match.
 * --due-date → "Due Date", --name → "Name", --status → "Status"
 */
function kebabToProperty(kebab, schema) {
  // Remove leading dashes
  const clean = kebab.replace(/^-+/, '');

  // Try exact lowercase match first
  if (schema[clean.toLowerCase()]) {
    return schema[clean.toLowerCase()];
  }

  // Try kebab → space conversion: "due-date" → "due date"
  const spaced = clean.replace(/-/g, ' ');
  if (schema[spaced.toLowerCase()]) {
    return schema[spaced.toLowerCase()];
  }

  // Try kebab → title case: "due-date" → "Due Date"
  const titled = clean.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (schema[titled.toLowerCase()]) {
    return schema[titled.toLowerCase()];
  }

  return null;
}

/**
 * Extract dynamic property flags from raw argv.
 * Returns array of "Key=Value" strings compatible with buildProperties.
 */
function extractDynamicProps(argv, knownFlags, schema) {
  const props = [];
  const known = new Set(knownFlags);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || arg === '--') continue;

    const flagName = arg.replace(/^--/, '');

    // Skip known commander flags
    if (known.has(flagName) || known.has(arg)) continue;

    // Try to match against schema
    const schemaEntry = kebabToProperty(flagName, schema);
    if (schemaEntry && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      props.push(`${schemaEntry.name}=${argv[i + 1]}`);
      i++; // skip value
    }
  }

  return props;
}

module.exports = {
  markdownToBlocks,
  parseInlineFormatting,
  blocksToMarkdown,
  parseCsv,
  parseCsvLine,
  kebabToProperty,
  extractDynamicProps,
};
