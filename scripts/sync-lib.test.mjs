import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { addPaths, frontmatterDescription, sparseClone, stableTags, summary } from './sync-lib.mjs';

test('frontmatterDescription', () => {
  assert.equal(
    frontmatterDescription('---\nname: a\ndescription: >-\n  Route C# and\n  .NET requests.\nlicense: MIT\n---\nb'),
    'Route C# and .NET requests.',
  );
  assert.equal(frontmatterDescription('---\ndescription: >\n  Guide for\n  Rust.\n---'), 'Guide for Rust.');
  assert.equal(frontmatterDescription('---\ndescription: "x: y"\n---'), 'x: y');
  assert.equal(frontmatterDescription("---\ndescription: 'x y'\n---"), 'x y');
  assert.equal(frontmatterDescription('---\ndescription: plain one\n---'), 'plain one');
  assert.equal(frontmatterDescription('---\ndescription: |\n  a\n---'), null);
  assert.equal(frontmatterDescription('no frontmatter'), '');
});

test('frontmatterDescription returns null for unhandled forms', () => {
  assert.equal(frontmatterDescription('---\ndescription: "abc\n  def"\n---'), null);
  assert.equal(frontmatterDescription('---\ndescription: abc\n  def\n---'), null);
  assert.equal(frontmatterDescription('---\ndescription: "a \\"b\\" c"\n---'), null);
});

test('summary', () => {
  assert.equal(summary('ALWAYS USE before running tests. Trigger on x.'), 'ALWAYS USE before running tests.');
  const long = summary('word '.repeat(60).trim());
  assert.ok(long.length <= 201 && long.endsWith('…'));
});

test('addPaths', () => {
  const globs = ['**/*.sql', '**/migrations/**'];
  const paths = 'paths:\n  - "**/*.sql"\n  - "**/migrations/**"\n';
  assert.equal(addPaths('---\nname: x\n---\nbody\n', globs), `---\nname: x\n${paths}---\nbody\n`);
  assert.equal(
    addPaths('---\ndescription: |\n  a\n\n  b\n---\n', globs),
    `---\ndescription: |\n  a\n\n  b\n${paths}---\n`,
  );
  assert.equal(addPaths('no frontmatter\n', globs), null);
  assert.equal(addPaths('---\npaths:\n  - "*.x"\n---\n', globs), null);
});

const sha = (c) => c.repeat(40);
const lsRemote = (rows) => rows.map(([s, ref]) => `${s}\t${ref}`).join('\n');

test('stableTags lists stable tags oldest first, each with its peeled commit', () => {
  const out = lsRemote([
    [sha('2'), 'refs/tags/v5.10.0'],
    [sha('a'), 'refs/tags/v5.9.0'],
    [sha('b'), 'refs/tags/v5.9.0^{}'],
    [sha('c'), 'refs/tags/v6.0.0-beta.1'],
  ]);
  assert.deepEqual(stableTags(out), [
    { tag: 'v5.9.0', sha: sha('b') },
    { tag: 'v5.10.0', sha: sha('2') },
  ]);
});

test('stableTags is empty without a stable tag', () => {
  assert.deepEqual(stableTags(lsRemote([[sha('c'), 'refs/tags/v8.0.0-rc.1']])), []);
  assert.deepEqual(stableTags(''), []);
});

test('sparseClone checks out a commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sparse-clone-test-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = (...args) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', repo, ...args], {
        encoding: 'utf8',
      }).trim();
    git('init', '--quiet');
    git('config', 'uploadpack.allowFilter', 'true');
    git('config', 'uploadpack.allowAnySHA1InWant', 'true');
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(repo, 'sub', 'a.txt'), 'zeroth\n');
    git('add', 'sub/a.txt');
    git('commit', '--quiet', '-m', 'zeroth');
    writeFileSync(join(repo, 'sub', 'a.txt'), 'first\n');
    git('commit', '--quiet', '-am', 'first');
    const first = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'sub', 'a.txt'), 'second\n');
    git('commit', '--quiet', '-am', 'second');

    const url = pathToFileURL(repo).href;
    // A Windows git with core.autocrlf checks files out in CRLF.
    const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    const old = sparseClone(url, ['sub'], { ref: first });
    assert.equal(read(join(old, 'sub', 'a.txt')), 'first\n');
    const inOld = (...args) => execFileSync('git', ['-C', old, ...args], { encoding: 'utf8' }).trim();
    assert.equal(inOld('rev-parse', 'HEAD'), first);
    assert.equal(inOld('rev-list', '--count', 'HEAD'), '1'); // depth applies: `first` has a parent, yet the clone is shallow
    const full = sparseClone(url, ['sub'], { ref: first, depth: 0 });
    assert.equal(execFileSync('git', ['-C', full, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), '2');
    const head = sparseClone(url, ['sub']);
    assert.equal(read(join(head, 'sub', 'a.txt')), 'second\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
