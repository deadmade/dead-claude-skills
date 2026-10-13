// Shared plumbing for scripts/sync-*.mjs: sparse-clone an upstream repo, report new upstream skills,
// and record the synced commit.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Shallow, blobless, sparse clone of `url` into a temp dir, checked out to `patterns`. Returns the clone dir.
export function sparseClone(url, patterns, { noCone = false } = {}) {
  const dir = join(tempDir(), 'up');
  git('clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse', url, dir);
  git('-C', dir, 'sparse-checkout', 'set', ...(noCone ? ['--no-cone'] : []), ...patterns);
  return dir;
}

// `description:` from the first frontmatter block. Handles plain, "double"/'single'-quoted and folded (`>`, `>-`)
// forms; "" when missing, null for any other form (e.g. `|`).
export function frontmatterDescription(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return '';
  const lines = fm[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith('description:'));
  if (i < 0) return '';
  const v = lines[i].slice('description:'.length).trim();
  if (/^>[-+]?$/.test(v)) {
    const rest = lines.slice(i + 1);
    const n = rest.findIndex((l) => l && !/^\s/.test(l));
    return (n < 0 ? rest : rest.slice(0, n)).map((l) => l.trim()).filter(Boolean).join(' ');
  }
  if (/^[|>]/.test(v)) return null;
  return v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

// First sentence of `desc`, cut at the last space before `max` with "…" when still too long.
export function summary(desc, max = 200) {
  const dot = desc.indexOf('. ');
  const s = dot < 0 ? desc : desc.slice(0, dot + 1);
  return s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max))}…`;
}

// `description:` from a SKILL.md frontmatter, unquoted; "" when missing.
export function description(skillMd) {
  return existsSync(skillMd) ? (frontmatterDescription(readFileSync(skillMd, 'utf8')) ?? '') : '';
}

// Upstream skills that are neither vendored nor skipped. With NEW_SKILLS_FILE set (the workflows), each is
// appended as "<name>\t<description>" so the workflow can open an issue for it.
export function reportNew(entries) {
  for (const [name, desc] of entries) {
    console.log(`new upstream skill (not in SKILLS or SKIPPED): ${name}: ${desc}`);
    if (process.env.NEW_SKILLS_FILE) appendFileSync(process.env.NEW_SKILLS_FILE, `${name}\t${desc}\n`);
  }
}

// Record the upstream commit, but only when something under `dir` besides `upstreamFile` changed; otherwise restore
// `upstreamFile` so an upstream move that touches nothing we vendor gives no diff (and no sync PR).
export function finish(label, sha, upstreamFile, dir) {
  const rel = relative(ROOT, upstreamFile);
  const changed = git('-C', ROOT, 'status', '--porcelain', '--', dir, `:(exclude)${rel}`) !== '';
  if (changed) writeFileSync(upstreamFile, sha + '\n');
  else git('-C', ROOT, 'checkout', '--', rel);
  console.log(changed ? `${label} synced to ${sha} (changed)` : `${label} unchanged at ${sha} (no vendored changes)`);
}
