#!/usr/bin/env node

const { program } = require('commander');
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const helpers = require('../lib/helpers');

// ─── Config file system ────────────────────────────────────────────────────────

const { CONFIG_DIR, CONFIG_PATH } = helpers.getConfigPaths();

function loadConfig() {
  return helpers.loadConfig(CONFIG_PATH);
}

function saveConfig(config) {
  helpers.saveConfig(config, CONFIG_DIR, CONFIG_PATH);
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
  if (UUID_REGEX.test(aliasOrId)) {
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

/**
 * Resolve alias + filter → page ID, or pass through a raw UUID.
 * Used by update, delete, get, blocks, comments, comment, append.
 *
 * Returns { pageId, dbIds } where dbIds is non-null when resolved via alias.
 */
async function resolvePageId(aliasOrId, filterStr) {
  const config = loadConfig();
  if (config.aliases && config.aliases[aliasOrId]) {
    if (!filterStr) {
      console.error('When using an alias, --filter is required to identify a specific page.');
      console.error(`Example: notion update ${aliasOrId} --filter "Name=My Page" --prop "Status=Done"`);
      process.exit(1);
    }
    const dbIds = config.aliases[aliasOrId];
    const notion = getNotion();
    const filter = await buildFilter(dbIds, filterStr);
    const res = await notion.dataSources.query({
      data_source_id: dbIds.data_source_id,
      filter,
      page_size: 5,
    });
    if (res.results.length === 0) {
      console.error('No matching page found.');
      process.exit(1);
    }
    if (res.results.length > 1) {
      console.error(`Multiple pages match (${res.results.length}). Use a more specific filter or pass a page ID directly.`);
      const rows = pagesToRows(res.results);
      const cols = Object.keys(rows[0]).slice(0, 4);
      printTable(rows, cols);
      process.exit(1);
    }
    return { pageId: res.results[0].id, dbIds };
  }
  // Check if it looks like a UUID — if not, it's probably a typo'd alias
  if (!UUID_REGEX.test(aliasOrId)) {
    const aliasNames = config.aliases ? Object.keys(config.aliases) : [];
    console.error(`Unknown alias: "${aliasOrId}"`);
    if (aliasNames.length > 0) {
      console.error(`Available aliases: ${aliasNames.join(', ')}`);
    } else {
      console.error('No aliases configured. Run: notion init --key <your-api-key>');
    }
    process.exit(1);
  }
  // Treat as raw page ID
  return { pageId: aliasOrId, dbIds: null };
}

// ─── Lazy Notion client ────────────────────────────────────────────────────────

let _notion = null;
function getNotion() {
  if (!_notion) {
    _notion = new Client({ auth: getApiKey() });
  }
  return _notion;
}

// ─── Helpers (imported from lib/helpers.js) ────────────────────────────────────

const {
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
} = helpers;

/** Check if --json flag is set anywhere in the command chain */
function getGlobalJson(cmd) {
  let c = cmd;
  while (c) {
    if (c.opts().json) return true;
    c = c.parent;
  }
  return false;
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
  const result = buildFilterFromSchema(schema, filterStr);
  if (result.error) {
    console.error(result.error);
    if (result.available) {
      console.error(`Available: ${result.available.join(', ')}`);
    }
    process.exit(1);
  }
  return result.filter;
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

      if (!config.aliases) config.aliases = {};

      console.log(`Found ${res.results.length} database${res.results.length !== 1 ? 's' : ''}:\n`);

      const added = [];
      for (const db of res.results) {
        const title = richTextToPlain(db.title) || '';
        const dsId = db.id;
        const dbId = db.database_id || dsId;

        // Auto-generate a slug from the title
        let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
        if (!slug) slug = `db-${dsId.slice(0, 8)}`;

        // Avoid collisions — append a number if needed
        let finalSlug = slug;
        let counter = 2;
        while (config.aliases[finalSlug] && config.aliases[finalSlug].data_source_id !== dsId) {
          finalSlug = `${slug}-${counter}`;
          counter++;
        }

        config.aliases[finalSlug] = {
          database_id: dbId,
          data_source_id: dsId,
        };

        console.log(`  ✅ ${finalSlug.padEnd(25)} → ${title || '(untitled)'}`);
        added.push(finalSlug);
      }

      saveConfig(config);
      console.log('');
      console.log(`${added.length} alias${added.length !== 1 ? 'es' : ''} saved automatically.`);
      console.log('');
      console.log('Ready! Try:');
      if (added.length > 0) {
        console.log(`  notion query ${added[0]}`);
        console.log(`  notion add ${added[0]} --prop "Name=Hello World"`);
      }
      console.log('');
      console.log('Manage aliases:');
      console.log('  notion alias list              — see all aliases');
      console.log('  notion alias rename <old> <new> — rename an alias');
      console.log('  notion alias remove <name>     — remove an alias');
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

alias
  .command('rename <old-name> <new-name>')
  .description('Rename a database alias')
  .action((oldName, newName) => {
    const config = loadConfig();
    if (!config.aliases || !config.aliases[oldName]) {
      console.error(`Alias "${oldName}" not found.`);
      const names = config.aliases ? Object.keys(config.aliases) : [];
      if (names.length > 0) {
        console.error(`Available: ${names.join(', ')}`);
      }
      process.exit(1);
    }
    if (config.aliases[newName]) {
      console.error(`Alias "${newName}" already exists. Remove it first or pick a different name.`);
      process.exit(1);
    }
    config.aliases[newName] = config.aliases[oldName];
    delete config.aliases[oldName];
    saveConfig(config);
    console.log(`✅ Renamed "${oldName}" → "${newName}"`);
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
  .option('--output <format>', 'Output format: table, csv, json, yaml (default: table)')
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

      // Determine output format: --output takes precedence, --json is shorthand
      const format = opts.output || (getGlobalJson(cmd) ? 'json' : 'table');

      if (format === 'json') {
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      const rows = pagesToRows(res.results);
      if (rows.length === 0) {
        console.log('(no results)');
        return;
      }
      const columns = Object.keys(rows[0]);
      outputFormatted(rows, columns, format);
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
  .command('update <page-or-alias>')
  .description('Update a page\'s properties by ID or alias + filter')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .option('--prop <key=value...>', 'Property value — repeatable', (v, prev) => prev.concat([v]), [])
  .action(async (target, opts, cmd) => {
    try {
      const notion = getNotion();
      const { pageId, dbIds: resolvedDbIds } = await resolvePageId(target, opts.filter);
      let dbIds = resolvedDbIds;
      if (!dbIds) {
        const page = await notion.pages.retrieve({ page_id: pageId });
        const dsId = page.parent?.data_source_id;
        if (!dsId) {
          console.error('Page is not in a database — cannot auto-detect property types.');
          process.exit(1);
        }
        dbIds = { data_source_id: dsId, database_id: page.parent?.database_id || dsId };
      }
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
  .command('delete <page-or-alias>')
  .description('Delete (archive) a page by ID or alias + filter')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, opts, cmd) => {
    try {
      const notion = getNotion();
      const { pageId } = await resolvePageId(target, opts.filter);
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
  .command('get <page-or-alias>')
  .description('Get a page\'s properties by ID or alias + filter')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, opts, cmd) => {
    try {
      const notion = getNotion();
      const { pageId } = await resolvePageId(target, opts.filter);
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
  .command('blocks <page-or-alias>')
  .description('Get page content as rendered blocks by ID or alias + filter')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, opts, cmd) => {
    try {
      const notion = getNotion();
      const { pageId } = await resolvePageId(target, opts.filter);
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

// ─── users ─────────────────────────────────────────────────────────────────────
program
  .command('users')
  .description('List all users in the workspace')
  .action(async (opts, cmd) => {
    try {
      const notion = getNotion();
      const res = await notion.users.list({});
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      const rows = res.results.map(u => ({
        id: u.id,
        name: u.name || '',
        type: u.type || '',
        email: (u.person && u.person.email) || '',
      }));
      printTable(rows, ['id', 'name', 'type', 'email']);
    } catch (err) {
      console.error('Users failed:', err.message);
      process.exit(1);
    }
  });

// ─── user ──────────────────────────────────────────────────────────────────────
program
  .command('user <user-id>')
  .description('Get user details')
  .action(async (userId, opts, cmd) => {
    try {
      const notion = getNotion();
      const user = await notion.users.retrieve({ user_id: userId });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(user, null, 2));
        return;
      }
      console.log(`User: ${user.id}`);
      console.log(`Name: ${user.name || '(unnamed)'}`);
      console.log(`Type: ${user.type || ''}`);
      if (user.person && user.person.email) {
        console.log(`Email: ${user.person.email}`);
      }
      if (user.avatar_url) {
        console.log(`Avatar: ${user.avatar_url}`);
      }
      if (user.bot) {
        console.log(`Bot Owner: ${JSON.stringify(user.bot.owner || {})}`);
      }
    } catch (err) {
      console.error('User failed:', err.message);
      process.exit(1);
    }
  });

// ─── comments ──────────────────────────────────────────────────────────────────
program
  .command('comments <page-or-alias>')
  .description('List comments on a page by ID or alias + filter')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, opts, cmd) => {
    try {
      const notion = getNotion();
      const { pageId } = await resolvePageId(target, opts.filter);
      const res = await notion.comments.list({ block_id: pageId });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      if (res.results.length === 0) {
        console.log('(no comments)');
        return;
      }
      const rows = res.results.map(c => ({
        id: c.id,
        text: richTextToPlain(c.rich_text),
        created: c.created_time || '',
        author: c.created_by?.name || c.created_by?.id || '',
      }));
      printTable(rows, ['id', 'text', 'created', 'author']);
    } catch (err) {
      console.error('Comments failed:', err.message);
      process.exit(1);
    }
  });

// ─── comment ───────────────────────────────────────────────────────────────────
program
  .command('comment <page-or-alias> <text>')
  .description('Add a comment to a page by ID or alias + filter')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, text, opts, cmd) => {
    try {
      const notion = getNotion();
      const { pageId } = await resolvePageId(target, opts.filter);
      const res = await notion.comments.create({
        parent: { page_id: pageId },
        rich_text: [{ text: { content: text } }],
      });
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log(`✅ Comment added: ${res.id}`);
    } catch (err) {
      console.error('Comment failed:', err.message);
      process.exit(1);
    }
  });

// ─── append ────────────────────────────────────────────────────────────────────
program
  .command('append <page-or-alias> <text>')
  .description('Append a text block to a page by ID or alias + filter')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, text, opts, cmd) => {
    try {
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
      if (getGlobalJson(cmd)) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log(`✅ Appended text block to page ${pageId}`);
    } catch (err) {
      console.error('Append failed:', err.message);
      process.exit(1);
    }
  });

// ─── Run ───────────────────────────────────────────────────────────────────────
program.parse();
