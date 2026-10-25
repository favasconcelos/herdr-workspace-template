# herdr-workspace-template

[![CI](https://github.com/favasconcelos/herdr-workspace-template/actions/workflows/ci.yml/badge.svg)](https://github.com/favasconcelos/herdr-workspace-template/actions/workflows/ci.yml)

Herdr plugin: auto-create pre-configured tabs on every new workspace.

Every `workspace create` gets a predictable starting layout instead of a single empty tab.

## Install

```bash
herdr plugin install favasconcelos/herdr-workspace-template
```

Local dev (`plugin link` does not run builds, so build once yourself):

```bash
herdr plugin link <checkout>
cd <checkout> && npm ci && npm run build
```

Requires Herdr `>= 0.9.0` (`min_herdr_version = "0.9.0"`) and Node.js `>= 18`.
Platforms: `linux`, `macos`, `windows` (pure Node.js, no shell dependencies).

## Project structure

```text
herdr-plugin.toml     # manifest (entrypoints → dist/*.js, [[build]] runs npm ci + build)
src/
  lib.ts              # config loader, templates, event parsing, dedupe, herdr CLI calls
  autotabs.ts         # workspace.created + workspace.focused handler
  apply.ts            # manual action entrypoint
test/
  lib.test.ts         # node:test unit tests (run: npm test)
dist/                 # tsc output (gitignored, built on install)
tabs.json.example     # copy to $(herdr plugin config-dir workspace-template)/tabs.json
```

TypeScript extends `@tsconfig/node24`; dependencies are pinned exact in
`package.json` + `package-lock.json`.

## How it works

- `[[events]] on = "workspace.created"` + `on = "workspace.focused"` → `src/autotabs.js`.
  Both are needed: UI-created worktrees historically emit only `workspace.focused`,
  CLI creates emit `workspace.created` (same pattern as `herdr-plugin-workspace-manager`).
  A state-dir marker (`done-<workspace_id>`) dedupes so each workspace is templated once.
- Reads the tab list from the plugin config dir `tabs.json`
  (per-project `.herdr-tabs.json` in the workspace checkout wins when present):
  ```json
  { "tabs": ["logs", "server"], "rename_first": "agent" }
  ```
  Fallback when missing: rename first tab to `agent`, add `logs` + `server`.
  Entries may be rich objects with `cwd`/`command`/`env`/`splits` (see
  Configuration), and named `templates` can be defined for the chooser.
- Guard: only fills fresh workspaces with exactly 1 tab — skips restores and grouped worktree workspaces.
- `[[actions]] apply` (`workspace` context) → `src/apply.js` for manual re-apply to the current workspace.
- Event payload shape handled: `{"event": ..., "data": {"workspace": {"workspace_id": "wX"}}}` for
  created, `{"data": {"workspace_id": "wX"}}` for focused, plus `HERDR_WORKSPACE_ID` fallback.

Get your config path with:

```bash
herdr plugin config-dir workspace-template
cp tabs.json.example "$(herdr plugin config-dir workspace-template)/tabs.json"
```

## Usage

1. Create any workspace normally — tabs appear automatically:
   ```bash
   herdr workspace create --cwd ~/code/foo --label foo
   herdr tab list --workspace <wX>
   # wX:t1 agent, wX:t2 logs, wX:t3 server
   ```
2. Manual re-apply from the Herdr UI (workspace context → Apply workspace template) or:
   ```bash
   herdr plugin action invoke apply --plugin workspace-template
   ```
   Headless invocations (UI button, CLI) always use the default template (or
   `default_template` when set). To choose a template, run the entrypoint
   directly in a terminal inside the target workspace — its pane env already
   carries `HERDR_WORKSPACE_ID`, and a TTY enables the picker:
   ```bash
   HERDR_TEMPLATE=rust node <checkout>/dist/apply.js   # named template, no prompt
   node <checkout>/dist/apply.js                       # fzf picker when on a TTY
   ```
   This works because Herdr injects the caller's workspace into each managed
   pane (`HERDR_WORKSPACE_ID`, see `herdr --skill`); custom env vars are not
   forwarded through `plugin action invoke`, so the direct form is required
   for overrides.
   Optional keybinding (`~/.config/herdr/config.toml`):
   ```toml
   [[keys.command]]
   key = "prefix+t"
   type = "plugin_action"
   command = "workspace-template.apply"
   description = "apply workspace template"
   ```
3. Debug:
   ```bash
   herdr plugin log list --plugin workspace-template
   ```

## Troubleshooting

- **Tabs don't appear:** check `herdr plugin list` shows `workspace-template` enabled,
  then `herdr plugin log list --plugin workspace-template` — a `workspace.created`
  entry with `autotabs: ... templated` means it ran; `... has N tabs, skipping`
  means the 1-tab guard fired (workspace wasn't fresh).
- **Link warnings:** `herdr plugin link` warns on unknown event names — valid names
  here are `workspace.created` and `workspace.focused` (dotted form).
- **`tabs.json` not picked up:** confirm the path with
  `herdr plugin config-dir workspace-template` and validate JSON with
  `python3 -m json.tool <path>/tabs.json`.

## Configuration

Global config lives in `tabs.json` under `herdr plugin config-dir workspace-template`.
A per-project `.herdr-tabs.json` in the workspace's checkout directory overrides
it (same schema). Resolution order: `.herdr-tabs.json` → global `tabs.json` →
built-in defaults.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `tabs` | `["logs","server"]` | Labels created with `tab create --no-focus` |
| `rename_first` | `"agent"` | Renames auto-created `<ws>:t1`; empty string disables |
| `templates` | `{}` | Named templates `{name: {tabs, rename_first}}` for the chooser |
| `default_template` | `""` | Named template auto-applied to new workspaces; default is top-level `tabs` |

Each `tabs[]` entry is either a plain label string or a rich object:

```json
{
  "tabs": [
    "logs",
    { "label": "server", "cwd": "/repo", "command": "npm run dev" },
    {
      "label": "code",
      "splits": [
        { "label": "db", "command": "pg start", "direction": "down", "ratio": 0.3 }
      ]
    }
  ],
  "rename_first": "agent"
}
```

Rich tab keys: `label` (or `title`), `cwd`, `command` (string or string array,
run with `pane run` in the tab's root pane), `env` (`{KEY: value}`), `splits`
(extra panes; each also accepts `direction`: `right`/`down`, with
`vertical`→`right` and `horizontal→down` aliases, plus optional `ratio` in
`(0,1)`). `panes` is accepted as an alias for `splits` (workspace-manager
style): its first entry folds into the root pane, the rest become splits.

Named templates for the chooser (`apply` action):

```json
{
  "tabs": ["logs", "server"],
  "rename_first": "agent",
  "default_template": "node",
  "templates": {
    "node": { "tabs": ["dev", "test"] },
    "rust": { "tabs": ["bacon"], "rename_first": "main" }
  }
}
```

## Difference vs herdr-plugin-workspace-manager

[`razajamil/herdr-plugin-workspace-manager`](https://github.com/razajamil/herdr-plugin-workspace-manager)
does declarative per-workspace tab/pane layouts with commands. This plugin is the
lightweight alternative: a fixed tab set applied to *every* new workspace, no per-repo config.

## Roadmap

- [x] v0.1 fixed list + 1-tab guard + dedupe + manual apply
- [x] v0.2 per-project override (`.herdr-tabs.json`) + layout support (splits, cwd, commands via `pane split`/`pane run`, no socket API so Windows keeps working)
- [x] v0.3 template chooser (`templates` + `default_template`, `HERDR_TEMPLATE` override, `fzf` picker in manual `apply` when on a TTY)
- [ ] v0.4 popup picker at creation time (plugin pane `popup` placement)

## Contributing

PRs welcome. Test with:

```bash
npm run lint                                        # Biome check (same as CI)
npm test                                              # build tests + 31 unit tests
herdr plugin link <checkout> && npm run build
herdr workspace create --cwd /tmp --label template-test --focus
herdr tab list --workspace <wX>
```

## Releasing

Push a `v*` tag — the `Release` workflow builds, tests, and creates the GitHub
release with generated notes:

```bash
npm version <major|minor|patch> --no-git-tag-version  # bump package.json + CHANGELOG first
git add -A && git commit -m "release: vX.Y.Z" && git tag vX.Y.Z && git push origin main vX.Y.Z
```

## License

MIT — see [LICENSE](LICENSE).
