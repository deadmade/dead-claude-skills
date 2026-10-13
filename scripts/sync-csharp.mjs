// Vendor every skill of Microsoft's dotnet/skills marketplace into plugins/languages/csharp-skills/library/, indexed by
// six C#-only router skills under skills/ (ROUTERS). Idempotent: same upstream commit, same output.
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fail, finish, frontmatterDescription, git, sparseClone, summary } from './sync-lib.mjs';

const UPSTREAM_URL = 'https://github.com/dotnet/skills.git';
const GLOBS = [
  '**/*.cs',
  '**/*.csproj',
  '**/*.sln',
  '**/*.slnx',
  '**/*.props',
  '**/*.targets',
  '**/*.razor',
  '**/*.xaml',
  '**/global.json',
];

// Router skill -> the upstream plugins whose skills it indexes. Unlisted upstream plugins land in core.
export const ROUTERS = [
  {
    name: 'core',
    description:
      "C#/.NET only. C# language semantics and refactoring, runtime diagnostics and performance, .NET 11 APIs, advanced scenarios, AI/LLM integration in .NET. Index of Microsoft's .NET skills for these.",
    plugins: ['dotnet', 'dotnet-advanced', 'dotnet11', 'dotnet-diag', 'dotnet-ai'],
  },
  {
    name: 'testing',
    description:
      "C#/.NET only. Running, writing, filtering and analyzing .NET tests (MSTest, xUnit, NUnit, TUnit), coverage, test smells, test framework migrations. Index of Microsoft's .NET skills for these.",
    plugins: ['dotnet-test', 'dotnet-test-migration'],
  },
  {
    name: 'build',
    description:
      "C#/.NET only. MSBuild and build failures, NuGet packages and central package management, upgrading .NET versions, dotnet new templates. Index of Microsoft's .NET skills for these.",
    plugins: ['dotnet-msbuild', 'dotnet-nuget', 'dotnet-upgrade', 'dotnet-template-engine'],
  },
  {
    name: 'web',
    description:
      "C#/.NET only. ASP.NET Core (middleware, endpoints, minimal APIs, real-time) and Blazor components and interactivity. Index of Microsoft's .NET skills for these.",
    plugins: ['dotnet-aspnetcore', 'dotnet-blazor'],
  },
  {
    name: 'data',
    description:
      "C#/.NET only. Entity Framework Core and .NET data access. Index of Microsoft's .NET skills for these.",
    plugins: ['dotnet-data'],
  },
  {
    name: 'desktop',
    description:
      "C#/.NET only. .NET MAUI and Windows Forms apps: setup, layout, data binding, navigation, diagnostics. Index of Microsoft's .NET skills for these.",
    plugins: ['dotnet-maui', 'dotnet-winforms'],
  },
];

export const assignRouter = (plugin) => ROUTERS.find((r) => r.plugins.includes(plugin))?.name ?? 'core';

export function renderRouter({ name, description, entries }) {
  const rows = [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(
      (e) =>
        `| ${e.name} | ${e.summary.replaceAll('|', '\\|')} | \`\${CLAUDE_PLUGIN_ROOT}/library/${e.name}/SKILL.md\` |`,
    );
  return [
    '---',
    `name: ${name}`,
    `description: "${description}"`,
    'paths:',
    ...GLOBS.map((g) => `  - "${g}"`),
    '---',
    '',
    `# C#/.NET skills: ${name}`,
    '',
    "Microsoft's .NET skills for this area (vendored from dotnet/skills). Pick the one that matches the task, read its",
    'SKILL.md with the Read tool, and follow it. When a skill names another skill, read',
    '`${CLAUDE_PLUGIN_ROOT}/library/<that-name>/SKILL.md`.',
    '',
    '| Skill | Use for | Path |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

const frontmatter = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
export const isHidden = (text) => /^disable-model-invocation:\s*true\s*$/m.test(frontmatter(text));
const fmName = (text) => /^name:\s*['"]?([^'"\r\n]*?)['"]?\s*$/m.exec(frontmatter(text))?.[1];

const INSTALLED =
  'All of these skills are already installed in the csharp-skills plugin, reached through its router skills ' +
  '(csharp-skills:core, :testing, :build, :web, :data, :desktop). Each one is at `../<skill>/SKILL.md` relative to ' +
  'this skill.';
// Prepended to csharp-expert, which upstream wrote as an install guide for a marketplace of separate plugins.
const note = (path) =>
  '**In the csharp-skills plugin:** every specialist named here is already installed. Specialists are not listed in ' +
  '/skills; find them in the csharp-skills router indexes (csharp-skills:core, :testing, :build, :web, :data, ' +
  `:desktop) or read \`${path}<skill>/SKILL.md\`. Ignore any install, marketplace, restart or reload steps below.`;
// [file under library/, pattern, replacement]. Each must match, so an upstream rewording fails the sync.
const REWRITES = [
  ['csharp-expert/SKILL.md', /^---\n[\s\S]*?\n---\n/, (fm) => `${fm}\n${note('../')}\n`],
  [
    'csharp-expert/references/dotnet-skills-marketplace.md',
    /^# dotnet\/skills Marketplace\n/,
    (h) => `${h}\n${note('../../')}\n`,
  ],
  [
    'csharp-expert/SKILL.md',
    /^([^\n]*:\n\n)?```text\n(\/plugin marketplace add dotnet\/skills\n)?\/plugin install <plugin>@dotnet-agent-skills\n```/gm,
    INSTALLED,
  ],
  [
    'csharp-expert/SKILL.md',
    /^- The marketplace name is `dotnet-agent-skills`; the source repository is `dotnet\/skills`\.$/gm,
    `- ${INSTALLED}`,
  ],
  [
    'csharp-expert/references/dotnet-skills-marketplace.md',
    /^([^\n]*:\n\n)?```text\n(\/plugin marketplace add dotnet\/skills\n)?\/plugin install <plugin>@dotnet-agent-skills\n```/gm,
    INSTALLED,
  ],
  [
    'csharp-expert/references/dotnet-skills-marketplace.md',
    // The "restart after installation" paragraph and the update block; INSTALLED already precedes them.
    /^Restart the host after installation[\s\S]*?\n```text\n\/plugin update <plugin>@dotnet-agent-skills\n```\n\n/m,
    '',
  ],
  [
    'csharp-expert/references/dotnet-skills-marketplace.md',
    /^Register the marketplace:\n\n```text\ncodex plugin marketplace add dotnet\/skills\n```\n\nLaunch Codex[\s\S]*?\ncodex plugin marketplace upgrade dotnet-agent-skills\n```/gm,
    INSTALLED,
  ],
];
// Index summaries that replace a skill's own description in the router.
export const SUMMARY_OVERRIDES = {
  'csharp-expert': 'C# semantics, and routing to the right specialist skill in this plugin.',
};
export const entrySummary = (name, desc) => SUMMARY_OVERRIDES[name] ?? summary(desc);

// Upstream plugin.json keys for parts we don't vendor.
const UNVENDORED = ['agents', 'mcpServers', 'lspServers', 'hooks', 'commands'];

const PLUGIN = join(ROOT, 'plugins', 'languages', 'csharp-skills');
const LIBRARY = join(PLUGIN, 'library');

function report(line) {
  console.log(line);
  if (process.env.SYNC_REPORT) appendFileSync(process.env.SYNC_REPORT, line + '\n');
}

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

function main() {
  // 1. Clone.
  const up = sparseClone(UPSTREAM_URL, ['.claude-plugin', 'plugins']);
  const plugins = JSON.parse(readFileSync(join(up, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins ?? [];
  if (!plugins.length) fail('upstream marketplace lists no plugins');

  // 2. Collect skills: name -> { plugin, src }.
  const skills = new Map();
  for (const { name: plugin } of plugins) {
    const dir = join(up, 'plugins', plugin, 'skills');
    if (!existsSync(dir)) fail(`upstream plugins/${plugin} has no skills/`);
    for (const name of readdirSync(dir)) {
      const md = join(dir, name, 'SKILL.md');
      if (!existsSync(md)) fail(`upstream plugins/${plugin}/skills/${name}/SKILL.md not found`);
      const text = readFileSync(md, 'utf8');
      if (fmName(text) !== name) fail(`plugins/${plugin}/skills/${name}/SKILL.md: name is "${fmName(text)}"`);
      if (frontmatterDescription(text) === null)
        fail(`plugins/${plugin}/skills/${name}/SKILL.md: unsupported description form`);
      if (skills.has(name)) fail(`skill ${name} is in both ${skills.get(name).plugin} and ${plugin}`);
      skills.set(name, { plugin, src: join(dir, name) });
    }
  }

  // 3. Diff against the last sync.
  const old = new Set(existsSync(LIBRARY) ? readdirSync(LIBRARY) : []);
  for (const n of [...skills.keys()].sort()) if (!old.has(n)) report(`added: ${n}`);
  for (const n of [...old].sort()) if (!skills.has(n)) report(`removed: ${n}`);

  // 4. Report what isn't vendored.
  const agents = [];
  for (const { name: plugin } of plugins) {
    const manifest = JSON.parse(readFileSync(join(up, 'plugins', plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
    const keys = UNVENDORED.filter((k) => k in manifest);
    if (keys.length) report(`skipped: ${plugin}: ${keys.join(', ')} not vendored`);
    if (!ROUTERS.some((r) => r.plugins.includes(plugin))) report(`unmapped (→ core): ${plugin}`);
    const agentDir = join(up, 'plugins', plugin, 'agents');
    if (existsSync(agentDir))
      for (const f of readdirSync(agentDir).filter((f) => f.endsWith('.agent.md')))
        agents.push(fmName(readFileSync(join(agentDir, f), 'utf8')) ?? fail(`plugins/${plugin}/agents/${f}: no name`));
  }

  // 5. Copy.
  for (const d of ['library', 'skills']) rmSync(join(PLUGIN, d), { recursive: true, force: true });
  mkdirSync(LIBRARY, { recursive: true });
  for (const [name, { src }] of skills) cpSync(src, join(LIBRARY, name), { recursive: true });

  // 6. Rewrites.
  for (const [rel, pattern, replacement] of REWRITES) {
    const file = join(LIBRARY, rel);
    const text = readFileSync(file, 'utf8');
    if (!pattern.test(text)) fail(`rewrite ${pattern} found nothing in library/${rel} (upstream changed?)`);
    writeFileSync(file, text.replace(pattern, replacement));
  }

  // 7. Agent mentions. Hyphens count as word characters, since agent names are hyphenated.
  const mentionPatterns = agents
    .sort()
    .map((a) => [
      a,
      a === 'msbuild' ? /`msbuild` agent|dotnet-msbuild:msbuild\b/ : new RegExp(`(?<![\\w-])${a}(?![\\w-])`),
    ]);
  const files = listFiles(LIBRARY).sort();
  for (const [a, re] of mentionPatterns)
    for (const f of files)
      if (re.test(readFileSync(f, 'utf8')))
        report(`mentions skipped agent ${a}: ${relative(PLUGIN, f).split(sep).join('/')}`);

  // 8. Routers.
  for (const r of ROUTERS) {
    const entries = [];
    for (const name of readdirSync(LIBRARY)) {
      if (assignRouter(skills.get(name).plugin) !== r.name) continue;
      const text = readFileSync(join(LIBRARY, name, 'SKILL.md'), 'utf8');
      if (!isHidden(text)) entries.push({ name, summary: entrySummary(name, frontmatterDescription(text)) });
    }
    mkdirSync(join(PLUGIN, 'skills', r.name), { recursive: true });
    writeFileSync(join(PLUGIN, 'skills', r.name, 'SKILL.md'), renderRouter({ ...r, entries }));
  }

  // 9. Finish.
  cpSync(join(up, 'LICENSE'), join(PLUGIN, 'LICENSE'));
  finish('csharp-skills', git('-C', up, 'rev-parse', 'HEAD'), join(PLUGIN, 'UPSTREAM'), PLUGIN);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
