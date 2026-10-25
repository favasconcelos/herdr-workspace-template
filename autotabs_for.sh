#!/bin/bash
# autotabs_for.sh — shared core: apply template to explicit workspace $1 (bypasses 1-tab guard)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

HERDR="${HERDR_BIN_PATH:-herdr}"
WS="${1:-}"
[ -z "$WS" ] && { echo "usage: autotabs_for.sh <workspace_id>" >&2; exit 1; }

load_tabs_config

for t in $TABS; do
  "$HERDR" tab create --workspace "$WS" --label "$t" --no-focus >/dev/null 2>&1 || echo "failed: $t" >&2
done
echo "applied [$TABS] to $WS"
