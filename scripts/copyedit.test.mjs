import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mask } from '../plugins/flows/hooks/prose.mjs';
import { lost, newFindings } from '../plugins/flows/skills/copyedit/scripts/compare.mjs';
import { findPhrases, formatCandidates, loadPhrases } from '../plugins/flows/skills/copyedit/scripts/phrases.mjs';

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

const PHRASES_TSV = join(import.meta.dirname, '../plugins/flows/skills/copyedit/data/phrases.tsv');
const SMALL = loadPhrases(
  [
    'kind\tphrase\treplacement\tsource',
    'wordy\tin order to\tto\tplainlanguage.gov use-simple-words-phrases',
    'redundant\teach and every\teach\ttest',
    'negative\tnot many\tfew\ttest',
    'wordy\tthe fact that\trevise it out\ttest',
    'wordy\towing to the fact that\tsince (because)\ttest',
    'wordy\t, who is\tdrop it\ttest',
    '',
  ].join('\n'),
);
const find = (text, phrases = SMALL) => findPhrases(mask(text, { code: 'X' }), phrases);

test('findPhrases finds wordy, redundant and negative phrases', () => {
  const found = find('We did it in order to learn.\nEach and every step helps.\nNot many agree.\n');
  assert.deepEqual(found, [
    { line: 1, kind: 'wordy', text: 'in order to', note: 'to' },
    { line: 2, kind: 'redundant', text: 'Each and every', note: 'each' },
    { line: 3, kind: 'negative', text: 'Not many', note: 'few' },
  ]);
});

test('findPhrases matches whole words only, and never inside code', () => {
  assert.deepEqual(find('We reorder to win, teach and everyone, in order tomorrow, notmany.'), []);
  assert.deepEqual(find('Use `in order to` or ``each and every`` or in order `to`.\n\n```\nnot many\n```\n'), []);
  assert.equal(find('The [each and every](https://example.com/not many) page.').length, 1);
  assert.equal(find('He, who is tall, left.').length, 1);
});

test('findPhrases matches a phrase wrapped over a line and reports the line it starts on', () => {
  const found = find('First line.\nWe did it in order\nto learn.\n');
  assert.deepEqual(found, [{ line: 2, kind: 'wordy', text: 'in order to', note: 'to' }]);
  assert.equal(find('One\n\nin order\n\nto two.').length, 0);
});

test('findPhrases counts lines right in CRLF text', () => {
  const found = find('One.\r\nTwo.\r\nNot many here, in order to win.\r\n');
  assert.deepEqual(
    found.map((c) => [c.line, c.text]),
    [
      [3, 'Not many'],
      [3, 'in order to'],
    ],
  );
});

test('findPhrases reports only the longest of overlapping phrases', () => {
  const found = find('We stopped owing to the fact that it rained.');
  assert.deepEqual(found, [{ line: 1, kind: 'wordy', text: 'owing to the fact that', note: 'since (because)' }]);
});

test('loadPhrases reads the TSV', () => {
  assert.deepEqual(SMALL[0], {
    kind: 'wordy',
    phrase: 'in order to',
    replacement: 'to',
    source: 'plainlanguage.gov use-simple-words-phrases',
  });
  assert.equal(SMALL.length, 6);
  assert.deepEqual(loadPhrases('kind\tphrase\treplacement\tsource\r\nwordy\ta b\tc\td\r\n'), [
    { kind: 'wordy', phrase: 'a b', replacement: 'c', source: 'd' },
  ]);
  assert.throws(() => loadPhrases('kind\tphrase\treplacement\tsource\nwordy\ta\tb\n'), /line 2/);
  assert.throws(() => loadPhrases('kind\tphrase\treplacement\tsource\nfunny\ta\tb\tc\n'), /line 2.*funny/);
});

test('the shipped phrases.tsv loads, cites a source for every row and matches each of its phrases', () => {
  const rows = loadPhrases(readFileSync(PHRASES_TSV, 'utf8'));
  assert.ok(rows.length > 100);
  for (const kind of ['wordy', 'redundant', 'negative'])
    assert.ok(
      rows.some((r) => r.kind === kind),
      kind,
    );
  assert.equal(new Set(rows.map((r) => r.phrase)).size, rows.length, 'a phrase is listed twice');
  for (const r of rows) {
    assert.match(r.source, /^(plainlanguage\.gov [a-z-]+|Strunk 1920 rule (11|13))$/, r.phrase);
    assert.ok(r.replacement, r.phrase);
    assert.doesNotMatch(r.phrase, /[*\\^$|()[\]{}?+]|\.\.\./, `${r.phrase} is not a literal phrase`);
    const found = find(`Alpha ${r.phrase} omega.`, [r]);
    assert.equal(found.length, 1, r.phrase);
    assert.equal(found[0].kind, r.kind);
  }
  assert.deepEqual(find('We left in order to win.', rows)[0], {
    line: 1,
    kind: 'wordy',
    text: 'in order to',
    note: 'to',
  });
});

test('formatCandidates sorts by line', () => {
  assert.equal(
    formatCandidates([
      { line: 7, kind: 'negative', text: 'not many', note: 'few' },
      { line: 2, kind: 'wordy', text: 'in order to', note: 'to' },
    ]),
    'line 2: wordy: "in order to" (to)\nline 7: negative: "not many" (few)',
  );
  assert.equal(formatCandidates([]), '');
});
