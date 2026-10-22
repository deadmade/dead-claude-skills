// The installer's terminal I/O on Node's stdlib: interactive screens, a yes/no, a typed line and plain output.
import { createInterface } from 'node:readline';
import { createInterface as createLineInterface } from 'node:readline/promises';
import { frame, paint, wrap } from './view.ts';

// What the prompts use of stdin and stdout, so tests can hand them streams of their own.
type IO = {
  input: NodeJS.ReadableStream & { setRawMode?(raw: boolean): unknown };
  output: NodeJS.WritableStream & { columns?: number; rows?: number };
};
const STD: IO = { input: process.stdin, output: process.stdout };
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';

// A killed installer must not leave the terminal raw with a hidden cursor.
function restore() {
  if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
  if (process.stdout.isTTY) process.stdout.write(SHOW);
}
process.on('exit', restore);
for (const [sig, n] of [
  ['SIGTERM', 15],
  ['SIGHUP', 1],
] as const) {
  process.on(sig, () => {
    restore();
    process.exit(128 + n);
  });
}

// Runs one screen until move() returns a state with a result. render(state, { columns, rows }) -> lines.
// ctrl-c resolves the state with result 'quit'.
export function screen<S extends { result?: string }>(
  state: S,
  {
    move,
    render,
  }: { move: (s: S, key: string) => S; render: (s: S, size: { columns: number; rows: number }) => string[] },
  { input, output }: IO = STD,
): Promise<S> {
  return new Promise((resolve, reject) => {
    // No output: keys aren't echoed over the frame. The interface sets up keypress events with a 50 ms esc timeout.
    const rl = createInterface({ input, escapeCodeTimeout: 50, terminal: true });
    let s = state;
    let drawn = 0;
    let afterReturn = false;
    let over = false;
    // Keys buffered while a step ran (an Enter pressed during "Installing …") must not answer this screen.
    let ready = false;
    const settle = setTimeout(() => {
      ready = true;
    }, 50);
    const draw = () => {
      const lines = render(s, { columns: output.columns ?? 80, rows: output.rows ?? 24 });
      output.write(`${drawn ? `\r${drawn > 1 ? `\x1b[${drawn - 1}A` : ''}\x1b[J` : ''}${lines.join('\n')}`);
      drawn = lines.length;
    };
    const finish = (err: Error | null, value?: S) => {
      if (over) return;
      over = true;
      clearTimeout(settle);
      input.off('keypress', onKey);
      output.off('resize', draw);
      rl.close();
      input.setRawMode?.(false);
      input.pause();
      output.write(`${SHOW}\n`);
      if (err) reject(err);
      else resolve(value!);
    };
    function onKey(_: string, key: { ctrl?: boolean; name?: string } = {}) {
      if (over) return;
      try {
        if (key.ctrl && key.name === 'c') return finish(null, { ...s, result: 'quit' } as S);
        if (!ready) return;
        let name = key.name ?? '';
        // \r\n arrives as return + enter: one press.
        const skip = name === 'enter' && afterReturn;
        afterReturn = name === 'return';
        if (skip) return;
        if (name === 'enter') name = 'return';
        s = move(s, name);
        if (s.result) return finish(null, s);
        draw();
      } catch (e) {
        finish(e);
      }
    }
    rl.on('SIGINT', () => finish(null, { ...s, result: 'quit' } as S));
    input.on('keypress', onKey);
    output.on('resize', draw);
    input.setRawMode?.(true);
    input.resume();
    output.write(HIDE);
    draw();
  });
}

// Yes / No on one line: ←/→ to switch, y/n to pick, enter to confirm. null on ctrl-c.
export async function confirm(message: string, initial = true, io = STD) {
  const s = await screen<{ yes: boolean; result?: 'done' | 'quit' }>(
    { yes: initial },
    {
      move: (st, k) => {
        if (k === 'left' || k === 'right') return { ...st, yes: !st.yes };
        if (k === 'y' || k === 'n') return { yes: k === 'y', result: 'done' };
        return k === 'return' ? { ...st, result: 'done' } : st;
      },
      render: (st) => {
        const choice = (label: string, on: boolean) => (on ? paint(['bold', 'inverse'], ` ${label} `) : ` ${label} `);
        return [`${message}  ${choice('Yes', st.yes)} / ${choice('No', !st.yes)}`];
      },
    },
    io,
  );
  return s.result === 'quit' ? null : s.yes;
}

// A typed answer in line mode; null on ctrl-c.
export async function line(message: string, { input, output } = STD) {
  const rl = createLineInterface({ input, output, terminal: true });
  const ac = new AbortController();
  rl.on('SIGINT', () => ac.abort());
  try {
    return await rl.question(`${message} `, { signal: ac.signal });
  } catch {
    output.write('\n');
    return null;
  } finally {
    rl.close();
    input.setRawMode?.(false);
    input.pause();
  }
}

// A framed note; long lines wrap so text the user copies stays whole.
export function note(title: string, lines: string[]) {
  const columns = process.stdout.columns ?? 80;
  const inner = Math.max(columns - 1, 8) - 4;
  process.stdout.write(
    `${frame(
      paint('bold', title),
      lines.flatMap((l) => wrap(l, inner)),
      { columns },
    ).join('\n')}\n`,
  );
}

// One line per step: label …, then done or failed (with the reason on the next line). fn resolves { ok, err } or throws.
export async function progress<R extends { ok: boolean; err?: string }>(label: string, fn: () => Promise<R>) {
  process.stdout.write(`${label} … `);
  let r: R | { ok: false; err: string };
  try {
    r = await fn();
  } catch (e) {
    r = { ok: false, err: e.message };
  }
  process.stdout.write(
    r.ok ? `${paint('green', 'done')}\n` : `${paint('red', 'failed')}\n${r.err ? `  ${r.err}\n` : ''}`,
  );
  return r;
}

export function log(kind: 'info' | 'warn' | 'error', text: string) {
  const out = kind === 'warn' ? paint('yellow', text) : kind === 'error' ? paint('red', `✗ ${text}`) : text;
  process.stdout.write(`${out}\n`);
}
