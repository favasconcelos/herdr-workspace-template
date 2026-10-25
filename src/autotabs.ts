#!/usr/bin/env node
// autotabs.ts — runs on workspace.created / workspace.focused.
// Env from Herdr: HERDR_BIN_PATH, HERDR_PLUGIN_EVENT, HERDR_PLUGIN_EVENT_JSON,
// HERDR_PLUGIN_CONFIG_DIR, HERDR_PLUGIN_STATE_DIR, HERDR_WORKSPACE_ID (sometimes).

import { extractWorkspaceId, alreadyDone, applyTemplate } from './lib';

function main(): void {
  const ws = extractWorkspaceId();
  if (!ws) {
    console.error('autotabs: no workspace_id in event, skipping');
    process.exit(0);
  }

  // Dedupe: workspace.focused fires on every switch; only template once.
  if (alreadyDone(ws)) process.exit(0);

  const result = applyTemplate(ws, { guard: true });
  if (!result.applied) {
    console.error(`autotabs: workspace ${ws} ${result.reason}`);
    process.exit(0);
  }

  if (result.failed.length > 0) {
    console.error(`autotabs: failed to create tabs: ${result.failed.join(', ')}`);
  }
  console.log(
    `autotabs: workspace ${ws} templated with [${result.renameFirst} ${result.tabs.join(' ')}]`,
  );
}

main();
