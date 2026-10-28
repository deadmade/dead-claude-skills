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
import { mask } from '../plugins/flows/hooks/prose.mjs';
import { lost, newFindings } from '../plugins/flows/skills/copyedit/scripts/compare.mjs';
import { findPhrases, formatCandidates, loadPhrases } from '../plugins/flows/skills/copyedit/scripts/phrases.mjs';
import { findPython, measure } from '../plugins/flows/skills/copyedit/scripts/measure.mjs';

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
  const terms = new Set();
  for (const eol of EOLS) {
    const saved = eol('We settled Q3 last week.\n');
    const edited = eol('We settled Q3 last week, and D2 too.\n');
    const found = newFindings(saved, edited, { file: 'spec.md', terms });
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
  for (const eol of ['\n', '\r\n']) {
    const found = find(`First line.${eol}We did it in order${eol}to learn.${eol}`);
    assert.deepEqual(found, [{ line: 2, kind: 'wordy', text: 'in order to', note: 'to' }]);
  }
  assert.equal(find('We did it in order\u00a0to learn.').length, 1);
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
    assert.match(r.source, /^(plainlanguage\.gov [a-z-]+|Strunk 1920 rule (11|13)( \(present tense\))?)$/, r.phrase);
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

const MEASURE_PY = join(import.meta.dirname, '../plugins/flows/skills/copyedit/scripts/measure.py');
const SPACY_KINDS = [
  'nominalization',
  'passive',
  'abstract subject',
  'no link to the previous sentence',
  'long opener',
  'long subject',
  'subject-verb gap',
  'list in a sentence',
];

test(
  'measure.py finds the tested kinds',
  { skip: !process.env.FLOWS_PROSE_PYTHON && 'FLOWS_PROSE_PYTHON is not set' },
  () => {
    const sample = readFileSync(join(import.meta.dirname, 'fixtures/prose-sample.md'), 'utf8');
    const lines = sample.split('\n');
    // The kind each marker names, on the first line of text after it.
    const expected = [];
    lines.forEach((line, i) => {
      const kind = /^<!-- expect: (.+) -->$/.exec(line)?.[1];
      if (!kind) return;
      let at = i + 1;
      while (!lines[at].trim()) at++;
      expected.push({ line: at + 1, kind });
    });
    assert.deepEqual(expected.map((e) => e.kind).sort(), [...SPACY_KINDS].sort());
    const fence = [lines.indexOf('```text') + 1, lines.indexOf('```', lines.indexOf('```text') + 1) + 1];

    const results = EOLS.map((eol) => {
      const run = spawnSync(process.env.FLOWS_PROSE_PYTHON, [MEASURE_PY], {
        input: mask(eol(sample), { code: 'X' }),
        encoding: 'utf8',
        timeout: 300000,
      });
      assert.equal(run.status, 0, run.stderr);
      return JSON.parse(run.stdout);
    });
    const [{ candidates, totals }] = results;
    for (const { line, kind } of expected)
      assert.equal(
        candidates.filter((c) => c.line === line && c.kind === kind).length,
        1,
        `one ${kind} on line ${line}: ${JSON.stringify(candidates.filter((c) => c.line === line))}`,
      );
    for (const c of candidates) {
      assert.deepEqual(Object.keys(c).sort(), ['kind', 'line', 'note', 'text']);
      assert.ok(SPACY_KINDS.includes(c.kind), c.kind);
      assert.ok(c.line < fence[0] || c.line > fence[1], `candidate in the fenced block: ${JSON.stringify(c)}`);
    }
    const items = [
      lines.findIndex((l) => l.startsWith('- The list item')) + 1,
      lines.indexOf('- Another item follows it.') + 1,
    ];
    assert.deepEqual(
      candidates.filter((c) => c.kind === 'list in a sentence' && c.line >= items[0] && c.line <= items[1]),
      [],
      'no list in a sentence inside a list item, its second paragraph included',
    );
    assert.ok(
      candidates.some((c) => c.kind === 'passive' && c.text === 'were fetched' && c.note === 'no agent: who fetches?'),
      'the passive names its verb',
    );
    assert.deepEqual(Object.keys(totals).sort(), [
      '% abstract subjects',
      '% adjacent sentences sharing a content word',
      '% lists in a sentence',
      '% long openers (over 8 words)',
      '% long subjects (over 7 words)',
      '% passive sentences',
      '% sentences with no link to the previous sentence',
      '% subject-verb gaps (over 4 words)',
      'nominalizations per 100 words',
      'sentences',
      'words',
    ]);
    assert.ok(totals.words > 100 && totals.sentences > 8, JSON.stringify(totals));
    assert.deepEqual(results[1], results[0], 'CRLF text gives the same result');
  },
);

test(
  "measure.py exits 1 on input that isn't UTF-8 and 3 with one line when spaCy can't load",
  { skip: !process.env.FLOWS_PROSE_PYTHON && 'FLOWS_PROSE_PYTHON is not set' },
  () => {
    const bad = spawnSync(process.env.FLOWS_PROSE_PYTHON, [MEASURE_PY], { input: Buffer.from([0xff, 0xfe, 0x41]) });
    assert.equal(bad.status, 1);
    // -S leaves out site-packages, so spaCy can't import.
    const unloaded = spawnSync(process.env.FLOWS_PROSE_PYTHON, ['-S', MEASURE_PY], {
      input: 'Text.',
      encoding: 'utf8',
    });
    assert.equal(unloaded.status, 3);
    assert.match(unloaded.stderr, /^measure\.py: can't load spaCy's en_core_web_trf: .+\n$/);
    assert.equal(unloaded.stdout, '');
  },
);

const measurePy = (text, args = []) =>
  spawnSync(process.env.FLOWS_PROSE_PYTHON, [...args, MEASURE_PY], {
    input: mask(text, { code: 'X' }),
    encoding: 'utf8',
    timeout: 300000,
  });

test(
  'measure.py skips HTML comments and flags only nouns made from verbs as actions',
  { skip: !process.env.FLOWS_PROSE_PYTHON && 'FLOWS_PROSE_PYTHON is not set' },
  () => {
    const doc = [
      '<!-- overrides pack/SKILL.md: "The marker was written before the run, and there are three reasons." -->',
      '',
      '<!--',
      'There are many reasons for the delay in the schedule, and they were all written down.',
      '-->',
      '',
      'The package is large. The message explains the fix.',
      '',
      'The installation of the cache occurs on update.',
      '',
    ].join('\n');
    for (const eol of EOLS) {
      const run = measurePy(eol(doc));
      assert.equal(run.status, 0, run.stderr);
      const { candidates, totals } = JSON.parse(run.stdout);
      assert.deepEqual(
        candidates.filter((c) => c.line <= 5),
        [],
        'nothing in the HTML comments',
      );
      assert.equal(totals.sentences, 3, JSON.stringify(totals));
      const actions = (line) =>
        candidates.filter((c) => c.line === line && ['nominalization', 'abstract subject'].includes(c.kind));
      assert.deepEqual(actions(7), [], 'package and message are not actions');
      assert.deepEqual(
        actions(9).map((c) => c.kind),
        ['nominalization'],
        `one candidate for "the installation occurs": ${JSON.stringify(actions(9))}`,
      );
    }
  },
);

test(
  'measure.py exits 1 with one line when measuring fails after the model loaded',
  { skip: !process.env.FLOWS_PROSE_PYTHON && 'FLOWS_PROSE_PYTHON is not set' },
  () => {
    // A stand-in spaCy whose model has no pipe(), so measure() raises after the load.
    const run = spawnSync(
      process.env.FLOWS_PROSE_PYTHON,
      [
        '-c',
        'import runpy, sys, types; sys.modules["spacy"] = types.SimpleNamespace(load=lambda name: object()); ' +
          'sys.argv = [sys.argv[1]]; runpy.run_path(sys.argv[0], run_name="__main__")',
        MEASURE_PY,
      ],
      { input: 'The cache files were fetched before the run.\n', encoding: 'utf8' },
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /^measure\.py: .+\n$/);
    assert.equal(run.stdout, '');
  },
);

const MEASURE_MJS = join(import.meta.dirname, '../plugins/flows/skills/copyedit/scripts/measure.mjs');

const MEASURED = [
  '# Notes',
  '',
  'There is a reason we did it in order to learn, and `in order to` is code.',
  '',
  'The cache files were fetched before the run. It failed to stop.',
  '',
].join('\n');

// A spawnSync stand-in: records each call and answers with `result`.
function stubSpawn(result) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, signal: null, stdout: '', stderr: '', ...result };
  };
  return { spawn, calls };
}

// measure() on MEASURED (or its CRLF form) in a fresh folder; returns its result and the files it wrote.
function measureIn(options, text = MEASURED) {
  const dir = mkdtempSync(join(tmpdir(), 'measure-'));
  writeFileSync(join(dir, 'doc.md'), text);
  const out = join(dir, 'before');
  const result = measure(join(dir, 'doc.md'), out, options);
  return {
    result,
    candidatesFile: readFileSync(join(out, 'candidates.txt'), 'utf8'),
    totalsFile: JSON.parse(readFileSync(join(out, 'totals.json'), 'utf8')),
  };
}

const PHRASE_ONLY = [
  { line: 3, kind: 'wordy', text: 'There is', note: '(omit)' },
  { line: 3, kind: 'wordy', text: 'in order to', note: 'to' },
  { line: 5, kind: 'negative', text: 'failed to', note: "didn't" },
];
const PHRASE_KEYS = [
  'negative phrases per 100 words',
  'redundant phrases per 100 words',
  'words',
  'wordy phrases per 100 words',
];

// Skips still write the phrase candidates and the word-based totals.
function assertPhrasesOnly({ result, candidatesFile, totalsFile }) {
  assert.deepEqual(result.candidates, PHRASE_ONLY);
  assert.equal(candidatesFile, formatCandidates(PHRASE_ONLY) + '\n');
  assert.deepEqual(Object.keys(totalsFile).sort(), PHRASE_KEYS);
  assert.deepEqual(totalsFile, result.totals);
  // 28 words, the heading's and the "X" for the code span among them; "There is" counts as a wordy phrase.
  assert.equal(totalsFile.words, 28);
  assert.equal(totalsFile['wordy phrases per 100 words'], 7.1);
  assert.equal(totalsFile['negative phrases per 100 words'], 3.6);
  assert.equal(totalsFile['redundant phrases per 100 words'], 0);
}

test('measure merges phrase and spaCy candidates', () => {
  const spacy = {
    candidates: [
      { line: 3, kind: 'abstract subject', text: 'There is', note: "'There' as the subject" },
      { line: 5, kind: 'passive', text: 'were fetched', note: 'no agent: who fetches?' },
    ],
    totals: { words: 22, sentences: 3, '% passive sentences': 33.3 },
  };
  for (const eol of EOLS) {
    const { spawn, calls } = stubSpawn({ stdout: JSON.stringify(spacy) + '\n' });
    const { result, candidatesFile, totalsFile } = measureIn({ python: '/env/bin/python', spawn }, eol(MEASURED));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, '/env/bin/python');
    assert.equal(calls[0].args.length, 1);
    assert.match(calls[0].args[0], /measure\.py$/);
    assert.equal(calls[0].options.input, mask(eol(MEASURED), { code: 'X' }));
    assert.equal(calls[0].options.timeout, 540000);
    // The phrase list's "There is" gives way to spaCy's abstract subject on the same line.
    const expected = [
      spacy.candidates[0],
      { line: 3, kind: 'wordy', text: 'in order to', note: 'to' },
      spacy.candidates[1],
      { line: 5, kind: 'negative', text: 'failed to', note: "didn't" },
    ];
    assert.deepEqual(result, {
      candidates: expected,
      totals: {
        words: 22,
        sentences: 3,
        '% passive sentences': 33.3,
        // Node's figures count every phrase, "There is" too, per Node's 28 words; spaCy's word count wins.
        'wordy phrases per 100 words': 7.1,
        'redundant phrases per 100 words': 0,
        'negative phrases per 100 words': 3.6,
      },
    });
    assert.equal(candidatesFile, formatCandidates(expected) + '\n');
    assert.deepEqual(totalsFile, result.totals);
  }
});

test('only an abstract subject from spaCy hides the phrase candidate with the same words', () => {
  const spacy = {
    candidates: [
      { line: 3, kind: 'abstract subject', text: 'There is', note: "'There' as the subject" },
      { line: 3, kind: 'nominalization', text: 'in order to', note: 'a stub' },
    ],
    totals: {},
  };
  for (const eol of EOLS) {
    const { spawn } = stubSpawn({ stdout: JSON.stringify(spacy) });
    const { result } = measureIn({ python: '/env/bin/python', spawn }, eol(MEASURED));
    assert.deepEqual(
      result.candidates.filter((c) => c.line === 3),
      [...spacy.candidates, { line: 3, kind: 'wordy', text: 'in order to', note: 'to' }],
    );
  }
});

test('measure skips spaCy without a Python', () => {
  for (const eol of EOLS) {
    const { spawn, calls } = stubSpawn({});
    const run = measureIn({ python: undefined, spawn }, eol(MEASURED));
    assert.equal(calls.length, 0);
    assert.equal(run.result.skipped, 'no environment');
    assertPhrasesOnly(run);
  }
});

test("measure reports exit 3's line", () => {
  for (const status of [3, 1]) {
    const stderr = `FutureWarning: something\nmeasure.py: can't load spaCy's en_core_web_trf: OSError: no model\n`;
    const { spawn } = stubSpawn({ status, stderr });
    const run = measureIn({ python: '/env/bin/python', spawn });
    assert.equal(
      run.result.skipped,
      `exit ${status}: measure.py: can't load spaCy's en_core_web_trf: OSError: no model`,
    );
    assertPhrasesOnly(run);
  }
});

test('measure reports a timeout', () => {
  const error = Object.assign(new Error('spawnSync /env/bin/python ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const { spawn, calls } = stubSpawn({ status: null, signal: 'SIGTERM', error });
  const run = measureIn({ python: '/env/bin/python', timeoutMs: 2000, spawn });
  assert.equal(calls[0].options.timeout, 2000);
  assert.equal(run.result.skipped, 'timed out after 2 s');
  assertPhrasesOnly(run);

  const killed = measureIn({ python: '/env/bin/python', spawn: stubSpawn({ status: null, signal: 'SIGKILL' }).spawn });
  assert.equal(killed.result.skipped, 'killed by SIGKILL');
  assertPhrasesOnly(killed);
});

test('findPython per platform', () => {
  const linux = join('/c', 'flows-prose', 'env', 'bin', 'python');
  const win = join('/c', 'flows-prose', 'env', 'Scripts', 'python.exe');
  const has = (path) => (p) => p === path;
  assert.equal(findPython({ config: '/c', platform: 'linux', exists: has(linux) }), linux);
  assert.equal(findPython({ config: '/c', platform: 'darwin', exists: has(linux) }), linux);
  assert.equal(findPython({ config: '/c', platform: 'win32', exists: has(win) }), win);
  assert.equal(findPython({ config: '/c', platform: 'win32', exists: has(linux) }), undefined);
  assert.equal(findPython({ config: '/c', platform: 'linux', exists: () => false }), undefined);
});

test('the measure CLI prints the skip line and writes both files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'measure-cli-'));
  writeFileSync(join(dir, 'doc.md'), MEASURED);
  const r = spawnSync(process.execPath, [MEASURE_MJS, join(dir, 'doc.md'), join(dir, 'before')], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(dir, 'config') },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "spaCy's measures were skipped: no environment\n");
  assert.equal(readFileSync(join(dir, 'before', 'candidates.txt'), 'utf8'), formatCandidates(PHRASE_ONLY) + '\n');
  assert.equal(JSON.parse(readFileSync(join(dir, 'before', 'totals.json'), 'utf8')).words, 28);
});

test("measure reports a Python that won't start or answers with something other than JSON", () => {
  const error = Object.assign(new Error('spawnSync /env/bin/python ENOENT'), { code: 'ENOENT' });
  const missing = measureIn({ python: '/env/bin/python', spawn: stubSpawn({ status: null, error }).spawn });
  assert.equal(missing.result.skipped, "can't start /env/bin/python: spawnSync /env/bin/python ENOENT");
  assertPhrasesOnly(missing);

  const garbled = measureIn({ python: '/env/bin/python', spawn: stubSpawn({ stdout: 'Traceback' }).spawn });
  assert.match(garbled.result.skipped, /^unreadable output: /);
  assertPhrasesOnly(garbled);
});

test('measure leaves HTML comments out of the phrases and the word count', () => {
  const commented = MEASURED + '<!-- overrides pack/SKILL.md: "There is a reason, in order to\nwin." -->\n';
  for (const eol of EOLS) {
    const run = measureIn({ python: undefined, spawn: stubSpawn({}).spawn }, eol(commented));
    assertPhrasesOnly(run);
  }
});

test('the measure CLI exits 2 with one line when it fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'measure-cli-'));
  const r = spawnSync(process.execPath, [MEASURE_MJS, join(dir, 'missing.md'), join(dir, 'before')], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(dir, 'config') },
  });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^measure\.mjs failed: ENOENT[^\n]*missing\.md[^\n]*\n$/);
  assert.equal(r.stderr, '');
});
