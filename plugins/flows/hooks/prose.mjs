// Code check for new Markdown prose: conversation shorthand, labels only the conversation that wrote them explains.
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

// An inline code span ends at a blank line or at a line that starts a new block.
const INLINE_CODE =
  /(`+)(?!`)(?:(?!\n[ \t\r]*\n|\n {0,3}(?:[-*+][ \t]|\d+[.)][ \t]|#{1,6}[ \t]|[|>]))[\s\S])*?(?<!`)\1(?!`)/g;

export function mask(text) {
  return maskBlocks(text)
    .replace(INLINE_CODE, blank)
    .replace(/\]\([^)\n]*\)/g, (m) => `]${blank(m.slice(1))}`)
    .replace(/^( {0,3}\[[^\]\n]+\]:)([^\r\n]*)/gm, (_, label, target) => label + blank(target))
    .replace(/^ {0,3}>[^\r\n]*/gm, blank);
}

// A Write over an existing file counts only the lines the old file didn't have, so rewriting a document doesn't report
// what was already there.
export function newRanges(fullText, { tool_name, tool_input, tool_response }) {
  if (tool_name === 'Write') {
    const old = tool_response?.originalFile;
    if (typeof old !== 'string') return [[0, fullText.length]];
    const had = new Set(old.split(/\r?\n/));
    const ranges = [];
    let at = 0;
    for (const line of fullText.split('\n')) {
      if (!had.has(line.replace(/\r$/, ''))) ranges.push([at, at + line.length]);
      at += line.length + 1;
    }
    return ranges;
  }
  const added = tool_input?.new_string;
  if (tool_name !== 'Edit' || typeof added !== 'string' || added === '') return [];
  const needle = fullText.includes('\r\n') ? added.replace(/\r\n/g, '\n').replaceAll('\n', '\r\n') : added;
  const ranges = [];
  for (let at = fullText.indexOf(needle); at !== -1; at = fullText.indexOf(needle, at + needle.length))
    ranges.push([at, at + needle.length]);
  return ranges;
}

const LABELS = /\b[QD]-?\d+\b/g;
const PHRASES = /\bround \d+\b|\bmy call\b/gi;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function check(fullText, ranges, { file }) {
  const masked = mask(fullText);
  const inRange = (at) => ranges.some(([from, to]) => at >= from && at < to);
  const hits = [];

  if (file.split(/[\\/]/).pop() !== 'flow.md') {
    for (const m of [...masked.matchAll(LABELS), ...masked.matchAll(PHRASES)]) {
      if (!inRange(m.index)) continue;
      if (/^Q/.test(m[0]) && /^ \d{4}\b/.test(masked.slice(m.index + m[0].length))) continue;
      const word = escape(m[0]);
      const label = new RegExp(
        [
          `^[ \\t]*(?:(?:[-*+]|\\d+[.)]|#{1,6})[ \\t]+)?[*_]*${word}\\b`,
          `\\b(?:marked|labelled)[ \\t]+[*_(]*${word}\\b`,
          `\\b${word}[*_]*[ \\t]*\\([^)\\n]*\\)[*_]*:`,
        ].join('|'),
        'im',
      );
      if (label.test(masked)) continue;
      hits.push({ at: m.index, rule: 'shorthand', match: m[0], message: 'say what was decided instead of the label' });
    }
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

export function main({ stdin, readFile, env = process.env }) {
  const ok = { code: 0, stderr: '' };
  if (env.FLOWS_PROSE_CHECK === 'off') return ok;
  try {
    const input = JSON.parse(stdin);
    const file = input.tool_input?.file_path;
    if (typeof file !== 'string' || !/\.md$/i.test(file)) return ok;
    const text = readFile(file);
    const findings = check(text, newRanges(text, input), { file });
    return findings.length ? { code: 2, stderr: report(file, findings) } : ok;
  } catch {
    return ok;
  }
}
