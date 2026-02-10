const { Client } = require('@notionhq/client');
const helpers = require('./helpers');

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

const { CONFIG_DIR, CONFIG_PATH } = helpers.getConfigPaths();

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

function createContext(program) {
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

  function getNotion() {
    if (!_notion) {
      _notion = new Client({ auth: getApiKey() });
      _notionWithRetry = wrapNotionClient(_notion);
    }
    return _notionWithRetry;
  }

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

  return {
    CONFIG_DIR,
    CONFIG_PATH,
    loadConfig,
    saveConfig,
    getWorkspaceName,
    getWorkspaceConfig,
    getApiKey,
    resolveDb,
    resolvePageId,
    getNotion,
    createNotionClient,
    wrapNotionClient,
    runCommand,
    jsonOutput,
    getGlobalJson,
    getDbSchema,
    buildProperties,
    buildFilter,
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
  };
}

module.exports = {
  createContext,
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
};
