import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROUTERS, assignRouter, isHidden, renderRouter } from './sync-csharp.mjs';
import { frontmatterDescription } from './sync-lib.mjs';

test('assignRouter maps upstream plugins to routers, unknown ones to core', () => {
  assert.equal(assignRouter('dotnet-blazor'), 'web');
  assert.equal(assignRouter('dotnet-test-migration'), 'testing');
  assert.equal(assignRouter('dotnet-brand-new'), 'core');
});

test('no upstream plugin is in two routers', () => {
  const all = ROUTERS.flatMap((r) => r.plugins);
  assert.equal(new Set(all).size, all.length);
});

test('renderRouter sorts entries, escapes pipes and keeps the description parseable', () => {
  const description = ROUTERS.find((r) => r.name === 'testing').description;
  const out = renderRouter({
    name: 'testing',
    description,
    entries: [
      { name: 'b', summary: 'x | y' },
      { name: 'a', summary: 'z' },
    ],
  });
  assert.ok(out.indexOf('| a |') < out.indexOf('| b |'));
  assert.ok(out.includes('x \\| y'));
  assert.ok(out.includes('`${CLAUDE_PLUGIN_ROOT}/library/a/SKILL.md`'));
  assert.ok(out.includes('name: testing'));
  assert.equal(frontmatterDescription(out), description);
});

test('isHidden reads disable-model-invocation', () => {
  assert.equal(isHidden('---\nname: f\ndisable-model-invocation: true\nuser-invocable: false\n---'), true);
  assert.equal(isHidden('---\nname: f\nuser-invocable: false\n---'), false);
});
