import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { formatOutputs, hasTitle, names, newSkillIssue, parseOutputs, source } from './sync.mjs';
import { ROOT } from './sync-lib.mjs';
import { SOURCES } from './sync-sources.mjs';

test('every source has a unique name, an existing script and existing paths', () => {
  assert.equal(new Set(names()).size, SOURCES.length);
  for (const s of SOURCES) {
    assert.ok(existsSync(join(ROOT, 'scripts', s.script)), s.script);
    for (const p of s.paths) assert.ok(existsSync(join(ROOT, p)), `${s.name}: ${p}`);
    assert.ok(s.bodyFrom === 'script' || typeof s.body === 'function', `${s.name} has no body`);
  }
});

test('every sync script is a source', () => {
  const scripts = readdirSync(join(ROOT, 'scripts')).filter(
    (f) => /^sync-.*\.mjs$/.test(f) && !f.endsWith('.test.mjs') && !['sync-lib.mjs', 'sync-sources.mjs'].includes(f),
  );
  const used = new Set(SOURCES.map((s) => s.script));
  assert.deepEqual(
    scripts.filter((f) => !used.has(f)),
    [],
  );
});

test('every source passes its checks on the tree as committed', () => {
  for (const s of SOURCES) s.check({ tag: 'v1.2.3' });
});

test('names narrows to one source', () => {
  assert.deepEqual(names('ponytail'), ['ponytail']);
  assert.equal(names().length, SOURCES.length);
});

test('formatOutputs uses the heredoc form for multi-line values', () => {
  const out = formatOutputs({ title: 'Sync x', paths: 'a\nb' });
  assert.match(out, /^title=Sync x\npaths<<(EOF_[\w-]+)\na\nb\n\1\n$/);
});

test('parseOutputs reads key=value lines', () => {
  assert.deepEqual(parseOutputs('tag=v5.3.2\nsha=abc\n\nnoise\n'), { tag: 'v5.3.2', sha: 'abc' });
});

test('newSkillIssue names the skill, its source and where to decide', () => {
  const { name, title, body } = newSkillIssue(source('mattpocock-picks').newSkills, 'engineering/pr', '');
  assert.equal(name, 'pr');
  assert.equal(title, 'New upstream skill in mattpocock/skills: pr');
  assert.match(body, /^mattpocock\/skills now publishes `engineering\/pr`/);
  assert.match(body, /> no description/);
  assert.match(body, /tree\/main\/skills\/engineering\/pr/);
  assert.match(body, /bump the skill count check in `scripts\/sync-sources.mjs`/);
  assert.match(body, /overlap with superpowers before/);
  assert.match(newSkillIssue(source('pstack-picks').newSkills, 'x', 'd').body, /run the script\. If the guard/);
});

test('hasTitle matches whole titles only', () => {
  assert.ok(hasTitle('a: pr\na: pr-two', 'a: pr'));
  assert.ok(!hasTitle('a: pr-two', 'a: pr'));
});
