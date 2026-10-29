// Downloads: release assets checked against their sha256, unpacked and moved into place.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// Downloads the release asset, checks its sha256, and moves the binary to bin (on Windows the old one is renamed aside
// first). asset.digest: a pinned checksum instead of the .sha256 file; asset.raw: the download is the binary itself;
// asset.folder: the whole archive becomes bin's folder, which is the program's own and replaced whole, so nothing an
// older release shipped there lingers.
export type Asset = {
  file: string;
  url: string;
  exe: string;
  sha256?: string;
  digest?: string;
  raw?: boolean;
  folder?: boolean;
};
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
    const out = join(tmp, 'out');
    writeFileSync(file, bytes);
    if (!asset.raw) {
      mkdirSync(out);
      const r = spawnSync(tar(), ['-xf', file, '-C', out], { encoding: 'utf8' });
      if (r.status !== 0)
        throw new Error(`could not unpack ${asset.file}: ${(r.stderr || r.error?.message || '').trim()}`);
      if (!existsSync(join(out, asset.exe))) throw new Error(`${asset.file} holds no ${asset.exe}`);
    }
    const dest = asset.folder ? dirname(bin) : bin;
    mkdirSync(dirname(dest), { recursive: true });
    const staged = `${dest}.tmp-${process.pid}`;
    if (asset.folder) cpSync(out, staged, { recursive: true });
    else cpSync(asset.raw ? file : join(out, asset.exe), staged);
    chmodSync(asset.folder ? join(staged, asset.exe) : staged, 0o755);
    // Windows can rename a running exe (agent-browser's daemon, a live web-mcp) but not replace it. A folder can't be
    // renamed onto another one anywhere, so the old folder always moves aside first.
    replaceBin(staged, dest, WIN || asset.folder === true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
