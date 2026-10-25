# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
