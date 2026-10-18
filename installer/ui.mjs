// The installer's terminal I/O on Node's stdlib: interactive screens, a yes/no, a typed line and plain output.
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { frame, paint, wrap } from './view.mjs';

const STD = { input: process.stdin, output: process.stdout };
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
]) {
  process.on(sig, () => {
    restore();
    process.exit(128 + n);
  });
}

// Runs one screen until move() returns a state with a result. render(state, { columns, rows }) -> lines.
// ctrl-c resolves the state with result 'quit'.
export function screen(state, { move, render }, { input, output } = STD) {
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
    const finish = (err, value) => {
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
      else resolve(value);
    };
    function onKey(_, key = {}) {
      if (over) return;
      try {
        if (key.ctrl && key.name === 'c') return finish(null, { ...s, result: 'quit' });
        if (!ready) return;
        let name = key.name;
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
    rl.on('SIGINT', () => finish(null, { ...s, result: 'quit' }));
    input.on('keypress', onKey);
    output.on('resize', draw);
    input.setRawMode?.(true);
    input.resume();
    output.write(HIDE);
    draw();
  });
}

// Yes / No on one line: ←/→ to switch, y/n to pick, enter to confirm. null on ctrl-c.
export async function confirm(message, initial = true, io = STD) {
  const s = await screen(
    { yes: initial },
    {
      move: (st, k) => {
        if (k === 'left' || k === 'right') return { ...st, yes: !st.yes };
        if (k === 'y' || k === 'n') return { yes: k === 'y', result: 'done' };
        return k === 'return' ? { ...st, result: 'done' } : st;
      },
      render: (st) => {
        const choice = (label, on) => (on ? paint(['bold', 'inverse'], ` ${label} `) : ` ${label} `);
        return [`${message}  ${choice('Yes', st.yes)} / ${choice('No', !st.yes)}`];
      },
    },
    io,
  );
  return s.result === 'quit' ? null : s.yes;
}

// A typed answer in line mode; null on ctrl-c. The callback API answers synchronously, so closing there stops readline
// before it echoes (and swallows) anything pasted after the first Enter.
export function line(message, { input, output } = STD) {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: true });
    let done = false;
    const end = (answer) => {
      if (done) return;
      done = true;
      rl.close();
      input.setRawMode?.(false);
      input.pause();
      resolve(answer);
    };
    rl.on('SIGINT', () => {
      output.write('\n');
      end(null);
    });
    // stdin closed before an answer (EOF, a closed pipe): treat it like ctrl-c instead of hanging.
    rl.on('close', () => end(null));
    rl.question(`${message} `, end);
  });
}

// A typed answer that is never shown: the prompt is written here and everything line() draws (echo, redraws) is dropped.
export async function secret(message, io = STD) {
  io.output.write(`${message} `);
  const answer = await line('', { input: io.input, output: new Writable({ write: (_c, _e, cb) => cb() }) });
  io.output.write('\n');
  return answer;
}

// A framed note; long lines wrap so text the user copies stays whole.
export function note(title, lines) {
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
export async function progress(label, fn) {
  process.stdout.write(`${label} … `);
  let r;
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

export function log(kind, text) {
  const out = kind === 'warn' ? paint('yellow', text) : kind === 'error' ? paint('red', `✗ ${text}`) : text;
  process.stdout.write(`${out}\n`);
}
