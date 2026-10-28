// /copyedit's measure step: the phrase list's candidates, and spaCy's (measure.py) when the prose environment exists.
// `node measure.mjs <file> <outdir>` writes <outdir>/candidates.txt (one candidate per line, for the editor) and
// <outdir>/totals.json, and prints one line when spaCy's measures were skipped. It always writes both files: without
// spaCy they hold the phrase candidates and the word-based figures. Any other failure prints one line and exits 2.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mask } from '../../../hooks/prose.mjs';
import { findPhrases, formatCandidates, loadPhrases } from './phrases.mjs';

const PHRASE_KINDS = { wordy: 'wordy phrases', redundant: 'redundant phrases', negative: 'negative phrases' };

// The installer's prose step puts the environment here (installer/core/prose.ts, prosePython): the plugin ships
// without the installer, so the rule is repeated.
export function findPython({ config, platform, exists = existsSync }) {
  const python =
    platform === 'win32'
      ? join(config, 'flows-prose', 'env', 'Scripts', 'python.exe')
      : join(config, 'flows-prose', 'env', 'bin', 'python');
  return exists(python) ? python : undefined;
}

const blank = (s) => s.replace(/[^\r\n]/g, ' ');
const per100 = (n, words) => (words ? Math.round((1000 * n) / words) / 10 : 0);
const lastLine = (text) =>
  String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .pop()
    ?.trim() ?? '';

// Runs measure.py on the masked text; returns its { candidates, totals }, or { skipped } with the reason.
function runSpacy(masked, { python, timeoutMs, spawn }) {
  if (!python) return { skipped: 'no environment' };
  const r = spawn(python, [join(import.meta.dirname, 'measure.py')], {
    input: masked,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error?.code === 'ETIMEDOUT') return { skipped: `timed out after ${Math.round(timeoutMs / 1000)} s` };
  if (r.error) return { skipped: `can't start ${python}: ${r.error.message}` };
  if (r.signal) return { skipped: `killed by ${r.signal}` };
  if (r.status !== 0) return { skipped: `exit ${r.status}: ${lastLine(r.stderr)}` };
  try {
    return JSON.parse(r.stdout);
  } catch (err) {
    return { skipped: `unreadable output: ${err.message}` };
  }
}

export function measure(file, outdir, { python, timeoutMs = 540000, spawn = spawnSync } = {}) {
  const masked = mask(readFileSync(file, 'utf8'), { code: 'X' });
  // HTML comments aren't prose; measure.py skips them itself.
  const prose = masked.replace(/<!--[\s\S]*?-->/g, blank);
  const words = (prose.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length;
  const phrases = findPhrases(
    prose,
    loadPhrases(readFileSync(join(import.meta.dirname, '../data/phrases.tsv'), 'utf8')),
  );

  const spacy = runSpacy(masked, { python, timeoutMs, spawn });
  const fromSpacy = spacy.candidates ?? [];
  // "there is" from the list and spaCy's abstract subject name the same words: keep one candidate, spaCy's. Other
  // kinds judge something else in those words, so both stay.
  const taken = new Set(
    fromSpacy.filter((c) => c.kind === 'abstract subject').map((c) => `${c.line} ${c.text.toLowerCase()}`),
  );
  const candidates = [...fromSpacy, ...phrases.filter((c) => !taken.has(`${c.line} ${c.text.toLowerCase()}`))].sort(
    (a, b) => a.line - b.line,
  );
  // Node's word count and phrase figures, so the totals are complete without spaCy; spaCy's own figures (its word
  // count too) go over them when it ran.
  const totals = { words };
  for (const [kind, name] of Object.entries(PHRASE_KINDS))
    totals[`${name} per 100 words`] = per100(phrases.filter((c) => c.kind === kind).length, words);
  Object.assign(totals, spacy.totals);

  mkdirSync(outdir, { recursive: true });
  const list = formatCandidates(candidates);
  writeFileSync(join(outdir, 'candidates.txt'), list ? list + '\n' : '');
  writeFileSync(join(outdir, 'totals.json'), JSON.stringify(totals, null, 2) + '\n');
  return spacy.skipped ? { candidates, totals, skipped: spacy.skipped } : { candidates, totals };
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  try {
    const [file, outdir] = process.argv.slice(2);
    const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const { skipped } = measure(file, outdir, { python: findPython({ config, platform: process.platform }) });
    if (skipped) console.log(`spaCy's measures were skipped: ${skipped}`);
  } catch (err) {
    console.log(`measure.mjs failed: ${err.message}`);
    process.exitCode = 2;
  }
}
