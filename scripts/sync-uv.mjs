// Pin installer/assets/uv.json to astral-sh/uv's newest release, with its Windows and Linux archives' sha256 from the
// release's asset digests. Needs `gh` and a Node that strips types (it imports the installer).
import { UV_FILES } from '../installer/core/binaries.ts';
import { syncPin } from './sync-lib.mjs';

syncPin({
  repo: 'astral-sh/uv',
  files: Object.fromEntries(Object.entries(UV_FILES).map(([key, { file }]) => [key, file])),
  out: 'installer/assets/uv.json',
  tagPattern: /^(\d+\.\d+\.\d+)$/,
});
