#!/bin/bash
# autotabs.sh — runs on workspace.created / workspace.focused
# Env from Herdr: HERDR_BIN_PATH, HERDR_PLUGIN_EVENT, HERDR_PLUGIN_EVENT_JSON,
# HERDR_PLUGIN_CONFIG_DIR, HERDR_PLUGIN_STATE_DIR, HERDR_WORKSPACE_ID (sometimes)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

HERDR="${HERDR_BIN_PATH:-herdr}"

WS=$(extract_workspace_id)

if [ -z "$WS" ]; then
  echo "autotabs: no workspace_id in event, skipping" >&2
  exit 0
fi

# Dedupe: workspace.focused fires on every switch; only template once.
if already_done "$WS"; then
  exit 0
fi

load_tabs_config

# Safety: only auto-fill fresh workspaces (1 tab). Avoids duplicating on restore / grouped worktrees.
TAB_COUNT=$("$HERDR" tab list --workspace "$WS" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('result',{}).get('tabs',[])))" 2>/dev/null || echo "0")

if [ "$TAB_COUNT" != "1" ]; then
  mark_done "$WS"
  echo "autotabs: workspace $WS has $TAB_COUNT tabs, skipping" >&2
  exit 0
fi

# Rename the auto-created first tab, then add the rest.
if [ -n "${RENAME_FIRST:-}" ]; then
  "$HERDR" tab rename "${WS}:t1" "$RENAME_FIRST" >/dev/null 2>&1 || true
fi

for t in $TABS; do
  "$HERDR" tab create --workspace "$WS" --label "$t" --no-focus >/dev/null 2>&1 || echo "autotabs: failed to create tab $t" >&2
done

mark_done "$WS"
echo "autotabs: workspace $WS templated with [$RENAME_FIRST $TABS]"
