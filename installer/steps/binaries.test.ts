import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, done, failures } from '../context.ts';
import { FLOW_COCKPIT, applyBin } from './binaries.ts';

// Linux gets the flow cockpit from the flake: the installer downloads nothing and says how to run it.
test('applyBin prints the hint on linux', async () => {
  await applyBin('flow-cockpit', FLOW_COCKPIT, 'linux', 'x64');
  const pinned = `github:deadmade/dead-claude-skills/v${VERSION}#flow-cockpit`;
  assert.ok(
    done.some((l) => l.startsWith('flow-cockpit: ') && l.includes(pinned)),
    done.join('\n'),
  );
  assert.deepEqual(failures, []);
});
