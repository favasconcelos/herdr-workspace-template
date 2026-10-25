// lib.ts — shared helpers for the workspace-template plugin.
// Used by autotabs.ts (event hook) and apply.ts (manual action).

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const PLUGIN_ID = 'workspace-template';
export const DEFAULT_TABS: string[] = ['logs', 'server'];
export const DEFAULT_RENAME_FIRST = 'agent';

export interface TabsConfig {
  tabs: string[];
  renameFirst: string;
}

export interface ApplyResult {
  applied: boolean;
  reason?: string;
  tabs: string[];
  renameFirst: string;
  failed: string[];
}

export function herdrBin(): string {
  return process.env.HERDR_BIN_PATH || 'herdr';
}

export function runHerdr(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(herdrBin(), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function defaultConfigDir(): string {
  return path.join(os.homedir(), '.config', 'herdr', 'plugins', 'config', PLUGIN_ID);
}

// Reads $HERDR_PLUGIN_CONFIG_DIR/tabs.json:
// { "tabs": ["logs", "server"], "rename_first": "agent" }
// Falls back to defaults when missing or invalid.
export function loadTabsConfig(env: NodeJS.ProcessEnv = process.env): TabsConfig {
  const dir = env.HERDR_PLUGIN_CONFIG_DIR || defaultConfigDir();
  const file = path.join(dir, 'tabs.json');
  let tabs: string[] = [...DEFAULT_TABS];
  let renameFirst: string = DEFAULT_RENAME_FIRST;
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof data === 'object' && data !== null) {
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.tabs) && record.tabs.length > 0) {
        const cleaned = (record.tabs as unknown[]).filter(
          (t): t is string => typeof t === 'string' && t.length > 0,
        );
        if (cleaned.length > 0) tabs = cleaned;
      }
      if (typeof record.rename_first === 'string') renameFirst = record.rename_first;
    }
  } catch {
    // Fallback to defaults.
  }
  return { tabs, renameFirst };
}

// Extracts the workspace id from HERDR_PLUGIN_EVENT_JSON.
// Real wire format (herdr 0.7+): {"event":"...","data":{"workspace":{"workspace_id":"w5",...}}}
// workspace.focused variant: {"event":"...","data":{"workspace_id":"w5"}}
// Falls back to HERDR_WORKSPACE_ID (present on some invocations).
export function extractWorkspaceId(env: NodeJS.ProcessEnv = process.env): string {
  let ws = '';
  try {
    const event = JSON.parse(env.HERDR_PLUGIN_EVENT_JSON || '{}') as {
      data?: { workspace?: { workspace_id?: string }; workspace_id?: string };
      workspace?: { workspace_id?: string };
      workspace_id?: string;
    };
    const data = event.data ?? event;
    ws =
      data.workspace?.workspace_id ||
      data.workspace_id ||
      event.workspace_id ||
      event.workspace?.workspace_id ||
      '';
  } catch {
    // Ignore malformed payloads; fall through to env fallback.
  }
  if (!ws) ws = env.HERDR_WORKSPACE_ID || '';
  return ws;
}

// Extracts the workspace id from HERDR_PLUGIN_CONTEXT_JSON (manual actions).
export function extractContextWorkspaceId(env: NodeJS.ProcessEnv = process.env): string {
  let ws = '';
  try {
    const ctx = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON || '{}') as {
      workspace?: { workspace_id?: string };
      workspace_id?: string;
    };
    ws = ctx.workspace_id || ctx.workspace?.workspace_id || '';
  } catch {
    // Ignore malformed payloads; fall through to env fallback.
  }
  if (!ws) ws = env.HERDR_WORKSPACE_ID || '';
  return ws;
}

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir =
    env.HERDR_PLUGIN_STATE_DIR || path.join(os.tmpdir(), 'herdr-workspace-template-state');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Best effort; marker writes will simply fail silently.
  }
  return dir;
}

function markerPath(ws: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateDir(env), `done-${ws}`);
}

// Dedupe: workspace.focused fires on every switch; template each workspace once.
export function alreadyDone(ws: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return fs.existsSync(markerPath(ws, env));
  } catch {
    return false;
  }
}

export function markDone(ws: string, env: NodeJS.ProcessEnv = process.env): void {
  try {
    fs.writeFileSync(markerPath(ws, env), '');
  } catch {
    // Best effort.
  }
}

export function tabCount(ws: string): number {
  const result = runHerdr(['tab', 'list', '--workspace', ws]);
  if (result.status !== 0) return 0;
  try {
    const data = JSON.parse(result.stdout || '{}') as {
      result?: { tabs?: unknown[] };
    };
    return data.result?.tabs?.length ?? 0;
  } catch {
    return 0;
  }
}

export interface ApplyOptions {
  guard?: boolean;
  env?: NodeJS.ProcessEnv;
  run?: (args: string[]) => { status: number; stdout: string; stderr: string };
  countTabs?: (ws: string) => number;
}

// Applies the template to a workspace.
// With guard=true (event path) only fresh 1-tab workspaces are filled.
export function applyTemplate(ws: string, options: ApplyOptions = {}): ApplyResult {
  const { guard = true, env = process.env } = options;
  const run = options.run ?? runHerdr;
  const countTabs = options.countTabs ?? tabCount;
  const { tabs, renameFirst } = loadTabsConfig(env);

  if (guard) {
    const count = countTabs(ws);
    if (count !== 1) {
      markDone(ws, env);
      return { applied: false, reason: `has ${count} tabs, skipping`, tabs, renameFirst, failed: [] };
    }
  }

  if (renameFirst) {
    run(['tab', 'rename', `${ws}:t1`, renameFirst]);
  }

  const failed: string[] = [];
  for (const label of tabs) {
    const result = run(['tab', 'create', '--workspace', ws, '--label', label, '--no-focus']);
    if (result.status !== 0) failed.push(label);
  }

  markDone(ws, env);
  return { applied: true, tabs, renameFirst, failed };
}
