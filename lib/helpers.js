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
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    // Corrupted config — start fresh
  }
  return { aliases: {} };
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
    case 'relation':
      return (prop.relation || []).map(r => r.id).join(', ');
    case 'rollup':
      return JSON.stringify(prop.rollup);
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
 * Build a Notion filter object from a schema entry and key=value string.
 * Pure logic portion — does not call the API (schema must be provided).
 */
function buildFilterFromSchema(schema, filterStr) {
  const eqIdx = filterStr.indexOf('=');
  if (eqIdx === -1) {
    return { error: `Invalid filter format: ${filterStr} (expected key=value)` };
  }
  const key = filterStr.slice(0, eqIdx);
  const value = filterStr.slice(eqIdx + 1);
  const schemaEntry = schema[key.toLowerCase()];
  if (!schemaEntry) {
    return {
      error: `Filter property "${key}" not found in database schema.`,
      available: Object.values(schema).map(s => s.name),
    };
  }

  const propName = schemaEntry.name;
  const type = schemaEntry.type;

  switch (type) {
    case 'title':
    case 'rich_text':
      return { filter: { property: propName, [type]: { contains: value } } };
    case 'select':
      return { filter: { property: propName, select: { equals: value } } };
    case 'multi_select':
      return { filter: { property: propName, multi_select: { contains: value } } };
    case 'number':
      return { filter: { property: propName, number: { equals: Number(value) } } };
    case 'checkbox':
      return { filter: { property: propName, checkbox: { equals: value === 'true' || value === '1' } } };
    case 'date':
      return { filter: { property: propName, date: { equals: value } } };
    case 'status':
      return { filter: { property: propName, status: { equals: value } } };
    default:
      return { filter: { property: propName, [type]: { equals: value } } };
  }
}

module.exports = {
  getConfigPaths,
  loadConfig,
  saveConfig,
  richTextToPlain,
  propValue,
  buildPropValue,
  printTable,
  pagesToRows,
  formatCsv,
  formatYaml,
  outputFormatted,
  buildFilterFromSchema,
  UUID_REGEX,
};
