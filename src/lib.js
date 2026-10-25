'use strict';
// lib.js — shared helpers for the workspace-template plugin.
// Used by autotabs.js (event hook) and apply.js (manual action).

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLUGIN_ID = 'workspace-template';
const DEFAULT_TABS = ['logs', 'server'];
const DEFAULT_RENAME_FIRST = 'agent';

function herdrBin() {
  return process.env.HERDR_BIN_PATH || 'herdr';
}

function runHerdr(args) {
  return spawnSync(herdrBin(), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function defaultConfigDir() {
  return path.join(os.homedir(), '.config', 'herdr', 'plugins', 'config', PLUGIN_ID);
}

// Reads $HERDR_PLUGIN_CONFIG_DIR/tabs.json:
// { "tabs": ["logs", "server"], "rename_first": "agent" }
// Falls back to defaults when missing or invalid.
function loadTabsConfig() {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR || defaultConfigDir();
  const file = path.join(dir, 'tabs.json');
  let tabs = [...DEFAULT_TABS];
  let renameFirst = DEFAULT_RENAME_FIRST;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data.tabs) && data.tabs.length > 0) {
      const cleaned = data.tabs.filter((t) => typeof t === 'string' && t.length > 0);
      if (cleaned.length > 0) tabs = cleaned;
    }
    if (typeof data.rename_first === 'string') renameFirst = data.rename_first;
  } catch {
    // Fallback to defaults.
  }
  return { tabs, renameFirst };
}

// Extracts the workspace id from HERDR_PLUGIN_EVENT_JSON.
// Real wire format (herdr 0.7+): {"event":"...","data":{"workspace":{"workspace_id":"w5",...}}}
// workspace.focused variant: {"event":"...","data":{"workspace_id":"w5"}}
// Falls back to HERDR_WORKSPACE_ID (present on some invocations).
function extractWorkspaceId() {
  let ws = '';
  try {
    const event = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || '{}');
    const data = event.data || event;
    ws =
      ((data.workspace || {}).workspace_id || '') ||
      data.workspace_id ||
      event.workspace_id ||
      ((event.workspace || {}).workspace_id || '') ||
      '';
  } catch {
    // Ignore malformed payloads; fall through to env fallback.
  }
  if (!ws) ws = process.env.HERDR_WORKSPACE_ID || '';
  return ws;
}

// Extracts the workspace id from HERDR_PLUGIN_CONTEXT_JSON (manual actions).
function extractContextWorkspaceId() {
  let ws = '';
  try {
    const ctx = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || '{}');
    ws = ctx.workspace_id || ((ctx.workspace || {}).workspace_id || '') || '';
  } catch {
    // Ignore malformed payloads; fall through to env fallback.
  }
  if (!ws) ws = process.env.HERDR_WORKSPACE_ID || '';
  return ws;
}

function stateDir() {
  const dir =
    process.env.HERDR_PLUGIN_STATE_DIR || path.join(os.tmpdir(), 'herdr-workspace-template-state');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Best effort; marker writes will simply fail silently.
  }
  return dir;
}

function markerPath(ws) {
  return path.join(stateDir(), `done-${ws}`);
}

// Dedupe: workspace.focused fires on every switch; template each workspace once.
function alreadyDone(ws) {
  try {
    return fs.existsSync(markerPath(ws));
  } catch {
    return false;
  }
}

function markDone(ws) {
  try {
    fs.writeFileSync(markerPath(ws), '');
  } catch {
    // Best effort.
  }
}

function tabCount(ws) {
  const result = runHerdr(['tab', 'list', '--workspace', ws]);
  if (result.status !== 0) return 0;
  try {
    const data = JSON.parse(result.stdout || '{}');
    return ((data.result || {}).tabs || []).length;
  } catch {
    return 0;
  }
}

// Applies the template to a workspace.
// With guard=true (event path) only fresh 1-tab workspaces are filled.
function applyTemplate(ws, { guard = true } = {}) {
  const { tabs, renameFirst } = loadTabsConfig();

  if (guard) {
    const count = tabCount(ws);
    if (count !== 1) {
      markDone(ws);
      return { applied: false, reason: `has ${count} tabs, skipping` };
    }
  }

  if (renameFirst) {
    runHerdr(['tab', 'rename', `${ws}:t1`, renameFirst]);
  }

  const failed = [];
  for (const label of tabs) {
    const result = runHerdr(['tab', 'create', '--workspace', ws, '--label', label, '--no-focus']);
    if (result.status !== 0) failed.push(label);
  }

  markDone(ws);
  return { applied: true, tabs, renameFirst, failed };
}

module.exports = {
  loadTabsConfig,
  extractWorkspaceId,
  extractContextWorkspaceId,
  alreadyDone,
  markDone,
  tabCount,
  applyTemplate,
};
