import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trim } from './sync-hallmark.mjs';

test('trim drops the comp step and the edit-time hook from flow.md', () => {
  const flow = `The stamp says \`shape: app screen\`, which sloplint and the edit-time hook read as the app scope.

## Fast mode

Quick.

## Edit-time linting

Run \`install-hook.mjs\`.

## Comp before build (signal 9)

Load \`comp.md\`.

## Harnesses

| Edit-time hook | PostToolUse via \`install-hook.mjs\` | none | none |
| Network | yes | off; \`imagegen.mjs\` needs an explicit ask and an approval | gated |

**The render tier** (\`sloplint --render\`, \`capture.mjs\`, \`picture.mjs\`) needs Node.
`;
  assert.deepEqual(trim('references/flow.md', flow), {
    out: `The stamp says \`shape: app screen\`, which sloplint reads as the app scope.

## Fast mode

Quick.

## Harnesses

| Network | yes | off | gated |

**The render tier** (\`sloplint --render\`, \`capture.mjs\`) needs Node.
`,
    left: [],
  });
});

test('trim renumbers imagery.md once generated stills are gone', () => {
  const imagery = `4. **Photographs**.
5. **Generated stills**, only when \`TOGETHER_API_KEY\` is set (§ 6).
6. **Type at full scale**.

## 6. Generated stills

See \`comp.md\`.

## 7. Never
`;
  assert.deepEqual(trim('references/imagery.md', imagery), {
    out: '4. **Photographs**.\n5. **Type at full scale**.\n\n## 7. Never\n',
    left: [],
  });
});

test('trim reports a mention its edits no longer reach, and leaves "together" alone', () => {
  const { left } = trim('references/craft.md', 'Display and body together.\nNow load `comp.md` first.\n');
  assert.deepEqual(left, [2]);
});
