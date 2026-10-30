// Every upstream the weekly sync workflow (.github/workflows/sync.yml) vendors: the script that syncs it, what its PR
// adds, the checks its result must pass (`check` gets the script's own GITHUB_OUTPUT values and returns what the
// title and body need), and its PR and new-skill issue text. scripts/sync.mjs runs one entry.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './sync-lib.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

// Each of `paths` parses as JSON; the marketplace always, since every sync can break it.
export function json(...paths) {
  for (const p of ['.claude-plugin/marketplace.json', ...paths]) JSON.parse(read(p));
}

export function exists(path, { nonEmpty = false } = {}) {
  assert(existsSync(join(ROOT, path)), `${path} is missing`);
  if (nonEmpty) assert(read(path).length > 0, `${path} is empty`);
}

// SKILL.md files exactly one folder below `dir`.
export function skillCount(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).filter(
    (d) => d.isDirectory() && existsSync(join(ROOT, dir, d.name, 'SKILL.md')),
  ).length;
}

export function count(what, n, want) {
  assert(n === want, `expected ${want} ${what}, found ${n}`);
}

export const upstream = (path) => read(path).trim();

const sha7 = (sha) => sha.slice(0, 7);
const CC = '\ncc @deadmade\n';

// A plain commit-pinned upstream: `<label> to <sha>` and a one-line body naming what was synced from where.
const commitPr = (label, what, repo) => ({
  title: ({ sha }) => `Sync ${label} to ${sha}`,
  body: ({ sha }) =>
    `Automated sync of ${what} from https://github.com/${repo} at\nhttps://github.com/${repo}/commit/${sha}.\n${CC}`,
});

const RELEASE = (name) => ({
  name,
  script: 'sync-release.mjs',
  args: [name],
  paths: [`plugins/flows/packs/${name}`],
  bodyFrom: 'script',
  check: (out) => {
    json(`plugins/flows/packs/${name}/.claude-plugin/plugin.json`);
    assert(out.tag, 'sync-release.mjs reported no tag');
    return { tag: out.tag };
  },
  title: ({ tag }) => `Sync ${name} to ${tag}`,
});

export const SOURCES = [
  {
    name: 'agent-browser',
    script: 'sync-agent-browser.mjs',
    paths: ['installer/assets/agent-browser.json'],
    scan: false,
    check: () => {
      const { upstream: tag, sha256 } = JSON.parse(read('installer/assets/agent-browser.json'));
      assert(Object.keys(sha256).length > 0, 'agent-browser.json pins no sha256');
      return { tag };
    },
    title: ({ tag }) => `Pin agent-browser to ${tag}`,
    body: ({ tag }) =>
      `Bumps installer/assets/agent-browser.json to https://github.com/vercel-labs/agent-browser/releases/tag/v${tag}\n` +
      `and pins its Windows and Linux binaries' sha256. The installer downloads this version for web-mcp users.\n${CC}`,
  },
  {
    name: 'uv',
    script: 'sync-uv.mjs',
    paths: ['installer/assets/uv.json'],
    scan: false,
    check: () => {
      const { upstream: tag, sha256 } = JSON.parse(read('installer/assets/uv.json'));
      assert(/^\d+\.\d+\.\d+$/.test(tag), `uv.json pins no semver upstream: ${tag}`);
      for (const key of ['win32-x64', 'linux-x64'])
        assert(/^[0-9a-f]{64}$/.test(sha256?.[key] ?? ''), `uv.json has no sha256 for ${key}`);
      return { tag };
    },
    title: ({ tag }) => `Pin uv to ${tag}`,
    body: ({ tag }) =>
      `Bumps installer/assets/uv.json to https://github.com/astral-sh/uv/releases/tag/${tag}\n` +
      `and pins its Windows and Linux archives' sha256. The installer downloads this uv for headroom-trim users.\n${CC}`,
  },
  {
    name: 'csharp-skills',
    script: 'sync-csharp.mjs',
    paths: ['plugins/opt-in/implementation/csharp-skills'],
    bodyFrom: 'report',
    check: () => {
      const d = 'plugins/opt-in/implementation/csharp-skills';
      json(`${d}/.claude-plugin/plugin.json`);
      count('router skills', skillCount(`${d}/skills`), 6);
      const library = skillCount(`${d}/library`);
      assert(library >= 90, `expected at least 90 library skills, found ${library}`);
      return { sha: upstream(`${d}/UPSTREAM`) };
    },
    title: ({ sha }) => `Sync csharp-skills to ${sha}`,
    body: ({ sha }, report) =>
      `Automated sync of https://github.com/dotnet/skills at https://github.com/dotnet/skills/commit/${sha}.\n\n` +
      'Sync report (added/removed skills, plugin parts not vendored, unmapped plugins, mentions of skipped agents):\n\n' +
      '```text\n' +
      report +
      '```\n' +
      CC,
  },
  {
    name: 'graphify',
    script: 'sync-graphify.mjs',
    paths: ['plugins/shared/graphify'],
    check: () => {
      const d = 'plugins/shared/graphify';
      json(`${d}/.claude-plugin/plugin.json`, `${d}/hooks/hooks.json`);
      exists(`${d}/skills/graphify/SKILL.md`);
      const refs = readdirSync(join(ROOT, d, 'skills/graphify/references')).filter((f) => f.endsWith('.md'));
      count('graphify references', refs.length, 8);
      return { sha: upstream(`${d}/UPSTREAM`) };
    },
    ...commitPr('graphify', 'the graphify Claude Code skill', 'Graphify-Labs/graphify'),
  },
  {
    name: 'hallmark',
    script: 'sync-hallmark.mjs',
    paths: ['plugins/opt-in/hallmark/skills/hallmark'],
    check: () => {
      const d = 'plugins/opt-in/hallmark';
      json(`${d}/.claude-plugin/plugin.json`);
      const head = read(`${d}/skills/hallmark/SKILL.md`).split('\n').slice(0, 10);
      assert(
        head.some((l) => l.startsWith('description: "WEB FRONTEND ONLY:')),
        'hallmark SKILL.md lost its WEB FRONTEND ONLY description',
      );
      return { sha: upstream(`${d}/skills/hallmark/UPSTREAM`) };
    },
    ...commitPr('hallmark', '`skills/hallmark`', 'nutlope/hallmark'),
  },
  {
    name: 'mattpocock-picks',
    script: 'sync-mattpocock.mjs',
    paths: ['plugins/flows/packs/mattpocock-picks'],
    check: () => {
      const d = 'plugins/flows/packs/mattpocock-picks';
      json(`${d}/.claude-plugin/plugin.json`);
      count('mattpocock-picks skills', skillCount(`${d}/skills`), 13);
      return { sha: upstream(`${d}/UPSTREAM`) };
    },
    ...commitPr('mattpocock-picks', 'the curated skills', 'mattpocock/skills'),
    newSkills: {
      title: (name) => `New upstream skill in mattpocock/skills: ${name}`,
      lead: (skill) => `mattpocock/skills now publishes \`${skill}\`, which is neither vendored nor skipped.`,
      source: (skill) => `https://github.com/mattpocock/skills/tree/main/skills/${skill}`,
      script: 'scripts/sync-mattpocock.mjs',
      include: (skill) => `add \`${skill}\` to \`SKILLS\``,
      overlap: 'superpowers',
    },
  },
  {
    name: 'paper-lookup',
    script: 'sync-paper-lookup.mjs',
    paths: ['plugins/flows/packs/paper-lookup/skills/paper-lookup'],
    check: () => {
      const d = 'plugins/flows/packs/paper-lookup';
      json(`${d}/.claude-plugin/plugin.json`);
      exists(`${d}/skills/paper-lookup/SKILL.md`, { nonEmpty: true });
      assert(
        !read(`${d}/skills/paper-lookup/SKILL.md`).includes('Citing Scientific Agent Skills'),
        'paper-lookup SKILL.md still carries the citation section',
      );
      return { sha: upstream(`${d}/skills/paper-lookup/UPSTREAM`) };
    },
    ...commitPr('paper-lookup', '`skills/paper-lookup`', 'K-Dense-AI/scientific-agent-skills'),
  },
  {
    name: 'postgres',
    script: 'sync-postgres.mjs',
    paths: ['plugins/opt-in/implementation/postgres'],
    check: () => {
      const d = 'plugins/opt-in/implementation/postgres';
      json(`${d}/.claude-plugin/plugin.json`);
      exists(`${d}/skills/postgres-best-practices/SKILL.md`, { nonEmpty: true });
      exists(`${d}/skills/postgres-database-migration/SKILL.md`, { nonEmpty: true });
      return {
        neon: upstream(`${d}/skills/postgres-best-practices/UPSTREAM`),
        pgai: upstream(`${d}/skills/postgres-database-migration/UPSTREAM`),
      };
    },
    title: ({ neon, pgai }) => `Sync postgres to neon ${sha7(neon)}, pg-aiguide ${sha7(pgai)}`,
    body: ({ neon, pgai }) =>
      "Automated sync of the postgres plugin's vendored skills:\n\n" +
      '- `skills/postgres-best-practices` from https://github.com/neondatabase/postgres-skills at\n' +
      `  https://github.com/neondatabase/postgres-skills/commit/${neon}\n` +
      '- `skills/postgres-database-migration` from https://github.com/timescale/pg-aiguide at\n' +
      `  https://github.com/timescale/pg-aiguide/commit/${pgai}\n` +
      CC,
  },
  {
    name: 'pstack-picks',
    script: 'sync-pstack.mjs',
    paths: ['plugins/flows/packs/pstack-picks'],
    check: () => {
      const d = 'plugins/flows/packs/pstack-picks';
      json(`${d}/.claude-plugin/plugin.json`);
      count('pstack-picks skills', skillCount(`${d}/skills`), 16);
      exists(`${d}/agents/comment-sicko.md`);
      return { sha: upstream(`${d}/UPSTREAM`) };
    },
    title: ({ sha }) => `Sync pstack-picks to ${sha}`,
    body: ({ sha }) =>
      'Automated sync of the curated pstack skills from https://github.com/cursor/plugins at\n' +
      `https://github.com/cursor/plugins/commit/${sha}, with the Claude Code\n` +
      'rewrites from `scripts/sync-pstack.mjs` applied and the Cursor-ism guard passing.\n' +
      CC,
    newSkills: {
      title: (name) => `New upstream skill in cursor/plugins pstack: ${name}`,
      lead: (skill) => `pstack now has \`${skill}\`, which is neither vendored nor skipped.`,
      source: (skill) => `https://github.com/cursor/plugins/tree/main/pstack/skills/${skill}`,
      script: 'scripts/sync-pstack.mjs',
      include: (skill) => `add \`${skill}\` to \`SKILLS\``,
      after: 'If the guard reports Cursor-specific text, add a rule to `REWRITES` in the same script.',
      overlap: 'superpowers and mattpocock-picks',
    },
  },
  RELEASE('ponytail'),
  RELEASE('superpowers'),
  {
    name: 'rust-skills',
    script: 'sync-rust.mjs',
    paths: ['plugins/opt-in/implementation/rust-skills'],
    check: () => {
      const d = 'plugins/opt-in/implementation/rust-skills';
      json(`${d}/.claude-plugin/plugin.json`);
      assert(
        /^paths:/m.test(read(`${d}/skills/rust-best-practices/SKILL.md`)),
        'rust-best-practices SKILL.md has no paths:',
      );
      return { sha: upstream(`${d}/UPSTREAM`) };
    },
    ...commitPr('rust-skills', '`skills/rust-best-practices`', 'apollographql/skills'),
  },
  {
    name: 'security-audit',
    script: 'sync-security-audit.mjs',
    paths: ['plugins/flows/packs/security-audit'],
    check: () => {
      const d = 'plugins/flows/packs/security-audit';
      json(`${d}/.claude-plugin/plugin.json`);
      exists(`${d}/skills/security-audit/SKILL.md`, { nonEmpty: true });
      return { sha: upstream(`${d}/UPSTREAM`) };
    },
    ...commitPr('security-audit', 'the security-audit skill', 'cloudflare/security-audit-skill'),
  },
  {
    name: 'self-review',
    script: 'sync-self-review.mjs',
    paths: ['plugins/flows/skills/self-review', 'plugins/flows/agents'],
    check: () => {
      const s = 'plugins/flows/skills/self-review';
      json('plugins/flows/.claude-plugin/plugin.json');
      const ours = readdirSync(join(ROOT, 'plugins/flows/agents')).filter(
        (f) => f.endsWith('.md') && read(`plugins/flows/agents/${f}`).includes('by scripts/sync-self-review.mjs.'),
      );
      count('self-review agents', ours.length, 5);
      exists(`${s}/references/upstream/code-review.md`);
      exists(`${s}/references/upstream/spec-standards-review.md`);
      const shas = Object.fromEntries(
        upstream(`${s}/UPSTREAM`)
          .split('\n')
          .map((l) => l.split(/\s+/)),
      );
      const official = shas['anthropics/claude-plugins-official'];
      const matt = shas['mattpocock/skills'];
      assert(official && matt, `${s}/UPSTREAM lacks a commit`);
      return { official, matt };
    },
    commitMessage: ({ official, matt }) =>
      `Sync self-review to claude-plugins-official ${official} and mattpocock/skills ${matt}`,
    title: () => 'Sync self-review upstreams',
    body: ({ official, matt }) =>
      'Automated sync of the review passes /self-review runs, vendored in plugins/flows:\n' +
      `- https://github.com/anthropics/claude-plugins-official/commit/${official}\n` +
      '  (code-review command, pr-review-toolkit agents)\n' +
      `- https://github.com/mattpocock/skills/commit/${matt} (engineering/code-review)\n` +
      CC,
  },
  {
    name: 'tob-picks',
    script: 'sync-tob.mjs',
    paths: ['plugins/flows/packs/tob-picks', 'plugins/flows/agents/spec-compliance-checker.md'],
    check: () => {
      const d = 'plugins/flows/packs/tob-picks';
      json(`${d}/.claude-plugin/plugin.json`);
      count('tob-picks skills', skillCount(`${d}/skills`), 4);
      return { sha: upstream(`${d}/UPSTREAM`) };
    },
    ...commitPr('tob-picks', 'the curated skills', 'trailofbits/skills'),
    newSkills: {
      title: (name) => `New upstream skill in trailofbits/skills: ${name}`,
      lead: (skill) => `trailofbits/skills now publishes \`${skill}\`, which is neither vendored nor skipped.`,
      source: (skill) => `https://github.com/trailofbits/skills/tree/main/plugins/${skill}`,
      script: 'scripts/sync-tob.mjs',
      include: (skill) => `add \`${skill}\` to \`SKILLS\` (its agents and workflows to \`AGENTS\`/\`WORKFLOWS\`)`,
      overlap: 'self-review, superpowers and the other picks',
    },
  },
];
