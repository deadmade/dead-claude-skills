import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';

export const decide = ({ env, health, lockHash }) => {
  if (env.HEADROOM_TRIM === 'off') return 'off';
  if (!health) return 'start';
  return health.lock === lockHash ? 'running' : 'replace';
};

export const lockHashOf = (text) => createHash('sha256').update(text).digest('hex');

// <config>/bin/uv first, else the first absolute PATH entry holding uv; never a bare name or the current folder.
export function findUv({ config, path, platform, isFile }) {
  const p = platform === 'win32' ? win32 : posix;
  const name = platform === 'win32' ? 'uv.exe' : 'uv';
  const candidates = [p.join(config, 'bin', name)];
  for (const dir of (path ?? '').split(p.delimiter)) if (dir && p.isAbsolute(dir)) candidates.push(p.join(dir, name));
  return candidates.find((c) => isFile(c));
}

export function startArgs({ uv, serverDir, port, data, lock }) {
  return {
    cmd: uv,
    args: [
      'run', '--locked', '--project', serverDir, 'python', join(serverDir, 'server.py'),
      '--port', String(port), '--data', data, '--lock-hash', lock,
    ],
    env: { UV_PROJECT_ENVIRONMENT: join(data, 'venv') },
  };
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

export async function main({ argv, env, fetch, spawn, readFile, isFile }) {
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
    const lock = lockHashOf(readFile(join(serverDir, 'uv.lock')));
    const get = (ms) =>
      within(ms, async (signal) => {
        const r = await fetch(`${base}/health`, { signal });
        return r.ok ? await r.json() : undefined;
      }).catch(() => undefined);
    const health = await get(250);
    const action = decide({ env, health, lockHash: lock });
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
    const s = startArgs({ uv, serverDir, port, data, lock });
    mkdirSync(data, { recursive: true });
    const child = spawn(s.cmd, s.args, {
      cwd: data,
      env: { ...env, ...s.env },
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on?.('error', (e) => log(`could not start the trim server: ${e.message}`));
    child.unref();
  } catch (e) {
    log(`launcher failed: ${e?.message ?? e}`);
  }
}
