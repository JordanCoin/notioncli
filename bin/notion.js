#!/usr/bin/env node

const { program } = require('commander');
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

// ─── Config file system ────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'),
  'notioncli'
);
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (err) {
    // Corrupted config — start fresh
  }
  return { aliases: {} };
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Resolve API key: env var → config file → error with setup instructions
 */
function getApiKey() {
  if (process.env.NOTION_API_KEY) return process.env.NOTION_API_KEY;
  const config = loadConfig();
  if (config.apiKey) return config.apiKey;
  console.error('Error: No Notion API key found.');
  console.error('');
  console.error('Set it up with one of:');
  console.error('  1. notion init --key ntn_your_api_key');
  console.error('  2. export NOTION_API_KEY=ntn_your_api_key');
  console.error('');
  console.error('Get a key at: https://www.notion.so/profile/integrations');
  process.exit(1);
}

/**
 * Resolve a user-given alias or UUID to { database_id, data_source_id }.
 * If given a raw UUID, we use it for both IDs (the SDK figures it out).
 */
function resolveDb(aliasOrId) {
  const config = loadConfig();
  if (config.aliases && config.aliases[aliasOrId]) {
    return config.aliases[aliasOrId];
  }
  if (/^[0-9a-f-]{32,36}$/i.test(aliasOrId)) {
    return { database_id: aliasOrId, data_source_id: aliasOrId };
  }
  const aliasNames = config.aliases ? Object.keys(config.aliases) : [];
  console.error(`Unknown database alias: "${aliasOrId}"`);
  if (aliasNames.length > 0) {
    console.error(`Available aliases: ${aliasNames.join(', ')}`);
  } else {
    console.error('No aliases configured. Add one with: notion alias add <name> <database-id>');
  }
  process.exit(1);
}

// ─── Lazy Notion client ────────────────────────────────────────────────────────

let _notion = null;
function getNotion() {
  if (!_notion) {
    _notion = new Client({ auth: getApiKey() });
  }
  return _notion;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Check if --json flag is set anywhere in the command chain */
function getGlobalJson(cmd) {
  let c = cmd;
  while (c) {
    if (c.opts().json) return true;
    c = c.parent;
  }
  return false;
}

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
      console.error(`Unsupported property type: ${type} — passing raw value`);
      return { [type]: value };
  }
}

/**
 * Fetch data source schema — returns map of lowercase_name → { type, name }
 * Uses dataSources.retrieve() which accepts the data_source_id.
 */
async function getDbSchema(dbIds) {
  const notion = getNotion();
  const dsId = dbIds.data_source_id;
  const ds = await notion.dataSources.retrieve({ data_source_id: dsId });
  const schema = {};
  for (const [name, prop] of Object.entries(ds.properties)) {
    schema[name.toLowerCase()] = { type: prop.type, name };
  }
  return schema;
}

/** Build properties object from --prop key=value pairs using schema */
async function buildProperties(dbIds, props) {
  const schema = await getDbSchema(dbIds);
  const properties = {};

  for (const kv of props) {
    const eqIdx = kv.indexOf('=');
    if (eqIdx === -1) {
      console.error(`Invalid property format: ${kv} (expected key=value)`);
      process.exit(1);
    }
    const key = kv.slice(0, eqIdx);
    const value = kv.slice(eqIdx + 1);

    const schemaEntry = schema[key.toLowerCase()];
    if (!schemaEntry) {
      console.error(`Property "${key}" not found in database schema.`);
      console.error(`Available: ${Object.values(schema).map(s => s.name).join(', ')}`);
      process.exit(1);
    }

    properties[schemaEntry.name] = buildPropValue(schemaEntry.type, value);
  }

  return properties;
}

/** Parse filter string key=value into a Notion filter object */
async function buildFilter(dbIds, filterStr) {
  const schema = await getDbSchema(dbIds);
  const eqIdx = filterStr.indexOf('=');
  if (eqIdx === -1) {
    console.error(`Invalid filter format: ${filterStr} (expected key=value)`);
    process.exit(1);
  }
  const key = filterStr.slice(0, eqIdx);
  const value = filterStr.slice(eqIdx + 1);
  const schemaEntry = schema[key.toLowerCase()];
  if (!schemaEntry) {
    console.error(`Filter property "${key}" not found in database schema.`);
    console.error(`Available: ${Object.values(schema).map(s => s.name).join(', ')}`);
    process.exit(1);
  }

  const propName = schemaEntry.name;
  const type = schemaEntry.type;

  switch (type) {
    case 'title':
    case 'rich_text':
      return { property: propName, [type]: { contains: value } };
    case 'select':
      return { property: propName, select: { equals: value } };
    case 'multi_select':
      return { property: propName, multi_select: { contains: value } };
    case 'number':
      return { property: propName, number: { equals: Number(value) } };
    case 'checkbox':
      return { property: propName, checkbox: { equals: value === 'true' || value === '1' } };
    case 'date':
      return { property: propName, date: { equals: value } };
    case 'status':
      return { property: propName, status: { equals: value } };
    default:
      return { property: propName, [type]: { equals: value } };
  }
}

// ─── Commands ──────────────────────────────────────────────────────────────────

program
  .name('notion')
  .description('A powerful CLI for the Notion API — query databases, manage pages, and automate your workspace from the terminal.')
  .version('1.0.0')
  .option('--json', 'Output raw JSON instead of formatted tables');

// ─── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize notioncli with your API key and discover databases')
  .option('--key <api-key>', 'Notion integration API key (starts with ntn_)')
  .action(async (opts) => {
    const config = loadConfig();
    const apiKey = opts.key || process.env.NOTION_API_KEY;

    if (!apiKey) {
      console.error('Error: Provide an API key with --key or set NOTION_API_KEY env var.');
      console.error('');
      console.error('To create an integration:');
      console.error('  1. Go to https://www.notion.so/profile/integrations');
      console.error('  2. Click "New integration"');
      console.error('  3. Copy the API key (starts with ntn_)');
      console.error('  4. Share your databases with the integration');
      console.error('');
      console.error('Then run: notion init --key ntn_your_api_key');
      process.exit(1);
    }

    config.apiKey = apiKey;
    saveConfig(config);
    console.log(`✅ API key saved to ${CONFIG_PATH}`);
    console.log('');

    // Discover databases
    const notion = new Client({ auth: apiKey });
    try {
      const res = await notion.search({
        filter: { value: 'data_source', property: 'object' },
        page_size: 100,
      });

      if (res.results.length === 0) {
        console.log('No databases found. Make sure you\'ve shared databases with your integration.');
        console.log('In Notion: open a database → ••• menu → Connections → Add your integration');
        return;
      }

      console.log(`Found ${res.results.length} database${res.results.length !== 1 ? 's' : ''}:`);
      console.log('');
      for (const db of res.results) {
        const title = richTextToPlain(db.title) || '(untitled)';
        const id = db.id;
        // Suggest a slug-friendly alias
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
        console.log(`  ${title}`);
        console.log(`    ID: ${id}`);
        console.log(`    Add alias: notion alias add ${slug || 'mydb'} ${id}`);
        console.log('');
      }
    } catch (err) {
      console.error(`Failed to discover databases: ${err.message}`);
      console.error('Your API key was saved. You can add databases manually with: notion alias add <name> <id>');
    }
  });

// ─── alias ─────────────────────────────────────────────────────────────────────
const alias = program
  .command('alias')
  .description('Manage database aliases for quick access');

alias
  .command('add <name> <database-id>')
  .description('Add a database alias (auto-discovers data_source_id)')
  .action(async (name, databaseId) => {
    const config = loadConfig();
    if (!config.aliases) config.aliases = {};

    // Try to discover the data_source_id by searching for this database
    const notion = getNotion();
    let dataSourceId = databaseId;

    try {
      const res = await notion.search({
        filter: { value: 'data_source', property: 'object' },
        page_size: 100,
      });

      const match = res.results.find(db => {
        // Match by data_source_id or database_id
        return db.id === databaseId ||
               db.id.replace(/-/g, '') === databaseId.replace(/-/g, '');
      });

      if (match) {
        dataSourceId = match.id;
        // The database_id might differ from data_source_id
        const dbId = match.database_id || databaseId;
        config.aliases[name] = {
          database_id: dbId,
          data_source_id: dataSourceId,
        };
        const title = richTextToPlain(match.title) || '(untitled)';
        console.log(`✅ Added alias "${name}" → ${title}`);
        console.log(`   database_id:    ${dbId}`);
        console.log(`   data_source_id: ${dataSourceId}`);
      } else {
        // Couldn't find via search — use the ID for both
        config.aliases[name] = {
          database_id: databaseId,
          data_source_id: databaseId,
        };
        console.log(`✅ Added alias "${name}" → ${databaseId}`);
        console.log('   (Could not auto-discover data_source_id — using same ID for both)');
      }
    } catch (err) {
      // Fallback: use same ID for both
      config.aliases[name] = {
        database_id: databaseId,
        data_source_id: databaseId,
      };
      console.log(`✅ Added alias "${name}" → ${databaseId}`);
      console.log(`   (Auto-discovery failed: ${err.message})`);
    }

    saveConfig(config);
  });

alias
  .command('list')
  .description('Show all configured database aliases')
  .action(() => {
    const config = loadConfig();
    const aliases = config.aliases || {};
    const names = Object.keys(aliases);

    if (names.length === 0) {
      console.log('No aliases configured.');
      console.log('Add one with: notion alias add <name> <database-id>');
      return;
    }

    const rows = names.map(name => ({
      alias: name,
      database_id: aliases[name].database_id,
      data_source_id: aliases[name].data_source_id,
    }));
    printTable(rows, ['alias', 'database_id', 'data_source_id']);
  });

alias
  .command('remove <name>')
  .description('Remove a database alias')
  .action((name) => {
    const config = loadConfig();
    if (!config.aliases || !config.aliases[name]) {
      console.error(`Alias "${name}" not found.`);
      const names = config.aliases ? Object.keys(config.aliases) : [];
      if (names.length > 0) {
        console.error(`Available: ${names.join(', ')}`);
      }
      process.exit(1);
    }
    delete config.aliases[name];
    saveConfig(config);
    console.log(`✅ Removed alias "${name}"`);
  });

// ─── search ────────────────────────────────────────────────────────────────────
program
  .command('search <query>')
  .description('Search across all pages and databases shared with your integration')
  .action(async (query, opts, cmd) => {
    try {
      const notion = getNotion();
      const res = await notion.search({ query, page_size: 20 });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      const rows = res.results.map(r => {
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
    } catch (err) {
      console.error('Search failed:', err.message);
      process.exit(1);
    }
  });

// ─── query ─────────────────────────────────────────────────────────────────────
program
  .command('query <database>')
  .description('Query a database by alias or ID (e.g. notion query projects --filter Status=Active)')
  .option('--filter <key=value>', 'Filter by property (e.g. Status=Active)')
  .option('--sort <key:direction>', 'Sort by property (e.g. Date:desc)')
  .option('--limit <n>', 'Max results (default: 100, max: 100)', '100')
  .action(async (db, opts, cmd) => {
    try {
      const notion = getNotion();
      const dbIds = resolveDb(db);
      const params = {
        data_source_id: dbIds.data_source_id,
        page_size: Math.min(parseInt(opts.limit), 100),
      };

      if (opts.filter) {
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

      const res = await notion.dataSources.query(params);
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      const rows = pagesToRows(res.results);
      if (rows.length === 0) {
        console.log('(no results)');
        return;
      }
      const columns = Object.keys(rows[0]);
      printTable(rows, columns);
    } catch (err) {
      console.error('Query failed:', err.message);
      process.exit(1);
    }
  });

// ─── add ───────────────────────────────────────────────────────────────────────
program
  .command('add <database>')
  .description('Add a new page to a database (e.g. notion add projects --prop "Name=New Task")')
  .option('--prop <key=value...>', 'Property value — repeatable (e.g. --prop "Name=Hello" --prop "Status=Todo")', (v, prev) => prev.concat([v]), [])
  .action(async (db, opts, cmd) => {
    try {
      const notion = getNotion();
      const dbIds = resolveDb(db);
      const properties = await buildProperties(dbIds, opts.prop);
      const res = await notion.pages.create({
        parent: { type: 'data_source_id', data_source_id: dbIds.data_source_id },
        properties,
      });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log(`✅ Created page: ${res.id}`);
      console.log(`   URL: ${res.url}`);
    } catch (err) {
      console.error('Add failed:', err.message);
      process.exit(1);
    }
  });

// ─── update ────────────────────────────────────────────────────────────────────
program
  .command('update <page-id>')
  .description('Update a page\'s properties (e.g. notion update abc123 --prop "Status=Done")')
  .option('--prop <key=value...>', 'Property value — repeatable', (v, prev) => prev.concat([v]), [])
  .action(async (pageId, opts, cmd) => {
    try {
      const notion = getNotion();
      const page = await notion.pages.retrieve({ page_id: pageId });
      const dsId = page.parent?.data_source_id;
      if (!dsId) {
        console.error('Page is not in a database — cannot auto-detect property types.');
        process.exit(1);
      }
      const dbIds = { data_source_id: dsId, database_id: page.parent?.database_id || dsId };
      const properties = await buildProperties(dbIds, opts.prop);
      const res = await notion.pages.update({ page_id: pageId, properties });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log(`✅ Updated page: ${res.id}`);
    } catch (err) {
      console.error('Update failed:', err.message);
      process.exit(1);
    }
  });

// ─── delete (archive) ──────────────────────────────────────────────────────────
program
  .command('delete <page-id>')
  .description('Delete (archive) a page by ID')
  .action(async (pageId, opts, cmd) => {
    try {
      const notion = getNotion();
      const res = await notion.pages.update({ page_id: pageId, archived: true });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log(`🗑️  Archived page: ${res.id}`);
      console.log('   (Restore it from the trash in Notion if needed)');
    } catch (err) {
      console.error('Delete failed:', err.message);
      process.exit(1);
    }
  });

// ─── get ───────────────────────────────────────────────────────────────────────
program
  .command('get <page-id>')
  .description('Get a page\'s properties by ID')
  .action(async (pageId, opts, cmd) => {
    try {
      const notion = getNotion();
      const page = await notion.pages.retrieve({ page_id: pageId });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(page, null, 2));
        return;
      }
      console.log(`Page: ${page.id}`);
      console.log(`URL:  ${page.url}`);
      console.log(`Created: ${page.created_time}`);
      console.log(`Updated: ${page.last_edited_time}`);
      console.log('');
      console.log('Properties:');
      for (const [name, prop] of Object.entries(page.properties)) {
        console.log(`  ${name}: ${propValue(prop)}`);
      }
    } catch (err) {
      console.error('Get failed:', err.message);
      process.exit(1);
    }
  });

// ─── blocks ────────────────────────────────────────────────────────────────────
program
  .command('blocks <page-id>')
  .description('Get page content as rendered blocks (headings, lists, text, etc.)')
  .action(async (pageId, opts, cmd) => {
    try {
      const notion = getNotion();
      const res = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      if (res.results.length === 0) {
        console.log('(no blocks)');
        return;
      }
      for (const block of res.results) {
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
        console.log(`${prefix}${text}${suffix}`);
      }
    } catch (err) {
      console.error('Blocks failed:', err.message);
      process.exit(1);
    }
  });

// ─── dbs ───────────────────────────────────────────────────────────────────────
program
  .command('dbs')
  .description('List all databases shared with your integration')
  .action(async (opts, cmd) => {
    try {
      const notion = getNotion();
      const res = await notion.search({
        filter: { value: 'data_source', property: 'object' },
        page_size: 100,
      });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      const rows = res.results.map(db => ({
        id: db.id,
        title: richTextToPlain(db.title),
        url: db.url || '',
      }));
      if (rows.length === 0) {
        console.log('No databases found. Make sure you\'ve shared databases with your integration.');
        console.log('In Notion: open a database → ••• menu → Connections → Add your integration');
        return;
      }
      printTable(rows, ['id', 'title', 'url']);
    } catch (err) {
      console.error('List databases failed:', err.message);
      process.exit(1);
    }
  });

// ─── Run ───────────────────────────────────────────────────────────────────────
program.parse();
