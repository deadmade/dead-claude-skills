// Downloads: release assets checked against their sha256, unpacked and moved into place.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import tls from 'node:tls';
import { WIN } from '../context.ts';
import { sha256Matches, sha256Of } from '../core/binaries.ts';
import { replaceBin } from './files.ts';
import { which } from './proc.ts';

// fetch trusts only Node's bundled roots, so behind HTTPS inspection (ESET at work re-signs every site with a root in the
// Windows store) every download fails. Adding the OS store fixes fetch for this process; children don't inherit it.
export function trustSystemCerts() {
  try {
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
  } catch (e) {
    return `couldn't load the system certificates (${e.message}), downloads trust Node's own roots only`;
  }
}

// Windows' own bsdtar, which reads zips. A bare `tar` from Git Bash is GNU tar, which reads C:\… as a remote host.
const tar = () =>
  WIN ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : (which('tar') ?? 'tar');

export async function fetchOk(url: string) {
  const res = await fetch(url);
  if (res.status === 404) throw new Error(`no release at ${url} yet`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// Asks the local server on `port` to exit (POST /shutdown) and waits up to waitMs for the port to stop accepting;
// true when nothing listens any more (also when nothing did).
export async function stopLocalServer(port: number, waitMs = 2000) {
  await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1000) }).catch(
    () => {},
  );
  const open = () =>
    new Promise<boolean>((resolve) => {
      const s = connect(port, '127.0.0.1');
      s.on('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => resolve(false));
    });
  for (const end = Date.now() + waitMs; Date.now() < end; await new Promise((r) => setTimeout(r, 50)))
    if (!(await open())) return true;
  return !(await open());
}

// Downloads the release asset, checks its sha256, and moves the binary to bin (on Windows the old one is renamed aside
// first). asset.digest: a pinned checksum instead of the .sha256 file; asset.raw: the download is the binary itself.
export type Asset = { file: string; url: string; exe: string; sha256?: string; digest?: string; raw?: boolean };
export async function downloadBin(name: string, asset: Asset, bin: string) {
  const [archive, want] = await Promise.all([
    fetchOk(asset.url).then((r) => r.arrayBuffer()),
    asset.digest ??
      fetchOk(asset.sha256!)
        .then((r) => r.text())
        .then(sha256Of),
  ]);
  const bytes = Buffer.from(archive);
  if (!sha256Matches(bytes, want)) throw new Error(`${asset.file}: checksum mismatch`);
  const tmp = mkdtempSync(join(tmpdir(), `${name}-`));
  try {
    const file = join(tmp, asset.file);
    writeFileSync(file, bytes);
    if (!asset.raw) {
      const r = spawnSync(tar(), ['-xf', file, '-C', tmp], { encoding: 'utf8' });
      if (r.status !== 0)
        throw new Error(`could not unpack ${asset.file}: ${(r.stderr || r.error?.message || '').trim()}`);
    }
    mkdirSync(dirname(bin), { recursive: true });
    const staged = `${bin}.tmp-${process.pid}`;
    cpSync(asset.raw ? file : join(tmp, asset.exe), staged);
    chmodSync(staged, 0o755);
    // Windows can rename a running exe (agent-browser's daemon, a live web-mcp) but not replace it.
    replaceBin(staged, bin, WIN);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
