// Windows: download cswap.exe from this version's release (checked against its .sha256), put its folder on PATH.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cswapCurrent, cswapDownload } from '../core/binaries.ts';
import { ASSETS, VERSION, ask, done, failures, readJson } from '../context.ts';
import { replaceBin } from '../system/files.ts';
import { addUserPath } from '../system/winpath.ts';
import { progress } from '../ui/ui.ts';

export async function applyCswap(on: boolean) {
  const version = readJson(join(ASSETS, 'cswap.json')).upstream;
  const dl = cswapDownload(process.platform, process.env, VERSION);
  if (!on || !dl) return;
  const have = existsSync(dl.exe) ? spawnSync(dl.exe, ['--version'], { encoding: 'utf8' }) : undefined;
  if (!(have?.status === 0 && cswapCurrent(have.stdout, version))) {
    if (!(await ask(`Download cswap.exe ${version} (claude-swap, built by this repo's CI) to ${dl.dir}?`, true))) {
      return done.push('cswap: download skipped by you');
    }
    const r = await progress(`Downloading cswap.exe ${version}`, async () => {
      const get = async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res;
      };
      const [exe, sum] = await Promise.all([
        get(dl.url).then((res) => res.arrayBuffer()),
        get(dl.sha256Url).then((res) => res.text()),
      ]);
      const bytes = Buffer.from(exe);
      const want = sum.trim().split(/\s+/)[0].toLowerCase();
      const got = createHash('sha256').update(bytes).digest('hex');
      if (got !== want) throw new Error(`checksum mismatch (got ${got}, want ${want}), nothing written`);
      mkdirSync(dl.dir, { recursive: true });
      const tmp = `${dl.exe}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes);
      // A running cswap.exe (the plugin polls it) can be renamed but not replaced.
      replaceBin(tmp, dl.exe, true);
      return { ok: true };
    });
    if (!r.ok) return failures.push(`cswap download failed: ${r.err}`);
    done.push(`cswap: installed ${version} to ${dl.exe}`);
  }
  if (!process.env.PATH?.toLowerCase().includes(dl.dir.toLowerCase()))
    process.env.PATH = `${process.env.PATH};${dl.dir}`;
  const path = addUserPath(dl.dir);
  if (path === 'read-failed') failures.push(`cswap: couldn't read your user PATH; add ${dl.dir} to it by hand`);
  else if (path === 'added') done.push(`cswap: added ${dl.dir} to your user PATH (new terminals see it)`);
  else if (path === 'write-failed') failures.push(`cswap: couldn't add ${dl.dir} to PATH; add it by hand`);
}
