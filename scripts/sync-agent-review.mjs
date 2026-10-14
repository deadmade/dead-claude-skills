// Vendor captivus/agent-review's skill into plugins/agent-review/. Local changes, all in SKILL.md, as the upstream
// tool notes recommend for work installs: `disable-model-invocation: true` (its description and when_to_use match
// most work), no `effort: high` (it would override session effort), and the pointer to the upstream README's
// instructions-file snippet redirected to the dead-skills bundle's rules.md, which carries it.
// Idempotent: re-running against the same upstream commit produces no diff.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fail, finish, git, sparseClone } from './sync-lib.mjs';

const UPSTREAM_URL = 'https://github.com/captivus/agent-review.git';
const UPSTREAM_WEB = 'https://github.com/captivus/agent-review/blob/main';
const PLUGIN = join(ROOT, 'plugins', 'agent-review');
const DEST = join(PLUGIN, 'skills', 'agent-review');

export const README_POINTER = 'the `README.md` has a snippet for your instructions file';
export const RULES_POINTER = "the dead-skills bundle's `rules.md` carries the self-audit for every session";

// SKILL.md with the local changes above. Returns null when upstream changed shape (no frontmatter, no `name:
// agent-review`, or the README pointer is gone), so the sync fails instead of shipping a skill that fires on its own.
export function localize(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = lines.slice(1, end).filter((l) => !/^effort:/.test(l) && !/^disable-model-invocation:/.test(l));
  if (!fm.some((l) => /^name:\s*agent-review\s*$/.test(l))) return null;
  const body = lines.slice(end + 1).join('\n');
  if (!body.includes(README_POINTER)) return null;
  return ['---', ...fm, 'disable-model-invocation: true', '---', body.replace(README_POINTER, RULES_POINTER)].join(
    '\n',
  );
}

// Source note right after the frontmatter (which must stay first), or at the top of a file without one.
export function stamp(text, url) {
  const note = `<!-- Vendored from ${url} by scripts/sync-agent-review.mjs. Don't edit: the weekly sync overwrites it. -->`;
  const end = text.startsWith('---\n') ? text.indexOf('\n---\n', 4) : -1;
  if (end < 0) return `${note}\n\n${text}`;
  const cut = end + '\n---\n'.length;
  return `${text.slice(0, cut)}\n${note}\n${text.slice(cut)}`;
}

function main() {
  const up = sparseClone(UPSTREAM_URL, ['/SKILL.md', '/LICENSE', '/references/'], { noCone: true });
  for (const p of ['SKILL.md', 'LICENSE', 'references']) {
    if (!existsSync(join(up, p))) fail(`upstream ${p} not found (renamed or removed?)`);
  }
  const skill = localize(readFileSync(join(up, 'SKILL.md'), 'utf8'));
  if (!skill) fail('upstream SKILL.md changed shape: check localize() in scripts/sync-agent-review.mjs');

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(join(DEST, 'references'), { recursive: true });
  writeFileSync(join(DEST, 'SKILL.md'), stamp(skill, `${UPSTREAM_WEB}/SKILL.md`));
  for (const f of readdirSync(join(up, 'references')).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(join(up, 'references', f), 'utf8');
    writeFileSync(join(DEST, 'references', f), stamp(text, `${UPSTREAM_WEB}/references/${f}`));
  }
  cpSync(join(up, 'LICENSE'), join(PLUGIN, 'LICENSE'));
  finish('agent-review', git('-C', up, 'rev-parse', 'HEAD'), join(PLUGIN, 'UPSTREAM'), PLUGIN);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
