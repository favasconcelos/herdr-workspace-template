// lib.test.ts — unit tests for the workspace-template plugin.
// Run: npm test (builds tests with tsc, then node --test dist-test/)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  loadTabsConfig,
  loadConfigFile,
  loadProjectConfig,
  resolveTabsConfig,
  selectTemplate,
  extractWorkspaceId,
  extractContextWorkspaceId,
  extractWorkspaceCwd,
  parseTabSpec,
  normalizeDirection,
  tabLabels,
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
    assert.deepEqual(tabLabels(config.tabs), ['logs', 'server']);
    assert.equal(config.renameFirst, 'agent');
  });

  it('reads tabs and rename_first from tabs.json', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ tabs: ['dev', 'test'], rename_first: 'main' }),
    );
    const config = loadTabsConfig(makeEnv({ HERDR_PLUGIN_CONFIG_DIR: dir }));
    assert.deepEqual(tabLabels(config.tabs), ['dev', 'test']);
    assert.equal(config.renameFirst, 'main');
  });

  it('falls back to defaults on invalid JSON', () => {
    fs.writeFileSync(path.join(dir, 'tabs.json'), '{oops');
    const config = loadTabsConfig(makeEnv({ HERDR_PLUGIN_CONFIG_DIR: dir }));
    assert.deepEqual(tabLabels(config.tabs), ['logs', 'server']);
  });

  it('ignores empty tabs arrays but honors empty rename_first', () => {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ tabs: [], rename_first: '' }),
    );
    const config = loadTabsConfig(makeEnv({ HERDR_PLUGIN_CONFIG_DIR: dir }));
    assert.deepEqual(tabLabels(config.tabs), ['logs', 'server']);
    assert.equal(config.renameFirst, '');
  });
});

describe('parseTabSpec', () => {
  it('parses plain string labels', () => {
    assert.deepEqual(parseTabSpec('logs'), { label: 'logs' });
    assert.equal(parseTabSpec(''), null);
    assert.equal(parseTabSpec(42), null);
  });

  it('parses rich objects with cwd, command, splits', () => {
    const spec = parseTabSpec({
      label: 'server',
      cwd: '/repo',
      command: 'npm run dev',
      splits: [{ label: 'db', command: 'pg start', direction: 'down' }],
    });
    assert.deepEqual(spec, {
      label: 'server',
      cwd: '/repo',
      command: ['npm run dev'],
      splits: [{ label: 'db', command: ['pg start'], direction: 'down' }],
    });
  });

  it('accepts title/split/vertical aliases and array commands', () => {
    const spec = parseTabSpec({
      title: 'code',
      command: ['make', 'setup'],
      splits: [{ title: 'side', split: 'vertical', ratio: 0.3 }],
    });
    assert.deepEqual(spec, {
      label: 'code',
      command: ['make', 'setup'],
      splits: [{ label: 'side', direction: 'right', ratio: 0.3 }],
    });
  });

  it('folds panes[0] into the root tab spec', () => {
    const spec = parseTabSpec({
      label: 'code',
      panes: [
        { title: 'agent', command: 'claude' },
        { title: 'editor', split: 'vertical', command: 'nvim' },
      ],
    });
    assert.deepEqual(spec, {
      label: 'code',
      command: ['claude'],
      splits: [{ label: 'editor', command: ['nvim'], direction: 'right' }],
    });
  });

  it('normalizes directions', () => {
    assert.equal(normalizeDirection('right'), 'right');
    assert.equal(normalizeDirection('horizontal'), 'down');
    assert.equal(normalizeDirection('bogus'), undefined);
  });
});

describe('templates', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-tpl-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(obj: unknown): string {
    const file = path.join(dir, 'tabs.json');
    fs.writeFileSync(file, JSON.stringify(obj));
    return file;
  }

  it('parses named templates and default_template', () => {
    const file = writeConfig({
      tabs: ['logs'],
      rename_first: 'agent',
      default_template: 'node',
      templates: {
        node: { tabs: ['dev', 'test'] },
        rust: { tabs: ['bacon'], rename_first: 'main' },
      },
    });
    const config = loadConfigFile(file);
    assert.deepEqual(tabLabels(config.tabs), ['logs']);
    assert.deepEqual(config.availableTemplates?.sort(), ['node', 'rust']);
    // default_template wins for non-interactive selection
    const selected = selectTemplate(config, makeEnv({}));
    assert.equal(selected.name, 'node');
    assert.deepEqual(tabLabels(selected.tabs), ['dev', 'test']);
    assert.equal(selected.renameFirst, 'agent');
  });

  it('HERDR_TEMPLATE selects a named template', () => {
    const file = writeConfig({
      tabs: ['logs'],
      templates: { rust: { tabs: ['bacon'], rename_first: 'main' } },
    });
    const config = loadConfigFile(file);
    const selected = selectTemplate(config, makeEnv({ HERDR_TEMPLATE: 'rust' }));
    assert.equal(selected.name, 'rust');
    assert.deepEqual(tabLabels(selected.tabs), ['bacon']);
    assert.equal(selected.renameFirst, 'main');
  });

  it('unknown HERDR_TEMPLATE returns an error', () => {
    const file = writeConfig({ tabs: ['logs'], templates: { a: { tabs: ['x'] } } });
    const config = loadConfigFile(file);
    const selected = selectTemplate(config, makeEnv({ HERDR_TEMPLATE: 'nope' }));
    assert.match(selected.error ?? '', /unknown template/);
  });
});

describe('project override', () => {
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-global-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wst-proj-'));
  });

  afterEach(() => {
    fs.rmSync(globalDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('extractWorkspaceCwd reads context and event payloads', () => {
    assert.equal(
      extractWorkspaceCwd(makeEnv({ HERDR_PLUGIN_CONTEXT_JSON: '{"workspace_cwd":"/a"}' })),
      '/a',
    );
    assert.equal(
      extractWorkspaceCwd(
        makeEnv({ HERDR_PLUGIN_CONTEXT_JSON: '{"focused_pane_cwd":"/b"}' }),
      ),
      '/b',
    );
    assert.equal(
      extractWorkspaceCwd(
        makeEnv({
          HERDR_PLUGIN_EVENT_JSON: '{"data":{"worktree":{"path":"/c"}}}',
        }),
      ),
      '/c',
    );
    assert.equal(extractWorkspaceCwd(makeEnv({})), '');
  });

  it('per-project .herdr-tabs.json wins over global tabs.json', () => {
    fs.writeFileSync(
      path.join(globalDir, 'tabs.json'),
      JSON.stringify({ tabs: ['logs'], rename_first: 'agent' }),
    );
    fs.writeFileSync(
      path.join(projectDir, '.herdr-tabs.json'),
      JSON.stringify({ tabs: ['dev'], rename_first: 'main' }),
    );
    const env = makeEnv({ HERDR_PLUGIN_CONFIG_DIR: globalDir });
    const resolved = resolveTabsConfig('wX', { env, workspaceCwd: projectDir });
    assert.equal(resolved.source, 'project');
    assert.deepEqual(tabLabels(resolved.tabs), ['dev']);
    assert.equal(resolved.renameFirst, 'main');
  });

  it('falls back to global when no project file exists', () => {
    fs.writeFileSync(
      path.join(globalDir, 'tabs.json'),
      JSON.stringify({ tabs: ['logs'], rename_first: 'agent' }),
    );
    const env = makeEnv({ HERDR_PLUGIN_CONFIG_DIR: globalDir });
    const resolved = resolveTabsConfig('wX', { env, workspaceCwd: projectDir });
    assert.equal(resolved.source, 'global');
    assert.deepEqual(tabLabels(resolved.tabs), ['logs']);
  });

  it('invalid project JSON falls back to global', () => {
    fs.writeFileSync(
      path.join(globalDir, 'tabs.json'),
      JSON.stringify({ tabs: ['logs'] }),
    );
    fs.writeFileSync(path.join(projectDir, '.herdr-tabs.json'), '{oops');
    const env = makeEnv({ HERDR_PLUGIN_CONFIG_DIR: globalDir });
    const resolved = resolveTabsConfig('wX', { env, workspaceCwd: projectDir });
    assert.equal(resolved.source, 'global');
    assert.deepEqual(tabLabels(resolved.tabs), ['logs']);
  });

  it('loadProjectConfig returns null when absent', () => {
    assert.equal(loadProjectConfig(projectDir), null);
    assert.equal(loadProjectConfig(''), null);
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

  it('creates splits, cwd, and commands for rich tab specs', () => {
    const calls: string[][] = [];
    const tabJson = (tabId: string, paneId: string) =>
      JSON.stringify({ result: { tab: { tab_id: tabId }, root_pane: { pane_id: paneId } } });
    const result = applyTemplate('wX', {
      guard: false,
      env: testEnv(),
      config: {
        tabs: [
          {
            label: 'web',
            cwd: '/repo',
            command: ['npm run dev'],
            splits: [{ label: 'db', command: ['pg start'], direction: 'down' }],
          },
        ],
        renameFirst: 'agent',
      },
      run: (args) => {
        calls.push(args);
        if (args[0] === 'tab' && args[1] === 'create') {
          return { status: 0, stdout: tabJson('wX:t2', 'wX:p10'), stderr: '' };
        }
        if (args[0] === 'pane' && args[1] === 'split') {
          return {
            status: 0,
            stdout: JSON.stringify({ result: { pane: { pane_id: 'wX:p11' } } }),
            stderr: '',
          };
        }
        return { status: 0, stdout: '{}', stderr: '' };
      },
    });
    assert.equal(result.applied, true);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(calls, [
      ['tab', 'rename', 'wX:t1', 'agent'],
      ['tab', 'create', '--workspace', 'wX', '--label', 'web', '--cwd', '/repo', '--no-focus'],
      ['pane', 'run', 'wX:p10', 'npm run dev'],
      ['pane', 'split', 'wX:p10', '--direction', 'down', '--no-focus'],
      ['pane', 'rename', 'wX:p11', 'db'],
      ['pane', 'run', 'wX:p11', 'pg start'],
    ]);
  });

  it('records failures when pane ids are missing', () => {
    const result = applyTemplate('wX', {
      guard: false,
      env: testEnv(),
      config: {
        tabs: [{ label: 'web', command: ['npm run dev'] }],
        renameFirst: '',
      },
      run: () => ({ status: 0, stdout: '{}', stderr: '' }),
    });
    assert.equal(result.applied, true);
    assert.deepEqual(result.failed, ['web']);
  });
});
