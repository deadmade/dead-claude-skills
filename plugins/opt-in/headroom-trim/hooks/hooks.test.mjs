import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const config = JSON.parse(readFileSync(new URL('./hooks.json', import.meta.url), 'utf8'));

test('SessionStart runs the launcher as one exec-form command with the port', () => {
  const entries = config.hooks.SessionStart;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].hooks, [
    { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/launch.mjs', '47811'] },
  ]);
});

test('PostToolUse posts every tool result to the trim server on the same port, 5 s, no onFailure', () => {
  const entries = config.hooks.PostToolUse;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, '*');
  assert.deepEqual(entries[0].hooks, [{ type: 'http', url: 'http://127.0.0.1:47811/hook', timeout: 5 }]);
  assert.equal(config.hooks.SessionStart[0].hooks[0].args[1], '47811');
});

test('every script hooks.json runs exists', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const args = config.hooks.SessionStart.flatMap((e) => e.hooks.flatMap((h) => h.args));
  assert.ok(args.length > 0);
  for (const arg of args.filter((a) => a.startsWith('$'))) {
    assert.match(arg, /^\$\{CLAUDE_PLUGIN_ROOT\}\//);
    const path = arg.replace('${CLAUDE_PLUGIN_ROOT}', root);
    assert.ok(existsSync(path), path);
  }
});
