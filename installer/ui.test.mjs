import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { confirm, line, progress, screen, secret } from './ui.mjs';

const tty = () => {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(v) {
      this.isRaw = v;
      return this;
    },
  });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 60, rows: 20 });
  let written = '';
  output.on('data', (d) => {
    written += d;
  });
  return { input, output, written: () => written };
};
// screen() drops keys from its first 50 ms (type-ahead from a running step).
const settle = () => new Promise((r) => setTimeout(r, 60));
const counter = {
  move: (s, k) => (k === 'down' ? { ...s, n: s.n + 1 } : k === 'return' ? { ...s, result: 'apply' } : s),
  render: (s) => [`n=${s.n}`],
};

test('screen resolves on enter and restores the terminal', async () => {
  const io = tty();
  const done = screen({ n: 0 }, counter, io);
  await settle();
  io.input.write('\x1b[B');
  io.input.write('\r');
  const s = await done;
  assert.deepEqual([s.n, s.result, io.input.isRaw, io.input.isPaused()], [1, 'apply', false, true]);
  assert.ok(io.written().includes('\x1b[?25l') && io.written().endsWith('\x1b[?25h\n'));
});

test('screen maps enter, ignoring the one right after return', async () => {
  const io = tty();
  const done = screen(
    { n: 0 },
    { ...counter, move: (s, k) => (k === 'return' ? { ...s, n: s.n + 1, result: s.n ? 'apply' : undefined } : s) },
    io,
  );
  await settle();
  io.input.write('\r\n');
  io.input.write('\n');
  assert.equal((await done).n, 2);
});

test('ctrl-c resolves quit', async () => {
  const io = tty();
  const done = screen({ n: 0 }, counter, io);
  await settle();
  io.input.write('\x03');
  const s = await done;
  assert.deepEqual([s.result, io.input.isRaw], ['quit', false]);
});

test('a throwing move still restores the terminal', async () => {
  const io = tty();
  const done = screen(
    { n: 0 },
    {
      ...counter,
      move: () => {
        throw new Error('boom');
      },
    },
    io,
  );
  await settle();
  io.input.write('\x1b[B');
  await assert.rejects(done, /boom/);
  assert.deepEqual([io.input.isRaw, io.input.isPaused()], [false, true]);
  assert.ok(io.written().includes('\x1b[?25h'));
});

test('confirm takes y/n and enter, ctrl-c is null', async () => {
  const ask = async (keys, initial) => {
    const io = tty();
    const done = confirm('Write?', initial, io);
    await settle();
    io.input.write(keys);
    return done;
  };
  assert.equal(await ask('n', true), false);
  assert.equal(await ask('y', false), true);
  assert.equal(await ask('\r', true), true);
  assert.equal(await ask('\x1b[C\r', true), false);
  assert.equal(await ask('\x03', true), null);
});

test('line returns the typed text, ctrl-c is null', async () => {
  let io = tty();
  let done = line('Type "clean" to continue:', io);
  io.input.write('clean\r');
  assert.equal(await done, 'clean');
  io = tty();
  done = line('Type "clean" to continue:', io);
  io.input.write('\x03');
  assert.equal(await done, null);
  assert.equal(io.input.isRaw, false);
});

test('line stops at the first Enter, so text pasted after it is not echoed', async () => {
  const io = tty();
  const done = line('Collection URL:', io);
  io.input.write('url\rsecret\r');
  assert.equal(await done, 'url');
  assert.ok(!io.written().includes('secret'));
  assert.equal(io.input.isRaw, false);
});

test('line is null when stdin closes before an answer', async () => {
  const io = tty();
  const done = line('Collection URL:', io);
  io.input.end();
  assert.equal(await done, null);
});

test('secret returns the typed text and never echoes it', async () => {
  const io = tty();
  const done = secret('Azure DevOps personal access token:', io);
  io.input.write('hunter3\x7f2\r');
  assert.equal(await done, 'hunter2');
  assert.ok(io.written().includes('Azure DevOps personal access token:'));
  assert.ok(!/hunter|\*/.test(io.written()), 'nothing of the secret is shown');
  assert.equal(io.input.isRaw, false);
});

test('progress turns a throw into failed', async () => {
  const r = await progress('Downloading tui-review', async () => {
    throw new Error('boom');
  });
  assert.deepEqual(r, { ok: false, err: 'boom' });
  assert.deepEqual(await progress('Installing x', async () => ({ ok: true })), { ok: true });
});

test('keys typed before a prompt opens do not answer it', async () => {
  const io = tty();
  io.input.write('\r');
  const done = confirm('Write?', true, io);
  let settled = false;
  done.then(() => {
    settled = true;
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(settled, false);
  await new Promise((r) => setTimeout(r, 150));
  io.input.write('n');
  assert.equal(await done, false);
});
