// /copyedit's last step: compare the editor's document with the saved copy, and replace the document only when
// nothing was lost. `node compare.mjs <saved> <edited> <document>`: prints the lost items and exits 1, or copies the
// edited text over the document in the saved copy's line endings, prints the check's new findings and exits 0.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, loadTerms, report } from '../../../hooks/prose.mjs';

const lf = (text) => text.replace(/\r\n/g, '\n');

// Fenced blocks apart from the rest, so their lines count as one item and nothing inside them as prose.
function split(text) {
  const blocks = [];
  const body = lf(text).replace(/^ {0,3}(`{3,}|~{3,}).*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, (block) => {
    blocks.push(block.trim());
    return '';
  });
  return { blocks, body };
}

// Line wrapping isn't content: join a wrapped line to the one before, keeping list items, headings, tables, quotes
// and blank lines.
const reflow = (body) => body.replace(/(?<=\S)\n[ \t]*(?=[^\s\-*+|#\d>])/g, ' ');

function items(text) {
  const { blocks, body } = split(text);
  const flat = reflow(body);
  const lines = body.split('\n');
  const tables = [];
  lines.forEach((line, i) => {
    if (!/^\s*\|/.test(line)) return;
    if (i > 0 && /^\s*\|/.test(lines[i - 1])) tables[tables.length - 1]++;
    else tables.push(1);
  });
  const prose = flat.replace(/`[^`\n]+`/g, ' ').replace(/\]\([^)]*\)/g, ']');
  return {
    headings: lines.filter((l) => /^#{1,6} /.test(l)).map((l) => l.trim()),
    blocks,
    spans: flat.match(/`[^`\n]+`/g)?.map((s) => s.replace(/\s+/g, ' ')) ?? [],
    links: [...flat.matchAll(/\]\(([^)\s]+)/g)].map((m) => m[1]),
    numbers: prose.match(/(?<![\w.])\d+(?:[.,]\d+)*/g) ?? [],
    checkboxes: lines.filter((l) => /^\s*(?:[-*+]|\d+[.)]) \[[ xX]\]/.test(l)).length,
    tables,
  };
}

// What `before` has that `after` lacks, counting repeats.
function missing(before, after) {
  const left = new Map();
  for (const x of after) left.set(x, (left.get(x) ?? 0) + 1);
  return before.filter((x) => {
    const n = left.get(x) ?? 0;
    left.set(x, n - 1);
    return n <= 0;
  });
}

export function lost(saved, edited) {
  const a = items(saved);
  const b = items(edited);
  const out = [
    ...missing(a.headings, b.headings).map((h) => `heading: ${h}`),
    ...missing(a.blocks, b.blocks).map((c) => `code block: ${c.split('\n').slice(0, 2).join(' ')}`),
    ...missing(a.spans, b.spans).map((s) => `code span: ${s}`),
    ...missing(a.links, b.links).map((l) => `link target: ${l}`),
    ...missing(a.numbers, b.numbers).map((n) => `number: ${n}`),
  ];
  if (out.length === 0 && a.headings.join('\n') !== b.headings.join('\n')) out.push('headings: their order changed');
  if (b.checkboxes < a.checkboxes) out.push(`checkbox steps: ${b.checkboxes}, was ${a.checkboxes}`);
  if (a.tables.join() !== b.tables.join())
    out.push(`table rows: ${b.tables.join(', ') || 'no table'}, was ${a.tables.join(', ')}`);
  return out;
}

// The check's findings on the edited text that the saved copy didn't have as often.
export function newFindings(saved, edited, { file, terms }) {
  const all = (text) => check(text, [[0, text.length]], { file, terms });
  const had = new Map();
  for (const f of all(saved)) had.set(`${f.rule} ${f.match}`, (had.get(`${f.rule} ${f.match}`) ?? 0) + 1);
  return all(edited).filter((f) => {
    const key = `${f.rule} ${f.match}`;
    const n = had.get(key) ?? 0;
    had.set(key, n - 1);
    return n <= 0;
  });
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const [savedPath, editedPath, docPath] = process.argv.slice(2);
  const saved = readFileSync(savedPath, 'utf8');
  const edited = existsSync(editedPath) ? lf(readFileSync(editedPath, 'utf8')) : '';
  const gone = edited.trim() ? lost(saved, edited) : ['the editor wrote no document'];
  if (gone.length) {
    console.log(gone.join('\n'));
    process.exitCode = 1;
  } else {
    writeFileSync(docPath, saved.includes('\r\n') ? edited.replace(/\n/g, '\r\n') : edited);
    const terms = loadTerms(readFileSync(join(import.meta.dirname, '../../../hooks/common-terms.txt'), 'utf8'));
    const text = report(docPath, newFindings(saved, edited, { file: docPath, terms }));
    if (text) console.log(text);
  }
}
