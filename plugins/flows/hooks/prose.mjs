// Code check for new Markdown prose: conversation shorthand and abbreviations used before they are defined.
// Judges only the text a Write or Edit just put in the file, and never looks inside code, front matter, link
// targets or block quotes. Plain Node: it runs as a PostToolUse command hook.

const CLOSING = 'Fix what makes the prose worse for a reader. Leave a sentence as is when the finding is wrong.';
const MAX_FINDINGS = 10;

const blank = (s) => s.replace(/[^\r\n]/g, ' ');

// Front matter and fenced code blocks, line by line so every length and newline survives.
function maskBlocks(text) {
  const lines = text.split('\n');
  let fence = null;
  let i = 0;
  if (lines[0]?.trimEnd() === '---') {
    const end = lines.findIndex((line, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) for (; i <= end; i++) lines[i] = blank(lines[i]);
  }
  for (; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (fence) {
      if (
        open &&
        open[1][0] === fence[0] &&
        open[1].length >= fence.length &&
        /^\s*$/.test(lines[i].slice(open[0].length))
      )
        fence = null;
      lines[i] = blank(lines[i]);
    } else if (open) {
      fence = open[1];
      lines[i] = blank(lines[i]);
    }
  }
  return lines.join('\n');
}

export function mask(text) {
  return maskBlocks(text)
    .replace(/(`+)(?!`)(?:(?!\n[ \t\r]*\n)[\s\S])*?(?<!`)\1(?!`)/g, blank)
    .replace(/\]\([^)\n]*\)/g, (m) => `]${blank(m.slice(1))}`)
    .replace(/^( {0,3}\[[^\]\n]+\]:)([^\r\n]*)/gm, (_, label, target) => label + blank(target))
    .replace(/^ {0,3}>[^\r\n]*/gm, blank);
}

export function newRanges(fullText, { tool_name, tool_input }) {
  if (tool_name === 'Write') return [[0, fullText.length]];
  const added = tool_input?.new_string;
  if (tool_name !== 'Edit' || typeof added !== 'string' || added === '') return [];
  const needle = fullText.includes('\r\n') ? added.replace(/\r\n/g, '\n').replaceAll('\n', '\r\n') : added;
  const ranges = [];
  for (let at = fullText.indexOf(needle); at !== -1; at = fullText.indexOf(needle, at + needle.length))
    ranges.push([at, at + needle.length]);
  return ranges;
}

const SHORTHAND = /\b[QD]-?\d+\b|\bround \d+\b|\bmy call\b/gi;
const ABBREVIATION = /\b[A-Z][A-Z0-9]{1,5}s?\b/g;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const initial = (word) => word.replace(/^[^A-Za-z0-9]+/, '')[0]?.toUpperCase();

// Where `abbr` is defined in `defs` (code font allowed), or -1: "ABBR (Words)", "Words (ABBR)" or a table row.
function definedAt(defs, abbr) {
  const a = escape(abbr);
  const wrap = '[`*_]*';
  const found = [];
  const add = (re, ok) => {
    for (const m of defs.matchAll(re)) if (ok(m)) found.push(m.indices.groups.a[0]);
  };
  add(new RegExp(`(?<![A-Za-z0-9])(?<a>${a})s?${wrap}[ \\t]*\\(([^)\\n]*)\\)`, 'gd'), (m) => {
    const words = m[2].trim().split(/[\s-]+/);
    return words.length >= 2 && initial(words[0]) === abbr[0];
  });
  add(new RegExp(`([^\\n(]*)\\(${wrap}(?<a>${a})s?${wrap}\\)`, 'gd'), (m) => {
    const words = m[1]
      .trim()
      .split(/[\s-]+/)
      .slice(-6);
    return words.some((w, n) => words.length - n >= 2 && initial(w) === abbr[0]);
  });
  add(new RegExp(`^[ \\t]*\\|[ \\t]*${wrap}(?<a>${a})${wrap}[ \\t]*\\|[ \\t]*[A-Za-z]`, 'gdm'), () => true);
  return found.length ? Math.min(...found) : -1;
}

export function check(fullText, ranges, { file, terms }) {
  const masked = mask(fullText);
  const defs = maskBlocks(fullText);
  const inRange = (at) => ranges.some(([from, to]) => at >= from && at < to);
  const hits = [];

  if (file.split(/[\\/]/).pop() !== 'flow.md') {
    for (const m of masked.matchAll(SHORTHAND)) {
      if (!inRange(m.index)) continue;
      if (/^Q/i.test(m[0]) && /^ \d{4}\b/.test(masked.slice(m.index + m[0].length))) continue;
      const label = new RegExp(`^[ \\t]*(?:(?:[-*+]|\\d+[.)]|#{1,6})[ \\t]+)?[*_]*${escape(m[0])}\\b`, 'im');
      if (label.test(masked)) continue;
      hits.push({ at: m.index, rule: 'shorthand', match: m[0], message: 'say what was decided instead of the label' });
    }
  }

  const seen = new Set();
  for (const m of masked.matchAll(ABBREVIATION)) {
    if (!inRange(m.index)) continue;
    const abbr = m[0].replace(/s$/, '');
    if ((abbr.match(/[A-Z]/g) || []).length < 2 || terms.has(abbr) || terms.has(m[0]) || seen.has(abbr)) continue;
    if (/^\.[a-z]{1,4}\b/.test(masked.slice(m.index + m[0].length))) continue;
    seen.add(abbr);
    const at = definedAt(defs, abbr);
    if (at !== -1 && at <= m.index) continue;
    hits.push({
      at: m.index,
      rule: 'undefined',
      match: m[0],
      message: `spell it out at first use: <words> (${abbr})`,
    });
  }

  return hits
    .sort((a, b) => a.at - b.at)
    .map(({ at, ...finding }) => {
      const before = fullText.slice(0, at);
      return { line: before.split('\n').length, col: at - before.lastIndexOf('\n'), ...finding };
    });
}

export function report(file, findings) {
  if (findings.length === 0) return '';
  const lines = findings
    .slice(0, MAX_FINDINGS)
    .map((f) => `${file}:${f.line}:${f.col} ${f.rule}: "${f.match}" → ${f.message}`);
  return [...lines, CLOSING].join('\n');
}

export function main({ stdin, readFile, terms }) {
  const ok = { code: 0, stderr: '' };
  try {
    const input = JSON.parse(stdin);
    const file = input.tool_input?.file_path;
    if (typeof file !== 'string' || !/\.md$/i.test(file)) return ok;
    const text = readFile(file);
    const findings = check(text, newRanges(text, input), { file, terms });
    return findings.length ? { code: 2, stderr: report(file, findings) } : ok;
  } catch {
    return ok;
  }
}
