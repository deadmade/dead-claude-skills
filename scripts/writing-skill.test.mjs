import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const RULE = "_write for a smart reader who wasn't there, and omit needless words._";

test('the writing skill is model-invocable and states the rule', () => {
  const text = read('plugins/flows/skills/writing/SKILL.md');
  const [, front, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.match(front, /^name: writing$/m);
  assert.doesNotMatch(front, /disable-model-invocation/);
  const first = body
    .trim()
    .split(/\n\n/)
    .find((p) => !p.startsWith('#'));
  assert.ok(first.includes(RULE), `first paragraph: ${first}`);
});
