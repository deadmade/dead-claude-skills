// Vendor K-Dense-AI/scientific-agent-skills' paper-lookup skill into its own plugin, minus its
// "Citing Scientific Agent Skills" section (it asks Claude to cite upstream's paper in the user's work).
// Idempotent: re-running against the same upstream commit produces no diff.
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, finish, git, sparseClone } from './sync-lib.mjs';

const UPSTREAM_URL = 'https://github.com/K-Dense-AI/scientific-agent-skills.git';
const DEST = join(ROOT, 'plugins', 'paper-lookup', 'skills', 'paper-lookup');

const up = sparseClone(UPSTREAM_URL, ['skills/paper-lookup']);
const SRC = join(up, 'skills', 'paper-lookup');
if (!existsSync(join(SRC, 'SKILL.md'))) fail('upstream skills/paper-lookup/SKILL.md not found');
// A copied symlink would point outside the plugin once installed.
for (const f of readdirSync(SRC, { recursive: true })) {
  if (lstatSync(join(SRC, f)).isSymbolicLink()) fail(`upstream skills/paper-lookup/${f} is a symlink`);
}

rmSync(DEST, { recursive: true, force: true });
cpSync(SRC, DEST, { recursive: true });
cpSync(join(up, 'LICENSE.md'), join(DEST, 'LICENSE.md'));

const skill = readFileSync(join(DEST, 'SKILL.md'), 'utf8');
const out = skill.replace(/\n## Citing Scientific Agent Skills\n[\s\S]*?(?=\n## |$)/, '').trimEnd() + '\n';
if (out.includes('Citing Scientific Agent Skills')) fail('could not strip the citing section from SKILL.md');
writeFileSync(join(DEST, 'SKILL.md'), out);

finish('paper-lookup', git('-C', up, 'rev-parse', 'HEAD'), join(DEST, 'UPSTREAM'), DEST);
