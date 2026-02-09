// test/mock.test.js — Command logic with mocked Notion client (no live API)

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  getConfigPaths,
  loadConfig,
  saveConfig,
  buildFilterFromSchema,
  UUID_REGEX,
  pagesToRows,
  printTable,
} = require('../lib/helpers');

// ─── Config management ────────────────────────────────────────────────────────

describe('Config management', () => {
  let tmpDir;
  let configDir;
  let configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notioncli-test-'));
    configDir = path.join(tmpDir, 'notioncli');
    configPath = path.join(configDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadConfig returns empty config for missing file', () => {
    const config = loadConfig(configPath);
    assert.equal(config.activeWorkspace, 'default');
    assert.ok(config.workspaces.default);
    assert.deepEqual(config.workspaces.default.aliases, {});
  });

  it('loadConfig returns empty config for corrupted file', () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, 'not json at all!!!');
    const config = loadConfig(configPath);
    assert.equal(config.activeWorkspace, 'default');
    assert.ok(config.workspaces.default);
  });

  it('saveConfig creates directory and file', () => {
    const config = { activeWorkspace: 'default', workspaces: { default: { aliases: { test: { database_id: 'db1', data_source_id: 'ds1' } } } } };
    saveConfig(config, configDir, configPath);
    assert.ok(fs.existsSync(configPath));
  });

  it('loadConfig reads back saved config', () => {
    const config = {
      activeWorkspace: 'default',
      workspaces: {
        default: {
          apiKey: 'ntn_test_key',
          aliases: {
            projects: { database_id: 'db-123', data_source_id: 'ds-456' },
          },
        },
      },
    };
    saveConfig(config, configDir, configPath);
    const loaded = loadConfig(configPath);
    assert.equal(loaded.workspaces.default.apiKey, 'ntn_test_key');
    assert.deepEqual(loaded.workspaces.default.aliases.projects, {
      database_id: 'db-123',
      data_source_id: 'ds-456',
    });
  });

  it('saveConfig overwrites existing config', () => {
    saveConfig({ activeWorkspace: 'default', workspaces: { default: { aliases: { a: { database_id: '1', data_source_id: '1' } } } } }, configDir, configPath);
    saveConfig({ activeWorkspace: 'default', workspaces: { default: { aliases: { b: { database_id: '2', data_source_id: '2' } } } } }, configDir, configPath);
    const loaded = loadConfig(configPath);
    assert.ok(!loaded.workspaces.default.aliases.a);
    assert.ok(loaded.workspaces.default.aliases.b);
  });

  it('loadConfig auto-migrates old flat format', () => {
    const oldConfig = { apiKey: 'ntn_old', aliases: { tasks: { database_id: 'db1', data_source_id: 'ds1' } } };
    saveConfig(oldConfig, configDir, configPath);
    const loaded = loadConfig(configPath);
    assert.equal(loaded.activeWorkspace, 'default');
    assert.equal(loaded.workspaces.default.apiKey, 'ntn_old');
    assert.deepEqual(loaded.workspaces.default.aliases.tasks, { database_id: 'db1', data_source_id: 'ds1' });
  });
});

// ─── getConfigPaths ────────────────────────────────────────────────────────────

describe('getConfigPaths', () => {
  it('returns expected path structure with override', () => {
    const paths = getConfigPaths('/tmp/custom-config');
    assert.equal(paths.CONFIG_DIR, '/tmp/custom-config');
    assert.equal(paths.CONFIG_PATH, '/tmp/custom-config/config.json');
  });

  it('returns default paths without override', () => {
    const paths = getConfigPaths();
    assert.ok(paths.CONFIG_DIR.includes('notioncli'));
    assert.ok(paths.CONFIG_PATH.endsWith('config.json'));
  });
});

// ─── resolveDb logic (pure parts) ──────────────────────────────────────────────

describe('resolveDb logic (pure)', () => {
  let tmpDir, configDir, configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notioncli-test-'));
    configDir = path.join(tmpDir, 'notioncli');
    configPath = path.join(configDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('known alias resolves to database_id + data_source_id', () => {
    const config = {
      activeWorkspace: 'default',
      workspaces: {
        default: {
          aliases: {
            projects: { database_id: 'db-aaa', data_source_id: 'ds-bbb' },
          },
        },
      },
    };
    saveConfig(config, configDir, configPath);
    const loaded = loadConfig(configPath);
    const result = loaded.workspaces.default.aliases.projects;
    assert.ok(result);
    assert.equal(result.database_id, 'db-aaa');
    assert.equal(result.data_source_id, 'ds-bbb');
  });

  it('raw UUID is recognized by UUID_REGEX', () => {
    assert.ok(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000'));
    assert.ok(UUID_REGEX.test('550e8400e29b41d4a716446655440000'));
  });

  it('unknown non-UUID string is rejected by UUID_REGEX', () => {
    assert.ok(!UUID_REGEX.test('my-database'));
    assert.ok(!UUID_REGEX.test('workouts'));
  });

  it('config with no aliases returns empty aliases object', () => {
    saveConfig({ activeWorkspace: 'default', workspaces: { default: { aliases: {} } } }, configDir, configPath);
    const loaded = loadConfig(configPath);
    assert.deepEqual(Object.keys(loaded.workspaces.default.aliases), []);
  });
});

// ─── resolvePageId logic (pure simulation) ─────────────────────────────────────

describe('resolvePageId logic (simulated)', () => {
  // We simulate the resolvePageId logic without process.exit

  function simulateResolvePageId(config, aliasOrId, filterStr, queryResults) {
    // Known alias
    if (config.aliases && config.aliases[aliasOrId]) {
      if (!filterStr) {
        return { error: 'filter_required' };
      }
      const dbIds = config.aliases[aliasOrId];
      const results = queryResults || [];
      if (results.length === 0) {
        return { error: 'no_match' };
      }
      if (results.length > 1) {
        return { error: 'multiple_matches', count: results.length, results };
      }
      return { pageId: results[0].id, dbIds };
    }
    // UUID check
    if (!UUID_REGEX.test(aliasOrId)) {
      return {
        error: 'unknown_alias',
        available: config.aliases ? Object.keys(config.aliases) : [],
      };
    }
    return { pageId: aliasOrId, dbIds: null };
  }

  const config = {
    aliases: {
      projects: { database_id: 'db-1', data_source_id: 'ds-1' },
      tasks: { database_id: 'db-2', data_source_id: 'ds-2' },
    },
  };

  it('known alias + filter → single match → returns page ID', () => {
    const result = simulateResolvePageId(config, 'projects', 'Name=Test', [
      { id: 'page-123' },
    ]);
    assert.equal(result.pageId, 'page-123');
    assert.deepEqual(result.dbIds, { database_id: 'db-1', data_source_id: 'ds-1' });
  });

  it('known alias + no filter → error', () => {
    const result = simulateResolvePageId(config, 'projects', null, []);
    assert.equal(result.error, 'filter_required');
  });

  it('known alias + filter → 0 results → error', () => {
    const result = simulateResolvePageId(config, 'projects', 'Name=Nothing', []);
    assert.equal(result.error, 'no_match');
  });

  it('known alias + filter → multiple results → error', () => {
    const result = simulateResolvePageId(config, 'projects', 'Name=Dup', [
      { id: 'page-1' },
      { id: 'page-2' },
      { id: 'page-3' },
    ]);
    assert.equal(result.error, 'multiple_matches');
    assert.equal(result.count, 3);
  });

  it('raw UUID → returns as-is with null dbIds', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = simulateResolvePageId(config, uuid, null, []);
    assert.equal(result.pageId, uuid);
    assert.equal(result.dbIds, null);
  });

  it('unknown non-UUID string → error with available aliases', () => {
    const result = simulateResolvePageId(config, 'unknown-db', null, []);
    assert.equal(result.error, 'unknown_alias');
    assert.ok(result.available.includes('projects'));
    assert.ok(result.available.includes('tasks'));
  });
});

// ─── getApiKey logic (pure simulation) ─────────────────────────────────────────

describe('getApiKey logic (simulated)', () => {
  function simulateGetApiKey(envKey, configApiKey) {
    if (envKey) return { key: envKey };
    if (configApiKey) return { key: configApiKey };
    return { error: 'no_key' };
  }

  it('returns env var when set', () => {
    const result = simulateGetApiKey('ntn_env_key', 'ntn_config_key');
    assert.equal(result.key, 'ntn_env_key');
  });

  it('returns config key when env var not set', () => {
    const result = simulateGetApiKey(null, 'ntn_config_key');
    assert.equal(result.key, 'ntn_config_key');
  });

  it('returns error when neither is set', () => {
    const result = simulateGetApiKey(null, null);
    assert.equal(result.error, 'no_key');
  });

  it('env var takes priority over config', () => {
    const result = simulateGetApiKey('ntn_env', 'ntn_config');
    assert.equal(result.key, 'ntn_env');
  });
});

// ─── getDbSchema logic (simulated) ─────────────────────────────────────────────

describe('getDbSchema logic (simulated)', () => {
  function simulateGetDbSchema(dsProperties) {
    const schema = {};
    for (const [name, prop] of Object.entries(dsProperties)) {
      schema[name.toLowerCase()] = { type: prop.type, name };
    }
    return schema;
  }

  it('maps properties to lowercase keys with original name preserved', () => {
    const props = {
      'Task Name': { type: 'title' },
      'Status': { type: 'select' },
      'Due Date': { type: 'date' },
    };
    const schema = simulateGetDbSchema(props);
    assert.deepEqual(schema['task name'], { type: 'title', name: 'Task Name' });
    assert.deepEqual(schema['status'], { type: 'select', name: 'Status' });
    assert.deepEqual(schema['due date'], { type: 'date', name: 'Due Date' });
  });

  it('handles empty properties', () => {
    const schema = simulateGetDbSchema({});
    assert.deepEqual(schema, {});
  });

  it('handles various property types', () => {
    const props = {
      'Name': { type: 'title' },
      'Description': { type: 'rich_text' },
      'Count': { type: 'number' },
      'Tags': { type: 'multi_select' },
      'Done': { type: 'checkbox' },
      'URL': { type: 'url' },
      'Email': { type: 'email' },
      'Phone': { type: 'phone_number' },
      'Stage': { type: 'status' },
      'Created': { type: 'created_time' },
      'Author': { type: 'created_by' },
    };
    const schema = simulateGetDbSchema(props);
    assert.equal(Object.keys(schema).length, 11);
    assert.equal(schema['name'].type, 'title');
    assert.equal(schema['url'].type, 'url');
  });
});

// ─── buildFilter via buildFilterFromSchema ─────────────────────────────────────

describe('buildFilter (via buildFilterFromSchema)', () => {
  const schema = {
    name: { type: 'title', name: 'Name' },
    notes: { type: 'rich_text', name: 'Notes' },
    priority: { type: 'select', name: 'Priority' },
    labels: { type: 'multi_select', name: 'Labels' },
    score: { type: 'number', name: 'Score' },
    active: { type: 'checkbox', name: 'Active' },
    deadline: { type: 'date', name: 'Deadline' },
    phase: { type: 'status', name: 'Phase' },
    website: { type: 'url', name: 'Website' },
  };

  it('title → contains filter', () => {
    const r = buildFilterFromSchema(schema, 'Name=Project Alpha');
    assert.deepEqual(r.filter, { property: 'Name', title: { contains: 'Project Alpha' } });
  });

  it('rich_text → contains filter', () => {
    const r = buildFilterFromSchema(schema, 'Notes=important');
    assert.deepEqual(r.filter, { property: 'Notes', rich_text: { contains: 'important' } });
  });

  it('select → equals filter', () => {
    const r = buildFilterFromSchema(schema, 'Priority=High');
    assert.deepEqual(r.filter, { property: 'Priority', select: { equals: 'High' } });
  });

  it('multi_select → contains filter', () => {
    const r = buildFilterFromSchema(schema, 'Labels=urgent');
    assert.deepEqual(r.filter, { property: 'Labels', multi_select: { contains: 'urgent' } });
  });

  it('number → equals filter (numeric)', () => {
    const r = buildFilterFromSchema(schema, 'Score=95');
    assert.deepEqual(r.filter, { property: 'Score', number: { equals: 95 } });
  });

  it('checkbox true → equals true', () => {
    const r = buildFilterFromSchema(schema, 'Active=true');
    assert.deepEqual(r.filter, { property: 'Active', checkbox: { equals: true } });
  });

  it('checkbox false → equals false', () => {
    const r = buildFilterFromSchema(schema, 'Active=false');
    assert.deepEqual(r.filter, { property: 'Active', checkbox: { equals: false } });
  });

  it('date → equals filter', () => {
    const r = buildFilterFromSchema(schema, 'Deadline=2024-12-31');
    assert.deepEqual(r.filter, { property: 'Deadline', date: { equals: '2024-12-31' } });
  });

  it('status → equals filter', () => {
    const r = buildFilterFromSchema(schema, 'Phase=Done');
    assert.deepEqual(r.filter, { property: 'Phase', status: { equals: 'Done' } });
  });

  it('unknown type → generic equals filter', () => {
    const r = buildFilterFromSchema(schema, 'Website=https://example.com');
    assert.deepEqual(r.filter, { property: 'Website', url: { equals: 'https://example.com' } });
  });

  it('missing property → error with available list', () => {
    const r = buildFilterFromSchema(schema, 'NonExistent=value');
    assert.ok(r.error);
    assert.ok(Array.isArray(r.available));
    assert.ok(r.available.includes('Name'));
  });

  it('no equals sign → error', () => {
    const r = buildFilterFromSchema(schema, 'justAString');
    assert.ok(r.error);
    assert.ok(r.error.includes('Invalid filter format'));
  });
});
