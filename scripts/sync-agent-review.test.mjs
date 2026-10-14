import assert from 'node:assert/strict';
import { test } from 'node:test';
import { README_POINTER, RULES_POINTER, localize, stamp } from './sync-agent-review.mjs';

const upstream = [
  '---',
  'name: agent-review',
  'description: Check agent work.',
  'effort: high',
  '---',
  '',
  `- A skill only applies once it's loaded; ${README_POINTER}.`,
].join('\n');

test('localize hides the skill from the model, drops effort and redirects the README pointer', () => {
  const out = localize(upstream);
  assert.ok(
    out.startsWith('---\nname: agent-review\ndescription: Check agent work.\ndisable-model-invocation: true\n---\n'),
  );
  assert.ok(!out.includes('effort:'));
  assert.ok(out.includes(RULES_POINTER) && !out.includes(README_POINTER));
  assert.equal(localize(out.replace(RULES_POINTER, README_POINTER)), out, 'idempotent on its own output');
});

test('localize refuses an upstream that changed shape', () => {
  assert.equal(localize('no frontmatter'), null);
  assert.equal(localize(upstream.replace('name: agent-review', 'name: other')), null);
  assert.equal(localize(upstream.replace(README_POINTER, 'something else')), null);
});

test('stamp goes after the frontmatter, or on top without one', () => {
  assert.match(stamp('---\nname: x\n---\nbody', 'u'), /^---\nname: x\n---\n\n<!-- Vendored from u .*-->\nbody$/);
  assert.match(stamp('# Title', 'u'), /^<!-- Vendored from u .*-->\n\n# Title$/);
});
