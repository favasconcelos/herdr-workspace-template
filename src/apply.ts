#!/usr/bin/env node
// apply.ts — manual action: apply the template to the workspace from the
// invocation context (HERDR_PLUGIN_CONTEXT_JSON, HERDR_WORKSPACE_ID fallback).
//
// Chooser (v0.3): when the resolved config defines named templates,
// HERDR_TEMPLATE=<name> selects one directly. Otherwise, if stdout is a TTY
// and `fzf` is available, the user picks interactively; headless invocations
// fall back to the default template.

import { spawnSync } from 'node:child_process';
import {
  extractContextWorkspaceId,
  extractWorkspaceCwd,
  applyTemplate,
  resolveTabsConfig,
  selectTemplate,
  type ResolvedConfig,
} from './lib';

function tryFzfChoose(available: string[]): string | null {
  if (available.length === 0) return null;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  try {
    const result = spawnSync('fzf', ['--prompt=template> ', '--height=40%'], {
      input: available.join('\n') + '\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    if (result.status !== 0) return null;
    const choice = (typeof result.stdout === 'string' ? result.stdout : '').trim();
    return available.includes(choice) ? choice : null;
  } catch {
    return null;
  }
}

function main(): void {
  const ws = extractContextWorkspaceId();
  if (!ws) {
    console.error('apply: no workspace in context. Invoke from a workspace.');
    process.exit(1);
  }

  const resolved: ResolvedConfig = resolveTabsConfig(ws, {
    workspaceCwd: extractWorkspaceCwd() || undefined,
  });
  const available = Object.keys(resolved.templates ?? {});
  let selected = selectTemplate(resolved);

  // Interactive chooser: only when the user didn't pin HERDR_TEMPLATE.
  if (!process.env.HERDR_TEMPLATE && available.length > 0) {
    const choice = tryFzfChoose(available);
    if (choice && resolved.templates) {
      const found = resolved.templates[choice];
      selected = { tabs: found.tabs, renameFirst: found.renameFirst, name: choice };
    }
  }
  if (selected.error) {
    console.error(`apply: ${selected.error}`);
    process.exit(1);
  }

  const result = applyTemplate(ws, {
    guard: false,
    config: {
      tabs: selected.tabs,
      renameFirst: selected.renameFirst,
      templateName: selected.name,
      source: resolved.source,
    },
  });
  if (result.failed.length > 0) {
    console.error(`apply: failed to create tabs: ${result.failed.join(', ')}`);
    process.exit(1);
  }
  const what = selected.name ? ` template "${selected.name}"` : '';
  console.log(
    `apply: workspace ${ws} templated${what} with [${result.renameFirst} ${result.tabs.join(' ')}]`,
  );
}

main();
