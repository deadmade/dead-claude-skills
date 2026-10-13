// Vendor the prompt and commit secret scanners (lite variant) from dwarvesf/claude-guardrails, unmodified.
// The scripts find their patterns at ../patterns, so the layout is kept. Idempotent.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, finish, git, sparseClone } from './sync-lib.mjs';

const UPSTREAM_URL = 'https://github.com/dwarvesf/claude-guardrails.git';
const DEST = join(ROOT, 'plugins', 'secret-scan');
const FILES = [
  ['lite/scan-secrets.sh', 'scripts/scan-secrets.sh'],
  ['lite/scan-commit.sh', 'scripts/scan-commit.sh'],
  ['patterns/secrets.json', 'patterns/secrets.json'],
  ['patterns/bip39-english.txt', 'patterns/bip39-english.txt'],
  ['LICENSE', 'LICENSE'],
];

const up = sparseClone(UPSTREAM_URL, ['lite', 'patterns']);
for (const [from] of FILES) if (!existsSync(join(up, from))) fail(`upstream ${from} not found`);

for (const dir of ['scripts', 'patterns']) rmSync(join(DEST, dir), { recursive: true, force: true });
for (const [from, to] of FILES) cpSync(join(up, from), join(DEST, to));

finish('secret-scan', git('-C', up, 'rev-parse', 'HEAD'), join(DEST, 'UPSTREAM'), DEST);
