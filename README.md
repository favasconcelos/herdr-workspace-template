# herdr-workspace-template

Herdr plugin: auto-create pre-configured tabs on every new workspace.

Every `workspace create` gets a predictable starting layout instead of a single empty tab.

## Install

```bash
herdr plugin install favasconcelos/herdr-workspace-template
```

Local dev:

```bash
herdr plugin link <checkout>
```

Requires Herdr `>= 0.9.0` (`min_herdr_version = "0.9.0"`) and Node.js `>= 18`.
Platforms: `linux`, `macos`, `windows` (pure Node.js, no shell dependencies).

## Project structure

```text
herdr-plugin.toml     # manifest (entrypoints → src/*.js)
src/
  autotabs.js         # workspace.created + workspace.focused handler
  apply.js            # manual action entrypoint
  lib.js              # config loader, event parsing, dedupe, herdr CLI calls
tabs.json.example     # copy to $(herdr plugin config-dir workspace-template)/tabs.json
```

## How it works

- `[[events]] on = "workspace.created"` + `on = "workspace.focused"` → `src/autotabs.js`.
  Both are needed: UI-created worktrees historically emit only `workspace.focused`,
  CLI creates emit `workspace.created` (same pattern as `herdr-plugin-workspace-manager`).
  A state-dir marker (`done-<workspace_id>`) dedupes so each workspace is templated once.
- Reads the tab list from the plugin config dir `tabs.json`:
  ```json
  { "tabs": ["logs", "server"], "rename_first": "agent" }
  ```
  Fallback when missing: rename first tab to `agent`, add `logs` + `server`.
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
   herdr plugin action invoke workspace-template.apply
   ```
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

| Key | Default | Meaning |
| --- | ------- | ------- |
| `tabs` | `["logs","server"]` | Labels created with `tab create --no-focus` |
| `rename_first` | `"agent"` | Renames auto-created `<ws>:t1`; empty string disables |

## Difference vs herdr-plugin-workspace-manager

[`razajamil/herdr-plugin-workspace-manager`](https://github.com/razajamil/herdr-plugin-workspace-manager)
does declarative per-workspace tab/pane layouts with commands. This plugin is the
lightweight alternative: a fixed tab set applied to *every* new workspace, no per-repo config.

## Roadmap

- [x] v0.1 fixed list + 1-tab guard + dedupe + manual apply
- [ ] v0.2 per-project override (`.herdr-tabs.json`) + `layout.apply` support (splits, cwd, commands)
- [ ] v0.3 prompt/chooser at creation (popup + fzf)

## Contributing

PRs welcome. Test with:

```bash
herdr plugin link <checkout>
herdr workspace create --cwd /tmp --label template-test --focus
herdr tab list --workspace <wX>
```

## License

MIT — see [LICENSE](LICENSE).
