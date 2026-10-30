import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

test('the copyedit procedure and its script sit in the writing skill', () => {
  assert.match(read('plugins/flows/skills/writing/SKILL.md'), /\(references\/copyedit\.md\)/);
  const procedure = read('plugins/flows/skills/writing/references/copyedit.md');
  assert.match(procedure, /\$\{CLAUDE_SKILL_DIR\}\/\.\.\/writing\/scripts\/compare\.mjs/);
  assert.ok(!('writing' in readUses(ROOT)), 'writing is not a conductor');
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.deepEqual(
    checkUses(ROOT, marketplace).filter((p) => p.includes('writing')),
    [],
  );
});

test('flow-rules runs the copyedit before gates', () => {
  const rules = read('plugins/flows/references/flow-rules.md');
  assert.match(rules, /\$\{CLAUDE_SKILL_DIR\}\/\.\.\/writing\/references\/copyedit\.md/);
  assert.match(rules, /flows:writing/);
});

test('SKILL.md links every lesson reference, and every link resolves', () => {
  const dir = 'plugins/flows/skills/writing';
  const links = [...read(`${dir}/SKILL.md`).matchAll(/\]\((references\/[^)]+\.md)\)/g)].map((m) => m[1]);
  const files = readdirSync(join(ROOT, dir, 'references'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `references/${f}`);
  assert.deepEqual([...new Set(links)].sort(), files.sort());
  for (const f of files) assert.match(read(`${dir}/${f}`), /^# /, f);
});
