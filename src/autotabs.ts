#!/usr/bin/env node
/**
 * Event-hook entrypoint: runs on `workspace.created` and `workspace.focused`.
 *
 * Both events are needed: UI-created worktrees historically emit only
 * `workspace.focused`, while CLI creates emit `workspace.created`. A state-dir
 * marker dedupes so each workspace is templated once. Runs non-interactively,
 * so template choice comes from the resolved config (`HERDR_TEMPLATE` or
 * `default_template`) with no prompting.
 *
 * Herdr-provided env: `HERDR_BIN_PATH`, `HERDR_PLUGIN_EVENT`,
 * `HERDR_PLUGIN_EVENT_JSON`, `HERDR_PLUGIN_CONFIG_DIR`,
 * `HERDR_PLUGIN_STATE_DIR`, sometimes `HERDR_WORKSPACE_ID`.
 */

import {
  extractWorkspaceId,
  alreadyDone,
  applyTemplate,
  resolveTabsConfig,
  selectTemplate,
} from './lib';

function main(): void {
  const ws = extractWorkspaceId();
  if (!ws) {
    console.error('autotabs: no workspace_id in event, skipping');
    process.exit(0);
  }

  if (alreadyDone(ws)) process.exit(0);

  const resolved = resolveTabsConfig(ws);
  const selected = selectTemplate(resolved);
  if (selected.error) {
    console.error(`autotabs: ${selected.error}; using default template`);
  }
  const where = resolved.source === 'project' ? ` (project ${resolved.projectCwd})` : '';
  const what = selected.name ? ` template "${selected.name}"` : '';

  const result = applyTemplate(ws, {
    guard: true,
    config: {
      tabs: selected.tabs,
      renameFirst: selected.renameFirst,
      templateName: selected.name,
      source: resolved.source,
    },
  });
  if (!result.applied) {
    console.error(`autotabs: workspace ${ws} ${result.reason}`);
    process.exit(0);
  }

  if (result.failed.length > 0) {
    console.error(`autotabs: failed to create tabs: ${result.failed.join(', ')}`);
  }
  console.log(
    `autotabs: workspace ${ws} templated${what} with [${result.renameFirst} ${result.tabs.join(' ')}]${where}`,
  );
}

main();
