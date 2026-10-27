// Vendor nutlope/hallmark's skill into its own plugin and scope it to web files via its description.
// Only the skill itself ships: upstream's installers, the settings.json lint hook, Together AI image generation (the
// comp step and generated stills), the theme-picture renderer, its dev checks and fixtures, and the Codex adapter are
// deleted, along with the text that points at them.
// Idempotent: re-running against the same upstream commit produces no diff.
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fail, finish, git, sparseClone } from './sync-lib.mjs';

const UPSTREAM_URL = 'https://github.com/nutlope/hallmark.git';
// Prefixed to the description to keep the skill out of non-web work. Must not contain double quotes
// (it lands inside a double-quoted YAML string). `paths:` frontmatter would be the cleaner fix, but
// Claude Code ignores it for plugin skills (verified on 2.1.272; it only works for project skills).
const SCOPE =
  'WEB FRONTEND ONLY: use solely for browser UI work (HTML/CSS, React/Vue/Svelte/Astro pages and components); never for CLIs, backends, libraries, or non-web apps (e.g. Rust, Python, Go), even when asked for a new app.';

const DEST = join(ROOT, 'plugins', 'opt-in', 'hallmark', 'skills', 'hallmark');

export const DROPPED = [
  'agents',
  'references/comp.md',
  'scripts/fixtures',
  'scripts/imagegen.mjs',
  'scripts/install.mjs',
  'scripts/install-hook.mjs',
  'scripts/lint-hook.mjs',
  'scripts/picture.mjs',
  'scripts/refcheck.mjs',
];

// Per file, the text that points at a dropped part. A pattern that stops matching upstream leaves a mention that
// LEFTOVER catches, so the sync fails instead of shipping a dangling instruction.
const EDITS = {
  'SKILL.md': [
    [/^\*\*Powered by Together AI\.\*\*\n\n/m, ''],
    [/; `TOGETHER_API_KEY` set \([^)]*\)/, ''],
    [/ · `comp\.md` on signal 9 \([^)]*\)/, ''],
    [/ On signal 9, `comp\.md` runs here\./, ''],
    [/, comp before build/, ''],
    [/ and the edit-time hook\./, '.'],
  ],
  'references/flow.md': [
    [/\n## (Edit-time linting|Comp before build[^\n]*)\n[\s\S]*?(?=\n## )/g, ''],
    [/, which sloplint and the edit-time hook read as/, ', which sloplint reads as'],
    [/^\| Edit-time hook \|.*\n/m, ''],
    [/; `imagegen\.mjs` needs an explicit ask and an approval/, ''],
    [/, `picture\.mjs`/, ''],
  ],
  'references/imagery.md': [
    [/^5\. \*\*Generated stills\*\*.*\n6\. /m, '5. '],
    [/\n## 6\. Generated stills\n[\s\S]*?(?=\n## )/, ''],
  ],
};
const LEFTOVER =
  /comp\.md|[Cc]omp before build|signal 9|imagegen|TOGETHER_API_KEY|Together AI|[Gg]enerated still|install(-hook)?\.mjs|lint-hook|[Ee]dit-time|refcheck|picture\.mjs/;

// In the first frontmatter block (which must name the skill `hallmark`): prefix the description with SCOPE.
// Returns null when the frontmatter isn't shaped as expected.
function scopeDescription(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  let named = false;
  let described = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---') return named && described ? lines.join('\n') : null;
    if (/^name:\s*hallmark\s*$/.test(line)) {
      named = true;
    } else if (/^description:\s*"/.test(line)) {
      lines[i] = line.replace(/^description:\s*"/, () => `description: "${SCOPE} `);
      described = true;
    } else if (/^description:\s*[^"|>\s]/.test(line)) {
      const v = line.replace(/^description:\s*/, '').replaceAll('"', '\\"');
      lines[i] = `description: "${SCOPE} ${v}"`;
      described = true;
    }
  }
  return null;
}

// Applies EDITS to one file's text; returns it with the line numbers of any mention of a dropped part still left.
export function trim(file, text) {
  const out = (EDITS[file] ?? []).reduce((t, [re, to]) => t.replace(re, to), text);
  const left = out.split('\n').flatMap((l, i) => (LEFTOVER.test(l) ? [i + 1] : []));
  return { out, left };
}

function main() {
  const up = sparseClone(UPSTREAM_URL, ['skills/hallmark']);
  const SRC = join(up, 'skills', 'hallmark');
  if (!existsSync(join(SRC, 'SKILL.md'))) fail('upstream skills/hallmark/SKILL.md not found');
  // A copied symlink would point outside the plugin once installed.
  for (const f of readdirSync(SRC, { recursive: true })) {
    if (lstatSync(join(SRC, f)).isSymbolicLink()) fail(`upstream skills/hallmark/${f} is a symlink`);
  }

  rmSync(DEST, { recursive: true, force: true });
  cpSync(SRC, DEST, { recursive: true });
  cpSync(join(up, 'LICENSE'), join(DEST, 'LICENSE'));
  for (const f of DROPPED) rmSync(join(DEST, f), { recursive: true, force: true });

  // Every Markdown file the skill reads (themes/README.md only documents how upstream builds the themes).
  const docs = [
    'SKILL.md',
    ...readdirSync(join(DEST, 'references'), { recursive: true })
      .filter((f) => f.endsWith('.md') && f !== join('themes', 'README.md'))
      .map((f) => join('references', f).replaceAll('\\', '/')),
  ];
  for (const f of docs) {
    const { out, left } = trim(f, readFileSync(join(DEST, f), 'utf8'));
    if (left.length)
      fail(`${f} still mentions a dropped part on line ${left.join(', ')}; update EDITS in sync-hallmark.mjs`);
    writeFileSync(join(DEST, f), out);
  }

  const scoped = scopeDescription(readFileSync(join(DEST, 'SKILL.md'), 'utf8'));
  if (scoped === null) fail("unexpected SKILL.md frontmatter upstream (missing --- block or 'name: hallmark')");
  writeFileSync(join(DEST, 'SKILL.md'), scoped);

  finish('hallmark', git('-C', up, 'rev-parse', 'HEAD'), join(DEST, 'UPSTREAM'), DEST);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
