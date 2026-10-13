// Vendor apollographql/skills' rust-best-practices skill into its own plugin, adding `paths:` frontmatter (Claude Code currently ignores it for plugin skills; kept for when it does not).
// Idempotent: re-running against the same upstream commit produces no diff.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, finish, git, sparseClone } from './sync-lib.mjs';

const UPSTREAM_URL = 'https://github.com/apollographql/skills.git';
const GLOBS = ['**/*.rs', '**/Cargo.toml', '**/Cargo.lock'];

const PLUGIN = join(ROOT, 'plugins', 'languages', 'rust-skills');
const DEST = join(PLUGIN, 'skills', 'rust-best-practices');

// Insert a `paths:` list before the closing `---` of the first frontmatter block.
// Returns null when there is no frontmatter or `paths:` is already present.
function addPaths(text, globs) {
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

const up = sparseClone(UPSTREAM_URL, ['skills/rust-best-practices']);
const SRC = join(up, 'skills', 'rust-best-practices');
if (!existsSync(join(SRC, 'SKILL.md'))) fail('upstream skills/rust-best-practices/SKILL.md not found');

rmSync(join(PLUGIN, 'skills'), { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });
cpSync(join(up, 'LICENSE'), join(PLUGIN, 'LICENSE'));

const out = addPaths(readFileSync(join(DEST, 'SKILL.md'), 'utf8'), GLOBS);
if (out === null) fail('unexpected SKILL.md frontmatter upstream (no --- block, or paths: already present)');
writeFileSync(join(DEST, 'SKILL.md'), out);

finish('rust-skills', git('-C', up, 'rev-parse', 'HEAD'), join(PLUGIN, 'UPSTREAM'), PLUGIN);
