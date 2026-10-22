import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeArg } from './proc.ts';

const M = 'dead-claude-skills';

test('safeArg rejects shell metacharacters', () => {
  assert.equal(safeArg(`graphify@${M}`), `graphify@${M}`);
  for (const bad of ['a&b', '%PATH%', 'a"b', 'a b']) assert.throws(() => safeArg(bad));
});
