// Phrase candidates for /copyedit: wordy phrases, redundant pairs and negatives with an affirmative form, found in
// text that prose.mjs's mask(text, { code: 'X' }) has already masked (code, link targets and block quotes are
// blank, newlines survive, so line numbers hold). Plain Node. The list is data/phrases.tsv.

const KINDS = new Set(['wordy', 'redundant', 'negative']);
const WORD = String.raw`[\p{L}\p{N}_]`;
// Wrapped prose: a phrase's space may be a space or one line break, never a blank line.
const GAP = String.raw`(?:[ \t]+|[ \t]*\r?\n[ \t]*)`;

// kind, phrase, replacement and source per line; the first line is the header.
export function loadPhrases(tsv) {
  const phrases = [];
  tsv.split(/\r?\n/).forEach((row, n) => {
    if (n === 0 || !row.trim()) return;
    const [kind, phrase, replacement, source, ...extra] = row.split('\t');
    if (!KINDS.has(kind) || !phrase || !replacement || !source || extra.length)
      throw new Error(`phrases: line ${n + 1} is not "kind, phrase, replacement, source" with a known kind: ${row}`);
    phrases.push({ kind, phrase, replacement, source });
  });
  return phrases;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A phrase is literal text, case-insensitive, and starts and ends on a word edge when it starts and ends with a word.
function pattern(phrase) {
  const body = phrase.split(/\s+/).map(escape).join(GAP);
  const before = new RegExp(`^${WORD}`, 'u').test(phrase) ? `(?<!${WORD})` : '';
  const after = new RegExp(`${WORD}$`, 'u').test(phrase) ? `(?!${WORD})` : '';
  return new RegExp(before + body + after, 'giu');
}

// Where two phrases overlap, the longer one wins ("the fact that" inside "owing to the fact that").
export function findPhrases(masked, phrases) {
  const hits = [];
  for (const { kind, replacement, phrase } of phrases)
    for (const m of masked.matchAll(pattern(phrase)))
      hits.push({
        start: m.index,
        end: m.index + m[0].length,
        kind,
        text: m[0].replace(/\s+/g, ' '),
        note: replacement,
      });
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const found = [];
  let end = 0;
  for (const h of hits) {
    if (h.start < end) continue;
    end = h.end;
    found.push({
      line: masked.slice(0, h.start).split('\n').length,
      kind: h.kind,
      text: h.text,
      note: h.note,
    });
  }
  return found;
}

export const formatCandidates = (candidates) =>
  [...candidates]
    .sort((a, b) => a.line - b.line)
    .map((c) => `line ${c.line}: ${c.kind}: "${c.text}" (${c.note})`)
    .join('\n');
