// The copyedit's last step (references/copyedit.md): compare the editor's document with the saved copy, and replace the document only when
// nothing was lost. `node compare.mjs <saved> <edited> <document>`: prints the lost items and exits 1 (so too when the
// edited file is missing or empty, or the document no longer matches the saved copy), or copies the edited text over the document in the saved copy's line
// endings, prints the check's new findings and exits 0. Any other failure exits 2 and leaves the document as it was.
import {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { check, report } from '../../../hooks/prose.mjs';

const lf = (text) => text.replace(/\r\n/g, '\n');

// Fenced blocks apart from the rest, so their lines count as one item and nothing inside them as prose. A block's
// indentation isn't content: a list turned into prose may unindent it.
function split(text) {
  const blocks = [];
  const body = lf(text).replace(/^[ \t]*(`{3,}|~{3,}).*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, (block) => {
    blocks.push(
      block
        .split('\n')
        .map((l) => l.trim())
        .join('\n'),
    );
    return '';
  });
  return { blocks, body };
}

// Line wrapping isn't content: join a wrapped line to the one before, unless it starts a block (the rule prose.mjs's
// inline-code pattern uses: a list item, a heading, a table row, a quote) or the line before is blank.
const reflow = (body) =>
  body.replace(/(?<=\S)[ \t]*\n(?![ \t]*(?:\n|[-*+][ \t]|\d+[.)][ \t]|#{1,6}[ \t]|[|>]))[ \t]*/g, ' ');

// Numbers, versions and labels: every token with a digit in it (30, v0.3.0, x64, Q11, 2026-10-28 as three).
const TOKEN = /(?<![\w.])[A-Za-z]*\d[\w.]*/g;

function items(text) {
  const { blocks, body } = split(text);
  const flat = reflow(body);
  const lines = body.split('\n');
  const tables = [];
  lines.forEach((line, i) => {
    if (!/^\s*\|/.test(line)) return;
    const cols = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|').length;
    if (i > 0 && /^\s*\|/.test(lines[i - 1])) tables[tables.length - 1].rows++;
    else tables.push({ rows: 1, cols });
  });
  const prose = flat
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    // Enumerators aren't content: a list's markers, and "(1)" or "1)" in a sentence a list may replace. A bare "1)"
    // that closes an open parenthesis, as in "(Task 11)", is a number.
    .replace(/^[ \t]*\d+[.)][ \t]/gm, ' ')
    .replace(/(?<!\S)(\()?\d{1,2}\)(?!\S)/g, (m, open, at, all) => {
      const before = all.slice(all.lastIndexOf('\n', at - 1) + 1, at);
      return open || depth(before) <= 0 ? ' ' : m;
    });
  // Paragraphs and list items, one line each after the reflow: what isn't a heading, a table row or a quote.
  const paragraphs = prose.split('\n').filter((l) => l.trim() && !/^[ \t]*(?:#{1,6}[ \t]|\||>)/.test(l));
  // Setext headings: a text line underlined with = or -.
  const setext = lines.flatMap((l, i) =>
    l.trim() && !/^[ \t]*(?:[-*+>|]|\d+[.)])/.test(l) && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[i + 1] ?? '')
      ? [l.trim()]
      : [],
  );
  return {
    headings: [...lines.filter((l) => /^#{1,6} /.test(l)).map((l) => l.trim()), ...setext],
    // Comments carry machine markers (`<!-- uses:start -->`, `<!-- overrides … -->`): kept word for word.
    comments: body.match(/<!--[\s\S]*?-->/g)?.map((m) => m.replace(/\s+/g, ' ')) ?? [],
    // Reference definitions, autolinks and bare URLs, besides inline link targets.
    refs: lines.flatMap((l) => /^ {0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)/.exec(l)?.[1] ?? []),
    urls: (flat.replace(/`[^`\n]+`/g, ' ').match(/https?:\/\/[^\s<>()[\]`"']+/g) ?? []).map((u) =>
      u.replace(/[.,;:!?]+$/, ''),
    ),
    blocks,
    spans: flat.match(/`[^`\n]+`/g)?.map((s) => s.replace(/\s+/g, ' ')) ?? [],
    links: [...flat.matchAll(/\]\(([^)\s]+)/g)].map((m) => m[1]),
    numbers: (prose.match(TOKEN) ?? []).map((n) => n.replace(/\.+$/, '')),
    checkboxes: lines.flatMap((l) => /^\s*(?:[-*+]|\d+[.)]) \[([ xX])\]/.exec(l)?.[1].toLowerCase() ?? []).join(''),
    tables: tables.map((t) => `${t.rows}×${t.cols}`),
    quotes: quotes(lines),
    words: paragraphs.join(' ').match(WORD)?.length ?? 0,
  };
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const depth = (text) => (text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0);

// Block quotes, one item per quoted paragraph: the ">" markers and the wrapping aren't content. A line that follows a
// quote's line and starts no block continues the quote without its ">".
function quotes(lines) {
  const out = [];
  let open = false;
  for (const line of lines) {
    const quoted = /^[ \t]*>/.test(line);
    const lazy = open && !quoted && !/^[ \t]*(?:[-*+][ \t]|\d+[.)][ \t]|#{1,6}[ \t]|\|)/.test(line);
    const text =
      quoted || lazy
        ? line
            .replace(/^(?:[ \t]*>)+/, '')
            .replace(/\s+/g, ' ')
            .trim()
        : '';
    if (text) out.push(open ? `${out.pop()} ${text}` : text);
    open = Boolean(text);
  }
  return out;
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

const boxes = (states) => `${states.length} (${states.split('').filter((s) => s === 'x').length} ticked)`;

export function lost(saved, edited) {
  const a = items(saved);
  const b = items(edited);
  const out = [
    ...missing(a.headings, b.headings).map((h) => `heading: ${h}`),
    ...missing(a.blocks, b.blocks).map((c) => `code block: ${c.split('\n').slice(0, 2).join(' ')}`),
    ...missing(a.spans, b.spans).map((s) => `code span: ${s}`),
    ...missing(a.links, b.links).map((l) => `link target: ${l}`),
    ...missing(a.refs, b.refs).map((l) => `link definition: ${l}`),
    ...missing(a.urls, b.urls).map((u) => `URL: ${u}`),
    ...missing(a.comments, b.comments).map((m) => `comment: ${m}`),
    ...missing(a.numbers, b.numbers).map((n) => `number: ${n}`),
    ...missing(a.quotes, b.quotes).map((q) => `quote: ${q}`),
  ];
  if (out.length === 0 && a.headings.join('\n') !== b.headings.join('\n'))
    out.push('headings: added to or reordered; keep every heading in its place');
  if (a.checkboxes !== b.checkboxes) out.push(`checkbox steps: ${boxes(b.checkboxes)}, was ${boxes(a.checkboxes)}`);
  if (a.tables.join() !== b.tables.join())
    out.push(`tables (rows×columns): ${b.tables.join(', ') || 'none'}, was ${a.tables.join(', ')}`);
  // Prose without a number in it is compared by amount: an edit that keeps under 60% of the words dropped some, or the
  // editor's output was cut short. Paragraphs and list items aren't counted: merging them, or turning a list into
  // prose, is allowed.
  if (b.words * 5 < a.words * 3) out.push(`prose: ${b.words} words, was ${a.words} (an edit keeps at least 60%)`);
  return out;
}

// The check's findings on the edited text that the saved copy didn't have as often.
export function newFindings(saved, edited, { file }) {
  const all = (text) => check(text, [[0, text.length]], { file });
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
  try {
    const [savedPath, editedPath, docPath] = process.argv.slice(2);
    const saved = readFileSync(savedPath, 'utf8');
    let edited = existsSync(editedPath) ? lf(readFileSync(editedPath, 'utf8')) : '';
    const gone =
      readFileSync(docPath, 'utf8') !== saved
        ? ['the document changed since it was saved; edit refused']
        : edited.trim()
          ? lost(saved, edited)
          : ['the editor wrote no document'];
    if (gone.length) {
      console.log(gone.join('\n'));
      process.exitCode = 1;
    } else {
      // The saved copy's last newline, or its absence, stays.
      edited = edited.replace(/\n*$/, /\r?\n$/.test(saved) ? '\n' : '');
      const text = report(docPath, newFindings(saved, edited, { file: docPath }));
      // Written next to the document and renamed over it, so a failed write leaves the document whole. A symlinked
      // document is edited where it points, and keeps its mode.
      const real = realpathSync(docPath);
      const temp = join(dirname(real), `.${basename(real)}.${process.pid}.copyedit`);
      try {
        writeFileSync(temp, saved.includes('\r\n') ? edited.replace(/\n/g, '\r\n') : edited);
        chmodSync(temp, statSync(real).mode & 0o7777);
        renameSync(temp, real);
      } catch (err) {
        rmSync(temp, { force: true });
        throw err;
      }
      if (text) console.log(text);
    }
  } catch (err) {
    console.log(`compare.mjs failed, the document is unchanged: ${err.message}`);
    process.exitCode = 2;
  }
}
