#!/bin/bash
# apply.sh — manual action: apply template to workspace from invocation context
# Env: HERDR_PLUGIN_CONTEXT_JSON contains workspace_id, HERDR_WORKSPACE_ID fallback
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

CTX="${HERDR_PLUGIN_CONTEXT_JSON:-{\}}"
WS=$(HERDR_PLUGIN_CONTEXT_JSON="$CTX" python3 -c "import json,os; d=json.loads(os.environ.get('HERDR_PLUGIN_CONTEXT_JSON','{}')); print(d.get('workspace_id') or d.get('workspace',{}).get('workspace_id',''))" 2>/dev/null || echo "")
[ -z "$WS" ] && WS="${HERDR_WORKSPACE_ID:-}"

if [ -z "$WS" ]; then
  echo "apply: no workspace in context. Invoke from a workspace." >&2
  exit 1
fi

# TODO v0.2: prompt for template choice (fzf popup). v0.1 reuses same config as autotabs.sh.
exec bash "$SCRIPT_DIR/autotabs_for.sh" "$WS"
