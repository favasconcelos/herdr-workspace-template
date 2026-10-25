/**
 * Shared helpers for the workspace-template plugin.
 *
 * Used by `autotabs.ts` (workspace.created/workspace.focused event hook) and
 * `apply.ts` (manual action). All Herdr interaction goes through the CLI, so
 * the plugin stays dependency-free and cross-platform.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** Herdr plugin id, used for default config/state directory names. */
export const PLUGIN_ID = 'workspace-template'
/** Tab labels created when no config file is found. */
export const DEFAULT_TABS: string[] = ['logs', 'server']
/** Label applied to `<ws>:t1` when no config file is found; empty disables renaming. */
export const DEFAULT_RENAME_FIRST = 'agent'
/** Per-project override file, resolved inside the workspace checkout directory. */
export const PROJECT_CONFIG_NAME = '.herdr-tabs.json'

/** Split direction for an extra pane, as accepted by `herdr pane split`. */
export type SplitDirection = 'right' | 'down'

/** One extra pane inside a tab, created with `pane split` off the previous pane. */
export interface PaneSpec {
  /** Label applied with `pane rename`. Unset leaves the Herdr default. */
  label?: string
  /** Command executed with `pane run` once the pane exists. */
  command?: string[]
  /** Working directory passed as `pane split --cwd`. */
  cwd?: string
  /** Split direction; defaults to `'right'`. */
  direction?: SplitDirection
  /** Split ratio in (0, 1), passed as `pane split --ratio`. */
  ratio?: number
  /** Environment variables passed as repeated `pane split --env KEY=VALUE`. */
  env?: Record<string, string>
}

/** One tab created with `tab create`, plus optional commands and pane splits inside it. */
export interface TabSpec {
  /** Tab label, passed as `tab create --label`. */
  label: string
  /** Working directory passed as `tab create --cwd`. */
  cwd?: string
  /** Command executed with `pane run` in the tab's root pane. */
  command?: string[]
  /** Environment variables passed as repeated `tab create --env KEY=VALUE`. */
  env?: Record<string, string>
  /** Extra panes created with `pane split` off the previous pane. */
  splits?: PaneSpec[]
}

/** A fully parsed template: tab list plus first-tab rename label. */
export interface TabsConfig {
  /** Tabs to create, in order. */
  tabs: TabSpec[]
  /** Label applied to `<ws>:t1`; empty string disables renaming. */
  renameFirst: string
  /** Name of the template this config was selected from (default template has ''). */
  templateName?: string
  /** Where the config came from. Set by resolveTabsConfig, empty for loadTabsConfig. */
  source?: 'project' | 'global'
  /** Workspace cwd the project config was found in (if any). */
  projectCwd?: string
  /** All template names available in the source file. */
  availableTemplates?: string[]
}

/** A parsed config file, including any named templates for the chooser. */
export interface ResolvedConfig extends TabsConfig {
  /** Named templates from the file's `templates` map. */
  templates?: Record<string, { tabs: TabSpec[]; renameFirst: string }>
  /** Template name from the file's `default_template` key. */
  defaultTemplate?: string
}

/** Outcome of {@link applyTemplate}. */
export interface ApplyResult {
  /** Whether the template was applied (false when the 1-tab guard skipped). */
  applied: boolean
  /** Skip reason, set when `applied` is false. */
  reason?: string
  /** Labels of the tabs the template defines, in order. */
  tabs: string[]
  /** Rename label used for `<ws>:t1`. */
  renameFirst: string
  /** Tab or split labels that failed to create. */
  failed: string[]
  /** Name of the applied template ('' for the default). */
  templateName?: string
  /** Where the applied config came from. */
  source?: 'project' | 'global'
}

/** Herdr binary path, honoring the `HERDR_BIN_PATH` override Herdr provides. */
export function herdrBin(): string {
  return process.env.HERDR_BIN_PATH || 'herdr'
}

/**
 * Runs a Herdr CLI command and captures the result.
 *
 * @param args Arguments passed to the `herdr` binary, e.g. `['tab', 'list']`.
 */
export function runHerdr(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(herdrBin(), args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
}

/** Default global config directory for this plugin. */
function defaultConfigDir(): string {
  return path.join(os.homedir(), '.config', 'herdr', 'plugins', 'config', PLUGIN_ID)
}

/** Returns the value when it is a string, otherwise ''. */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Parses an `env` record, stringifying numeric/boolean values. */
function parseEnvRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Parses a `command` given as a string or string array. */
function parseCommand(value: unknown): string[] | undefined {
  if (typeof value === 'string' && value.length > 0) return [value]
  if (Array.isArray(value)) {
    const parts = (value as unknown[]).filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    return parts.length > 0 ? parts : undefined
  }
  return undefined
}

/**
 * Normalizes a split direction, mapping `vertical`/`horizontal` aliases to
 * Herdr's `right`/`down`.
 *
 * @returns The normalized direction, or undefined for unknown values.
 */
export function normalizeDirection(value: unknown): SplitDirection | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.toLowerCase()
  if (v === 'right' || v === 'down') return v
  if (v === 'vertical') return 'right'
  if (v === 'horizontal') return 'down'
  return undefined
}

/** Parses one pane entry (string label or object) into a {@link PaneSpec}. */
function parsePaneSpec(entry: unknown): PaneSpec | null {
  if (typeof entry === 'string') {
    return entry.length > 0 ? { label: entry } : null
  }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
  const obj = entry as Record<string, unknown>
  const label = asString(obj.label ?? obj.title)
  const command = parseCommand(obj.command)
  const cwd = asString(obj.cwd)
  const direction = normalizeDirection(obj.direction ?? obj.split)
  const ratio =
    typeof obj.ratio === 'number' && obj.ratio > 0 && obj.ratio < 1 ? obj.ratio : undefined
  const env = parseEnvRecord(obj.env)
  if (!label && !command && !cwd && !env) return null
  const spec: PaneSpec = {}
  if (label) spec.label = label
  if (command) spec.command = command
  if (cwd) spec.cwd = cwd
  if (direction) spec.direction = direction
  if (ratio !== undefined) spec.ratio = ratio
  if (env) spec.env = env
  return spec
}

/**
 * Normalizes one `tabs[]` entry into a {@link TabSpec}.
 *
 * Accepts a plain string label or a rich object with `label` (`title` alias),
 * `cwd`, `command` (string or string array), `env`, and `splits`. `panes` is
 * accepted as an alias for `splits`: its first entry describes the root pane,
 * so its command/cwd/env fold into the tab and only the rest become splits.
 *
 * @returns The normalized spec, or null when the entry carries no usable data.
 */
export function parseTabSpec(entry: unknown): TabSpec | null {
  if (typeof entry === 'string') {
    return entry.length > 0 ? { label: entry } : null
  }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
  const obj = entry as Record<string, unknown>
  const label = asString(obj.label ?? obj.title)
  if (!label) return null
  const spec: TabSpec = { label }
  const cwd = asString(obj.cwd)
  if (cwd) spec.cwd = cwd
  const command = parseCommand(obj.command)
  if (command) spec.command = command
  const env = parseEnvRecord(obj.env)
  if (env) spec.env = env
  const rawSplits = Array.isArray(obj.splits)
    ? obj.splits
    : Array.isArray(obj.panes)
      ? (obj.panes as unknown[])
      : null
  if (rawSplits) {
    let list: unknown[] = rawSplits
    if (Array.isArray(obj.panes) && !Array.isArray(obj.splits) && list.length > 0) {
      const root = parsePaneSpec(list[0])
      if (root) {
        if (root.command && !spec.command) spec.command = root.command
        if (root.cwd && !spec.cwd) spec.cwd = root.cwd
        if (root.env && !spec.env) spec.env = root.env
      }
      list = list.slice(1)
    }
    const splits: PaneSpec[] = []
    for (const item of list) {
      const parsed = parsePaneSpec(item)
      if (parsed) splits.push(parsed)
    }
    if (splits.length > 0) spec.splits = splits
  }
  return spec
}

/** Parses a `tabs` list, falling back to the given labels when empty/invalid. */
function parseTabsList(value: unknown, fallbackLabels: string[]): TabSpec[] {
  if (!Array.isArray(value)) {
    return fallbackLabels.map((label) => ({ label }))
  }
  const specs: TabSpec[] = []
  for (const entry of value) {
    const parsed = parseTabSpec(entry)
    if (parsed) specs.push(parsed)
  }
  return specs.length > 0 ? specs : fallbackLabels.map((label) => ({ label }))
}

/** Parses one named `templates` entry, inheriting unset keys from the defaults. */
function parseTemplateEntry(
  value: unknown,
  defaults: { tabs: TabSpec[]; renameFirst: string },
): { tabs: TabSpec[]; renameFirst: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { tabs: defaults.tabs, renameFirst: defaults.renameFirst }
  }
  const obj = value as Record<string, unknown>
  const tabs = Array.isArray(obj.tabs)
    ? parseTabsList(
        obj.tabs,
        defaults.tabs.map((t) => t.label),
      )
    : defaults.tabs
  const renameFirst = typeof obj.rename_first === 'string' ? obj.rename_first : defaults.renameFirst
  return { tabs, renameFirst }
}

/** Extracts the tab labels from a list of tab specs, in order. */
export function tabLabels(tabs: TabSpec[]): string[] {
  return tabs.map((t) => t.label)
}

/**
 * Loads the global template config from `$HERDR_PLUGIN_CONFIG_DIR/tabs.json`.
 *
 * @example
 * { "tabs": ["logs", "server"], "rename_first": "agent" }
 *
 * `tabs[]` entries may also be rich objects with `label`/`cwd`/`command`/
 * `env`/`splits`, and the file may define named `templates` plus a
 * `default_template`. Missing or invalid files fall back to built-in defaults.
 */
export function loadTabsConfig(env: NodeJS.ProcessEnv = process.env): TabsConfig {
  const dir = env.HERDR_PLUGIN_CONFIG_DIR || defaultConfigDir()
  return loadConfigFile(path.join(dir, 'tabs.json'))
}

/**
 * Loads and parses a template config file (global `tabs.json` or per-project
 * `.herdr-tabs.json`) into a {@link ResolvedConfig}.
 *
 * @param file Absolute path of the config file to read.
 * @returns The parsed config, or built-in defaults when the file is missing
 * or invalid.
 */
export function loadConfigFile(file: string): ResolvedConfig {
  const fallbackTabs: TabSpec[] = DEFAULT_TABS.map((label) => ({ label }))
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof data !== 'object' || data === null) {
      return { tabs: fallbackTabs, renameFirst: DEFAULT_RENAME_FIRST }
    }
    const record = data as Record<string, unknown>
    const tabs = parseTabsList(record.tabs, DEFAULT_TABS)
    const renameFirst =
      typeof record.rename_first === 'string' ? record.rename_first : DEFAULT_RENAME_FIRST
    const templates: Record<string, { tabs: TabSpec[]; renameFirst: string }> = {}
    if (
      typeof record.templates === 'object' &&
      record.templates !== null &&
      !Array.isArray(record.templates)
    ) {
      for (const [name, raw] of Object.entries(record.templates as Record<string, unknown>)) {
        if (!name) continue
        templates[name] = parseTemplateEntry(raw, { tabs, renameFirst })
      }
    }
    const defaultTemplate =
      typeof record.default_template === 'string' ? record.default_template : ''
    const out: ResolvedConfig = {
      tabs,
      renameFirst,
      templateName: '',
      availableTemplates: Object.keys(templates),
    }
    if (Object.keys(templates).length > 0) out.templates = templates
    if (defaultTemplate) out.defaultTemplate = defaultTemplate
    return out
  } catch {
    return { tabs: fallbackTabs, renameFirst: DEFAULT_RENAME_FIRST }
  }
}

/**
 * Extracts the workspace id from `HERDR_PLUGIN_EVENT_JSON`.
 *
 * Handles the real wire shapes — `data.workspace.workspace_id`
 * (workspace.created) and `data.workspace_id` (workspace.focused variant) —
 * and falls back to `HERDR_WORKSPACE_ID`. Returns '' when nothing is found.
 */
export function extractWorkspaceId(env: NodeJS.ProcessEnv = process.env): string {
  let ws = ''
  try {
    const event = JSON.parse(env.HERDR_PLUGIN_EVENT_JSON || '{}') as {
      data?: { workspace?: { workspace_id?: string }; workspace_id?: string }
      workspace?: { workspace_id?: string }
      workspace_id?: string
    }
    const data = event.data ?? event
    ws =
      data.workspace?.workspace_id ||
      data.workspace_id ||
      event.workspace_id ||
      event.workspace?.workspace_id ||
      ''
  } catch {}
  if (!ws) ws = env.HERDR_WORKSPACE_ID || ''
  return ws
}

/**
 * Extracts the workspace id from `HERDR_PLUGIN_CONTEXT_JSON` (manual actions),
 * falling back to `HERDR_WORKSPACE_ID`. Returns '' when nothing is found.
 */
export function extractContextWorkspaceId(env: NodeJS.ProcessEnv = process.env): string {
  let ws = ''
  try {
    const ctx = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON || '{}') as {
      workspace?: { workspace_id?: string }
      workspace_id?: string
    }
    ws = ctx.workspace_id || ctx.workspace?.workspace_id || ''
  } catch {}
  if (!ws) ws = env.HERDR_WORKSPACE_ID || ''
  return ws
}

/**
 * Best-effort workspace cwd from event/context env payloads, without any
 * Herdr call. Checks `workspace_cwd`, `focused_pane_cwd`, and worktree
 * checkout paths. Returns '' when nothing is found.
 */
export function extractWorkspaceCwd(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const ctx = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON || '{}') as {
      workspace_cwd?: string
      focused_pane_cwd?: string
      worktree?: { checkout_path?: string }
    }
    const cwd =
      (typeof ctx.workspace_cwd === 'string' && ctx.workspace_cwd) ||
      (typeof ctx.focused_pane_cwd === 'string' && ctx.focused_pane_cwd) ||
      (typeof ctx.worktree?.checkout_path === 'string' && ctx.worktree.checkout_path) ||
      ''
    if (cwd) return cwd
  } catch {}
  try {
    const event = JSON.parse(env.HERDR_PLUGIN_EVENT_JSON || '{}') as {
      data?: {
        workspace?: { worktree?: { checkout_path?: string } }
        worktree?: { path?: string }
      }
    }
    const data = event.data ?? {}
    const cwd = data.workspace?.worktree?.checkout_path || data.worktree?.path || ''
    if (typeof cwd === 'string' && cwd) return cwd
  } catch {}
  return ''
}

/** Reads the first pane cwd out of `pane list` JSON output. */
function parsePaneListCwd(stdout: string): string {
  try {
    const data = JSON.parse(stdout || '{}') as {
      result?: { panes?: Array<{ cwd?: string; foreground_cwd?: string }> }
    }
    const panes = data.result?.panes ?? []
    for (const pane of panes) {
      const cwd = pane?.cwd || pane?.foreground_cwd || ''
      if (cwd) return cwd
    }
  } catch {}
  return ''
}

/**
 * Resolves the workspace's checkout cwd: env payloads first, then the first
 * pane's cwd via `pane list`. Returns '' when nothing is found.
 */
export function resolveWorkspaceCwd(
  ws: string,
  options: {
    env?: NodeJS.ProcessEnv
    run?: (args: string[]) => { status: number; stdout: string; stderr: string }
  } = {},
): string {
  const { env = process.env, run = runHerdr } = options
  const fromEnv = extractWorkspaceCwd(env)
  if (fromEnv) return fromEnv
  if (!ws) return ''
  try {
    const result = run(['pane', 'list', '--workspace', ws])
    if (result.status !== 0) return ''
    return parsePaneListCwd(result.stdout)
  } catch {
    return ''
  }
}

/**
 * Loads the per-project override file `<cwd>/.herdr-tabs.json`.
 *
 * @returns The parsed project config, or null when the file is absent or
 * does not hold a config object.
 */
export function loadProjectConfig(workspaceCwd: string): ResolvedConfig | null {
  if (!workspaceCwd) return null
  const file = path.join(workspaceCwd, PROJECT_CONFIG_NAME)
  try {
    if (!fs.existsSync(file)) return null
  } catch {
    return null
  }
  const loaded = loadConfigFile(file)
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return null
  } catch {
    return null
  }
  return loaded
}

/**
 * Resolves the effective config: the per-project `.herdr-tabs.json` in the
 * workspace cwd wins over the global `tabs.json`.
 */
export function resolveTabsConfig(
  ws = '',
  options: {
    env?: NodeJS.ProcessEnv
    run?: (args: string[]) => { status: number; stdout: string; stderr: string }
    workspaceCwd?: string
  } = {},
): ResolvedConfig {
  const { env = process.env, run = runHerdr, workspaceCwd } = options
  const global = loadTabsConfig(env) as ResolvedConfig
  const cwd =
    workspaceCwd ?? (ws ? resolveWorkspaceCwd(ws, { env, run }) : extractWorkspaceCwd(env))
  if (cwd) {
    const project = loadProjectConfig(cwd)
    if (project) {
      return {
        ...project,
        source: 'project',
        projectCwd: cwd,
        availableTemplates: Object.keys(project.templates ?? {}),
      }
    }
  }
  return { ...global, source: 'global' }
}

/** A template picked out of a resolved config by {@link selectTemplate}. */
export interface SelectedTemplate {
  /** Tabs to create, in order. */
  tabs: TabSpec[]
  /** Label applied to `<ws>:t1`. */
  renameFirst: string
  /** Selected template name ('' for the top-level default). */
  name: string
  /** Set when `HERDR_TEMPLATE` names an unknown template. */
  error?: string
}

/**
 * Picks which template to apply from a resolved config.
 *
 * `HERDR_TEMPLATE` wins when set to a known template name (`default`
 * explicitly selects the top-level tabs). Otherwise the file's
 * `default_template` applies when it names a known template, else the
 * top-level default is used.
 *
 * @returns The selected tabs and rename label; `error` is set instead of
 * throwing when `HERDR_TEMPLATE` names an unknown template.
 */
export function selectTemplate(
  config: ResolvedConfig,
  env: NodeJS.ProcessEnv = process.env,
): SelectedTemplate {
  const templates = config.templates ?? {}
  const available = Object.keys(templates)
  const requested = (env.HERDR_TEMPLATE || '').trim()
  if (requested && requested !== 'default') {
    const found = templates[requested]
    if (!found) {
      return {
        tabs: config.tabs,
        renameFirst: config.renameFirst,
        name: '',
        error: `unknown template "${requested}" (available: ${available.join(', ') || 'none'})`,
      }
    }
    return { tabs: found.tabs, renameFirst: found.renameFirst, name: requested }
  }
  const def = (config.defaultTemplate || '').trim()
  if (def && templates[def]) {
    return { tabs: templates[def].tabs, renameFirst: templates[def].renameFirst, name: def }
  }
  return { tabs: config.tabs, renameFirst: config.renameFirst, name: '' }
}

/**
 * Returns the plugin state directory, creating it when needed. Marker files
 * in it record which workspaces were already templated.
 */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.HERDR_PLUGIN_STATE_DIR || path.join(os.tmpdir(), 'herdr-workspace-template-state')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  return dir
}

/** Marker file recording that a workspace was already templated. */
function markerPath(ws: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateDir(env), `done-${ws}`)
}

/**
 * Reports whether a workspace was already templated.
 *
 * `workspace.focused` fires on every switch, so the hook consults this to
 * template each workspace only once.
 */
export function alreadyDone(ws: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return fs.existsSync(markerPath(ws, env))
  } catch {
    return false
  }
}

/** Records a workspace as templated. Best effort; write failures are ignored. */
export function markDone(ws: string, env: NodeJS.ProcessEnv = process.env): void {
  try {
    fs.writeFileSync(markerPath(ws, env), '')
  } catch {}
}

/**
 * Counts the tabs of a workspace via `tab list`.
 *
 * @returns The tab count, or 0 when the workspace cannot be listed.
 */
export function tabCount(ws: string): number {
  const result = runHerdr(['tab', 'list', '--workspace', ws])
  if (result.status !== 0) return 0
  try {
    const data = JSON.parse(result.stdout || '{}') as {
      result?: { tabs?: unknown[] }
    }
    return data.result?.tabs?.length ?? 0
  } catch {
    return 0
  }
}

/** Extracts created tab/pane ids from `tab create` / `pane split` JSON output. */
function parseHerdrIds(stdout: string): { tabId: string; paneId: string } {
  try {
    const data = JSON.parse(stdout || '{}') as {
      result?: {
        tab?: { tab_id?: string }
        root_pane?: { pane_id?: string }
        pane?: { pane_id?: string }
      }
    }
    return {
      tabId: data.result?.tab?.tab_id || '',
      paneId: data.result?.root_pane?.pane_id || data.result?.pane?.pane_id || '',
    }
  } catch {
    return { tabId: '', paneId: '' }
  }
}

/** Expands an env record into repeated `--env KEY=VALUE` CLI arguments. */
function envArgs(env?: Record<string, string>): string[] {
  if (!env) return []
  const args: string[] = []
  for (const [k, v] of Object.entries(env)) args.push('--env', `${k}=${v}`)
  return args
}

/** Options for {@link applyTemplate}. */
export interface ApplyOptions {
  /**
   * When true (event path), only fresh 1-tab workspaces are filled; anything
   * else is skipped and marked done.
   */
  guard?: boolean
  /** Environment used for config/state dir resolution. */
  env?: NodeJS.ProcessEnv
  /** Herdr runner, injectable for tests. */
  run?: (args: string[]) => { status: number; stdout: string; stderr: string }
  /** Tab counter, injectable for tests. */
  countTabs?: (ws: string) => number
  /** Pre-resolved template (from resolveTabsConfig + selectTemplate). */
  config?: TabsConfig
}

/**
 * Applies a template to a workspace: renames `<ws>:t1`, then creates each tab
 * with its cwd/env plus optional commands and pane splits.
 *
 * @param ws Workspace id to template.
 * @returns Labels applied, the rename label used, and any tab/split labels
 * that failed along the way.
 */
export function applyTemplate(ws: string, options: ApplyOptions = {}): ApplyResult {
  const { guard = true, env = process.env } = options
  const run = options.run ?? runHerdr
  const countTabs = options.countTabs ?? tabCount
  const resolved = options.config ?? loadTabsConfig(env)
  const tabs = resolved.tabs
  const renameFirst = resolved.renameFirst
  const labels = tabLabels(tabs)

  if (guard) {
    const count = countTabs(ws)
    if (count !== 1) {
      markDone(ws, env)
      return {
        applied: false,
        reason: `has ${count} tabs, skipping`,
        tabs: labels,
        renameFirst,
        failed: [],
      }
    }
  }

  if (renameFirst) {
    run(['tab', 'rename', `${ws}:t1`, renameFirst])
  }

  const failed: string[] = []
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
    ]
    const created = run(createArgs)
    if (created.status !== 0) {
      failed.push(tab.label)
      continue
    }
    let currentPane = parseHerdrIds(created.stdout).paneId
    const needsPaneIds = Boolean(
      (tab.command && tab.command.length > 0) || (tab.splits && tab.splits.length > 0),
    )
    if (!currentPane && needsPaneIds) {
      failed.push(tab.label)
      continue
    }
    if (tab.command && currentPane) {
      const res = run(['pane', 'run', currentPane, ...tab.command])
      if (res.status !== 0 && !failed.includes(tab.label)) failed.push(tab.label)
    }
    for (const split of tab.splits ?? []) {
      const direction = split.direction ?? 'right'
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
      ]
      const res = run(splitArgs)
      if (res.status !== 0) {
        if (!failed.includes(split.label || tab.label)) failed.push(split.label || tab.label)
        continue
      }
      const nextPane = parseHerdrIds(res.stdout).paneId
      if (!nextPane) {
        if (!failed.includes(split.label || tab.label)) failed.push(split.label || tab.label)
        continue
      }
      currentPane = nextPane
      if (split.label) {
        run(['pane', 'rename', currentPane, split.label])
      }
      if (split.command) {
        const cmdRes = run(['pane', 'run', currentPane, ...split.command])
        if (cmdRes.status !== 0 && !failed.includes(split.label || tab.label)) {
          failed.push(split.label || tab.label)
        }
      }
    }
  }

  markDone(ws, env)
  return {
    applied: true,
    tabs: labels,
    renameFirst,
    failed,
    templateName: resolved.templateName,
    source: resolved.source,
  }
}
