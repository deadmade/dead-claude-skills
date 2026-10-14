import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  README_POINTER,
  RULES_POINTER,
  TOOL_NOTES_LINK,
  localize,
  stamp,
  trimToolNotes,
} from './sync-agent-review.mjs';
import { ROOT } from './sync-lib.mjs';

const upstream = [
  '---',
  'name: agent-review',
  'description: Check agent work.',
  'effort: high',
  '---',
  '',
  `- A skill only applies once it's loaded; ${README_POINTER}.`,
  `- tool-notes.md: ${TOOL_NOTES_LINK} in Claude Code`,
].join('\n');

test('localize hides the skill from the model, drops effort and redirects the README pointer', () => {
  const out = localize(upstream);
  assert.ok(
    out.startsWith('---\nname: agent-review\ndescription: Check agent work.\ndisable-model-invocation: true\n---\n'),
  );
  assert.ok(!out.includes('effort:'));
  assert.ok(out.includes(RULES_POINTER) && !out.includes(README_POINTER));
  assert.ok(out.includes('tool-notes.md: setting up independent reviewers'));
});

test('localize replaces an upstream disable-model-invocation instead of adding a second one', () => {
  const out = localize(upstream.replace('effort: high', 'disable-model-invocation: false'));
  assert.deepEqual(out.match(/^disable-model-invocation:.*$/gm), ['disable-model-invocation: true']);
});

test('localize and stamp reproduce the vendored SKILL.md', () => {
  const vendored = readFileSync(`${ROOT}/plugins/agent-review/skills/agent-review/SKILL.md`, 'utf8');
  const url = vendored.match(/<!-- Vendored from (\S+) /)[1];
  const upstreamish = vendored
    .replace(/\n<!-- Vendored from .*-->\n/, '')
    .replace(RULES_POINTER, README_POINTER)
    .replace('setting up independent reviewers in', `${TOOL_NOTES_LINK} in`);
  assert.equal(stamp(localize(upstreamish), url), vendored);
});

test('trimToolNotes drops the install section, keeps the title and the reviewer notes', () => {
  const notes = '# Tool notes\n\nIntro.\n\n## Install options\n\nCopy it.\n\n## Independent reviewers\n\nNo forks.\n';
  assert.equal(trimToolNotes(notes), '# Tool notes\n\nIntro.\n\n## Independent reviewers\n\nNo forks.\n');
  assert.equal(trimToolNotes(notes.replace('## Independent reviewers', '## Reviewers')), null);
  assert.equal(trimToolNotes(notes.replace('## Independent', '## New\n\n## Independent')), null, 'no silent drops');
});

test('localize refuses an upstream that changed shape', () => {
  assert.equal(localize('no frontmatter'), null);
  assert.equal(localize(upstream.replace('name: agent-review', 'name: other')), null);
  assert.equal(localize(upstream.replace(README_POINTER, 'something else')), null);
  assert.equal(localize(upstream.replace(TOOL_NOTES_LINK, 'something else')), null);
});

test('stamp goes after the frontmatter, or on top without one', () => {
  assert.match(stamp('---\nname: x\n---\nbody', 'u'), /^---\nname: x\n---\n\n<!-- Vendored from u .*-->\nbody$/);
  assert.match(stamp('# Title', 'u'), /^<!-- Vendored from u .*-->\n\n# Title$/);
});
