// The installer's file writes and the clean slate's backup and delete, split out of install.mjs so they can be tested.
import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLEAN_TARGETS, searxngSettings } from './core.mjs';

export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

// Renames staged to target. Windows can rename a running exe but not replace it, so there an existing target is moved
// aside first and put back if the rename fails; the aside copy of one still running is left beside it.
export function replaceFile(staged, target, win = process.platform === 'win32') {
  const old = `${target}.old-${process.pid}`;
  const aside = win && existsSync(target);
  if (aside) renameSync(target, old);
  try {
    renameSync(staged, target);
  } catch (e) {
    if (aside) renameSync(old, target);
    throw e;
  }
  try {
    rmSync(old, { force: true });
  } catch {
    /* still running: left beside it */
  }
}

// Copies every clean target that exists; any failure throws before the caller deletes anything.
export function backup(config, dir) {
  for (const t of [...CLEAN_TARGETS, 'settings.json']) {
    const src = join(config, t);
    if (existsSync(src)) cpSync(src, join(dir, t), { recursive: true, verbatimSymlinks: true });
  }
}

// Deletes the clean targets under config and returns what happened to each, for the summary.
export function clearTargets(config) {
  const out = [];
  for (const t of CLEAN_TARGETS) {
    const path = join(config, t);
    if (!existsSync(path)) continue;
    // Managed elsewhere (e.g. home-manager): deleting through the link would hit the source.
    if (lstatSync(path).isSymbolicLink()) {
      out.push(`kept ${path}: symlink, remove it where it's managed`);
      continue;
    }
    rmSync(path, { recursive: true });
    out.push(`deleted ${path}`);
  }
  return out;
}

// Writes SearXNG's settings.yml with this secret unless one exists: the container already uses that file's secret.
// Returns whether it wrote.
export function writeSearxng(dir, template, secret) {
  const file = join(dir, 'settings.yml');
  if (existsSync(file)) return false;
  writeAtomic(file, searxngSettings(template, secret));
  return true;
}
