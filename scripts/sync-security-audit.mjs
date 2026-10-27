// Vendor cloudflare/security-audit-skill's security-audit skill, unchanged, into plugins/flows/packs/security-audit/.
// /harden reads its domain files ("When to use this file") and its candidate-verifier prompt by path.
// Idempotent: re-running against the same upstream commit produces no diff.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fail, finish, git, sparseClone } from './sync-lib.mjs';

const UPSTREAM_URL = 'https://github.com/cloudflare/security-audit-skill.git';
const PLUGIN = join(ROOT, 'plugins', 'flows', 'packs', 'security-audit');
const DEST = join(PLUGIN, 'skills', 'security-audit');

const up = sparseClone(UPSTREAM_URL, ['skills/security-audit']);
const src = join(up, 'skills', 'security-audit');
if (!existsSync(join(src, 'SKILL.md'))) fail('upstream skills/security-audit/SKILL.md not found (renamed or removed?)');

rmSync(DEST, { recursive: true, force: true });
cpSync(src, DEST, { recursive: true });
cpSync(join(up, 'LICENSE'), join(PLUGIN, 'LICENSE'));

finish('security-audit', git('-C', up, 'rev-parse', 'HEAD'), join(PLUGIN, 'UPSTREAM'), PLUGIN);
