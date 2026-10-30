// Pin installer/assets/agent-browser.json to vercel-labs/agent-browser's newest release, with its Windows and Linux
// binaries' sha256 from the release's asset digests. Needs `gh` and a Node that strips types (it imports the installer).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_BROWSER_FILES } from '../installer/core/binaries.ts';
import { ROOT, fail } from './sync-lib.mjs';

const release = JSON.parse(
  execFileSync('gh', ['api', 'repos/vercel-labs/agent-browser/releases/latest'], { encoding: 'utf8' }),
);
const tag = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
if (!tag) fail(`unexpected tag ${release.tag_name}`);
const sha256 = Object.fromEntries(
  Object.entries(AGENT_BROWSER_FILES).map(([key, file]) => {
    const digest = /^sha256:([0-9a-f]{64})$/.exec(release.assets.find((a) => a.name === file)?.digest ?? '')?.[1];
    if (!digest) fail(`no sha256 digest for ${file}`);
    return [key, digest];
  }),
);
writeFileSync(
  join(ROOT, 'installer', 'assets', 'agent-browser.json'),
  JSON.stringify({ upstream: tag, sha256 }, null, 2) + '\n',
);
console.log(`agent-browser pinned to ${tag}`);
