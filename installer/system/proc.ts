// Starting other programs: finding them on PATH, and the claude CLI.
import { type SpawnOptions, type SpawnSyncOptions, spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { WIN, record } from '../context.ts';
import { log, progress } from '../ui/ui.ts';

export function safeArg(s: string) {
  if (!/^[a-z0-9@.:=/_-]+$/i.test(s)) throw new Error(`refusing unsafe argument: ${JSON.stringify(s)}`);
  return s;
}

export const errCode = (e: Error | undefined) => (e as NodeJS.ErrnoException | undefined)?.code;

// How a finished program failed: the error that kept it from starting, the signal that killed it, or its exit code.
export const exitReason = (r: { error?: Error; status: number | null; signal: NodeJS.Signals | null }) =>
  errCode(r.error) ?? (r.signal ? `signal ${r.signal}` : `exit ${r.status}`);

const isFile = (f: string) => statSync(f, { throwIfNoEntry: false })?.isFile() ?? false;
// What Windows can start: npm's global folder also holds an extensionless sh script next to claude.cmd.
const STARTABLE = ['.exe', '.com', '.cmd', '.bat'];

// bin's full path from PATH, or undefined. Never the current folder, where cmd.exe and a bare spawn look first on
// Windows (relative PATH entries count as that too).
export function which(bin: string) {
  const exts = WIN
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
        .toLowerCase()
        .split(';')
        .filter((e) => STARTABLE.includes(e))
    : [''];
  for (const dir of (process.env.PATH || '').split(delimiter).map((d) => d.replace(/^"(.*)"$/, '$1'))) {
    if (!isAbsolute(dir)) continue;
    for (const e of exts) if (isFile(join(dir, bin + e))) return join(dir, bin + e);
  }
}

export const onPath = (bin: string) => which(bin) !== undefined;

// A .cmd or .bat runs through cmd.exe as one command line: the path quoted (spaces), the args safeArg-checked. Node wraps
// it as cmd.exe /d /s /c "…", and an args array with shell: true is deprecated (DEP0190).
const viaCmd = (file: string) => WIN && /\.(cmd|bat)$/i.test(file);
const commandLine = (file: string, args: string[]) => [`"${file}"`, ...args.map(safeArg)].join(' ');

// file: a full path, from which() or our own.
export const start = (file: string, args: string[], opts: SpawnOptions = {}) =>
  viaCmd(file) ? spawn(commandLine(file, args), { ...opts, shell: true }) : spawn(file, args, opts);

export const startSync = (file: string, args: string[], opts: Omit<SpawnSyncOptions, 'encoding'> = {}) => {
  const o = { ...opts, encoding: 'utf8' as const };
  return viaCmd(file) ? spawnSync(commandLine(file, args), { ...o, shell: true }) : spawnSync(file, args, o);
};

// input: what the command reads on stdin, or undefined.
type Result = { ok: boolean; out: string; err: string };
export function claude(input: string | undefined, ...args: string[]) {
  args.forEach(safeArg);
  const file = which('claude');
  if (!file) {
    log('error', "Can't find claude. Install Claude Code and make sure it's on PATH.");
    process.exit(1);
  }
  const child = start(file, args);
  let out = '';
  let err = '';
  child.stdout!.setEncoding('utf8').on('data', (d) => {
    out += d;
  });
  child.stderr!.setEncoding('utf8').on('data', (d) => {
    err += d;
  });
  child.stdin!.on('error', () => {}).end(input);
  return new Promise<Result>((resolve) => {
    child.on('error', (e: NodeJS.ErrnoException) => {
      log('error', `Can't run claude (${e.code}). Install Claude Code and make sure it's on PATH.`);
      process.exit(1);
    });
    child.on('close', (code) => resolve({ ok: code === 0, out: out.trim(), err: (err || out).trim() }));
  });
}

// One claude command on its own progress line. doing: shown while it runs; label: what the summary says.
export const run = async (doing: string, label: string, ...args: string[]) =>
  record(label, await progress(doing, () => claude(undefined, ...args)));
