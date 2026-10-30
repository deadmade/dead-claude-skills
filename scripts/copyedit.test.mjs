import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lost, newFindings } from '../plugins/flows/skills/writing/scripts/compare.mjs';

const COMPARE = join(import.meta.dirname, '../plugins/flows/skills/writing/scripts/compare.mjs');

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

const crlf = (text) => text.replaceAll('\n', '\r\n');
// Each case runs on LF text and on CRLF text.
const EOLS = [(t) => t, crlf];

test('lost names a dropped heading, code block, link target, number, checkbox step and table row', () => {
  const edited = DOC.replace('## Notes\n\nNothing else.\n', '')
    .replace('```bash\nnpm ci\n```\n', '')
    .replace('the [release page](https://example.com/releases)', 'the release page')
    .replace('30 s', 'a while')
    .replace('- [x] Read the output.\n', '')
    .replace('| b    | 2     |\n', '')
    .replace('`agent-browser`', 'the browser');
  for (const eol of EOLS) {
    const out = lost(eol(DOC), eol(edited)).join('\n');
    for (const what of [
      '## Notes',
      'npm ci',
      'https://example.com/releases',
      '30',
      'checkbox',
      'tables',
      'agent-browser',
    ])
      assert.ok(out.includes(what), `${what} in:\n${out}`);
  }
});

test('lost names a dropped version or label, a flipped checkbox and a dropped column', () => {
  const doc = '# T\n\nPinned at v0.3.0 for x64, decided in Q11.\n\n- [x] Done.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
  for (const eol of EOLS) {
    const out = (edited) => lost(eol(doc), eol(edited)).join('\n');
    assert.match(out(doc.replace('v0.3.0', 'v0.4.0')), /number: v0\.3\.0/);
    assert.match(out(doc.replace(' for x64', '')), /number: x64/);
    assert.match(out(doc.replace(', decided in Q11', '')), /number: Q11/);
    assert.match(out(doc.replace('[x]', '[ ]')), /checkbox steps: 1 \(0 ticked\), was 1 \(1 ticked\)/);
    assert.match(out(doc.replace('| a | b |\n| - | - |\n| 1 | 2 |', '| a |\n| - |\n| 1 |')), /tables/);
  }
});

test('lost accepts rewording, rewrapping and CRLF', () => {
  const edited = DOC.replace(
    'The installer checks the hash of `agent-browser` before it runs it, and it waits 30 s for\nthe [release page]',
    'Before it runs `agent-browser`, the installer checks its hash.\nIt waits 30 s for the [release page]',
  )
    .replace('Run `npm test`.', 'Run `npm\ntest` first.')
    .replace('Nothing else.', 'There is nothing else.');
  assert.deepEqual(lost(DOC, edited), []);
  assert.deepEqual(lost(crlf(DOC), edited), []);
  assert.deepEqual(lost(DOC, crlf(edited)), []);
});

test('lost accepts a code span wrapped onto a line that starts with a dash or a digit', () => {
  const saved = '# T\n\nRun `cargo clippy --all-targets\n-- -D warnings` and `npm test` within\n500 ms.\n';
  const edited = '# T\n\nRun `cargo clippy --all-targets -- -D warnings` and `npm test` within 500 ms.\n';
  for (const eol of EOLS) {
    assert.deepEqual(lost(eol(saved), eol(edited)), []);
    assert.deepEqual(lost(eol(edited), eol(saved)), []);
  }
});

test('lost accepts a fenced block unindented from a list, and a renumbered list', () => {
  const saved = '# T\n\n1. Run:\n\n   ```bash\n   npm ci\n   ```\n\n1. Check.\n1. Ship.\n';
  const edited = '# T\n\n1. Run:\n\n```bash\nnpm ci\n```\n\n2. Check.\n3. Ship.\n';
  for (const eol of EOLS) assert.deepEqual(lost(eol(saved), eol(edited)), []);
});

test('lost accepts an inline enumeration turned into a numbered list', () => {
  const saved = '# T\n\nThe flow (1) reads, (2) checks, (3) writes and (4) reports.\n';
  const edited = '# T\n\nThe flow:\n\n1. Reads.\n2. Checks.\n3. Writes.\n4. Reports.\n';
  for (const eol of EOLS) {
    assert.deepEqual(lost(eol(saved), eol(edited)), []);
    assert.deepEqual(lost(eol(saved.replaceAll('(', '')), eol(edited)), []);
  }
});

test('lost flags reordered and added headings', () => {
  const edited = DOC.replace('## Steps', '## Tmp').replace('## Notes', '## Steps').replace('## Tmp', '## Notes');
  for (const eol of EOLS) {
    assert.match(lost(eol(DOC), eol(edited)).join('\n'), /reordered/);
    assert.match(lost(eol(DOC), eol(DOC.replace('## Notes', '## Extra\n\n## Notes'))).join('\n'), /added/);
  }
});

test('lost flags a number dropped or changed inside parentheses', () => {
  const doc = '# T\n\nThe wait is a minute (default = 60) and the step comes from the plan (Task 11) as written.\n';
  for (const eol of EOLS) {
    assert.match(lost(eol(doc), eol(doc.replace(' (default = 60)', ''))).join('\n'), /number: 60/);
    assert.match(lost(eol(doc), eol(doc.replace('Task 11', 'Task 12'))).join('\n'), /number: 11/);
  }
});

test('lost refuses an edit that drops most of the prose', () => {
  const doc = '# T\n\nOne fact here.\n\nSecond fact here.\n\nThird fact here.\n';
  for (const eol of EOLS) {
    const out = lost(eol(doc), eol('# T\n\nOne fact here.\n')).join('\n');
    assert.match(out, /prose: 3 words, was 9/);
  }
});

test('lost holds the prose to 60% of its words and lets paragraphs and lists merge', () => {
  const doc = [
    '# T',
    '',
    'The first paragraph has ten words in it, more or less.',
    '',
    '- The first item says one thing about `code` here.',
    '- The second item says [another](https://example.com/a-long-path) thing.',
    '',
    'The last paragraph closes it.',
    '',
    '```bash',
    'many words in a fenced block that never count as prose words at all',
    '```',
    '',
  ].join('\n');
  for (const eol of EOLS) {
    const check = (edited) => lost(eol(doc), eol(edited)).join('\n');
    // Paragraphs and list items merged into one paragraph each keep every word: it passes.
    const merged = doc
      .replace('more or less.\n\n- The first item', 'more or less. The first item')
      .replace('.\n- The second item', '. The second item')
      .replace('\n\nThe last paragraph closes it.', ' The last paragraph closes it.');
    assert.equal(check(merged), '');
    // 30 words: 18 is 60% and passes, 17 doesn't.
    const words = (first) =>
      doc
        .replace('The first paragraph has ten words in it, more or less.', first)
        .replace('The last paragraph closes it.', 'It closes.');
    assert.equal(check(words('Ten words.')), '');
    assert.match(check(words('Words.')), /prose: 17 words, was 30/);
  }
});

test('lost names a dropped or changed block quote and accepts a rewrapped one', () => {
  const doc = '# T\n\nThe spec says:\n\n> Keep every quoted word\n> as it is.\n\nThat holds.\n';
  for (const eol of EOLS) {
    const check = (edited) => lost(eol(doc), eol(edited)).join('\n');
    assert.equal(check(doc.replace('word\n> as', 'word as')), '');
    assert.equal(check(doc.replace('> Keep', '>   Keep')), '');
    // A wrapped line without its ">" still belongs to the quote (a lazy continuation).
    assert.equal(check(doc.replace('word\n> as', 'word\n  as')), '');
    assert.match(check(doc.replace('quoted word', 'quoted words')), /quote: Keep every quoted word as it is\./);
    assert.match(
      check(doc.replace('> Keep every quoted word\n> as it is.\n\n', '')),
      /quote: Keep every quoted word as it is\./,
    );
  }
});

test('newFindings ignores labels the original already had', () => {
  for (const eol of EOLS) {
    const saved = eol('We settled Q3 last week.\n');
    const edited = eol('We settled Q3 last week, and D2 too.\n');
    const found = newFindings(saved, edited, { file: 'spec.md' });
    assert.deepEqual(
      found.map((f) => f.match),
      ['D2'],
    );
  }
});

// Runs the CLI in a fresh folder; returns its result and the document afterwards. `saved` undefined leaves no saved
// copy.
function run(saved, edited, doc = saved ?? DOC) {
  const dir = mkdtempSync(join(tmpdir(), 'ce-'));
  const paths = { saved: join(dir, 'saved.md'), edited: join(dir, 'edited.txt'), doc: join(dir, 'doc.md') };
  if (saved !== undefined) writeFileSync(paths.saved, saved);
  writeFileSync(paths.doc, doc);
  if (edited !== undefined) writeFileSync(paths.edited, edited);
  const r = spawnSync(process.execPath, [COMPARE, paths.saved, paths.edited, paths.doc], { encoding: 'utf8' });
  return { ...r, dir, doc: readFileSync(paths.doc, 'utf8') };
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

test('the CLI exits 2 on any other failure and leaves the document', () => {
  const r = run(undefined, DOC, 'untouched\n');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /unchanged/);
  assert.equal(r.doc, 'untouched\n');
});

test("the CLI copies a good edit in the original's line endings", () => {
  const edited = DOC.replace('Nothing else.', 'There is nothing else.');
  const r = run(crlf(DOC), edited);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.doc, crlf(edited));
  assert.equal(run(DOC, edited).doc, edited);
  assert.equal(run(DOC, crlf(edited)).doc, edited);
});

test("the CLI keeps the original's final newline", () => {
  const edited = DOC.replace('Nothing else.\n', 'There is nothing else.');
  assert.equal(run(DOC, edited).doc, DOC.replace('Nothing else.', 'There is nothing else.'));
  assert.equal(run(DOC.trimEnd(), edited + '\n\n').doc, DOC.replace('Nothing else.\n', 'There is nothing else.'));
});

// Symlinks need a privilege on Windows, and its file modes don't carry the POSIX bits.
test(
  'the CLI edits a symlinked document where it points and keeps its mode',
  { skip: process.platform === 'win32' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'ce-'));
    const real = join(dir, 'AGENTS.md');
    const link = join(dir, 'CLAUDE.md');
    writeFileSync(join(dir, 'saved.md'), DOC);
    writeFileSync(real, DOC);
    chmodSync(real, 0o600);
    symlinkSync('AGENTS.md', link);
    const edited = DOC.replace('Nothing else.', 'There is nothing else.');
    writeFileSync(join(dir, 'edited.txt'), edited);
    const r = spawnSync(process.execPath, [COMPARE, join(dir, 'saved.md'), join(dir, 'edited.txt'), link], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readFileSync(real, 'utf8'), edited);
    assert.equal(statSync(real).mode & 0o777, 0o600);
  },
);

test('the CLI refuses an edit when the document changed since it was saved, and leaves it', () => {
  const edited = DOC.replace('Nothing else.', 'There is nothing else.');
  const changed = DOC.replace('Nothing else.', 'Something new.');
  for (const eol of EOLS) {
    const r = run(eol(DOC), eol(edited), eol(changed));
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), 'the document changed since it was saved; edit refused');
    assert.equal(r.doc, eol(changed));
  }
});

test('the CLI leaves no temporary file behind', () => {
  const r = run(DOC, DOC.replace('Nothing else.', 'There is nothing else.'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(r.dir).sort(), ['doc.md', 'edited.txt', 'saved.md']);
});

test('the CLI reports only new findings', () => {
  for (const eol of EOLS) {
    const r = run(eol('# T\n\nWe settled Q3 last week.\n'), eol('# T\n\nWe settled Q3 last week, and D2 too.\n'));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /D2/);
    assert.doesNotMatch(r.stdout, /Q3/);
  }
});

test('lost names a dropped comment, link definition, autolink, bare URL and setext heading', () => {
  for (const eol of EOLS) {
    const saved = eol(
      [
        'Title',
        '=====',
        '',
        '<!-- uses:start -->',
        'The guide is at <https://example.com/guide> and the docs at https://example.com/docs.',
        'See [the docs][d].',
        '',
        '[d]: https://example.com/ref',
        '',
      ].join('\n'),
    );
    const edited = eol('The guide and the docs are online. See the docs.\n');
    const gone = lost(saved, edited);
    for (const item of [
      'heading: Title',
      'comment: <!-- uses:start -->',
      'link definition: https://example.com/ref',
      'URL: https://example.com/guide',
      'URL: https://example.com/docs',
    ])
      assert.ok(gone.includes(item), `${item} in ${JSON.stringify(gone)}`);
    // A bare URL turned into a link keeps its target.
    const linked = saved.replace('the docs at https://example.com/docs.', 'the [docs](https://example.com/docs).');
    assert.deepEqual(lost(saved, linked), []);
  }
});
