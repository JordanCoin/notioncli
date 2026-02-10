// lib/helpers.js — Pure functions extracted from bin/notion.js for testability

const fs = require('fs');
const path = require('path');

// ─── Config file system ────────────────────────────────────────────────────────

function getConfigPaths(overrideDir) {
  const configDir = overrideDir || path.join(
    process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'),
    'notioncli'
  );
  return {
    CONFIG_DIR: configDir,
    CONFIG_PATH: path.join(configDir, 'config.json'),
  };
}

function loadConfig(configPath) {
  let config;
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    // Corrupted config — start fresh
  }
  if (!config) config = { activeWorkspace: 'default', workspaces: { default: { aliases: {} } } };
  return migrateConfig(config);
}

/**
 * Migrate old flat config → multi-workspace format.
 * Old: { apiKey, aliases }
 * New: { activeWorkspace, workspaces: { name: { apiKey, aliases } } }
 */
function migrateConfig(config) {
  if (config.workspaces) return config; // already migrated
  // Old format detected — wrap in "default" workspace
  const ws = { aliases: config.aliases || {} };
  if (config.apiKey) ws.apiKey = config.apiKey;
  return { activeWorkspace: 'default', workspaces: { default: ws } };
}

/**
 * Get the config for a specific workspace (or the active one).
 * Returns { apiKey, aliases } for that workspace.
 */
function resolveWorkspace(config, workspaceName) {
  const name = workspaceName || config.activeWorkspace || 'default';
  const ws = config.workspaces && config.workspaces[name];
  if (!ws) {
    const available = config.workspaces ? Object.keys(config.workspaces) : [];
    return { error: `Unknown workspace: "${name}"`, available, name };
  }
  return { apiKey: ws.apiKey, aliases: ws.aliases || {}, name };
}

function saveConfig(config, configDir, configPath) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Extract plain text from rich_text array */
function richTextToPlain(rt) {
  if (!rt) return '';
  if (Array.isArray(rt)) return rt.map(r => r.plain_text || '').join('');
  return '';
}

/** Extract a readable value from a Notion property */
function propValue(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
      return richTextToPlain(prop.title);
    case 'rich_text':
      return richTextToPlain(prop.rich_text);
    case 'number':
      return prop.number != null ? String(prop.number) : '';
    case 'select':
      return prop.select ? prop.select.name : '';
    case 'multi_select':
      return (prop.multi_select || []).map(s => s.name).join(', ');
    case 'date':
      if (!prop.date) return '';
      return prop.date.end ? `${prop.date.start} → ${prop.date.end}` : prop.date.start;
    case 'checkbox':
      return prop.checkbox ? '✓' : '✗';
    case 'url':
      return prop.url || '';
    case 'email':
      return prop.email || '';
    case 'phone_number':
      return prop.phone_number || '';
    case 'status':
      return prop.status ? prop.status.name : '';
    case 'formula':
      if (prop.formula) {
        const f = prop.formula;
        return f.string || f.number?.toString() || f.boolean?.toString() || f.date?.start || '';
      }
      return '';
    case 'relation': {
      const rels = prop.relation || [];
      if (rels.length === 0) return '';
      if (rels.length === 1) return `→ ${rels[0].id.slice(0, 8)}…`;
      return `→ ${rels.length} linked`;
    }
    case 'rollup': {
      const r = prop.rollup;
      if (!r) return '';
      switch (r.type) {
        case 'number': return r.number != null ? String(r.number) : '';
        case 'date': return r.date ? (r.date.end ? `${r.date.start} → ${r.date.end}` : r.date.start) : '';
        case 'array': {
          if (!r.array || r.array.length === 0) return '';
          return r.array.map(item => propValue(item)).join(', ');
        }
        default: return JSON.stringify(r);
      }
    }
    case 'people':
      return (prop.people || []).map(p => p.name || p.id).join(', ');
    case 'files':
      return (prop.files || []).map(f => f.name || f.external?.url || '').join(', ');
    case 'created_time':
      return prop.created_time || '';
    case 'last_edited_time':
      return prop.last_edited_time || '';
    case 'created_by':
      return prop.created_by?.name || prop.created_by?.id || '';
    case 'last_edited_by':
      return prop.last_edited_by?.name || prop.last_edited_by?.id || '';
    default:
      return JSON.stringify(prop[prop.type] ?? '');
  }
}

/** Build property value for Notion API based on schema type */
function buildPropValue(type, value) {
  switch (type) {
    case 'title':
      return { title: [{ text: { content: value } }] };
    case 'rich_text':
      return { rich_text: [{ text: { content: value } }] };
    case 'number':
      return { number: Number(value) };
    case 'select':
      return { select: { name: value } };
    case 'multi_select':
      return { multi_select: value.split(',').map(v => ({ name: v.trim() })) };
    case 'date':
      return { date: { start: value } };
    case 'checkbox':
      return { checkbox: value === 'true' || value === '1' || value === 'yes' };
    case 'url':
      return { url: value };
    case 'email':
      return { email: value };
    case 'phone_number':
      return { phone_number: value };
    case 'status':
      return { status: { name: value } };
    default:
      return { [type]: value };
  }
}

/** Simple table formatter */
function printTable(rows, columns) {
  if (!rows || rows.length === 0) {
    console.log('(no results)');
    return;
  }

  const widths = {};
  for (const col of columns) {
    widths[col] = col.length;
  }
  for (const row of rows) {
    for (const col of columns) {
      const val = String(row[col] ?? '');
      widths[col] = Math.max(widths[col], val.length);
    }
  }
  for (const col of columns) {
    widths[col] = Math.min(widths[col], 50);
  }

  const header = columns.map(c => c.padEnd(widths[c])).join(' │ ');
  const separator = columns.map(c => '─'.repeat(widths[c])).join('─┼─');
  console.log(header);
  console.log(separator);

  for (const row of rows) {
    const line = columns.map(c => {
      let val = String(row[c] ?? '');
      if (val.length > 50) val = val.slice(0, 47) + '...';
      return val.padEnd(widths[c]);
    }).join(' │ ');
    console.log(line);
  }

  console.log(`\n${rows.length} result${rows.length !== 1 ? 's' : ''}`);
}

/** Convert pages to table rows */
function pagesToRows(pages) {
  return pages.map(page => {
    const row = { id: page.id };
    if (page.properties) {
      for (const [key, prop] of Object.entries(page.properties)) {
        row[key] = propValue(prop);
      }
    }
    return row;
  });
}

/** Format rows as CSV string */
function formatCsv(rows, columns) {
  if (!rows || rows.length === 0) return '(no results)';
  const escape = (val) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) {
    lines.push(columns.map(c => escape(row[c])).join(','));
  }
  return lines.join('\n');
}

/** Format rows as YAML string */
function formatYaml(rows, columns) {
  if (!rows || rows.length === 0) return '(no results)';
  const lines = [];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) lines.push('');
    lines.push(`- # result ${i + 1}`);
    for (const col of columns) {
      const val = String(rows[i][col] ?? '');
      const needsQuote = val.includes(':') || val.includes('#') || val.includes('"') || val.includes("'") || val.includes('\n') || val === '';
      lines.push(`  ${col}: ${needsQuote ? '"' + val.replace(/"/g, '\\"') + '"' : val}`);
    }
  }
  return lines.join('\n');
}

/** Output rows in the specified format */
function outputFormatted(rows, columns, format) {
  switch (format) {
    case 'csv':
      console.log(formatCsv(rows, columns));
      break;
    case 'yaml':
      console.log(formatYaml(rows, columns));
      break;
    case 'json':
      console.log(JSON.stringify(rows, null, 2));
      break;
    case 'table':
    default:
      printTable(rows, columns);
      break;
  }
}

/** UUID regex pattern used for validation */
const UUID_REGEX = /^[0-9a-f-]{32,36}$/i;

/**
 * Parse a filter string into { key, operator, value }.
 * Supports: >=, <=, !=, >, <, = (default)
 * Examples: "Status=Active", "Day>5", "Date>=2026-01-01", "Name!=Draft"
 */
function parseFilterOperator(filterStr) {
  // Order matters: check multi-char operators first
  const ops = ['>=', '<=', '!=', '>', '<', '='];
  for (const op of ops) {
    const idx = filterStr.indexOf(op);
    if (idx > 0) {
      return {
        key: filterStr.slice(0, idx),
        operator: op,
        value: filterStr.slice(idx + op.length),
      };
    }
  }
  return { error: `Invalid filter format: ${filterStr} (expected key=value, key>value, etc.)` };
}

/**
 * Resolve relative date keywords to ISO date strings.
 */
function resolveRelativeDate(value) {
  const lower = value.toLowerCase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (lower) {
    case 'today':
      return today.toISOString().split('T')[0];
    case 'yesterday': {
      const d = new Date(today); d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    }
    case 'tomorrow': {
      const d = new Date(today); d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    }
    case 'last_week': case 'last-week': {
      const d = new Date(today); d.setDate(d.getDate() - 7);
      return d.toISOString().split('T')[0];
    }
    case 'next_week': case 'next-week': {
      const d = new Date(today); d.setDate(d.getDate() + 7);
      return d.toISOString().split('T')[0];
    }
    default:
      return value; // Return as-is if not a keyword
  }
}

/**
 * Map { operator, type } to Notion filter condition.
 */
function operatorToCondition(type, operator, value) {
  // Resolve relative dates
  if (type === 'date') {
    value = resolveRelativeDate(value);
  }

  // Number coercion
  if (type === 'number') {
    value = Number(value);
  }

  // Checkbox coercion
  if (type === 'checkbox') {
    value = value === 'true' || value === '1' || value === 'yes';
  }

  // Map operators to Notion API condition names
  const conditionMap = {
    '=': getDefaultCondition(type, value),
    '!=': getNotEqualCondition(type, value),
    '>': { [getFilterType(type)]: { after: type === 'date' ? value : undefined, greater_than: type !== 'date' ? value : undefined } },
    '<': { [getFilterType(type)]: { before: type === 'date' ? value : undefined, less_than: type !== 'date' ? value : undefined } },
    '>=': { [getFilterType(type)]: { on_or_after: type === 'date' ? value : undefined, greater_than_or_equal_to: type !== 'date' ? value : undefined } },
    '<=': { [getFilterType(type)]: { on_or_before: type === 'date' ? value : undefined, less_than_or_equal_to: type !== 'date' ? value : undefined } },
  };

  const condition = conditionMap[operator];
  if (!condition) return null;

  // Clean undefined values
  const filterType = getFilterType(type);
  if (condition[filterType]) {
    const inner = condition[filterType];
    for (const k of Object.keys(inner)) {
      if (inner[k] === undefined) delete inner[k];
    }
  }

  return condition;
}

/** Get the Notion filter type key for a schema type */
function getFilterType(type) {
  // Most types use themselves as the filter key
  return type;
}

/** Default equals/contains condition for = operator */
function getDefaultCondition(type, value) {
  switch (type) {
    case 'title':
    case 'rich_text':
      return { [type]: { contains: value } };
    case 'select':
      return { select: { equals: value } };
    case 'multi_select':
      return { multi_select: { contains: value } };
    case 'number':
      return { number: { equals: value } };
    case 'checkbox':
      return { checkbox: { equals: value } };
    case 'date':
      return { date: { equals: value } };
    case 'status':
      return { status: { equals: value } };
    default:
      return { [type]: { equals: value } };
  }
}

/** Not-equal condition for != operator */
function getNotEqualCondition(type, value) {
  switch (type) {
    case 'title':
    case 'rich_text':
      return { [type]: { does_not_contain: value } };
    case 'select':
      return { select: { does_not_equal: value } };
    case 'multi_select':
      return { multi_select: { does_not_contain: value } };
    case 'number':
      return { number: { does_not_equal: value } };
    case 'checkbox':
      return { checkbox: { does_not_equal: value } };
    case 'date':
      // Notion doesn't have date does_not_equal; skip
      return { date: { does_not_equal: value } };
    case 'status':
      return { status: { does_not_equal: value } };
    default:
      return { [type]: { does_not_equal: value } };
  }
}

/**
 * Build a Notion filter object from a schema and a single filter string.
 * Supports operators: =, !=, >, <, >=, <=
 * Supports relative dates: today, yesterday, tomorrow, last_week, next_week
 */
function buildFilterFromSchema(schema, filterStr) {
  const parsed = parseFilterOperator(filterStr);
  if (parsed.error) return parsed;

  const { key, operator, value } = parsed;
  const schemaEntry = schema[key.toLowerCase()];
  if (!schemaEntry) {
    return {
      error: `Filter property "${key}" not found in database schema.`,
      available: Object.values(schema).map(s => s.name),
    };
  }

  const propName = schemaEntry.name;
  const type = schemaEntry.type;

  const condition = operatorToCondition(type, operator, value);
  if (!condition) {
    return { error: `Operator "${operator}" not supported for type "${type}"` };
  }

  return { filter: { property: propName, ...condition } };
}

/**
 * Build a compound AND filter from multiple filter strings.
 * Each filter is parsed independently, then combined with AND.
 */
function buildCompoundFilter(schema, filterStrs) {
  if (!Array.isArray(filterStrs) || filterStrs.length === 0) {
    return { error: 'No filters provided' };
  }
  if (filterStrs.length === 1) {
    return buildFilterFromSchema(schema, filterStrs[0]);
  }

  const filters = [];
  for (const f of filterStrs) {
    const result = buildFilterFromSchema(schema, f);
    if (result.error) return result;
    filters.push(result.filter);
  }

  return { filter: { and: filters } };
}

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
  getConfigPaths,
  loadConfig,
  migrateConfig,
  resolveWorkspace,
  saveConfig,
  richTextToPlain,
  propValue,
  buildPropValue,
  printTable,
  pagesToRows,
  formatCsv,
  formatYaml,
  outputFormatted,
  parseFilterOperator,
  resolveRelativeDate,
  buildFilterFromSchema,
  buildCompoundFilter,
  markdownToBlocks,
  parseInlineFormatting,
  blocksToMarkdown,
  parseCsv,
  kebabToProperty,
  extractDynamicProps,
  UUID_REGEX,
};
