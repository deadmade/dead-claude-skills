// headroom-trim's trim server is a uv project. A current uv on PATH is used as is; otherwise upstream's release for the
// version pinned in installer/assets/uv.json goes to ~/.claude/bin (where the plugin's launcher looks first). Then the
// server's environment and tiktoken's vocabulary are built into the plugin's data folder, so the first session starts
// at once. Asks before a download; every failure is a summary line.
import { join } from 'node:path';
import { type UpstreamPin, agentBrowserVersion, uvAsset, upstreamPlan } from '../core/binaries.ts';
import { hookPort, pluginDataDir, pluginInstallPath } from '../core/plugins.ts';
import { MARKETPLACE } from '../core/release.ts';
import { ASSETS, CONFIG, WIN, ask, done, failures, readJson, tryJson } from '../context.ts';
import { downloadBin, stopLocalServer } from '../system/net.ts';
import { errCode, startSync, which } from '../system/proc.ts';
import { log, progress } from '../ui/ui.ts';
import { BIN_DIR } from './binaries.ts';

export const HEADROOM_TRIM = `headroom-trim@${MARKETPLACE}`;
const OFF = 'headroom-trim stays off until uv is installed';

// The uv path in use, or undefined (a summary line says why).
export async function installUv(): Promise<string | undefined> {
  const pin: UpstreamPin = readJson(join(ASSETS, 'uv.json'));
  const pinned = pin.upstream ?? '';
  const key = `${process.platform}-${process.arch}`;
  const asset = uvAsset(process.platform, process.arch, pin);
  if (!asset) {
    failures.push(`uv: no pinned build for ${key} in installer/assets/uv.json; ${OFF}`);
    return undefined;
  }
  const bin = join(BIN_DIR, WIN ? 'uv.exe' : 'uv');
  const versionOf = (file: string) => {
    const r = startSync(file, ['--version']);
    return r.status === 0 ? agentBrowserVersion(r.stdout) : undefined;
  };
  const theirs = which('uv');
  const plan = upstreamPlan({ theirs: theirs && versionOf(theirs), ours: versionOf(bin), pinned });
  if (plan.use === 'path') return theirs;
  if (plan.download === 'skip') return bin;
  const what = plan.download === 'install' ? 'Download' : 'Upgrade';
  if (!(await ask(`${what} uv ${pinned} (Astral's release binary) to ${bin} for headroom-trim?`, true))) {
    failures.push(`uv: install skipped by you; ${OFF}`);
    return undefined;
  }
  const r = await progress(`Downloading uv ${pinned}`, async () => {
    await downloadBin('uv', asset, bin);
    return { ok: true };
  });
  if (!r.ok) {
    failures.push(`uv ${pinned}: ${r.err}; ${OFF}`);
    return undefined;
  }
  done.push(`uv: ${plan.download === 'install' ? 'installed' : 'upgraded to'} ${pinned} at ${bin}`);
  return bin;
}

// Builds the trim server's environment (uv sync) and fetches tiktoken's vocabulary. A running server is stopped first,
// so the sync can replace its files.
export async function prepareTrimServer(uv: string): Promise<void> {
  const installed = tryJson(join(CONFIG, 'plugins', 'installed_plugins.json'));
  const root = pluginInstallPath(installed, HEADROOM_TRIM);
  if (!root) {
    failures.push(
      "headroom-trim: Claude Code lists no install of it; the first session will build the server's environment",
    );
    return;
  }
  const data = pluginDataDir(CONFIG, HEADROOM_TRIM);
  const server = join(root, 'server');
  const env = {
    ...process.env,
    UV_PROJECT_ENVIRONMENT: join(data, 'venv'),
    TIKTOKEN_CACHE_DIR: join(data, 'tiktoken'),
  };
  const port = hookPort(tryJson(join(root, 'hooks', 'hooks.json')));
  if (port !== undefined && !(await stopLocalServer(port)))
    failures.push(`headroom-trim: the trim server on port ${port} did not stop; the sync may fail while it runs`);
  const run = (args: string[]) => startSync(uv, [...args, '--project', server], { env, stdio: 'inherit' });
  log('info', 'Building the headroom-trim server environment (uv sync)');
  const sync = run(['sync', '--locked']);
  if (sync.status !== 0) {
    failures.push(
      `headroom-trim: uv sync failed (${errCode(sync.error) ?? `exit ${sync.status}`}); the first session will retry it`,
    );
    return;
  }
  done.push('headroom-trim: server environment built');
  const fetched = startSync(
    uv,
    ['run', '--locked', '--project', server, 'python', '-c', "import tiktoken; tiktoken.get_encoding('o200k_base')"],
    { env, stdio: 'inherit' },
  );
  if (fetched.status !== 0)
    failures.push(
      `headroom-trim: token counts are estimated until the installer fetches tiktoken's vocabulary (${errCode(fetched.error) ?? `exit ${fetched.status}`})`,
    );
}
