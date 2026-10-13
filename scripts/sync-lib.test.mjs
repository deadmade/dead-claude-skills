import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontmatterDescription, summary } from './sync-lib.mjs';

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
