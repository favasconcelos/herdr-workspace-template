// lib.ts — shared helpers for the workspace-template plugin.
// Used by autotabs.ts (event hook) and apply.ts (manual action).

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const PLUGIN_ID = 'workspace-template';
export const DEFAULT_TABS: string[] = ['logs', 'server'];
export const DEFAULT_RENAME_FIRST = 'agent';
export const PROJECT_CONFIG_NAME = '.herdr-tabs.json';

export type SplitDirection = 'right' | 'down';

export interface PaneSpec {
  label?: string;
  command?: string[];
  cwd?: string;
  direction?: SplitDirection;
  ratio?: number;
  env?: Record<string, string>;
}

export interface TabSpec {
  label: string;
  cwd?: string;
  command?: string[];
  env?: Record<string, string>;
  splits?: PaneSpec[];
}

export interface TabsConfig {
  tabs: TabSpec[];
  renameFirst: string;
  /** Name of the template this config was selected from (default template has ''). */
  templateName?: string;
  /** Where the config came from. Set by resolveTabsConfig, empty for loadTabsConfig. */
  source?: 'project' | 'global';
  /** Workspace cwd the project config was found in (if any). */
  projectCwd?: string;
  /** All template names available in the source file (including default as ''). */
  availableTemplates?: string[];
}

export interface ApplyResult {
  applied: boolean;
  reason?: string;
  tabs: string[];
  renameFirst: string;
  failed: string[];
  templateName?: string;
  source?: 'project' | 'global';
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseEnvRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseCommand(value: unknown): string[] | undefined {
  if (typeof value === 'string' && value.length > 0) return [value];
  if (Array.isArray(value)) {
    const parts = (value as unknown[]).filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
    return parts.length > 0 ? parts : undefined;
  }
  return undefined;
}

export function normalizeDirection(value: unknown): SplitDirection | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.toLowerCase();
  if (v === 'right' || v === 'down') return v;
  // workspace-manager compat: vertical = side-by-side, horizontal = stacked.
  if (v === 'vertical') return 'right';
  if (v === 'horizontal') return 'down';
  return undefined;
}

function parsePaneSpec(entry: unknown): PaneSpec | null {
  if (typeof entry === 'string') {
    return entry.length > 0 ? { label: entry } : null;
  }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const obj = entry as Record<string, unknown>;
  const label = asString(obj.label ?? obj.title);
  const command = parseCommand(obj.command);
  const cwd = asString(obj.cwd);
  const direction = normalizeDirection(obj.direction ?? obj.split);
  const ratio =
    typeof obj.ratio === 'number' && obj.ratio > 0 && obj.ratio < 1 ? obj.ratio : undefined;
  const env = parseEnvRecord(obj.env);
  if (!label && !command && !cwd && !env) return null;
  const spec: PaneSpec = {};
  if (label) spec.label = label;
  if (command) spec.command = command;
  if (cwd) spec.cwd = cwd;
  if (direction) spec.direction = direction;
  if (ratio !== undefined) spec.ratio = ratio;
  if (env) spec.env = env;
  return spec;
}

/** Normalizes one `tabs[]` entry: a plain string label or a rich object. */
export function parseTabSpec(entry: unknown): TabSpec | null {
  if (typeof entry === 'string') {
    return entry.length > 0 ? { label: entry } : null;
  }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const obj = entry as Record<string, unknown>;
  const label = asString(obj.label ?? obj.title);
  if (!label) return null;
  const spec: TabSpec = { label };
  const cwd = asString(obj.cwd);
  if (cwd) spec.cwd = cwd;
  const command = parseCommand(obj.command);
  if (command) spec.command = command;
  const env = parseEnvRecord(obj.env);
  if (env) spec.env = env;
  const rawSplits = Array.isArray(obj.splits)
    ? obj.splits
    : Array.isArray(obj.panes)
      ? (obj.panes as unknown[])
      : null;
  if (rawSplits) {
    // `panes` (workspace-manager style) includes the root pane as its first
    // entry; `splits` are extra panes only. When `panes` is used, the first
    // entry describes the root pane, so fold its command/cwd/env up and only
    // split the rest.
    let list: unknown[] = rawSplits;
    if (Array.isArray(obj.panes) && !Array.isArray(obj.splits) && list.length > 0) {
      const root = parsePaneSpec(list[0]);
      if (root) {
        if (root.command && !spec.command) spec.command = root.command;
        if (root.cwd && !spec.cwd) spec.cwd = root.cwd;
        if (root.env && !spec.env) spec.env = root.env;
      }
      list = list.slice(1);
    }
    const splits: PaneSpec[] = [];
    for (const item of list) {
      const parsed = parsePaneSpec(item);
      if (parsed) splits.push(parsed);
    }
    if (splits.length > 0) spec.splits = splits;
  }
  return spec;
}

function parseTabsList(value: unknown, fallbackLabels: string[]): TabSpec[] {
  if (!Array.isArray(value)) {
    return fallbackLabels.map((label) => ({ label }));
  }
  const specs: TabSpec[] = [];
  for (const entry of value) {
    const parsed = parseTabSpec(entry);
    if (parsed) specs.push(parsed);
  }
  return specs.length > 0 ? specs : fallbackLabels.map((label) => ({ label }));
}

function parseTemplateEntry(
  value: unknown,
  defaults: { tabs: TabSpec[]; renameFirst: string },
): { tabs: TabSpec[]; renameFirst: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { tabs: defaults.tabs, renameFirst: defaults.renameFirst };
  }
  const obj = value as Record<string, unknown>;
  const tabs = Array.isArray(obj.tabs)
    ? parseTabsList(obj.tabs, defaults.tabs.map((t) => t.label))
    : defaults.tabs;
  const renameFirst =
    typeof obj.rename_first === 'string' ? obj.rename_first : defaults.renameFirst;
  return { tabs, renameFirst };
}

export function tabLabels(tabs: TabSpec[]): string[] {
  return tabs.map((t) => t.label);
}

// Reads $HERDR_PLUGIN_CONFIG_DIR/tabs.json:
// { "tabs": ["logs", "server"], "rename_first": "agent" }
// Extended: tabs[] entries may be objects with label/cwd/command/env/splits,
// and the file may define named "templates" + a "default_template".
// Falls back to defaults when missing or invalid.
export function loadTabsConfig(env: NodeJS.ProcessEnv = process.env): TabsConfig {
  const dir = env.HERDR_PLUGIN_CONFIG_DIR || defaultConfigDir();
  return loadConfigFile(path.join(dir, 'tabs.json'));
}

export function loadConfigFile(file: string): ResolvedConfig {
  const fallbackTabs: TabSpec[] = DEFAULT_TABS.map((label) => ({ label }));
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof data !== 'object' || data === null) {
      return { tabs: fallbackTabs, renameFirst: DEFAULT_RENAME_FIRST };
    }
    const record = data as Record<string, unknown>;
    const tabs = parseTabsList(record.tabs, DEFAULT_TABS);
    const renameFirst =
      typeof record.rename_first === 'string' ? record.rename_first : DEFAULT_RENAME_FIRST;
    const templates: Record<string, { tabs: TabSpec[]; renameFirst: string }> = {};
    if (
      typeof record.templates === 'object' &&
      record.templates !== null &&
      !Array.isArray(record.templates)
    ) {
      for (const [name, raw] of Object.entries(record.templates as Record<string, unknown>)) {
        if (!name) continue;
        templates[name] = parseTemplateEntry(raw, { tabs, renameFirst });
      }
    }
    const defaultTemplate =
      typeof record.default_template === 'string' ? record.default_template : '';
    const out: ResolvedConfig = {
      tabs,
      renameFirst,
      templateName: '',
      availableTemplates: Object.keys(templates),
    };
    if (Object.keys(templates).length > 0) out.templates = templates;
    if (defaultTemplate) out.defaultTemplate = defaultTemplate;
    return out;
  } catch {
    return { tabs: fallbackTabs, renameFirst: DEFAULT_RENAME_FIRST };
  }
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

/** Best-effort workspace cwd from event/context env payloads (no herdr call). */
export function extractWorkspaceCwd(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const ctx = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON || '{}') as {
      workspace_cwd?: string;
      focused_pane_cwd?: string;
      worktree?: { checkout_path?: string };
    };
    const cwd =
      (typeof ctx.workspace_cwd === 'string' && ctx.workspace_cwd) ||
      (typeof ctx.focused_pane_cwd === 'string' && ctx.focused_pane_cwd) ||
      (typeof ctx.worktree?.checkout_path === 'string' && ctx.worktree.checkout_path) ||
      '';
    if (cwd) return cwd;
  } catch {
    // Ignore malformed payloads.
  }
  try {
    const event = JSON.parse(env.HERDR_PLUGIN_EVENT_JSON || '{}') as {
      data?: {
        workspace?: { worktree?: { checkout_path?: string } };
        worktree?: { path?: string };
      };
    };
    const data = event.data ?? {};
    const cwd =
      data.workspace?.worktree?.checkout_path || data.worktree?.path || '';
    if (typeof cwd === 'string' && cwd) return cwd;
  } catch {
    // Ignore malformed payloads.
  }
  return '';
}

function parsePaneListCwd(stdout: string): string {
  try {
    const data = JSON.parse(stdout || '{}') as {
      result?: { panes?: Array<{ cwd?: string; foreground_cwd?: string }> };
    };
    const panes = data.result?.panes ?? [];
    for (const pane of panes) {
      const cwd = pane?.cwd || pane?.foreground_cwd || '';
      if (cwd) return cwd;
    }
  } catch {
    // Ignore malformed output.
  }
  return '';
}

/** Queries herdr for the workspace's checkout cwd (first pane's cwd). */
export function resolveWorkspaceCwd(
  ws: string,
  options: {
    env?: NodeJS.ProcessEnv;
    run?: (args: string[]) => { status: number; stdout: string; stderr: string };
  } = {},
): string {
  const { env = process.env, run = runHerdr } = options;
  const fromEnv = extractWorkspaceCwd(env);
  if (fromEnv) return fromEnv;
  if (!ws) return '';
  try {
    const result = run(['pane', 'list', '--workspace', ws]);
    if (result.status !== 0) return '';
    return parsePaneListCwd(result.stdout);
  } catch {
    return '';
  }
}

/** Loads a per-project override file (<cwd>/.herdr-tabs.json); null when absent/invalid. */
export function loadProjectConfig(workspaceCwd: string): ResolvedConfig | null {
  if (!workspaceCwd) return null;
  const file = path.join(workspaceCwd, PROJECT_CONFIG_NAME);
  try {
    if (!fs.existsSync(file)) return null;
  } catch {
    return null;
  }
  const loaded = loadConfigFile(file);
  // Distinguish "file missing/invalid, defaults returned" from a real project
  // file: re-read raw to confirm the file parsed as an object. loadConfigFile
  // already returns defaults on error, so verify the file holds an object.
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
  } catch {
    return null;
  }
  return loaded;
}

export interface ResolvedConfig extends TabsConfig {
  templates?: Record<string, { tabs: TabSpec[]; renameFirst: string }>;
  defaultTemplate?: string;
}

/**
 * Resolves the effective config: per-project `.herdr-tabs.json` in the
 * workspace cwd wins over the global `tabs.json`.
 */
export function resolveTabsConfig(
  ws = '',
  options: {
    env?: NodeJS.ProcessEnv;
    run?: (args: string[]) => { status: number; stdout: string; stderr: string };
    workspaceCwd?: string;
  } = {},
): ResolvedConfig {
  const { env = process.env, run = runHerdr, workspaceCwd } = options;
  const global = loadTabsConfig(env) as ResolvedConfig;
  const cwd =
    workspaceCwd ?? (ws ? resolveWorkspaceCwd(ws, { env, run }) : extractWorkspaceCwd(env));
  if (cwd) {
    const project = loadProjectConfig(cwd);
    if (project) {
      return {
        ...project,
        source: 'project',
        projectCwd: cwd,
        availableTemplates: Object.keys(project.templates ?? {}),
      };
    }
  }
  return { ...global, source: 'global' };
}

export interface SelectedTemplate {
  tabs: TabSpec[];
  renameFirst: string;
  name: string;
  error?: string;
}

/**
 * Picks which template to apply. Non-interactive: HERDR_TEMPLATE wins, then
 * the file's default_template, then the top-level default.
 */
export function selectTemplate(
  config: ResolvedConfig,
  env: NodeJS.ProcessEnv = process.env,
): SelectedTemplate {
  const templates = config.templates ?? {};
  const available = Object.keys(templates);
  const requested = (env.HERDR_TEMPLATE || '').trim();
  if (requested && requested !== 'default') {
    const found = templates[requested];
    if (!found) {
      return {
        tabs: config.tabs,
        renameFirst: config.renameFirst,
        name: '',
        error: `unknown template "${requested}" (available: ${available.join(', ') || 'none'})`,
      };
    }
    return { tabs: found.tabs, renameFirst: found.renameFirst, name: requested };
  }
  const def = (config.defaultTemplate || '').trim();
  if (def && templates[def]) {
    return { tabs: templates[def].tabs, renameFirst: templates[def].renameFirst, name: def };
  }
  return { tabs: config.tabs, renameFirst: config.renameFirst, name: '' };
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

function parseHerdrIds(stdout: string): { tabId: string; paneId: string } {
  try {
    const data = JSON.parse(stdout || '{}') as {
      result?: {
        tab?: { tab_id?: string };
        root_pane?: { pane_id?: string };
        pane?: { pane_id?: string };
      };
    };
    return {
      tabId: data.result?.tab?.tab_id || '',
      paneId: data.result?.root_pane?.pane_id || data.result?.pane?.pane_id || '',
    };
  } catch {
    return { tabId: '', paneId: '' };
  }
}

function envArgs(env?: Record<string, string>): string[] {
  if (!env) return [];
  const args: string[] = [];
  for (const [k, v] of Object.entries(env)) args.push('--env', `${k}=${v}`);
  return args;
}

export interface ApplyOptions {
  guard?: boolean;
  env?: NodeJS.ProcessEnv;
  run?: (args: string[]) => { status: number; stdout: string; stderr: string };
  countTabs?: (ws: string) => number;
  /** Pre-resolved template (from resolveTabsConfig + selectTemplate). */
  config?: TabsConfig;
}

// Applies the template to a workspace.
// With guard=true (event path) only fresh 1-tab workspaces are filled.
export function applyTemplate(ws: string, options: ApplyOptions = {}): ApplyResult {
  const { guard = true, env = process.env } = options;
  const run = options.run ?? runHerdr;
  const countTabs = options.countTabs ?? tabCount;
  const resolved = options.config ?? loadTabsConfig(env);
  const tabs = resolved.tabs;
  const renameFirst = resolved.renameFirst;
  const labels = tabLabels(tabs);

  if (guard) {
    const count = countTabs(ws);
    if (count !== 1) {
      markDone(ws, env);
      return {
        applied: false,
        reason: `has ${count} tabs, skipping`,
        tabs: labels,
        renameFirst,
        failed: [],
      };
    }
  }

  if (renameFirst) {
    run(['tab', 'rename', `${ws}:t1`, renameFirst]);
  }

  const failed: string[] = [];
  for (const tab of tabs) {
    const createArgs = [
      'tab',
      'create',
      '--workspace',
      ws,
      '--label',
      tab.label,
      ...(tab.cwd ? ['--cwd', tab.cwd] : []),
      ...envArgs(tab.env),
      '--no-focus',
    ];
    const created = run(createArgs);
    if (created.status !== 0) {
      failed.push(tab.label);
      continue;
    }
    let currentPane = parseHerdrIds(created.stdout).paneId;
    const needsPaneIds = Boolean(
      (tab.command && tab.command.length > 0) ||
        (tab.splits && tab.splits.length > 0),
    );
    if (!currentPane && needsPaneIds) {
      failed.push(tab.label);
      continue;
    }
    if (tab.command && currentPane) {
      const res = run(['pane', 'run', currentPane, ...tab.command]);
      if (res.status !== 0 && !failed.includes(tab.label)) failed.push(tab.label);
    }
    for (const split of tab.splits ?? []) {
      const direction = split.direction ?? 'right';
      const splitArgs = [
        'pane',
        'split',
        currentPane,
        '--direction',
        direction,
        ...(split.cwd ? ['--cwd', split.cwd] : []),
        ...(split.ratio !== undefined ? ['--ratio', String(split.ratio)] : []),
        ...envArgs(split.env),
        '--no-focus',
      ];
      const res = run(splitArgs);
      if (res.status !== 0) {
        if (!failed.includes(split.label || tab.label)) failed.push(split.label || tab.label);
        continue;
      }
      const nextPane = parseHerdrIds(res.stdout).paneId;
      if (!nextPane) {
        if (!failed.includes(split.label || tab.label)) failed.push(split.label || tab.label);
        continue;
      }
      currentPane = nextPane;
      if (split.label) {
        run(['pane', 'rename', currentPane, split.label]);
      }
      if (split.command) {
        const cmdRes = run(['pane', 'run', currentPane, ...split.command]);
        if (cmdRes.status !== 0 && !failed.includes(split.label || tab.label)) {
          failed.push(split.label || tab.label);
        }
      }
    }
  }

  markDone(ws, env);
  return {
    applied: true,
    tabs: labels,
    renameFirst,
    failed,
    templateName: resolved.templateName,
    source: resolved.source,
  };
}
