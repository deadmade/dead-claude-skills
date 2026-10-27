import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { check, main, mask, newRanges, report } from './prose.mjs';

const TERMS = new Set(
  readFileSync(new URL('./common-terms.txt', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean),
);
const all = (text) => [[0, text.length]];
const run = (text, file = 'docs/x.md') => check(text, all(text), { file, terms: TERMS });
const rules = (findings, rule) => findings.filter((f) => f.rule === rule).map((f) => f.match);

test('shorthand flags conversation labels', () => {
  const found = run('Decided in grill Q11 and round 2 (D4, my call).');
  assert.deepEqual(rules(found, 'shorthand'), ['Q11', 'round 2', 'D4', 'my call']);
});

test('shorthand skips quarters, defined labels and flow.md', () => {
  assert.deepEqual(run('It ships in Q1 2027.'), []);
  assert.deepEqual(run('- Q1 (reliability): the first goal.\n\nQ1 comes first.'), []);
  const text = 'Decided in grill Q11 and round 2 (D4, my call).';
  assert.deepEqual(run(text, 'docs/features/x/flow.md'), []);
});

test('undefined flags abbreviations used before their definition', () => {
  const found = run('The CMP answers. The CMPs vary. A Consent Management Platform (CMP) asks.');
  assert.deepEqual(rules(found, 'undefined'), ['CMP']);
  assert.equal(found[0].col, 5);
  assert.deepEqual(rules(run('BM25 ranks.'), 'undefined'), ['BM25']);
  assert.deepEqual(rules(run('The CMPs vary.'), 'undefined'), ['CMPs']);
  assert.deepEqual(rules(run('XYZ and XYZ again.'), 'undefined'), ['XYZ']);
});

test('undefined accepts every definition form', () => {
  const forms = [
    'ADR (Architecture Decision Record) records a choice.',
    'An Architecture Decision Record (ADR) records a choice.',
    '| ADR | Architecture Decision Record |\n|---|---|',
    '`ADR` (Architecture Decision Record) records a choice.',
  ];
  for (const form of forms) assert.deepEqual(run(`${form}\n\nLater the ADR passes.`), [], form);
});

test('real docs stay clean', () => {
  const text = readFileSync(new URL('./fixtures/clean.md', import.meta.url), 'utf8');
  assert.deepEqual(rules(run(text), 'undefined'), []);
});

test('masking leaves code, front matter, link targets and quotes alone', () => {
  const text = [
    '---',
    'title: Q7 and XYZ',
    '---',
    '',
    '```js',
    'const Q7 = XYZ;',
    '```',
    '',
    'Inline `Q7 XYZ` code, a [link](https://example.com/XYZ/Q7) and [ref][r].',
    '',
    '> Q7 said XYZ here.',
    '',
    '[r]: https://example.com/XYZ',
    '',
  ].join('\n');
  assert.equal(mask(text).length, text.length);
  assert.equal(mask(text).split('\n').length, text.split('\n').length);
  assert.deepEqual(run(text), []);
  assert.equal(run(`${text}\nXYZ`).length, 1);
});

test('edit checks every occurrence of new_string and nothing else', () => {
  const file = 'Q3 stays.\nAdd Q4.\nMiddle.\nAdd Q4.\n';
  const input = { tool_name: 'Edit', tool_input: { new_string: 'Add Q4.' } };
  const ranges = newRanges(file, input);
  assert.deepEqual(ranges, [
    [10, 17],
    [26, 33],
  ]);
  const found = check(file, ranges, { file: 'a.md', terms: TERMS });
  assert.deepEqual(
    found.map((f) => [f.line, f.match]),
    [
      [2, 'Q4'],
      [4, 'Q4'],
    ],
  );
  assert.deepEqual(newRanges(file, { tool_name: 'Edit', tool_input: { new_string: '' } }), []);
  assert.deepEqual(newRanges(file, { tool_name: 'Read', tool_input: { new_string: 'Q3' } }), []);
  assert.deepEqual(newRanges(file, { tool_name: 'Write', tool_input: { content: file } }), [[0, file.length]]);
});

test('CRLF keeps positions and finds edits', () => {
  const lf = 'First line.\nSecond Q9 line.\n';
  const crlf = lf.replaceAll('\n', '\r\n');
  const at = (text) => run(text).map(({ line, col }) => [line, col]);
  assert.deepEqual(at(crlf), at(lf));
  assert.deepEqual(at(lf), [[2, 8]]);
  const ranges = newRanges(crlf, { tool_name: 'Edit', tool_input: { new_string: 'First line.\nSecond Q9 line.' } });
  assert.deepEqual(ranges, [[0, 28]]);
});

test('report caps at 10 and ends with the closing line', () => {
  const findings = Array.from({ length: 12 }, (_, i) => ({
    line: i + 1,
    col: 1,
    rule: 'shorthand',
    match: `Q${i}`,
    message: 'say what was decided instead of the label',
  }));
  const lines = report('docs/x.md', findings).split('\n');
  assert.equal(lines.length, 11);
  assert.equal(lines[0], 'docs/x.md:1:1 shorthand: "Q0" → say what was decided instead of the label');
  assert.equal(
    lines[10],
    'Fix what makes the prose worse for a reader. Leave a sentence as is when the finding is wrong.',
  );
  assert.equal(report('docs/x.md', []), '');
});

test('main fails open', () => {
  const ok = { code: 0, stderr: '' };
  const readFile = () => 'Q1x Q11';
  const json = (file_path) => JSON.stringify({ tool_name: 'Write', tool_input: { file_path, content: 'Q11' } });
  assert.deepEqual(main({ stdin: '{nope', readFile, terms: TERMS }), ok);
  assert.deepEqual(main({ stdin: json('notes.txt'), readFile, terms: TERMS }), ok);
  const throwing = () => {
    throw new Error('gone');
  };
  assert.deepEqual(main({ stdin: json('a.md'), readFile: throwing, terms: TERMS }), ok);
  const hit = main({ stdin: json('a.md'), readFile, terms: TERMS });
  assert.equal(hit.code, 2);
  assert.match(hit.stderr, /^a\.md:1:5 shorthand: "Q11"/);
});
