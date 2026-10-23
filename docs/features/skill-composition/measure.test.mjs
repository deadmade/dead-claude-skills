import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = execFileSync(
  'node',
  [join(here, 'measure.mjs'), '--projects', join(here, 'fixtures/projects'), '--flows', join(here, 'fixtures/flows')],
  { encoding: 'utf8' },
);
const row = out.split('\n').find((l) => l.startsWith('| demo '));

test('two sessions reading the same flow.md form one run', () => assert.match(row, /\| demo-flow \| 2 \|/));
test('m1 counts only unnamed edits with no question before them', () => assert.match(row, /\| 1 \(bash edits: 0\) \|/));
test('m2 is 1/2 with grilling missing', () => assert.match(row, /\| 1\/2 \| grilling \|/));
