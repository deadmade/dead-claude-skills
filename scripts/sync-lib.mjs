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

// Every stable vX.Y.Z tag in `git ls-remote --tags` output with its commit (peeled for annotated tags), oldest first.
export function stableTags(lsRemote) {
  const tags = new Map();
  for (const line of lsRemote.split('\n')) {
    const m = /^([0-9a-f]{40})\trefs\/tags\/(v(\d+)\.(\d+)\.(\d+))(\^\{\})?$/.exec(line);
    if (!m) continue;
    const [, sha, tag, ...rest] = m;
    const entry = tags.get(tag) ?? { tag, version: rest.slice(0, 3).map(Number) };
    if (rest[3] || !entry.sha) entry.sha = sha; // the peeled ^{} line wins
    tags.set(tag, entry);
  }
  const cmp = ({ version: a }, { version: b }) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return [...tags.values()].sort(cmp).map(({ tag, sha }) => ({ tag, sha }));
}

// Blobless, sparse clone of `url` into a temp dir, checked out to `patterns`: the default branch at depth 1, or `ref`
// (a branch, a tag or a 40-hex commit); `depth: 0` keeps the whole history. `clone --branch` takes only names, so a
// commit is fetched and checked out after the clone. Returns the clone dir.
export function sparseClone(url, patterns, { noCone = false, ref, depth = 1 } = {}) {
  const dir = join(tempDir(), 'up');
  const commit = ref && /^[0-9a-f]{40}$/.test(ref);
  const depthOpt = depth ? ['--depth', String(depth)] : [];
  const opts = [...depthOpt, ...(ref && !commit ? ['--branch', ref] : [])];
  git('clone', '--quiet', ...opts, '--filter=blob:none', '--sparse', url, dir);
  if (commit) {
    git('-C', dir, 'fetch', '--quiet', ...depthOpt, 'origin', ref);
    git('-C', dir, 'checkout', '--quiet', '--detach', ref);
  }
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
    return (n < 0 ? rest : rest.slice(0, n))
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ');
  }
  if (/^[|>]/.test(v)) return null;
  if (/^\s/.test(lines[i + 1] ?? '')) return null; // multi-line plain scalar
  const q = v[0];
  if (q === '"' || q === "'") {
    if (v.length < 2 || !v.endsWith(q)) return null; // multi-line quoted
    if (q === '"' && v.includes('\\')) return null; // escapes aren't unescaped
    return v.slice(1, -1);
  }
  return v;
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

// Record the upstream commit, but only when something under `dir` (a path or a list of them) besides `upstreamFile`
// changed; otherwise restore `upstreamFile` so an upstream move that touches nothing we vendor gives no diff (and no
// sync PR).
export function finish(label, sha, upstreamFile, dir) {
  const rel = relative(ROOT, upstreamFile);
  const changed = git('-C', ROOT, 'status', '--porcelain', '--', ...[dir].flat(), `:(exclude)${rel}`) !== '';
  if (changed) writeFileSync(upstreamFile, sha + '\n');
  else git('-C', ROOT, 'checkout', '--', rel);
  console.log(changed ? `${label} synced to ${sha} (changed)` : `${label} unchanged at ${sha} (no vendored changes)`);
}

// Insert a `paths:` list before the closing `---` of the first frontmatter block.
// Returns null when there is no frontmatter or `paths:` is already present.
export function addPaths(text, globs) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      lines.splice(i, 0, 'paths:', ...globs.map((g) => `  - "${g}"`));
      return lines.join('\n');
    }
    if (/^paths:/.test(lines[i])) return null;
  }
  return null;
}
