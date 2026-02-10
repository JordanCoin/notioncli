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
 * Get the active workspace name from --workspace flag or config.
 */
function getWorkspaceName() {
  return program.opts().workspace || undefined;
}

/**
 * Get the active workspace config { apiKey, aliases, name }.
 */
function getWorkspaceConfig() {
  const config = loadConfig();
  const ws = helpers.resolveWorkspace(config, getWorkspaceName());
  if (ws.error) {
    console.error(`Error: ${ws.error}`);
    if (ws.available && ws.available.length > 0) {
      console.error(`Available workspaces: ${ws.available.join(', ')}`);
    }
    process.exit(1);
  }
  return ws;
}

/**
 * Resolve API key: env var → workspace config → error with setup instructions
 */
function getApiKey() {
  if (process.env.NOTION_API_KEY) return process.env.NOTION_API_KEY;
  const ws = getWorkspaceConfig();
  if (ws.apiKey) return ws.apiKey;
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
  const ws = getWorkspaceConfig();
  if (ws.aliases && ws.aliases[aliasOrId]) {
    return ws.aliases[aliasOrId];
  }
  if (UUID_REGEX.test(aliasOrId)) {
    return { database_id: aliasOrId, data_source_id: aliasOrId };
  }
  const aliasNames = ws.aliases ? Object.keys(ws.aliases) : [];
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
async function resolvePageId(aliasOrId, filterInput) {
  // Normalize filter: accept string or array, extract first non-empty
  const filterStr = Array.isArray(filterInput)
    ? (filterInput.length > 0 ? filterInput : null)
    : filterInput;
  const ws = getWorkspaceConfig();
  if (ws.aliases && ws.aliases[aliasOrId]) {
    if (!filterStr || (Array.isArray(filterStr) && filterStr.length === 0)) {
      console.error('When using an alias, --filter is required to identify a specific page.');
      console.error(`Example: notion update ${aliasOrId} --filter "Name=My Page" --prop "Status=Done"`);
      process.exit(1);
    }
    const dbIds = ws.aliases[aliasOrId];
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
    const aliasNames = ws.aliases ? Object.keys(ws.aliases) : [];
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
let _notionWithRetry = null;

function wrapNotionClient(notion) {
  const wrap = target => new Proxy(target, {
    get(obj, prop) {
      const value = obj[prop];
      if (typeof value === 'function') {
        return (...args) => withRetry(() => value.apply(obj, args));
      }
      if (value && typeof value === 'object') {
        return wrap(value);
      }
      return value;
    },
  });
  return wrap(notion);
}

function createNotionClient(apiKey) {
  const notion = new Client({ auth: apiKey });
  return wrapNotionClient(notion);
}

function getNotion() {
  if (!_notion) {
    _notion = new Client({ auth: getApiKey() });
    _notionWithRetry = wrapNotionClient(_notion);
  }
  return _notionWithRetry;
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
  buildCompoundFilter,
  markdownToBlocks,
  blocksToMarkdown,
  parseCsv,
  kebabToProperty,
  extractDynamicProps,
  UUID_REGEX,
  paginate,
  withRetry,
  getNotionApiErrorDetails,
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
 * Wrap a command action with standard error handling.
 * Reduces try/catch boilerplate across all commands.
 */
async function runCommand(name, fn) {
  try {
    await fn();
  } catch (err) {
    const details = getNotionApiErrorDetails(err);
    if (details) {
      console.error(`${name} failed: Notion API error`);
      if (details.status !== undefined) console.error(`Status: ${details.status}`);
      if (details.code) console.error(`Code: ${details.code}`);
      if (details.message) console.error(`Message: ${details.message}`);
      if (details.body) {
        const bodyText = typeof details.body === 'string'
          ? details.body
          : JSON.stringify(details.body, null, 2);
        console.error(`Body: ${bodyText}`);
      }
    } else {
      console.error(`${name} failed:`, err.message);
    }
    process.exit(1);
  }
}

/**
 * If --json flag is set, output raw JSON and return true. Otherwise return false.
 * Use: if (jsonOutput(cmd, result)) return;
 */
function jsonOutput(cmd, result) {
  if (getGlobalJson(cmd)) {
    console.log(JSON.stringify(result, null, 2));
    return true;
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

    const built = buildPropValue(schemaEntry.type, value);
    if (built && built.error) {
      console.error(`Invalid value for "${schemaEntry.name}" (${schemaEntry.type}): ${built.error}`);
      process.exit(1);
    }
    properties[schemaEntry.name] = built;
  }

  return properties;
}

/** Parse filter string(s) into a Notion filter object. Accepts string or array. */
async function buildFilter(dbIds, filterInput) {
  const schema = await getDbSchema(dbIds);
  const filters = Array.isArray(filterInput) ? filterInput : [filterInput];
  const result = buildCompoundFilter(schema, filters);
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
  .version('1.3.0')
  .option('--json', 'Output raw JSON instead of formatted tables')
  .option('-w, --workspace <name>', 'Use a specific workspace profile');

// ─── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize notioncli with your API key and discover databases')
  .option('--key <api-key>', 'Notion integration API key (starts with ntn_)')
  .action(async (opts) => runCommand('Init', async () => {
    const config = loadConfig();
    const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
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
      console.error('  Or with workspace: notion init --workspace work --key ntn_your_api_key');
      process.exit(1);
    }

    if (!config.workspaces) config.workspaces = {};
    if (!config.workspaces[wsName]) config.workspaces[wsName] = { aliases: {} };
    config.workspaces[wsName].apiKey = apiKey;
    config.activeWorkspace = wsName;
    saveConfig(config);
    console.log(`✅ API key saved to workspace "${wsName}" in ${CONFIG_PATH}`);
    console.log('');

    // Discover databases
    const notion = createNotionClient(apiKey);
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

      const aliases = config.workspaces[wsName].aliases || {};

      console.log(`Found ${res.results.length} database${res.results.length !== 1 ? 's' : ''}:\n`);

      const added = [];
      for (const db of res.results) {
        const title = richTextToPlain(db.title) || '';
        const dsId = db.id;
        const dbId = (db.parent && db.parent.type === 'database_id' && db.parent.database_id) || db.database_id || dsId;

        // Auto-generate a slug from the title
        let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
        if (!slug) slug = `db-${dsId.slice(0, 8)}`;

        // Avoid collisions — append a number if needed
        let finalSlug = slug;
        let counter = 2;
        while (aliases[finalSlug] && aliases[finalSlug].data_source_id !== dsId) {
          finalSlug = `${slug}-${counter}`;
          counter++;
        }

        aliases[finalSlug] = {
          database_id: dbId,
          data_source_id: dsId,
        };

        console.log(`  ✅ ${finalSlug.padEnd(25)} → ${title || '(untitled)'}`);
        added.push(finalSlug);
      }

      config.workspaces[wsName].aliases = aliases;
      saveConfig(config);
      console.log('');
      console.log(`${added.length} alias${added.length !== 1 ? 'es' : ''} saved to workspace "${wsName}".`);
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
  }));

// ─── alias ─────────────────────────────────────────────────────────────────────
const alias = program
  .command('alias')
  .description('Manage database aliases for quick access');

alias
  .command('add <name> <database-id>')
  .description('Add a database alias (auto-discovers data_source_id)')
  .action(async (name, databaseId) => runCommand('Alias add', async () => {
    const config = loadConfig();
    const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
    if (!config.workspaces[wsName]) config.workspaces[wsName] = { aliases: {} };
    const aliases = config.workspaces[wsName].aliases || {};

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
        // The database_id might differ from data_source_id — check parent
        const dbId = (match.parent && match.parent.type === 'database_id' && match.parent.database_id) || match.database_id || databaseId;
        aliases[name] = {
          database_id: dbId,
          data_source_id: dataSourceId,
        };
        const title = richTextToPlain(match.title) || '(untitled)';
        console.log(`✅ Added alias "${name}" → ${title}`);
        console.log(`   database_id:    ${dbId}`);
        console.log(`   data_source_id: ${dataSourceId}`);
      } else {
        // Couldn't find via search — use the ID for both
        aliases[name] = {
          database_id: databaseId,
          data_source_id: databaseId,
        };
        console.log(`✅ Added alias "${name}" → ${databaseId}`);
        console.log('   (Could not auto-discover data_source_id — using same ID for both)');
      }
    } catch (err) {
      // Fallback: use same ID for both
      aliases[name] = {
        database_id: databaseId,
        data_source_id: databaseId,
      };
      console.log(`✅ Added alias "${name}" → ${databaseId}`);
      console.log(`   (Auto-discovery failed: ${err.message})`);
    }

    config.workspaces[wsName].aliases = aliases;
    saveConfig(config);
  }));

alias
  .command('list')
  .description('Show all configured database aliases')
  .action(() => {
    const ws = getWorkspaceConfig();
    const aliases = ws.aliases || {};
    const names = Object.keys(aliases);

    if (names.length === 0) {
      console.log(`No aliases in workspace "${ws.name}".`);
      console.log('Add one with: notion alias add <name> <database-id>');
      return;
    }

    console.log(`Workspace: ${ws.name}\n`);
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
    const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
    const aliases = config.workspaces[wsName]?.aliases || {};
    if (!aliases[name]) {
      console.error(`Alias "${name}" not found in workspace "${wsName}".`);
      const names = Object.keys(aliases);
      if (names.length > 0) {
        console.error(`Available: ${names.join(', ')}`);
      }
      process.exit(1);
    }
    delete aliases[name];
    config.workspaces[wsName].aliases = aliases;
    saveConfig(config);
    console.log(`✅ Removed alias "${name}" from workspace "${wsName}"`);
  });

alias
  .command('rename <old-name> <new-name>')
  .description('Rename a database alias')
  .action((oldName, newName) => {
    const config = loadConfig();
    const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
    const aliases = config.workspaces[wsName]?.aliases || {};
    if (!aliases[oldName]) {
      console.error(`Alias "${oldName}" not found in workspace "${wsName}".`);
      const names = Object.keys(aliases);
      if (names.length > 0) {
        console.error(`Available: ${names.join(', ')}`);
      }
      process.exit(1);
    }
    if (aliases[newName]) {
      console.error(`Alias "${newName}" already exists. Remove it first or pick a different name.`);
      process.exit(1);
    }
    aliases[newName] = aliases[oldName];
    delete aliases[oldName];
    config.workspaces[wsName].aliases = aliases;
    saveConfig(config);
    console.log(`✅ Renamed "${oldName}" → "${newName}" in workspace "${wsName}"`);
  });

// ─── workspace ─────────────────────────────────────────────────────────────────
const workspace = program
  .command('workspace')
  .description('Manage workspace profiles (multiple Notion accounts)');

workspace
  .command('add <name>')
  .description('Add a new workspace profile')
  .requiredOption('--key <api-key>', 'Notion API key for this workspace')
  .action(async (name, opts) => runCommand('Workspace add', async () => {
    const config = loadConfig();
    if (config.workspaces[name]) {
      console.error(`Workspace "${name}" already exists. Use "notion init --workspace ${name} --key ..." to update it.`);
      process.exit(1);
    }
    config.workspaces[name] = { apiKey: opts.key, aliases: {} };
    saveConfig(config);
    console.log(`✅ Added workspace "${name}"`);
    console.log('');
    console.log(`Discover databases: notion init --workspace ${name}`);
    console.log(`Or set as active:   notion workspace use ${name}`);
  }));

workspace
  .command('list')
  .description('List all workspace profiles')
  .action(() => {
    const config = loadConfig();
    const names = Object.keys(config.workspaces || {});
    if (names.length === 0) {
      console.log('No workspaces configured. Run: notion init --key ntn_...');
      return;
    }
    for (const name of names) {
      const ws = config.workspaces[name];
      const active = name === config.activeWorkspace ? ' ← active' : '';
      const aliasCount = Object.keys(ws.aliases || {}).length;
      const keyPreview = ws.apiKey ? `${ws.apiKey.slice(0, 8)}...` : '(no key)';
      console.log(`  ${name}${active}`);
      console.log(`    Key: ${keyPreview} | Aliases: ${aliasCount}`);
    }
  });

workspace
  .command('use <name>')
  .description('Set the active workspace')
  .action((name) => {
    const config = loadConfig();
    if (!config.workspaces[name]) {
      console.error(`Workspace "${name}" not found.`);
      const names = Object.keys(config.workspaces || {});
      if (names.length > 0) {
        console.error(`Available: ${names.join(', ')}`);
      }
      process.exit(1);
    }
    config.activeWorkspace = name;
    saveConfig(config);
    console.log(`✅ Active workspace: ${name}`);
  });

workspace
  .command('remove <name>')
  .description('Remove a workspace profile')
  .action((name) => {
    const config = loadConfig();
    if (!config.workspaces[name]) {
      console.error(`Workspace "${name}" not found.`);
      process.exit(1);
    }
    if (name === config.activeWorkspace) {
      console.error(`Cannot remove the active workspace. Switch first: notion workspace use <other>`);
      process.exit(1);
    }
    delete config.workspaces[name];
    saveConfig(config);
    console.log(`✅ Removed workspace "${name}"`);
  });

// ─── search ────────────────────────────────────────────────────────────────────
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

// ─── query ─────────────────────────────────────────────────────────────────────
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

// ─── add ───────────────────────────────────────────────────────────────────────
program
  .command('add <database>')
  .description('Add a new page to a database (e.g. notion add tasks --name "Ship it" --status "Done")')
  .option('--prop <key=value...>', 'Property value — repeatable (e.g. --prop "Name=Hello")', (v, prev) => prev.concat([v]), [])
  .option('--from <file>', 'Import content from a .md file as page body')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (db, opts, cmd) => runCommand('Add', async () => {
    const notion = getNotion();
    const dbIds = resolveDb(db);

    // Merge --prop flags with dynamic property flags (--name, --status, etc.)
    const schema = await getDbSchema(dbIds);
    const knownFlags = ['prop', 'from', 'json', 'workspace', 'w', 'filter', 'limit', 'sort', 'output'];
    const dynamicProps = extractDynamicProps(process.argv, knownFlags, schema);
    const allProps = [...(opts.prop || []), ...dynamicProps];

    if (allProps.length === 0) {
      console.error('No properties provided. Use property flags or --prop:');
      console.error(`  notion add ${db} --name "My Page" --status "Active"`);
      console.error(`  notion add ${db} --prop "Name=My Page" --prop "Status=Active"`);
      const propNames = Object.values(schema).map(s => `--${s.name.toLowerCase().replace(/\s+/g, '-')}`);
      console.error(`\nAvailable: ${propNames.join(', ')}`);
      process.exit(1);
    }

    const properties = await buildProperties(dbIds, allProps);
    const res = await notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dbIds.data_source_id },
      properties,
    });

    // If --from file, parse and append blocks
    if (opts.from) {
      const filePath = path.resolve(opts.from);
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();

      let blocks;
      if (ext === '.md' || ext === '.markdown') {
        blocks = markdownToBlocks(content);
      } else {
        // Treat as plain text
        blocks = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } }];
      }

      // Notion API limits to 100 blocks per append call
      for (let i = 0; i < blocks.length; i += 100) {
        await notion.blocks.children.append({
          block_id: res.id,
          children: blocks.slice(i, i + 100),
        });
      }
    }

    if (jsonOutput(cmd, res)) return;
    console.log(`✅ Created page: ${res.id}`);
    console.log(`   URL: ${res.url}`);
    if (opts.from) console.log(`   Content imported from: ${opts.from}`);
  }));

// ─── update ────────────────────────────────────────────────────────────────────
program
  .command('update <page-or-alias>')
  .description('Update a page\'s properties by ID or alias + filter (e.g. notion update tasks --filter "Name=Ship it" --status "Done")')
  .option('--filter <key=value...>', 'Filter to find the page — repeatable for AND (required with alias)', (v, prev) => prev.concat([v]), [])
  .option('--prop <key=value...>', 'Property value — repeatable', (v, prev) => prev.concat([v]), [])
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (target, opts, cmd) => runCommand('Update', async () => {
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
    // Merge --prop flags with dynamic property flags
    const schema = await getDbSchema(dbIds);
    const knownFlags = ['prop', 'filter', 'json', 'workspace', 'w', 'limit', 'sort', 'output'];
    const dynamicProps = extractDynamicProps(process.argv, knownFlags, schema);
    const allProps = [...(opts.prop || []), ...dynamicProps];

    if (allProps.length === 0) {
      console.error('No properties to update. Use property flags or --prop:');
      console.error(`  notion update ${target} --filter "Name=..." --status "Done"`);
      process.exit(1);
    }

    const properties = await buildProperties(dbIds, allProps);
    const res = await notion.pages.update({ page_id: pageId, properties });
    if (jsonOutput(cmd, res)) return;
    console.log(`✅ Updated page: ${res.id}`);
  }));

// ─── delete (archive) ──────────────────────────────────────────────────────────
program
  .command('delete <page-or-alias>')
  .description('Delete (archive) a page by ID or alias + filter')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, opts, cmd) => runCommand('Delete', async () => {
    const notion = getNotion();
    const { pageId } = await resolvePageId(target, opts.filter);
    const res = await notion.pages.update({ page_id: pageId, archived: true });
    if (jsonOutput(cmd, res)) return;
    console.log(`🗑️  Archived page: ${res.id}`);
    console.log('   (Restore it from the trash in Notion if needed)');
  }));

// ─── get ───────────────────────────────────────────────────────────────────────
program
  .command('get <page-or-alias>')
  .description('Get a page\'s properties by ID or alias + filter')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, opts, cmd) => runCommand('Get', async () => {
    const notion = getNotion();
    const { pageId } = await resolvePageId(target, opts.filter);
    const page = await notion.pages.retrieve({ page_id: pageId });
    if (jsonOutput(cmd, page)) return;
    console.log(`Page: ${page.id}`);
    console.log(`URL:  ${page.url}`);
    console.log(`Created: ${page.created_time}`);
    console.log(`Updated: ${page.last_edited_time}`);
    console.log('');
    console.log('Properties:');
    for (const [name, prop] of Object.entries(page.properties)) {
      if (prop.type === 'relation') {
        const rels = prop.relation || [];
        if (rels.length === 0) {
          console.log(`  ${name}: (none)`);
        } else {
          // Resolve relation titles
          const titles = [];
          for (const rel of rels) {
            try {
              const linked = await notion.pages.retrieve({ page_id: rel.id });
              let t = '';
              for (const [, p] of Object.entries(linked.properties)) {
                if (p.type === 'title') { t = propValue(p); break; }
              }
              titles.push(t || rel.id.slice(0, 8) + '…');
            } catch {
              titles.push(rel.id.slice(0, 8) + '…');
            }
          }
          console.log(`  ${name}: ${titles.join(', ')}`);
        }
      } else if (prop.type === 'rollup') {
        const r = prop.rollup;
        if (!r) {
          console.log(`  ${name}: (empty)`);
        } else if (r.type === 'number') {
          console.log(`  ${name}: ${r.number != null ? r.number : '(empty)'}`);
        } else if (r.type === 'date') {
          console.log(`  ${name}: ${r.date ? r.date.start : '(empty)'}`);
        } else if (r.type === 'array' && r.array) {
          console.log(`  ${name}: ${r.array.map(item => propValue(item)).join(', ')}`);
        } else {
          console.log(`  ${name}: ${JSON.stringify(r)}`);
        }
      } else {
        console.log(`  ${name}: ${propValue(prop)}`);
      }
    }
  }));

// ─── blocks ────────────────────────────────────────────────────────────────────
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

// ─── block-edit ────────────────────────────────────────────────────────────────
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

// ─── block-delete ──────────────────────────────────────────────────────────────
program
  .command('block-delete <block-id>')
  .description('Delete a block from a page')
  .action(async (blockId, opts, cmd) => runCommand('Block delete', async () => {
    const notion = getNotion();
    const res = await notion.blocks.delete({ block_id: blockId });
    if (jsonOutput(cmd, res)) return;
    console.log(`🗑️  Deleted block: ${blockId.slice(0, 8)}…`);
  }));

// ─── relations ─────────────────────────────────────────────────────────────────
program
  .command('relations <page-or-alias>')
  .description('Show all relation and rollup properties with resolved titles')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, opts, cmd) => runCommand('Relations', async () => {
    const notion = getNotion();
    const { pageId } = await resolvePageId(target, opts.filter);
    const page = await notion.pages.retrieve({ page_id: pageId });

    if (jsonOutput(cmd, page)) return;

    let found = false;

    for (const [name, prop] of Object.entries(page.properties)) {
      if (prop.type === 'relation') {
        const rels = prop.relation || [];
        if (rels.length === 0) {
          console.log(`\n${name}: (no linked pages)`);
          continue;
        }
        found = true;
        console.log(`\n${name}: ${rels.length} linked page${rels.length !== 1 ? 's' : ''}`);

        // Resolve each related page title
        const rows = [];
        for (const rel of rels) {
          try {
            const linked = await notion.pages.retrieve({ page_id: rel.id });
            let title = '';
            for (const [, p] of Object.entries(linked.properties)) {
              if (p.type === 'title') {
                title = propValue(p);
                break;
              }
            }
            rows.push({
              id: rel.id.slice(0, 8) + '…',
              title: title || '(untitled)',
              url: linked.url || '',
            });
          } catch {
            rows.push({ id: rel.id.slice(0, 8) + '…', title: '(access denied)', url: '' });
          }
        }
        printTable(rows, ['id', 'title', 'url']);
      }

      if (prop.type === 'rollup') {
        found = true;
        const r = prop.rollup;
        console.log(`\n${name} (rollup):`);
        if (!r) {
          console.log('  (empty)');
          continue;
        }
        if (r.type === 'number') {
          console.log(`  ${r.function || 'value'}: ${r.number}`);
        } else if (r.type === 'date') {
          console.log(`  ${r.date ? r.date.start : '(empty)'}`);
        } else if (r.type === 'array' && r.array) {
          for (const item of r.array) {
            console.log(`  • ${propValue(item)}`);
          }
        } else {
          console.log(`  ${JSON.stringify(r)}`);
        }
      }
    }

    if (!found) {
      console.log('This page has no relation or rollup properties.');
    }
  }));

// ─── dbs ───────────────────────────────────────────────────────────────────────
program
  .command('dbs')
  .description('List all databases shared with your integration')
  .action(async (opts, cmd) => runCommand('List databases', async () => {
    const notion = getNotion();
    const { results, response } = await paginate(
      ({ start_cursor, page_size }) => notion.search({
        filter: { value: 'data_source', property: 'object' },
        start_cursor,
        page_size,
      }),
      { pageSizeLimit: 100 },
    );
    if (jsonOutput(cmd, response)) return;
    const rows = results.map(db => ({
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
  }));

// ─── users ─────────────────────────────────────────────────────────────────────
program
  .command('users')
  .description('List all users in the workspace')
  .action(async (opts, cmd) => runCommand('Users', async () => {
    const notion = getNotion();
    const { results, response } = await paginate(
      ({ start_cursor, page_size }) => notion.users.list({ start_cursor, page_size }),
      { pageSizeLimit: 100 },
    );
    if (jsonOutput(cmd, response)) return;
    const rows = results.map(u => ({
      id: u.id,
      name: u.name || '',
      type: u.type || '',
      email: (u.person && u.person.email) || '',
    }));
    printTable(rows, ['id', 'name', 'type', 'email']);
  }));

// ─── user ──────────────────────────────────────────────────────────────────────
program
  .command('user <user-id>')
  .description('Get user details')
  .action(async (userId, opts, cmd) => runCommand('User', async () => {
    const notion = getNotion();
    const user = await notion.users.retrieve({ user_id: userId });
    if (jsonOutput(cmd, user)) return;
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
  }));

// ─── comments ──────────────────────────────────────────────────────────────────
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

// ─── comment ───────────────────────────────────────────────────────────────────
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

// ─── append ────────────────────────────────────────────────────────────────────
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

// ─── me ────────────────────────────────────────────────────────────────────────
program
  .command('me')
  .description('Show details about the current integration/bot')
  .action(async (opts, cmd) => runCommand('Me', async () => {
    const notion = getNotion();
    const me = await notion.users.me({});
    if (jsonOutput(cmd, me)) return;
    console.log(`Bot: ${me.name || '(unnamed)'}`);
    console.log(`ID: ${me.id}`);
    console.log(`Type: ${me.type}`);
    if (me.bot?.owner) {
      const owner = me.bot.owner;
      console.log(`Owner: ${owner.type === 'workspace' ? 'Workspace' : owner.user?.name || owner.type}`);
    }
    if (me.avatar_url) {
      console.log(`Avatar: ${me.avatar_url}`);
    }
  }));

// ─── move ──────────────────────────────────────────────────────────────────────
program
  .command('move <page-or-alias>')
  .description('Move a page to a new parent (page or database)')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .option('--to <parent-id-or-alias>', 'Destination parent (page ID, database alias, or database ID)')
  .action(async (target, opts, cmd) => runCommand('Move', async () => {
    if (!opts.to) {
      console.error('--to is required. Specify a parent page ID or database alias.');
      process.exit(1);
    }
    const notion = getNotion();
    const { pageId } = await resolvePageId(target, opts.filter);

    // Resolve --to target
    let parent;
    const ws = getWorkspaceConfig();
    if (ws.aliases && ws.aliases[opts.to]) {
      const db = ws.aliases[opts.to];
      // pages.move() requires data_source_id parent, not database_id
      parent = { type: 'data_source_id', data_source_id: db.data_source_id };
    } else if (UUID_REGEX.test(opts.to)) {
      // Assume page ID — user can also pass a database_id
      parent = { type: 'page_id', page_id: opts.to };
    } else {
      console.error(`Unknown destination: "${opts.to}". Use a page ID or database alias.`);
      const aliasNames = ws.aliases ? Object.keys(ws.aliases) : [];
      if (aliasNames.length > 0) {
        console.error(`Available aliases: ${aliasNames.join(', ')}`);
      }
      process.exit(1);
    }

    const res = await notion.pages.move({ page_id: pageId, parent });
    if (jsonOutput(cmd, res)) return;
    console.log(`✅ Moved page: ${pageId.slice(0, 8)}…`);
    if (res.url) console.log(`   URL: ${res.url}`);
  }));

// ─── templates ─────────────────────────────────────────────────────────────────
program
  .command('templates <database>')
  .description('List page templates available for a database')
  .action(async (db, opts, cmd) => runCommand('Templates', async () => {
    const notion = getNotion();
    const dbIds = resolveDb(db);
    const res = await notion.dataSources.listTemplates({
      data_source_id: dbIds.data_source_id,
    });
    if (jsonOutput(cmd, res)) return;
    if (!res.results || res.results.length === 0) {
      console.log('No templates found for this database.');
      return;
    }
    const rows = res.results.map(t => {
      let title = '';
      if (t.properties) {
        for (const [, prop] of Object.entries(t.properties)) {
          if (prop.type === 'title') {
            title = propValue(prop);
            break;
          }
        }
      }
      return {
        id: t.id,
        title: title || '(untitled)',
        url: t.url || '',
      };
    });
    printTable(rows, ['id', 'title', 'url']);
  }));

// ─── db-create ─────────────────────────────────────────────────────────────────
program
  .command('db-create <parent-page-id> <title>')
  .description('Create a new database under a page')
  .option('--prop <name:type...>', 'Property definition — repeatable (e.g. --prop "Status:select" --prop "Priority:number")', (v, prev) => prev.concat([v]), [])
  .option('--alias <name>', 'Auto-create an alias for the new database')
  .action(async (parentPageId, title, opts, cmd) => runCommand('Database create', async () => {
    const notion = getNotion();

    // Build properties — always include a title property
    const properties = {};
    let hasTitleProp = false;

    for (const kv of opts.prop) {
      const colonIdx = kv.indexOf(':');
      if (colonIdx === -1) {
        console.error(`Invalid property format: ${kv} (expected name:type)`);
        console.error('Supported types: title, rich_text, number, select, multi_select, date, checkbox, url, email, phone_number, status');
        process.exit(1);
      }
      const name = kv.slice(0, colonIdx);
      const type = kv.slice(colonIdx + 1).toLowerCase();
      if (type === 'title') hasTitleProp = true;
      properties[name] = { [type]: {} };
    }

    // Ensure there's a title property
    if (!hasTitleProp) {
      properties['Name'] = { title: {} };
    }

    // 2025 API: databases.create() only handles title property reliably.
    // Non-title properties must be added via dataSources.update() after creation.
    const titleProps = {};
    const extraProps = {};
    for (const [name, prop] of Object.entries(properties)) {
      if (prop.title) {
        titleProps[name] = prop;
      } else {
        extraProps[name] = prop;
      }
    }
    // Ensure title property exists in create call
    if (Object.keys(titleProps).length === 0) {
      titleProps['Name'] = { title: {} };
    }

    const res = await notion.databases.create({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ text: { content: title } }],
      properties: titleProps,
    });

    // Extract correct dual IDs from response
    const databaseId = res.id;
    const dataSourceId = (res.data_sources && res.data_sources[0])
      ? res.data_sources[0].id
      : res.id;

    // Add non-title properties via dataSources.update()
    if (Object.keys(extraProps).length > 0) {
      await notion.dataSources.update({
        data_source_id: dataSourceId,
        properties: extraProps,
      });
    }

    if (jsonOutput(cmd, res)) return;

    console.log(`✅ Created database: ${databaseId.slice(0, 8)}…`);
    console.log(`   Title: ${title}`);
    console.log(`   Properties: ${Object.keys(properties).join(', ')}`);

    // Auto-create alias if requested
    if (opts.alias) {
      const config = loadConfig();
      const wsName = getWorkspaceName() || config.activeWorkspace || 'default';
      if (!config.workspaces[wsName]) config.workspaces[wsName] = { aliases: {} };
      if (!config.workspaces[wsName].aliases) config.workspaces[wsName].aliases = {};
      config.workspaces[wsName].aliases[opts.alias] = {
        database_id: databaseId,
        data_source_id: dataSourceId,
      };
      saveConfig(config);
      console.log(`   Alias: ${opts.alias}`);
    }
  }));

// ─── db-update ─────────────────────────────────────────────────────────────────
program
  .command('db-update <database>')
  .description('Update a database title or add properties')
  .option('--title <text>', 'New database title')
  .option('--add-prop <name:type...>', 'Add a property (e.g. --add-prop "Priority:number")', (v, prev) => prev.concat([v]), [])
  .option('--remove-prop <name...>', 'Remove a property by name', (v, prev) => prev.concat([v]), [])
  .action(async (db, opts, cmd) => runCommand('Database update', async () => {
    const notion = getNotion();
    const dbIds = resolveDb(db);

    // 2025 API: property changes go through dataSources.update(), NOT databases.update().
    // databases.update() silently ignores property modifications.
    // Title changes still go through databases.update().
    let canonicalId = dbIds.database_id;
    const dataSourceId = dbIds.data_source_id;

    // Resolve canonical database_id if both IDs are the same
    if (canonicalId === dataSourceId) {
      try {
        const ds = await notion.dataSources.retrieve({ data_source_id: canonicalId });
        if (ds.parent && ds.parent.type === 'database_id') {
          canonicalId = ds.parent.database_id;
        }
      } catch (_) { /* fall through with what we have */ }
    }

    // Build property changes for dataSources.update()
    let propChanges = null;
    if (opts.addProp.length > 0 || opts.removeProp.length > 0) {
      propChanges = {};

      for (const kv of opts.addProp) {
        const colonIdx = kv.indexOf(':');
        if (colonIdx === -1) {
          console.error(`Invalid property format: ${kv} (expected name:type)`);
          process.exit(1);
        }
        const name = kv.slice(0, colonIdx);
        const type = kv.slice(colonIdx + 1).toLowerCase();
        propChanges[name] = { [type]: {} };
      }

      for (const name of opts.removeProp) {
        propChanges[name] = null;
      }
    }

    let res;

    // Title changes go through databases.update()
    if (opts.title) {
      res = await notion.databases.update({
        database_id: canonicalId,
        title: [{ text: { content: opts.title } }],
      });
    }

    // Property changes go through dataSources.update()
    if (propChanges) {
      res = await notion.dataSources.update({
        data_source_id: dataSourceId,
        properties: propChanges,
      });
    }

    if (jsonOutput(cmd, res)) return;

    console.log(`✅ Updated database: ${(dbIds.database_id || dbIds.data_source_id).slice(0, 8)}…`);
    if (opts.title) console.log(`   Title: ${opts.title}`);
    if (opts.addProp.length > 0) console.log(`   Added: ${opts.addProp.join(', ')}`);
    if (opts.removeProp.length > 0) console.log(`   Removed: ${opts.removeProp.join(', ')}`);
  }));

// ─── upload ────────────────────────────────────────────────────────────────────
program
  .command('upload <page-or-alias> <file-path>')
  .description('Upload a file to a page')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, filePath, opts, cmd) => runCommand('Upload', async () => {
    const notion = getNotion();
    const { pageId } = await resolvePageId(target, opts.filter);

    // Resolve file path
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      console.error(`File not found: ${absPath}`);
      process.exit(1);
    }

    const filename = path.basename(absPath);
    const fileData = fs.readFileSync(absPath);
    const fileSize = fileData.length;

    // Detect MIME type from extension
    const MIME_MAP = {
      '.txt': 'text/plain', '.csv': 'text/csv', '.html': 'text/html',
      '.json': 'application/json', '.pdf': 'application/pdf',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
      '.zip': 'application/zip', '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    const ext = path.extname(filename).toLowerCase();
    const mimeType = MIME_MAP[ext] || 'application/octet-stream';

    // Step 1: Create file upload
    const upload = await notion.fileUploads.create({
      parent: { type: 'page_id', page_id: pageId },
      filename,
    });
    const uploadId = upload.id;

    // Step 2: Send file data with correct content type
    await notion.fileUploads.send({
      file_upload_id: uploadId,
      file: { data: new Blob([fileData], { type: mimeType }), filename },
      part_number: '1',
    });

    // Step 3: Append file block to page (no complete() needed — attach directly)
    await notion.blocks.children.append({
      block_id: pageId,
      children: [{
        object: 'block',
        type: 'file',
        file: {
          type: 'file_upload',
          file_upload: { id: uploadId },
        },
      }],
    });

    if (jsonOutput(cmd, { upload_id: uploadId, filename, size: fileSize, page_id: pageId })) return;

    const sizeStr = fileSize > 1024 * 1024
      ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
      : `${(fileSize / 1024).toFixed(1)} KB`;

    console.log(`✅ Uploaded: ${filename} (${sizeStr})`);
    console.log(`   Page: ${pageId.slice(0, 8)}…`);
  }));

// ─── props ─────────────────────────────────────────────────────────────────────
program
  .command('props <page-or-alias>')
  .description('List all properties with full paginated values')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, opts, cmd) => runCommand('Props', async () => {
    const notion = getNotion();
    const { pageId } = await resolvePageId(target, opts.filter);
    const page = await notion.pages.retrieve({ page_id: pageId });

    if (jsonOutput(cmd, page)) return;

    console.log(`Page: ${page.id}`);
    console.log(`URL:  ${page.url}\n`);

    for (const [name, prop] of Object.entries(page.properties)) {
      // For paginated properties (relation, rollup, rich_text, title, people),
      // use the property retrieval endpoint to get full values
      const needsPagination = ['relation', 'rollup', 'rich_text', 'title', 'people'].includes(prop.type);

      if (needsPagination && prop.id) {
        try {
          const fullProp = await notion.pages.properties.retrieve({
            page_id: pageId,
            property_id: prop.id,
          });

          if (fullProp.results) {
            // Paginated property — collect all results
            const items = fullProp.results;
            if (prop.type === 'relation') {
              if (items.length === 0) {
                console.log(`  ${name}: (none)`);
              } else {
                const titles = [];
                for (const item of items) {
                  const relId = item.relation?.id;
                  if (relId) {
                    try {
                      const linked = await notion.pages.retrieve({ page_id: relId });
                      let t = '';
                      for (const [, p] of Object.entries(linked.properties)) {
                        if (p.type === 'title') { t = propValue(p); break; }
                      }
                      titles.push(t || relId.slice(0, 8) + '…');
                    } catch {
                      titles.push(relId.slice(0, 8) + '…');
                    }
                  }
                }
                console.log(`  ${name}: ${titles.join(', ')}`);
              }
            } else if (prop.type === 'rich_text' || prop.type === 'title') {
              const text = items.map(i => i[prop.type]?.plain_text || '').join('');
              console.log(`  ${name}: ${text}`);
            } else if (prop.type === 'people') {
              const people = items.map(i => i.people?.name || i.people?.id || '').join(', ');
              console.log(`  ${name}: ${people}`);
            } else {
              console.log(`  ${name}: ${JSON.stringify(items)}`);
            }
          } else {
            // Non-paginated response
            console.log(`  ${name}: ${propValue(fullProp)}`);
          }
        } catch {
          // Fallback to basic propValue
          console.log(`  ${name}: ${propValue(prop)}`);
        }
      } else {
        console.log(`  ${name}: ${propValue(prop)}`);
      }
    }
  }));

// ─── import ────────────────────────────────────────────────────────────────────
program
  .command('import <file>')
  .description('Import data from a file (.csv/.json → database pages, .md → page content)')
  .option('--to <database>', 'Target database alias for CSV/JSON import')
  .option('--parent <page-id>', 'Parent page for markdown import')
  .option('--title <text>', 'Page title for markdown import')
  .action(async (file, opts, cmd) => runCommand('Import', async () => {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf-8');

    if (ext === '.csv' || ext === '.json') {
      // Database import: CSV/JSON → pages
      if (!opts.to) {
        console.error('--to <database> is required for CSV/JSON import.');
        console.error('Example: notion import data.csv --to tasks');
        process.exit(1);
      }

      const notion = getNotion();
      const dbIds = resolveDb(opts.to);
      const schema = await getDbSchema(dbIds);

      let rows;
      if (ext === '.csv') {
        rows = parseCsv(content);
      } else {
        const parsed = JSON.parse(content);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      }

      if (rows.length === 0) {
        console.error('No data found in file.');
        process.exit(1);
      }

      console.log(`Importing ${rows.length} row${rows.length !== 1 ? 's' : ''} to ${opts.to}...`);

      let created = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          // Map row keys to schema properties
          const propStrs = [];
          for (const [key, value] of Object.entries(row)) {
            if (value === '' || value === null || value === undefined) continue;
            const schemaEntry = schema[key.toLowerCase()];
            if (schemaEntry) {
              propStrs.push(`${schemaEntry.name}=${value}`);
            }
          }
          if (propStrs.length === 0) continue;

          const properties = await buildProperties(dbIds, propStrs);
          await notion.pages.create({
            parent: { type: 'data_source_id', data_source_id: dbIds.data_source_id },
            properties,
          });
          created++;
        } catch (err) {
          failed++;
          if (failed <= 3) console.error(`  Row failed: ${err.message}`);
        }
      }

      console.log(`✅ Imported ${created} page${created !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`);

    } else if (ext === '.md' || ext === '.markdown') {
      // Page import: Markdown → page with blocks
      const notion = getNotion();
      const title = opts.title || path.basename(filePath, ext);

      let parentId = opts.parent;
      if (!parentId && opts.to) {
        // If --to is an alias, create as a database page
        const dbIds = resolveDb(opts.to);
        const properties = await buildProperties(dbIds, [`Name=${title}`]);
        const res = await notion.pages.create({
          parent: { type: 'data_source_id', data_source_id: dbIds.data_source_id },
          properties,
        });
        parentId = res.id;
        console.log(`✅ Created page: ${res.id}`);
      } else if (parentId) {
        // Create as a child page
        const res = await notion.pages.create({
          parent: { type: 'page_id', page_id: parentId },
          properties: { title: { title: [{ text: { content: title } }] } },
        });
        parentId = res.id;
        console.log(`✅ Created page: ${res.id}`);
      } else {
        console.error('Specify --to <database> or --parent <page-id> for markdown import.');
        process.exit(1);
      }

      // Parse markdown and append blocks
      const blocks = markdownToBlocks(content);
      for (let i = 0; i < blocks.length; i += 100) {
        await notion.blocks.children.append({
          block_id: parentId,
          children: blocks.slice(i, i + 100),
        });
      }

      console.log(`   Imported ${blocks.length} block${blocks.length !== 1 ? 's' : ''} from ${path.basename(filePath)}`);
    } else {
      console.error(`Unsupported file type: ${ext}`);
      console.error('Supported: .csv, .json (→ database), .md (→ page)');
      process.exit(1);
    }
  }));

// ─── export ────────────────────────────────────────────────────────────────────
program
  .command('export <page-or-alias>')
  .description('Export page content as markdown')
  .option('--filter <key=value>', 'Filter to find the page (required when using an alias)')
  .action(async (target, opts, cmd) => runCommand('Export', async () => {
    const notion = getNotion();
    const { pageId } = await resolvePageId(target, opts.filter);

    // Fetch all blocks
    let blocks = [];
    let cursor;
    do {
      const res = await notion.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100,
      });
      blocks = blocks.concat(res.results);
      cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);

    const md = blocksToMarkdown(blocks);
    console.log(md);
  }));

// ─── Run ───────────────────────────────────────────────────────────────────────
program.parse();
