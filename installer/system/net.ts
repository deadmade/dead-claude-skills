// Downloads: release assets checked against their sha256, unpacked and moved into place.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WIN } from '../context.ts';
import { sha256Matches, sha256Of } from '../core/binaries.ts';
import { replaceBin } from './files.ts';

export async function fetchOk(url: string) {
  const res = await fetch(url);
  if (res.status === 404) throw new Error(`no release at ${url} yet`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
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
      // GNU tar on Linux, bsdtar on Windows 10+, which reads the zip too.
      const r = spawnSync('tar', ['-xf', file, '-C', tmp], { encoding: 'utf8' });
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
