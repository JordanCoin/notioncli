// lib/config.js — Config file system management

const fs = require('fs');
const path = require('path');

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

module.exports = {
  getConfigPaths,
  loadConfig,
  migrateConfig,
  resolveWorkspace,
  saveConfig,
};
