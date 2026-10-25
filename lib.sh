#!/bin/bash
# lib.sh — shared helpers for workspace-template plugin
# Source from autotabs.sh / apply.sh / autotabs_for.sh
# Provides: load_tabs_config (sets TABS + RENAME_FIRST)

load_tabs_config() {
  local config_file="${HERDR_PLUGIN_CONFIG_DIR:-$HOME/.config/herdr/plugins/config/workspace-template}/tabs.json"
  CONFIG_FILE="$config_file"
  export CONFIG_FILE
  DEFAULT_TABS="logs server"
  RENAME_FIRST="agent"

  if [ -f "$config_file" ]; then
    TABS=$(CONFIG_FILE="$config_file" python3 -c "import json,os; d=json.load(open(os.environ['CONFIG_FILE'])); print(' '.join(d.get('tabs',[])))" 2>/dev/null || echo "$DEFAULT_TABS")
    RENAME_FIRST=$(CONFIG_FILE="$config_file" python3 -c "import json,os; d=json.load(open(os.environ['CONFIG_FILE'])); print(d.get('rename_first','agent'))" 2>/dev/null || echo "agent")
    [ -z "$TABS" ] && TABS="$DEFAULT_TABS"
  else
    TABS="$DEFAULT_TABS"
  fi
  export TABS RENAME_FIRST
}

# Extract workspace_id from HERDR_PLUGIN_EVENT_JSON.
# Real wire format (herdr 0.7+): {"event":"workspace_created","data":{"workspace":{"workspace_id":"w5",...}}}
# workspace.focused variant: {"event":"...","data":{"workspace_id":"w5"}}
# Fallback: HERDR_WORKSPACE_ID env (present on some invocations).
extract_workspace_id() {
  HERDR_PLUGIN_EVENT_JSON="${HERDR_PLUGIN_EVENT_JSON:-{\}}" HERDR_WORKSPACE_ID="${HERDR_WORKSPACE_ID:-}" python3 -c "
import json,os
ws=''
try:
  e=json.loads(os.environ.get('HERDR_PLUGIN_EVENT_JSON','{}') or '{}')
  d=e.get('data',e)
  ws=(d.get('workspace') or {}).get('workspace_id','') or d.get('workspace_id','') or e.get('workspace_id','') or (e.get('workspace') or {}).get('workspace_id','')
except Exception:
  pass
if not ws:
  ws=os.environ.get('HERDR_WORKSPACE_ID','')
print(ws)
" 2>/dev/null
}

# Dedupe marker: returns 0 if this workspace was already templated.
already_done() {
  local ws="$1"
  local state_dir="${HERDR_PLUGIN_STATE_DIR:-/tmp/herdr-workspace-template-state}"
  mkdir -p "$state_dir" 2>/dev/null || true
  [ -f "$state_dir/done-$ws" ]
}
mark_done() {
  local ws="$1"
  local state_dir="${HERDR_PLUGIN_STATE_DIR:-/tmp/herdr-workspace-template-state}"
  mkdir -p "$state_dir" 2>/dev/null || true
  touch "$state_dir/done-$ws" 2>/dev/null || true
}
