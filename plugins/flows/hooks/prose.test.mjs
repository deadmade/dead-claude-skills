import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { check, loadTerms, main, mask, newRanges, report } from './prose.mjs';

const TERMS = loadTerms(readFileSync(new URL('./common-terms.txt', import.meta.url), 'utf8'));
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

test('shorthand leaves lowercase q and d numbers alone', () => {
  assert.deepEqual(run('Use d3.js and q4 data, see d12.'), []);
  assert.deepEqual(rules(run('We chose Round 2 and My Call.'), 'shorthand'), ['Round 2', 'My Call']);
});

test('prose-check exits 0 and prints nothing when common-terms.txt cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prose-'));
  for (const name of ['prose.mjs', 'prose-check.mjs'])
    copyFileSync(new URL(`./${name}`, import.meta.url), join(dir, name));
  const doc = join(dir, 'doc.md');
  writeFileSync(doc, 'The API returns a URL.\n');
  const stdin = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: doc, content: 'x' } });
  const ran = spawnSync(process.execPath, [join(dir, 'prose-check.mjs')], { input: stdin, encoding: 'utf8' });
  assert.deepEqual([ran.status, ran.stdout, ran.stderr], [0, '', '']);
});

const CLOSING = 'Fix what makes the prose worse for a reader. Leave a sentence as is when the finding is wrong.';

// Runs the shipped prose-check.mjs on a hook payload, with the check on.
function hook(payload) {
  const env = { ...process.env };
  delete env.FLOWS_PROSE_CHECK;
  const script = new URL('./prose-check.mjs', import.meta.url);
  return spawnSync(process.execPath, [fileURLToPath(script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
}

test('prose-check exits 2 with the findings and the closing line after a Write', () => {
  for (const eol of ['\n', '\r\n']) {
    const doc = join(mkdtempSync(join(tmpdir(), 'prose-')), 'doc.md');
    const content = `# Notes${eol}${eol}Decided in Q11, XYZ rules.${eol}`;
    writeFileSync(doc, content);
    const ran = hook({ tool_name: 'Write', tool_input: { file_path: doc, content } });
    assert.equal(ran.status, 2);
    assert.equal(ran.stdout, '');
    assert.match(ran.stderr, /doc\.md:3:12 shorthand: "Q11"/);
    assert.match(ran.stderr, /doc\.md:3:17 undefined: "XYZ"/);
    assert.ok(ran.stderr.endsWith(`${CLOSING}\n`), ran.stderr);
  }
});

test('prose-check exits 0 after an Edit that adds a clean line to a file with an old label', () => {
  for (const eol of ['\n', '\r\n']) {
    const doc = join(mkdtempSync(join(tmpdir(), 'prose-')), 'doc.md');
    writeFileSync(doc, `We settled Q3 last week.${eol}A clean line.${eol}`);
    const ran = hook({
      tool_name: 'Edit',
      tool_input: { file_path: doc, old_string: 'A line.', new_string: 'A clean line.' },
    });
    assert.deepEqual([ran.status, ran.stdout, ran.stderr], [0, '', '']);
  }
});

test("inline code doesn't pair across list items", () => {
  for (const eol of ['\n', '\r\n']) {
    const text = ['- a `b` and a stray ` here', '- `pub const REST: Duration` (30 min)', ''].join(eol);
    assert.deepEqual(rules(run(text), 'undefined'), [], JSON.stringify(eol));
    const masked = mask(text);
    assert.ok(!masked.includes('REST'));
    assert.ok(masked.includes('(30 min)'));
    assert.equal(masked.length, text.length);
  }
});

test('an inline span ends at any line that starts a block', () => {
  for (const eol of ['\n', '\r\n']) {
    for (const next of ['# Head', '| a | b |', '1. item', '+ item']) {
      const masked = mask(`a stray \` here${eol}${next} \`x\` tail`);
      assert.ok(masked.includes('here') && masked.includes(next) && masked.includes('tail'), next);
      assert.ok(!masked.includes('x'), next);
    }
    // mask blanks a quote line whole; only the stray backtick must not pair into it.
    assert.ok(mask(`a stray \` here${eol}> \`x\` tail`).includes('here'));
  }
});

test('mask can read code as a word', () => {
  assert.equal(mask('Run `npm test` now', { code: 'X' }), 'Run X          now');
  assert.equal(mask('Run `npm test` now'), 'Run            now');
  assert.equal(mask('`a`', { code: 'X' }), 'X  ');
  const wrapped = 'Run `npm\r\ntest` now';
  assert.equal(mask(wrapped, { code: 'X' }), 'Run X   \r\n      now');
  assert.equal(mask(wrapped, { code: 'X' }).length, wrapped.length);
});

test('a label defined mid-line counts as defined', () => {
  for (const eol of ['\n', '\r\n']) {
    const text = (s) => s.replaceAll('\n', eol);
    const marked = text('Everything marked _(my call)_ was decided by Claude.\n\nLater _(my call)_ again.');
    assert.deepEqual(rules(run(marked), 'shorthand'), []);
    const labelled = text('Everything labelled (D4) was decided by Claude.\n\nLater D4 again.');
    assert.deepEqual(rules(run(labelled), 'shorthand'), []);
    const gloss = text('Goals: **Q2 (latency):** p50 under 5 s. Others follow.\n\nSo Q2 holds.');
    assert.deepEqual(rules(run(gloss), 'shorthand'), []);
    assert.deepEqual(rules(run(text('We chose my call here.\n')), 'shorthand'), ['my call']);
    assert.deepEqual(rules(run(text('We chose Q2 here.\n')), 'shorthand'), ['Q2']);
  }
});

test('FLOWS_PROSE_CHECK=off turns the check off', () => {
  const stdin = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'a.md', content: 'See Q4' } });
  const readFile = () => 'See Q4';
  assert.deepEqual(main({ stdin, readFile, terms: TERMS, env: { FLOWS_PROSE_CHECK: 'off' } }), {
    code: 0,
    stderr: '',
  });
  assert.equal(main({ stdin, readFile, terms: TERMS, env: {} }).code, 2);
});

test('loadTerms reads terms and skips comments', () => {
  const lf = '# header\nAPI\n  URL  # inline\n\nSQL\n';
  const expected = new Set(['API', 'URL', 'SQL']);
  assert.deepEqual(loadTerms(lf), expected);
  assert.deepEqual(loadTerms(lf.replaceAll('\n', '\r\n')), expected);
});
