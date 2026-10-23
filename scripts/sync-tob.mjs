// Vendor a curated subset of Trail of Bits' skills (trailofbits/skills, one plugin per folder) into plugins/flows/packs/tob-picks/,
// renaming upstream plugin namespaces to ours (REWRITES). Idempotent: same upstream commit, same output.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ROOT, fail, finish, git, reportNew, sparseClone } from './sync-lib.mjs';

const UPSTREAM_URL = 'https://github.com/trailofbits/skills.git';
// Upstream plugins whose one skill (plus agents and workflows) we vendor.
const SKILLS = ['property-based-testing', 'spec-to-code-compliance', 'sharp-edges', 'mutation-testing'];
const AGENTS = [
  'spec-to-code-compliance/agents/spec-compliance-checker.md',
  'sharp-edges/agents/sharp-edges-analyzer.md',
];
const WORKFLOWS = ['spec-to-code-compliance/workflows/spec-compliance.js'];
// Upstream plugins deliberately not vendored. Anything in neither list is reported as new (see NEW_SKILLS_FILE).
const SKIPPED = [
  'agentic-actions-auditor',
  'audit-context-building',
  'building-secure-contracts', // smart contracts
  'burpsuite-project-parser',
  'c-review',
  'chrome-mcp-troubleshooting',
  'code-improver',
  'constant-time-analysis',
  'culture-index',
  'devcontainer-setup',
  'differential-review', // pstack blast-radius, self-review's pr-test-analyzer and claude-security cover it
  'dimensional-analysis',
  'dwarf-expert',
  'entry-point-analyzer',
  'firebase-apk-scanner',
  'fp-check',
  'gh-cli',
  'git-cleanup',
  'github-triage',
  'goal-prompt',
  'insecure-defaults',
  'let-fate-decide',
  'modern-cpp',
  'modern-python',
  'open-sourcing',
  'post-patch-validation',
  'review-walkthrough', // tui-review covers it
  'rust-review',
  'second-opinion',
  'semgrep-rule-creator',
  'semgrep-rule-variant-creator',
  'static-analysis',
  'supply-chain-risk-auditor',
  'testing-handbook-skills',
  'trailmark',
  'variant-analysis',
  'vulnerability-triage-brocards',
  'writing-lean-proofs',
  'yara-authoring',
  'zeroize-audit',
];
// [file under the plugin, pattern, replacement]. Each must match, so an upstream rename fails the sync.
const REWRITES = [
  [
    'skills/spec-to-code-compliance/SKILL.md',
    /\/spec-to-code-compliance:spec-compliance/g,
    '/tob-picks:spec-compliance',
  ],
  ['skills/spec-to-code-compliance/SKILL.md', /`spec-to-code-compliance:/g, '`tob-picks:'],
  // A pack's agents don't load (flows reads packs by path), so the checker runs as general-purpose with its agent
  // file's text in front of each requirement's prompt.
  [
    'workflows/spec-compliance.js',
    /^const CHECKER = 'spec-to-code-compliance:spec-compliance-checker'$/m,
    () =>
      `const CHECKER = 'general-purpose'\n// agents/spec-compliance-checker.md, inlined by scripts/sync-tob.mjs.\nconst CHECKER_PROMPT = ${JSON.stringify(readFileSync(join(PLUGIN, 'agents', 'spec-compliance-checker.md'), 'utf8'))}`,
  ],
  [
    'workflows/spec-compliance.js',
    /agent\(prompt, \{ \.\.\.options, agentType: CHECKER \}\)/g,
    'agent(`${CHECKER_PROMPT}\\n${prompt}`, { ...options, agentType: CHECKER })',
  ],
  // Upstream's detection command misses C#'s PBT libraries.
  ['skills/property-based-testing/references/libraries.md', /\|invariant_"/g, '|invariant_|FsCheck|CsCheck"'],
];

const PLUGIN = join(ROOT, 'plugins', 'flows', 'packs', 'tob-picks');

const up = sparseClone(UPSTREAM_URL, ['.claude-plugin', ...SKILLS.map((s) => `plugins/${s}`)]);
for (const s of SKILLS) {
  if (!existsSync(join(up, 'plugins', s, 'skills', s, 'SKILL.md')))
    fail(`upstream plugins/${s}/skills/${s}/SKILL.md not found (renamed or removed?)`);
}
for (const f of [...AGENTS, ...WORKFLOWS]) {
  if (!existsSync(join(up, 'plugins', f))) fail(`upstream plugins/${f} not found`);
}

// New upstream plugins: every marketplace entry that is neither vendored nor skipped.
const known = new Set([...SKILLS, ...SKIPPED]);
const NEW = JSON.parse(readFileSync(join(up, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins.filter(
  (p) => !known.has(p.name),
);
if (NEW.length) reportNew(NEW.map((p) => [p.name, p.description ?? '']));

for (const d of ['skills', 'agents', 'workflows']) rmSync(join(PLUGIN, d), { recursive: true, force: true });
for (const d of ['skills', 'agents', 'workflows']) mkdirSync(join(PLUGIN, d), { recursive: true });
for (const s of SKILLS) {
  // agents/openai.yaml (Codex metadata) and the icon it points at are of no use to Claude Code.
  cpSync(join(up, 'plugins', s, 'skills', s), join(PLUGIN, 'skills', s), {
    recursive: true,
    filter: (src) => !['agents', 'assets'].includes(basename(src)),
  });
}
for (const f of AGENTS) cpSync(join(up, 'plugins', f), join(PLUGIN, 'agents', basename(f)));
for (const f of WORKFLOWS) cpSync(join(up, 'plugins', f), join(PLUGIN, 'workflows', basename(f)));
cpSync(join(up, 'LICENSE'), join(PLUGIN, 'LICENSE'));

for (const [rel, pattern, replacement] of REWRITES) {
  const file = join(PLUGIN, rel);
  const text = readFileSync(file, 'utf8');
  if (!pattern.test(text)) fail(`rewrite ${pattern} found nothing in ${rel} (upstream changed?)`);
  writeFileSync(file, text.replace(pattern, replacement));
}

finish('tob-picks', git('-C', up, 'rev-parse', 'HEAD'), join(PLUGIN, 'UPSTREAM'), PLUGIN);
