import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseNotes, tagRange, unknownParts } from './sync-ponytail.mjs';

const manifest = {
  name: 'ponytail',
  version: '5.3.2',
  description: '',
  author: {},
  hooks: [],
  types: '',
  userConfig: {},
};
const top = ['.claude-plugin', 'hooks', 'skills', 'LICENSE', 'README.md', 'assets'];

test('a manifest and tree like v5.3.2 have no unknown parts', () => {
  assert.deepEqual(unknownParts(manifest, top), []);
});

test('a new manifest key is an unknown part', () => {
  assert.deepEqual(unknownParts({ ...manifest, mcpServers: {} }, top), ['mcpServers']);
});

test('a new default component folder is an unknown part', () => {
  assert.deepEqual(unknownParts(manifest, [...top, 'agents']), ['agents']);
});

const sha = (c) => c.repeat(40);
const TAGS = ['v5.1.0', 'v5.1.1', 'v5.2.0', 'v5.3.0', 'v5.3.1', 'v5.3.2'].map((tag, i) => ({
  tag,
  sha: sha(String(i)),
}));

test('tagRange lists the tags after the vendored one, newest first', () => {
  assert.deepEqual(tagRange(TAGS, sha('0'), 'v5.3.2'), {
    old: 'v5.1.0',
    tags: ['v5.3.2', 'v5.3.1', 'v5.3.0', 'v5.2.0', 'v5.1.1'],
  });
});

test('tagRange without a known old tag covers the new tag only', () => {
  assert.deepEqual(tagRange(TAGS, sha('f'), 'v5.3.2'), { tags: ['v5.3.2'] });
  assert.deepEqual(tagRange(TAGS, undefined, 'v5.3.2'), { tags: ['v5.3.2'] });
});

test('tagRange refuses to go back to an older tag', () => {
  assert.throws(() => tagRange(TAGS, sha('5'), 'v5.3.1'));
});

const COMPARE = 'https://github.com/DietrichGebert/ponytail/compare/v5.3.0...v5.3.2';

test('releaseNotes puts the newest release first and ends with the compare link', () => {
  const body = releaseNotes(
    [
      { tag: 'v5.3.2', body: '### Features\n- band', subjects: [] },
      { tag: 'v5.3.1', body: 'fixes', subjects: [] },
    ],
    COMPARE,
  );
  assert.equal(body.split('\n')[0], '## v5.3.2');
  assert.ok(body.indexOf('- band') < body.indexOf('## v5.3.1'));
  assert.match(body, new RegExp(`${COMPARE}[\\s\\S]*cc @deadmade\\n$`));
});

test('releaseNotes falls back to commit subjects, without the release commit', () => {
  for (const body of [null, '']) {
    const out = releaseNotes([
      { tag: 'v5.3.1', body, subjects: ['chore: release v5.3.1 (#1147)', 'fix(band): no mkdir'] },
    ]);
    assert.match(out, /^## v5\.3\.1 \(no release notes, commit subjects\)\n\n- fix\(band\): no mkdir\n/);
    assert.doesNotMatch(out, /chore: release/);
  }
});

test('releaseNotes says so when a tag has neither notes nor commits', () => {
  assert.match(releaseNotes([{ tag: 'v5.3.1', body: null, subjects: [] }]), /## v5\.3\.1[^\n]*\n\n\(no changes\)\n/);
});

test("releaseNotes points upstream's issue numbers at upstream and keeps mentions inert", () => {
  const out = releaseNotes([{ tag: 'v5.3.2', body: 'thanks @someone (#1152), see #7', subjects: [] }]);
  assert.match(out, /`@someone` \(DietrichGebert\/ponytail#1152\), see DietrichGebert\/ponytail#7/);
  assert.doesNotMatch(out, /cc @deadmade[\s\S]*`@deadmade`/);
});

test('releaseNotes stays under the PR body limit, cutting older releases first', () => {
  const big = 'x'.repeat(30_000);
  const out = releaseNotes(
    ['v5.3.2', 'v5.3.1', 'v5.3.0'].map((tag) => ({ tag, body: big, subjects: [] })),
    COMPARE,
  );
  assert.ok(out.length < 65_536);
  assert.match(out, /## v5\.3\.2/);
  assert.doesNotMatch(out, /## v5\.3\.0/);
  assert.match(out, new RegExp(`older releases are cut[^\\n]*${COMPARE}`));
});
