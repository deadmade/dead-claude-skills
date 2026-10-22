// Starting other programs: the claude CLI, and finding a program on PATH.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { WIN, record } from '../context.ts';
import { log, progress } from '../ui/ui.ts';

export function safeArg(s: string) {
  if (!/^[a-z0-9@.:=/_-]+$/i.test(s)) throw new Error(`refusing unsafe argument: ${JSON.stringify(s)}`);
  return s;
}

export const errCode = (e: Error | undefined) => (e as NodeJS.ErrnoException | undefined)?.code;

// input: what the command reads on stdin, or undefined.
type Result = { ok: boolean; out: string; err: string };
export function claude(input: string | undefined, ...args: string[]) {
  args.forEach(safeArg);
  // Windows: one string through the shell so both claude.cmd and claude.exe resolve; args are safeArg-checked.
  const child = WIN ? spawn(['claude', ...args].join(' '), { shell: true }) : spawn('claude', args);
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8').on('data', (d) => {
    out += d;
  });
  child.stderr.setEncoding('utf8').on('data', (d) => {
    err += d;
  });
  child.stdin.on('error', () => {}).end(input);
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

export function onPath(bin: string) {
  const exts = WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  return (process.env.PATH || '').split(delimiter).some((d) => exts.some((e) => existsSync(join(d, bin + e))));
}
