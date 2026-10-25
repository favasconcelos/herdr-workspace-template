# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Per-project override: `.herdr-tabs.json` in the workspace checkout wins over
  global `tabs.json` (resolved via invocation context cwd, else `pane list`).
- Rich tab specs: `tabs[]` entries accept `{label, cwd, command, env, splits}`
  (`title`/`panes` aliases, `vertical`→`right` / `horizontal`→`down` mapping);
  splits run through `pane split` + `pane run` so Windows support is kept.
- Named `templates` + `default_template` in either config file; `HERDR_TEMPLATE`
  selects one, manual `apply` offers an `fzf` picker when on a TTY.
- 15 new unit tests (31 total) covering spec parsing, templates, project
  override, and split/command apply sequences.

### Changed
- Rewrote `src/` in TypeScript (`lib.ts`, `autotabs.ts`, `apply.ts`, compiled to
  `dist/`; `tsconfig.json` extends `@tsconfig/node24`). Manifest entrypoints are
  `node dist/*.js` with `[[build]]` (`npm ci` + `npm run build`) for installs.
- Tests live in `test/` (`test/lib.test.ts`, separate `tsconfig.test.json`
  building to `dist-test/`); 16 `node:test` unit tests covering event/context ID
  parsing, config fallback, dedupe markers, guarded/manual apply with stubbed runs.
- Added GitHub Actions: `CI` (build + test on Node 20/22/24 for pushes and PRs
  to `main`) and `Release` (build + test + `gh release create` on `v*` tags).
- Pinned devDependencies exact (`typescript`, `@types/node`, `@tsconfig/node24`)
  with committed `package-lock.json`.
- Declares `windows` platform support (pure Node.js, linux-tested only).

## [0.1.0] - 2026-10-25

### Added
- Auto-create pre-configured tabs on `workspace.created` + `workspace.focused` (covers CLI and UI paths).
- `tabs.json` config (`tabs`, `rename_first`) with `logs`/`server` + `agent` defaults.
- 1-tab guard (skip restores / grouped worktrees) and per-workspace dedupe marker.
- Manual `apply` action for the current workspace.
- Correct `HERDR_PLUGIN_EVENT_JSON` parsing (`.data.workspace.workspace_id`, focused-shape, env fallback).
