// Vendor the review passes flows' /self-review runs into plugins/flows/, so none of the same-named upstream plugins
// (code-review, pr-review-toolkit, mattpocock's code-review) has to be installed:
// - claude-plugins-official code-review's command → skills/self-review/references/upstream/code-review.md (the bug pass)
// - mattpocock/skills engineering/code-review → skills/self-review/references/upstream/spec-standards-review.md
// - pr-review-toolkit's specialist agents → agents/, with the description rewritten so they don't fire on their own
// Idempotent: re-running against the same upstream commits produces no diff.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, finish, git, sparseClone } from './sync-lib.mjs';

const OFFICIAL_URL = 'https://github.com/anthropics/claude-plugins-official.git';
const MATT_URL = 'https://github.com/mattpocock/skills.git';
// pr-review-toolkit's code-reviewer is left out: the bug pass and the standards pass cover it.
const AGENTS = [
  'silent-failure-hunter',
  'pr-test-analyzer',
  'type-design-analyzer',
  'comment-analyzer',
  'code-simplifier',
];

const FLOWS = join(ROOT, 'plugins', 'flows');
const AGENTS_DEST = join(FLOWS, 'agents');
const SKILL = join(FLOWS, 'skills', 'self-review');
const REFS_DEST = join(SKILL, 'references', 'upstream');

const official = sparseClone(OFFICIAL_URL, ['plugins/code-review/commands', 'plugins/pr-review-toolkit']);
const matt = sparseClone(MATT_URL, ['skills/engineering/code-review']);

const need = (path) => existsSync(path) || fail(`upstream ${path} not found (renamed or removed?)`);
const bugPass = join(official, 'plugins', 'code-review', 'commands', 'code-review.md');
const specPass = join(matt, 'skills', 'engineering', 'code-review', 'SKILL.md');
const toolkit = join(official, 'plugins', 'pr-review-toolkit');
for (const p of [bugPass, specPass, join(toolkit, 'LICENSE'), join(matt, 'LICENSE')]) need(p);
for (const a of AGENTS) need(join(toolkit, 'agents', `${a}.md`));

// "Use this agent when ... proactively ... <example>…" → one sentence that names /self-review as the caller.
// The description is either one line (with literal \n escapes) or a YAML block scalar (`|` plus indented lines).
function retarget(agentMd, name) {
  const lines = readFileSync(agentMd, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('description:'));
  if (start < 0) fail(`${name}: no description`);
  let end = start + 1;
  let value = lines[start].replace(/^description:\s*/, '');
  if (/^[|>][-+]?$/.test(value)) {
    while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
    value = lines.slice(start + 1, end).join('\n');
  }
  const first = value
    .replace(/^"|"$/g, '')
    .trim()
    .split(/\\n|\n|(?<=\.)\s/)[0]
    .trim();
  if (!first) fail(`${name}: empty description`);
  lines.splice(start, end - start, `description: ${JSON.stringify(`Used by /self-review: ${first}`)}`);
  return lines.join('\n');
}

// Source note right after the frontmatter (which must stay first). Links to main, not a commit: UPSTREAM has those,
// and a SHA here would change every vendored file on every upstream commit.
function stamp(text, url) {
  const note = `<!-- Vendored from ${url} by scripts/sync-self-review.mjs. Don't edit: the weekly sync overwrites it. -->`;
  const end = text.startsWith('---\n') ? text.indexOf('\n---\n', 4) : -1;
  if (end < 0) return `${note}\n\n${text}`;
  const cut = end + '\n---\n'.length;
  return `${text.slice(0, cut)}\n${note}\n${text.slice(cut)}`;
}
const OFFICIAL_WEB = 'https://github.com/anthropics/claude-plugins-official/blob/main/plugins';
const MATT_WEB = 'https://github.com/mattpocock/skills/blob/main/skills';

// flows' agents/ holds other syncs' agents too: replace only the ones this script stamped.
const ours = (f) => readFileSync(join(AGENTS_DEST, f), 'utf8').includes('by scripts/sync-self-review.mjs.');
for (const f of readdirSync(AGENTS_DEST).filter(ours)) rmSync(join(AGENTS_DEST, f));
rmSync(REFS_DEST, { recursive: true, force: true });
mkdirSync(REFS_DEST, { recursive: true });
for (const a of AGENTS) {
  const text = stamp(
    retarget(join(toolkit, 'agents', `${a}.md`), a),
    `${OFFICIAL_WEB}/pr-review-toolkit/agents/${a}.md`,
  );
  writeFileSync(join(AGENTS_DEST, `${a}.md`), text);
}
const vendor = (from, to, url) => writeFileSync(join(REFS_DEST, to), stamp(readFileSync(from, 'utf8'), url));
vendor(bugPass, 'code-review.md', `${OFFICIAL_WEB}/code-review/commands/code-review.md`);
vendor(specPass, 'spec-standards-review.md', `${MATT_WEB}/engineering/code-review/SKILL.md`);
cpSync(join(toolkit, 'LICENSE'), join(SKILL, 'LICENSE'));
cpSync(join(matt, 'LICENSE'), join(SKILL, 'LICENSE-MIT'));

const sha = (dir) => git('-C', dir, 'rev-parse', 'HEAD');
const shas = `anthropics/claude-plugins-official ${sha(official)}\nmattpocock/skills ${sha(matt)}`;
finish('self-review', shas, join(SKILL, 'UPSTREAM'), [SKILL, AGENTS_DEST]);
