// Vendor captivus/agent-review's skill into plugins/agent-review/. Local changes: in SKILL.md, the two frontmatter
// changes upstream's tool notes recommend for work installs, `disable-model-invocation: true` (its description and
// when_to_use match most work) and no `effort: high` (it would override session effort), plus our own redirect of the
// pointer to the upstream README's instructions-file snippet to the dead-skills bundle's rules.md; tool-notes.md
// without its install section, which describes the unmodified skill; a source note in every Markdown file.
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
export const RULES_POINTER =
  'if the dead-skills bundle is installed, its `rules.md` carries a short form of the self-audit for every session';
export const TOOL_NOTES_LINK = 'install options and setting up independent reviewers';

// SKILL.md with the local changes above. Returns null when upstream changed shape (no frontmatter, no `name:
// agent-review`, or the README pointer or tool-notes link text is gone), so the sync fails instead of shipping a
// half-localized skill.
export function localize(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = lines.slice(1, end).filter((l) => !/^effort:/.test(l) && !/^disable-model-invocation:/.test(l));
  if (!fm.some((l) => /^name:\s*agent-review\s*$/.test(l))) return null;
  const body = lines.slice(end + 1).join('\n');
  if (!body.includes(README_POINTER) || !body.includes(TOOL_NOTES_LINK)) return null;
  const localBody = body
    .replace(README_POINTER, RULES_POINTER)
    .replace(TOOL_NOTES_LINK, 'setting up independent reviewers');
  return ['---', ...fm, 'disable-model-invocation: true', '---', localBody].join('\n');
}

// tool-notes.md without its install section. Returns null unless that is the first section and "Independent
// reviewers" directly follows it, so a section upstream adds in between fails the sync instead of being dropped.
export function trimToolNotes(text) {
  const heads = [...text.matchAll(/^## .*$/gm)];
  if (heads[0]?.[0] !== '## Install options' || heads[1]?.[0] !== '## Independent reviewers') return null;
  return text.slice(0, heads[0].index) + text.slice(heads[1].index);
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
  const refs = readdirSync(join(up, 'references')).map((f) => {
    if (!f.endsWith('.md')) fail(`upstream references/${f} isn't Markdown: vendor it in scripts/sync-agent-review.mjs`);
    const text = readFileSync(join(up, 'references', f), 'utf8');
    if (f !== 'tool-notes.md') return [f, text];
    return [f, trimToolNotes(text) ?? fail('upstream tool-notes.md changed shape: check trimToolNotes()')];
  });

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(join(DEST, 'references'), { recursive: true });
  writeFileSync(join(DEST, 'SKILL.md'), stamp(skill, `${UPSTREAM_WEB}/SKILL.md`));
  for (const [f, text] of refs) {
    writeFileSync(join(DEST, 'references', f), stamp(text, `${UPSTREAM_WEB}/references/${f}`));
  }
  cpSync(join(up, 'LICENSE'), join(PLUGIN, 'LICENSE'));
  finish('agent-review', git('-C', up, 'rev-parse', 'HEAD'), join(PLUGIN, 'UPSTREAM'), PLUGIN);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
