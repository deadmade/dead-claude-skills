// Vendor two upstream Postgres skills into the postgres database plugin: Neon's postgres-best-practices
// and Timescale pg-aiguide's postgres-database-migration. Each skill folder carries its upstream's LICENSE (and NOTICE)
// and its own UPSTREAM, since the two come from different repos. Each SKILL.md gets `paths:` frontmatter (Claude Code
// currently ignores it for plugin skills; kept for when it does not).
// Idempotent: re-running against the same upstream commits produces no diff.
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, addPaths, fail, finish, git, sparseClone } from './sync-lib.mjs';

const GLOBS = ['**/*.sql', '**/migrations/**', '**/migrate/**', '**/*.prisma', '**/alembic/**'];

const SKILLS = join(ROOT, 'plugins', 'database', 'postgres', 'skills');

const UPSTREAMS = [
  {
    url: 'https://github.com/neondatabase/postgres-skills.git',
    path: 'skills/postgres-best-practices',
    name: 'postgres-best-practices',
    extra: [],
  },
  {
    url: 'https://github.com/timescale/pg-aiguide.git',
    path: 'skills/postgres-database-migration',
    name: 'postgres-database-migration',
    extra: ['NOTICE'],
  },
];

for (const { url, path, name, extra } of UPSTREAMS) {
  const up = sparseClone(url, [path]);
  const src = join(up, path);
  if (!existsSync(join(src, 'SKILL.md'))) fail(`${url}: ${path}/SKILL.md not found`);
  // A copied symlink would point outside the plugin once installed.
  for (const f of readdirSync(src, { recursive: true })) {
    if (lstatSync(join(src, f)).isSymbolicLink()) fail(`${url}: ${path}/${f} is a symlink`);
  }

  const dest = join(SKILLS, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  for (const f of ['LICENSE', ...extra]) {
    if (!existsSync(join(up, f))) fail(`${url}: ${f} not found at the repo root`);
    cpSync(join(up, f), join(dest, f));
  }

  const out = addPaths(readFileSync(join(dest, 'SKILL.md'), 'utf8'), GLOBS);
  if (out === null) fail(`${url}: unexpected SKILL.md frontmatter (no --- block, or paths: already present)`);
  writeFileSync(join(dest, 'SKILL.md'), out);

  finish(name, git('-C', up, 'rev-parse', 'HEAD'), join(dest, 'UPSTREAM'), dest);
}
