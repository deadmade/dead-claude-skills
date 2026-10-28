import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lost, newFindings } from '../plugins/flows/skills/copyedit/scripts/compare.mjs';

const COMPARE = join(import.meta.dirname, '../plugins/flows/skills/copyedit/scripts/compare.mjs');

const DOC = [
  '# Title',
  '',
  'The installer checks the hash of `agent-browser` before it runs it, and it waits 30 s for',
  'the [release page](https://example.com/releases) to answer.',
  '',
  '## Steps',
  '',
  '- [ ] Run `npm test`.',
  '- [x] Read the output.',
  '',
  '| name | value |',
  '| ---- | ----- |',
  '| a    | 1     |',
  '| b    | 2     |',
  '',
  '```bash',
  'npm ci',
  '```',
  '',
  '## Notes',
  '',
  'Nothing else.',
  '',
].join('\n');

test('lost names a dropped heading, code block, link target, number, checkbox step and table row', () => {
  const edited = DOC.replace('## Notes\n\nNothing else.\n', '')
    .replace('```bash\nnpm ci\n```\n', '')
    .replace('the [release page](https://example.com/releases)', 'the release page')
    .replace('30 s', 'a while')
    .replace('- [x] Read the output.\n', '')
    .replace('| b    | 2     |\n', '')
    .replace('`agent-browser`', 'the browser');
  const out = lost(DOC, edited).join('\n');
  for (const what of ['## Notes', 'npm ci', 'https://example.com/releases', '30', 'checkbox', 'table', 'agent-browser'])
    assert.ok(out.includes(what), `${what} in:\n${out}`);
});

test('lost accepts rewording, rewrapping and CRLF', () => {
  const edited = DOC.replace(
    'The installer checks the hash of `agent-browser` before it runs it, and it waits 30 s for\nthe [release page]',
    'Before it runs `agent-browser`, the installer checks its hash.\nIt waits 30 s for the [release page]',
  )
    .replace('Run `npm test`.', 'Run `npm\ntest` first.')
    .replace('Nothing else.', 'There is nothing else.');
  assert.deepEqual(lost(DOC, edited), []);
  assert.deepEqual(lost(DOC.replaceAll('\n', '\r\n'), edited), []);
  assert.deepEqual(lost(DOC, edited.replaceAll('\n', '\r\n')), []);
});

test('lost flags reordered headings', () => {
  const edited = DOC.replace('## Steps', '## Tmp').replace('## Notes', '## Steps').replace('## Tmp', '## Notes');
  assert.match(lost(DOC, edited).join('\n'), /order/);
});

test('newFindings ignores labels the original already had', () => {
  const terms = new Set();
  const saved = 'We settled Q3 last week.\n';
  const edited = 'We settled Q3 last week, and D2 too.\n';
  const found = newFindings(saved, edited, { file: 'spec.md', terms });
  assert.deepEqual(
    found.map((f) => f.match),
    ['D2'],
  );
});

// Runs the CLI in a fresh folder; returns its result and the document afterwards.
function run(saved, edited) {
  const dir = mkdtempSync(join(tmpdir(), 'ce-'));
  const paths = { saved: join(dir, 'saved.md'), edited: join(dir, 'edited.txt'), doc: join(dir, 'doc.md') };
  writeFileSync(paths.saved, saved);
  writeFileSync(paths.doc, saved);
  if (edited !== undefined) writeFileSync(paths.edited, edited);
  const r = spawnSync(process.execPath, [COMPARE, paths.saved, paths.edited, paths.doc], { encoding: 'utf8' });
  return { ...r, doc: readFileSync(paths.doc, 'utf8') };
}

test('the CLI refuses a missing edit', () => {
  const r = run(DOC, undefined);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), 'the editor wrote no document');
  assert.equal(r.doc, DOC);
});

test('the CLI refuses an empty edit', () => {
  for (const edited of ['', ' \n\t\n']) {
    const r = run(DOC, edited);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), 'the editor wrote no document');
    assert.equal(r.doc, DOC);
  }
});

test('the CLI refuses an edit that lost something, and leaves the document', () => {
  const r = run(DOC, DOC.replace('## Notes\n\nNothing else.\n', ''));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /## Notes/);
  assert.equal(r.doc, DOC);
});

test("the CLI copies a good edit in the original's line endings", () => {
  const crlf = DOC.replaceAll('\n', '\r\n');
  const edited = DOC.replace('Nothing else.', 'There is nothing else.');
  const r = run(crlf, edited);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc, edited.replaceAll('\n', '\r\n'));
  const lf = run(DOC, edited);
  assert.equal(lf.doc, edited);
});

test('the CLI reports only new findings', () => {
  const saved = '# T\n\nWe settled Q3 last week.\n';
  const r = run(saved, '# T\n\nWe settled Q3 last week, and D2 too.\n');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /D2/);
  assert.doesNotMatch(r.stdout, /Q3/);
});
