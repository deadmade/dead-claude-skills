import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { missingBinaries } from './binaries.ts';
import {
  type ProseDecision,
  proseDecision,
  proseDefault,
  proseDir,
  proseFollow,
  proseMarker,
  prosePython,
  proseState,
  proseSync,
  proseUnticked,
  proseWanted,
} from './prose.ts';

const CFG = join('home', '.claude');

test('prosePython per platform', () => {
  assert.equal(proseDir(CFG), join(CFG, 'flows-prose'));
  assert.equal(proseMarker(CFG), join(CFG, 'flows-prose.off'));
  assert.equal(prosePython(CFG, 'linux'), join(CFG, 'flows-prose', 'env', 'bin', 'python'));
  assert.equal(prosePython(CFG, 'win32'), join(CFG, 'flows-prose', 'env', 'Scripts', 'python.exe'));
});

test("proseSync keeps uv's files inside flows-prose", () => {
  const assets = join('pkg', 'installer', 'assets');
  const { args, env } = proseSync(assets, CFG);
  assert.deepEqual(args, ['sync', '--frozen', '--managed-python', '--no-dev']);
  const dir = proseDir(CFG);
  assert.deepEqual(env, {
    UV_PROJECT: join(assets, 'prose'),
    UV_PROJECT_ENVIRONMENT: join(dir, 'env'),
    UV_CACHE_DIR: join(dir, 'cache'),
    UV_PYTHON_INSTALL_DIR: join(dir, 'python'),
  });
});

test('proseState reads the python and the marker', () => {
  const state = (files: string[], platform = 'linux') => {
    const set = new Set(files);
    return proseState({ config: CFG, platform, exists: (p) => set.has(p) });
  };
  assert.deepEqual(state([]), { installed: false, optedOut: false });
  assert.deepEqual(state([prosePython(CFG, 'linux')]), { installed: true, optedOut: false });
  assert.deepEqual(state([prosePython(CFG, 'linux')], 'win32'), { installed: false, optedOut: false });
  assert.deepEqual(state([prosePython(CFG, 'win32')], 'win32'), { installed: true, optedOut: false });
  assert.deepEqual(state([proseMarker(CFG)]), { installed: false, optedOut: true });
  // The folder alone is not an environment.
  assert.deepEqual(state([proseDir(CFG)]), { installed: false, optedOut: false });
});

test('proseDefault: on where offered with flows, off without flows or when opted out, on when installed', () => {
  const base = { installed: false, optedOut: false, offered: true, flows: true };
  assert.equal(proseDefault(base), true);
  assert.equal(proseDefault({ ...base, flows: false }), false, 'off without flows');
  assert.equal(proseDefault({ ...base, optedOut: true }), false, 'off when opted out');
  assert.equal(proseDefault({ ...base, offered: false }), false, 'off where not offered');
  assert.equal(
    proseDefault({ installed: true, optedOut: true, offered: false, flows: false }),
    true,
    'on when installed',
  );
});

test('proseDecision: remove, sync, needs-flows or none', () => {
  const d = (toggle: boolean, flows: boolean, installed: boolean) => proseDecision({ toggle, flows, installed });
  assert.equal(d(true, true, false), 'sync');
  assert.equal(d(true, true, true), 'sync');
  assert.equal(d(false, true, true), 'remove');
  assert.equal(d(true, false, true), 'remove', 'flows deselected takes the environment with it');
  assert.equal(d(false, false, true), 'remove');
  assert.equal(d(true, false, false), 'needs-flows');
  assert.equal(d(false, true, false), 'none');
  assert.equal(d(false, false, false), 'none');
});

test('proseDecision follows proseWanted', () => {
  for (const toggle of [true, false])
    for (const flows of [true, false]) {
      const d: ProseDecision = proseDecision({ toggle, flows, installed: false });
      assert.equal(d === 'sync', proseWanted({ toggle, flows }));
    }
});

test('proseWanted: only with flows, so prose ticked without flows asks for no uv', () => {
  assert.equal(proseWanted({ toggle: true, flows: true }), true);
  assert.equal(proseWanted({ toggle: true, flows: false }), false);
  assert.equal(proseWanted({ toggle: false, flows: true }), false);
  const uv = (flows: boolean) =>
    missingBinaries('linux', proseWanted({ toggle: true, flows }) ? ['prose'] : [], () => false).map((m) => m.binary);
  assert.deepEqual(uv(false), []);
  assert.deepEqual(uv(true), ['uv']);
});

test('proseUnticked: only a toggle that ends off where its default is on', () => {
  assert.equal(proseUnticked({ expected: true, toggle: false }), true);
  assert.equal(proseUnticked({ expected: true, toggle: true }), false);
  assert.equal(proseUnticked({ expected: false, toggle: false }), false);
  assert.equal(proseUnticked({ expected: false, toggle: true }), false);
});

test('proseFollow: flipping flows sets prose to its default until the user flips prose', () => {
  const F = 'flows@m';
  const base = {
    key: F,
    flows: F,
    chosen: { [F]: true, prose: false },
    touched: { [F]: true },
    installed: false,
    optedOut: false,
    offered: true,
  };
  assert.equal(proseFollow(base), true, 'ticking flows ticks prose');
  assert.equal(proseFollow({ ...base, touched: { [F]: true, prose: true } }), false, 'unticked in this run');
  assert.equal(proseFollow({ ...base, optedOut: true }), false, 'the opt-out marker holds');
  assert.equal(proseFollow({ ...base, offered: false }), false, 'not offered here');
  assert.equal(proseFollow({ ...base, key: 'dcg' }), false, 'another row');
  assert.equal(proseFollow({ ...base, chosen: { [F]: false, prose: true } }), false, 'unticking flows unticks prose');
  assert.equal(
    proseFollow({ ...base, installed: true, chosen: { [F]: false, prose: true } }),
    true,
    'unless it is installed: the step then removes it',
  );
  assert.equal(
    proseFollow({ ...base, touched: { [F]: true, prose: true }, chosen: { [F]: false, prose: true } }),
    true,
    'a prose the user ticked stays',
  );
});

test('unticking prose after ticking flows on the screens counts as unticked', () => {
  const F = 'flows@m';
  const state = { installed: false, optedOut: false, offered: true };
  const followed = proseFollow({
    key: F,
    flows: F,
    chosen: { [F]: true, prose: false },
    touched: { [F]: true },
    ...state,
  });
  assert.equal(followed, true);
  const expected = proseDefault({ ...state, flows: true });
  assert.equal(proseUnticked({ expected, toggle: false }), true);
});
