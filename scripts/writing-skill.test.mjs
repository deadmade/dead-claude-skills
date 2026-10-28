import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkUses, readUses } from './flows-uses.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const RULE = "_write for a smart reader who wasn't there, and omit needless words._";

// Frontmatter and body of a SKILL.md, in either line ending.
const parts = (text) => text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/).slice(1);

test('the writing skill is model-invocable and states the rule', () => {
  const text = read('plugins/flows/skills/writing/SKILL.md');
  for (const t of [text, text.replace(/\n/g, '\r\n')]) {
    const [front, body] = parts(t);
    assert.match(front, /^name: writing\r?$/m);
    assert.doesNotMatch(front, /disable-model-invocation/);
    const first = body
      .trim()
      .split(/\r?\n\r?\n/)
      .find((p) => !p.startsWith('#'));
    assert.ok(first.replace(/\r?\n/g, ' ').includes(RULE), `first paragraph: ${first}`);
  }
});

test('copyedit is a conductor', () => {
  const text = read('plugins/flows/skills/copyedit/SKILL.md');
  assert.match(parts(text)[0], /^disable-model-invocation: true$/m);
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  const uses = readUses(ROOT);
  assert.ok(uses.copyedit, 'copyedit has a uses.json');
  assert.deepEqual(
    checkUses(ROOT, marketplace).filter((p) => p.includes('copyedit')),
    [],
  );
});
