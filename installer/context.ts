// What every step shares: where things are, this release's version, and the summary's done and failed lines.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { confirm, log } from './ui/ui.ts';
import { paint } from './ui/view.ts';

export const PKG = join(import.meta.dirname, '..');
export const ASSETS = join(import.meta.dirname, 'assets');
export const CONFIG = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
export const SETTINGS = join(CONFIG, 'settings.json');
export const WIN = process.platform === 'win32';
export const FLAGS = process.argv.slice(2);

// shortcut: JSON is trusted to have the shape its caller declares, as our own files and Claude Code's do.
export const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
export const tryJson = <T = any>(file: string): T | undefined => {
  try {
    return readJson(file);
  } catch {
    return undefined;
  }
};
export const asset = (file: string) => readFileSync(join(ASSETS, file), 'utf8');
export const VERSION: string = readJson(join(PKG, 'package.json')).version;
export const failures: string[] = [];
export const done: string[] = [];

export const red = (s: string) => paint('red', s);
export const green = (s: string) => paint('green', s);

// The answer of a prompt; ctrl-c (null) ends the installer.
export function must<T>(answer: T | null): T {
  if (answer !== null) return answer;
  log('error', done.length ? 'Stopped. What ran so far is kept.' : 'Cancelled before installing anything.');
  process.exit(130);
}

export const ask = async (message: string, initialValue: boolean) => must(await confirm(message, initialValue));

export const record = (label: string, r: { ok: boolean; err?: string }) => {
  (r.ok ? done : failures).push(r.ok ? label : `${label}: ${r.err}`);
  return r.ok;
};

export const remove = (file: string, label: string) => {
  if (!existsSync(file)) return;
  rmSync(file);
  done.push(`deleted ${label}`);
};
