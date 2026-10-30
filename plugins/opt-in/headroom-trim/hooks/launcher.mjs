import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, truncateSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';

// -1, 0 or 1 for two x.y.z versions; a missing one is the oldest.
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => (v ?? '-1').split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
};

// A server from another identity is replaced, unless it came from a newer plugin version (a session started before an
// update must not swap it back).
export const decide = ({ env, health, identity, version }) => {
  if (env.HEADROOM_TRIM === 'off') return 'off';
  if (!health) return 'start';
  if (health.lock === identity) return 'running';
  return compare(version, health.version) >= 0 ? 'replace' : 'running';
};

const counts = (name) => name === 'uv.lock' || name === 'pyproject.toml' || name.endsWith('.py');

// sha256 over the server's lockfile, project and modules, sorted by name, each as name, length and bytes.
export function identityOf(serverDir) {
  const h = createHash('sha256');
  for (const name of readdirSync(serverDir).filter(counts).sort()) {
    const bytes = readFileSync(join(serverDir, name));
    h.update(`${name}\0${bytes.length}\0`).update(bytes);
  }
  return h.digest('hex');
}

export function pluginVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// The session's environment minus what would point uv or Python elsewhere, plus ours: the server is shared, so one
// shell's settings must not reach it.
const LEAKS = /^(UV_|PYTHON|VIRTUAL_ENV$)/i;
export const serverEnv = (env, ours) => ({
  ...Object.fromEntries(Object.entries(env).filter(([k]) => !LEAKS.test(k))),
  ...ours,
});

// <config>/bin/uv first, else the first absolute PATH entry holding uv; never a bare name or the current folder.
export function findUv({ config, path, platform, isFile }) {
  const p = platform === 'win32' ? win32 : posix;
  const name = platform === 'win32' ? 'uv.exe' : 'uv';
  const candidates = [p.join(config, 'bin', name)];
  for (const dir of (path ?? '').split(p.delimiter)) if (dir && p.isAbsolute(dir)) candidates.push(p.join(dir, name));
  return candidates.find((c) => isFile(c));
}

export function startArgs({ uv, serverDir, port, data, identity, version }) {
  return {
    cmd: uv,
    args: [
      'run', '--locked', '--project', serverDir, 'python', join(serverDir, 'server.py'),
      '--port', String(port), '--data', data, '--lock-hash', identity, '--version', version,
    ],
    env: { UV_PROJECT_ENVIRONMENT: join(data, 'venv'), PYTHONDONTWRITEBYTECODE: '1' },
  };
}

// <data>/server.log opened for append, emptied first once it passes max bytes.
export function openServerLog(data, max = 1_000_000) {
  const file = join(data, 'server.log');
  try {
    if (statSync(file).size > max) truncateSync(file);
  } catch {}
  return openSync(file, 'a');
}

// A fetch that ignores its signal still gives up after ms.
async function within(ms, run) {
  const ctl = new AbortController();
  let timer;
  try {
    return await Promise.race([
      run(ctl.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          ctl.abort();
          reject(new Error('timeout'));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function main({ argv, env, fetch, spawn, isFile }) {
  const data = env.CLAUDE_PLUGIN_DATA;
  const log = (msg) => {
    try {
      mkdirSync(data, { recursive: true });
      appendFileSync(join(data, 'launcher.log'), `${new Date().toISOString()} ${msg}\n`);
    } catch {}
  };
  try {
    if (env.HEADROOM_TRIM === 'off') return;
    const port = Number(argv[0]);
    const root = env.CLAUDE_PLUGIN_ROOT;
    const base = `http://127.0.0.1:${port}`;
    const serverDir = join(root, 'server');
    const identity = identityOf(serverDir);
    const version = pluginVersion(root);
    const get = (ms) =>
      within(ms, async (signal) => {
        const r = await fetch(`${base}/health`, { signal });
        return r.ok ? await r.json() : undefined;
      }).catch(() => undefined);
    const health = await get(250);
    const action = decide({ env, health, identity, version });
    if (action === 'off' || action === 'running') return;
    if (action === 'replace') {
      const end = Date.now() + 1000;
      await within(200, (signal) => fetch(`${base}/shutdown`, { method: 'POST', signal })).catch(() => {});
      while (Date.now() < end && (await get(Math.min(250, Math.max(1, end - Date.now()))))) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    const config = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const uv = findUv({ config, path: env.PATH ?? env.Path, platform: process.platform, isFile });
    if (!uv) return log('uv not found: run the dead-claude-skills installer, which downloads it');
    const s = startArgs({ uv, serverDir, port, data, identity, version });
    mkdirSync(data, { recursive: true });
    const out = openServerLog(data);
    let child;
    try {
      child = spawn(s.cmd, s.args, {
        cwd: data,
        env: serverEnv(env, s.env),
        detached: true,
        windowsHide: true,
        stdio: ['ignore', out, out],
      });
    } finally {
      closeSync(out);
    }
    child.on?.('error', (e) => log(`could not start the trim server: ${e.message}`));
    child.unref();
    log(`started ${uv} pid ${child.pid} (${version}, server.log has its output)`);
  } catch (e) {
    log(`launcher failed: ${e?.message ?? e}`);
  }
}
