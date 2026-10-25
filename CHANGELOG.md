# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- Rewrote `src/` in Node.js (`lib.js`, `autotabs.js`, `apply.js`; `package.json`
  with `engines: node >= 18`). Declares `windows` platform support.

## [0.1.0] - 2026-10-25

### Added
- Auto-create pre-configured tabs on `workspace.created` + `workspace.focused` (covers CLI and UI paths).
- `tabs.json` config (`tabs`, `rename_first`) with `logs`/`server` + `agent` defaults.
- 1-tab guard (skip restores / grouped worktrees) and per-workspace dedupe marker.
- Manual `apply` action for the current workspace.
- Correct `HERDR_PLUGIN_EVENT_JSON` parsing (`.data.workspace.workspace_id`, focused-shape, env fallback).
