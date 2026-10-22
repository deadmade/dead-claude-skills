// The installer's file writes and the clean slate's backup and delete, split out of install.ts so they can be tested.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { searxngSettings } from '../core/options.ts';
import { CLEAN_TARGETS } from '../core/settings.ts';

// Windows refuses a rename while another program has either file open: Defender scanning a fresh exe, an editor or
// Claude Code holding settings.json. That passes (a scan of a large exe can take seconds), so it's retried for up to 5 s
// before the refusal is thrown.
function rename(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      return renameSync(from, to);
    } catch (e) {
      if (process.platform !== 'win32' || i >= 50 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

export function writeAtomic(file: string, text: string | Buffer) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  rename(tmp, file);
}

// Moves staged to bin. aside (Windows): a running exe can be renamed but not replaced, so the old one is moved to
// bin.old-<pid> first, put back if the swap fails, and deleted when it no longer runs (a later call sweeps it).
export function replaceBin(staged: string, bin: string, aside: boolean) {
  const old = `${bin}.old-${process.pid}`;
  for (const f of readdirSync(dirname(bin)))
    if (f.startsWith(`${basename(bin)}.old-`))
      try {
        rmSync(join(dirname(bin), f), { force: true });
      } catch {
        /* still running */
      }
  const moved = aside && existsSync(bin);
  if (moved) rename(bin, old);
  try {
    rename(staged, bin);
  } catch (e) {
    try {
      if (moved) rename(old, bin);
    } catch (r) {
      // The swap's error stays the one reported; the next sweep would delete old, so say where it is.
      e.message += `; the old binary is at ${old} (${r.code}), rename it back to ${bin}`;
    } finally {
      try {
        rmSync(staged, { force: true });
      } catch {
        /* a leftover staged copy; the swap's error is the one to report */
      }
    }
    throw e;
  }
  try {
    rmSync(old, { force: true });
  } catch {
    /* still running: the next call sweeps it */
  }
}

// Copies every clean target that exists; any failure throws before the caller deletes anything.
export function backup(config: string, dir: string) {
  for (const t of [...CLEAN_TARGETS, 'settings.json']) {
    const src = join(config, t);
    if (existsSync(src)) cpSync(src, join(dir, t), { recursive: true, verbatimSymlinks: true });
  }
}

// Deletes the clean targets under config and returns what happened to each, for the summary.
export function clearTargets(config: string) {
  const out: string[] = [];
  for (const t of CLEAN_TARGETS) {
    const path = join(config, t);
    if (!existsSync(path)) continue;
    // Managed elsewhere (e.g. home-manager): deleting through the link would hit the source.
    if (lstatSync(path).isSymbolicLink()) {
      out.push(`kept ${path}: symlink, remove it where it's managed`);
      continue;
    }
    rmSync(path, { recursive: true, maxRetries: 5 });
    out.push(`deleted ${path}`);
  }
  return out;
}

// Writes SearXNG's settings.yml with this secret unless one exists: the container already uses that file's secret.
// Returns whether it wrote.
export function writeSearxng(dir: string, template: string, secret: string) {
  const file = join(dir, 'settings.yml');
  if (existsSync(file)) return false;
  writeAtomic(file, searxngSettings(template, secret));
  return true;
}
