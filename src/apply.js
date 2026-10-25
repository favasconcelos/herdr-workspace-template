#!/usr/bin/env node
'use strict';
// apply.js — manual action: apply the template to the workspace from the
// invocation context (HERDR_PLUGIN_CONTEXT_JSON, HERDR_WORKSPACE_ID fallback).
// TODO v0.2: prompt for template choice. v0.1 reuses the same config as autotabs.

const { extractContextWorkspaceId, applyTemplate } = require('./lib');

function main() {
  const ws = extractContextWorkspaceId();
  if (!ws) {
    console.error('apply: no workspace in context. Invoke from a workspace.');
    process.exit(1);
  }

  const result = applyTemplate(ws, { guard: false });
  if (result.failed.length > 0) {
    console.error(`apply: failed to create tabs: ${result.failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`apply: workspace ${ws} templated with [${result.renameFirst} ${result.tabs.join(' ')}]`);
}

main();
