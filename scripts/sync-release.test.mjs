import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGINS, missingParts, releaseNotes, tagRange, unknownParts } from './sync-release.mjs';

const manifest = {
  name: 'ponytail',
  version: '5.3.2',
  description: '',
  author: {},
  hooks: [],
  types: '',
  userConfig: {},
};
const top = ['.claude-plugin', 'hooks', 'skills', 'LICENSE', 'README.md', 'assets', 'commands'];
const { skipped } = PLUGINS.ponytail;

test('a manifest and tree like v5.3.2 have no unknown parts', () => {
  assert.deepEqual(unknownParts(manifest, top, skipped), []);
});

test('a new manifest key is an unknown part', () => {
  assert.deepEqual(unknownParts({ ...manifest, mcpServers: {} }, top, skipped), ['mcpServers']);
});

test("superpowers' v7.0.1 manifest and tree have no unknown parts", () => {
  const sp = {
    name: 'superpowers',
    description: '',
    version: '7.0.1',
    author: {},
    homepage: '',
    repository: '',
    license: 'MIT',
    keywords: [],
  };
  const tree = ['.agents', '.claude-plugin', '.codex-plugin', '.opencode', 'hooks', 'skills', 'tests', 'package.json'];
  assert.deepEqual(unknownParts(sp, tree, PLUGINS.superpowers.skipped), []);
});

test('a new default component folder is an unknown part', () => {
  assert.deepEqual(unknownParts(manifest, [...top, 'agents'], skipped), ['agents']);
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

const REPO = PLUGINS.ponytail.repo;
const COMPARE = 'https://github.com/DietrichGebert/ponytail/compare/v5.3.0...v5.3.2';

test('releaseNotes puts the newest release first and ends with the compare link', () => {
  const body = releaseNotes(
    REPO,
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
    const out = releaseNotes(REPO, [
      { tag: 'v5.3.1', body, subjects: ['chore: release v5.3.1 (#1147)', 'fix(band): no mkdir'] },
    ]);
    assert.match(out, /^## v5\.3\.1 \(no release notes, commit subjects\)\n\n- fix\(band\): no mkdir\n/);
    assert.doesNotMatch(out, /chore: release/);
  }
});

test('releaseNotes says so when a tag has neither notes nor commits', () => {
  assert.match(
    releaseNotes(REPO, [{ tag: 'v5.3.1', body: null, subjects: [] }]),
    /## v5\.3\.1[^\n]*\n\n\(no changes\)\n/,
  );
});

test("releaseNotes links upstream's issues without cross-referencing them and keeps mentions inert", () => {
  const out = releaseNotes(REPO, [
    {
      tag: 'v5.3.2',
      body: 'thanks @someone (#1152), see https://github.com/DietrichGebert/ponytail/pull/7',
      subjects: [],
    },
  ]);
  assert.match(
    out,
    /`@someone` \(\[#1152\]\(https:\/\/redirect\.github\.com\/DietrichGebert\/ponytail\/issues\/1152\)\)/,
  );
  assert.match(out, /see https:\/\/redirect\.github\.com\/DietrichGebert\/ponytail\/pull\/7/);
  assert.doesNotMatch(out, /DietrichGebert\/ponytail#|https:\/\/github\.com\/DietrichGebert\/ponytail\/pull/);
});

test('releaseNotes stays under the PR body limit, cutting older releases first', () => {
  const big = 'x'.repeat(30_000);
  const out = releaseNotes(
    REPO,
    ['v5.3.2', 'v5.3.1', 'v5.3.0'].map((tag) => ({ tag, body: big, subjects: [] })),
    COMPARE,
  );
  assert.ok(out.length < 65_536);
  assert.match(out, /## v5\.3\.2/);
  assert.doesNotMatch(out, /## v5\.3\.0/);
  assert.match(out, new RegExp(`older releases are cut[^\\n]*${COMPARE}`));
});

test('missingParts names every file the copy needs that the clone lacks', () => {
  const up = mkdtempSync(join(tmpdir(), 'pt-'));
  mkdirSync(join(up, 'hooks', 'band'), { recursive: true });
  writeFileSync(join(up, 'hooks', 'claude-band.json'), '{}');
  const manifest = { hooks: ['./hooks/claude-band.json', './hooks/gone.json'], types: './hooks/band/types.d.ts' };
  assert.deepEqual(missingParts(up, manifest, PLUGINS.ponytail.entry), [
    './hooks/gone.json',
    './hooks/band/types.d.ts',
    'skills/ponytail/SKILL.md',
    'LICENSE',
  ]);
});
