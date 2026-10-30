// Pin installer/assets/agent-browser.json to vercel-labs/agent-browser's newest release, with its Windows and Linux
// binaries' sha256 from the release's asset digests. Needs `gh` and a Node that strips types (it imports the installer).
import { AGENT_BROWSER_FILES } from '../installer/core/binaries.ts';
import { syncPin } from './sync-lib.mjs';

syncPin({
  repo: 'vercel-labs/agent-browser',
  files: AGENT_BROWSER_FILES,
  out: 'installer/assets/agent-browser.json',
  tagPattern: /^v(\d+\.\d+\.\d+)$/,
});
