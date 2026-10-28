// flows' prose environment for /copyedit: spaCy and en_core_web_trf in a uv project synced into <CONFIG>/flows-prose/.
import { join } from 'node:path';

export const proseDir = (config: string) => join(config, 'flows-prose');
// Written when the user unticks the toggle: it then stays off by default.
export const proseMarker = (config: string) => join(config, 'flows-prose.off');

export const prosePython = (config: string, platform: string) =>
  platform === 'win32'
    ? join(proseDir(config), 'env', 'Scripts', 'python.exe')
    : join(proseDir(config), 'env', 'bin', 'python');

// uv sync of the locked project in installer/assets/prose, with the venv, uv's cache and its managed Python all inside
// flows-prose, so deleting that folder removes everything.
export function proseSync(assets: string, config: string) {
  const dir = proseDir(config);
  return {
    args: ['sync', '--frozen', '--managed-python', '--no-dev'],
    env: {
      UV_PROJECT: join(assets, 'prose'),
      UV_PROJECT_ENVIRONMENT: join(dir, 'env'),
      UV_CACHE_DIR: join(dir, 'cache'),
      UV_PYTHON_INSTALL_DIR: join(dir, 'python'),
    } as Record<string, string>,
  };
}

export const proseState = ({
  config,
  platform,
  exists,
}: {
  config: string;
  platform: string;
  exists: (path: string) => boolean;
}) => ({ installed: exists(prosePython(config, platform)), optedOut: exists(proseMarker(config)) });

// The toggle's start value. flows: flows is selected when the screens open; offered: the toggle works here.
export const proseDefault = ({
  installed,
  optedOut,
  offered,
  flows,
}: {
  installed: boolean;
  optedOut: boolean;
  offered: boolean;
  flows: boolean;
}) => installed || (offered && flows && !optedOut);

// What the prose step does with the screens' result. flows: flows is selected after the screens.
export function proseDecision({ toggle, flows, installed }: { toggle: boolean; flows: boolean; installed: boolean }) {
  if (installed && !(toggle && flows)) return 'remove';
  if (toggle && flows) return 'sync';
  return toggle ? 'needs-flows' : 'none';
}
