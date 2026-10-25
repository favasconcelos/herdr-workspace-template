// lib.test.ts — unit tests for the workspace-template plugin.
// Run: npm test (builds tests with tsc, then node --test dist-test/)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  loadTabsConfig,
  extractWorkspaceId,
  extractContextWorkspaceId,
  alreadyDone,
  markDone,
  applyTemplate,
} from '../src/lib';

function makeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...extra };
}

describe('extractWorkspaceId', () => {
  it('parses the workspace.created wire shape', () => {
    const env = makeEnv({
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
        event: 'workspace_created',
        data: { workspace: { workspace_id: 'wC' } },
      }),
    });
    assert.equal(extractWorkspaceId(env), 'wC');
  });

  it('parses the workspace.focused shape', () => {
    const env = makeEnv({
      HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
        event: 'workspace_focused',
        data: { workspace_id: 'wD' },
      }),
    });
    assert.equal(extractWorkspaceId(env), 'wD');
  });

  it('falls back to HERDR_WORKSPACE_ID when the payload is empty', () => {
    const env = makeEnv({ HERDR_PLUGIN_EVENT_JSON: '{}', HERDR_WORKSPACE_ID: 'w9' });
    assert.equal(extractWorkspaceId(env), 'w9');
  });

  it('returns empty string for malformed JSON with no fallback', () => {
    const env = makeEnv({ HERDR_PLUGIN_EVENT_JSON: 'not-json' });
    assert.equal(extractWorkspaceId(env), '');
  });
});

describe('extractContextWorkspaceId', () => {
  it('parses workspace_id from the invocation context', () => {
    const env = makeEnv({
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ workspace_id: 'wE' }),
    });
    assert.equal(extractContextWorkspaceId(env), 'wE');
  });

  it('falls back to HERDR_WORKSPACE_ID', () => {
    const env = makeEnv({ HERDR_WORKSPACE_ID: 'w7' });
    assert.equal(extractContextWorkspaceId(env), 'w7');
  });

  it('returns empty string when nothing is available', () => {
    assert.equal(extractContextWorkspaceId(makeEnv()), '');
  });
});

describe('loadTabsConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-config-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to defaults when tabs.json is missing', () => {
    const config = loadTabsConfig(makeEnv({ HERDR_PLUGIN_CONFIG_DIR: dir }));
    assert.deepEqual(config.tabs, ['logs', 'server']);
    assert.equal(config.renameFirst, 'agent');
  });

  it('reads tabs and rename_first from tabs.json', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ tabs: ['dev', 'test'], rename_first: 'main' }),
    );
    const config = loadTabsConfig(makeEnv({ HERDR_PLUGIN_CONFIG_DIR: dir }));
    assert.deepEqual(config.tabs, ['dev', 'test']);
    assert.equal(config.renameFirst, 'main');
  });

  it('falls back to defaults on invalid JSON', () => {
    fs.writeFileSync(path.join(dir, 'tabs.json'), '{oops');
    const config = loadTabsConfig(makeEnv({ HERDR_PLUGIN_CONFIG_DIR: dir }));
    assert.deepEqual(config.tabs, ['logs', 'server']);
  });

  it('ignores empty tabs arrays but honors empty rename_first', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ tabs: [], rename_first: '' }),
    );
    const config = loadTabsConfig(makeEnv({ HERDR_PLUGIN_CONFIG_DIR: dir }));
    assert.deepEqual(config.tabs, ['logs', 'server']);
    assert.equal(config.renameFirst, '');
  });
});

describe('dedupe markers', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-state-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('alreadyDone is false until markDone', () => {
    const env = makeEnv({ HERDR_PLUGIN_STATE_DIR: dir });
    assert.equal(alreadyDone('w1', env), false);
    markDone('w1', env);
    assert.equal(alreadyDone('w1', env), true);
    assert.equal(alreadyDone('w2', env), false);
  });
});

describe('applyTemplate', () => {
  let configDir: string;
  let stateDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-config-'));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-state-'));
    fs.writeFileSync(
      path.join(configDir, 'tabs.json'),
      JSON.stringify({ tabs: ['logs', 'server'], rename_first: 'agent' }),
    );
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function testEnv(): NodeJS.ProcessEnv {
    return makeEnv({
      HERDR_PLUGIN_CONFIG_DIR: configDir,
      HERDR_PLUGIN_STATE_DIR: stateDir,
    });
  }

  it('templates a fresh 1-tab workspace: rename + create + marker', () => {
    const calls: string[][] = [];
    const result = applyTemplate('wX', {
      guard: true,
      env: testEnv(),
      countTabs: () => 1,
      run: (args) => {
        calls.push(args);
        return { status: 0, stdout: '{}', stderr: '' };
      },
    });
    assert.equal(result.applied, true);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(calls, [
      ['tab', 'rename', 'wX:t1', 'agent'],
      ['tab', 'create', '--workspace', 'wX', '--label', 'logs', '--no-focus'],
      ['tab', 'create', '--workspace', 'wX', '--label', 'server', '--no-focus'],
    ]);
    assert.equal(alreadyDone('wX', testEnv()), true);
  });

  it('skips non-fresh workspaces when guard is on', () => {
    const calls: string[][] = [];
    const result = applyTemplate('wY', {
      guard: true,
      env: testEnv(),
      countTabs: () => 3,
      run: (args) => {
        calls.push(args);
        return { status: 0, stdout: '{}', stderr: '' };
      },
    });
    assert.equal(result.applied, false);
    assert.match(result.reason ?? '', /has 3 tabs/);
    assert.deepEqual(calls, []);
    assert.equal(alreadyDone('wY', testEnv()), true);
  });

  it('bypasses the guard for manual apply', () => {
    const calls: string[][] = [];
    const result = applyTemplate('wZ', {
      guard: false,
      env: testEnv(),
      countTabs: () => {
        throw new Error('countTabs must not be called when guard is off');
      },
      run: (args) => {
        calls.push(args);
        return { status: 0, stdout: '{}', stderr: '' };
      },
    });
    assert.equal(result.applied, true);
    assert.equal(calls.length, 3);
  });

  it('skips rename when rename_first is empty and reports failures', () => {
    fs.writeFileSync(
      path.join(configDir, 'tabs.json'),
      JSON.stringify({ tabs: ['logs'], rename_first: '' }),
    );
    const calls: string[][] = [];
    const result = applyTemplate('wQ', {
      guard: false,
      env: testEnv(),
      run: (args) => {
        calls.push(args);
        return { status: 1, stdout: '', stderr: 'boom' };
      },
    });
    assert.equal(result.applied, true);
    assert.deepEqual(result.failed, ['logs']);
    assert.deepEqual(calls, [
      ['tab', 'create', '--workspace', 'wQ', '--label', 'logs', '--no-focus'],
    ]);
  });
});
