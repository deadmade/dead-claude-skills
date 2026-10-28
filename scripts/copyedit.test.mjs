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
