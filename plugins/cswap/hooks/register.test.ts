import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const LIST = JSON.stringify({
  schemaVersion: 1,
  activeAccountNumber: 1,
  accounts: [
    {
      number: 1,
      email: 'a@example.com',
      active: true,
      usageStatus: 'ok',
      usage: { fiveHour: { pct: 63.4, countdown: '2h 10m' }, sevenDay: { pct: 40 } },
    },
    { number: 2, email: 'b@example.com', alias: 'work', active: false, usageStatus: 'token_expired', usage: null },
  ],
});

type Answer = { exitCode: number; stdout: string };

// Fakes the host: `cswap` on PATH answers by subcommand; records every argv and what the plugin showed.
function host(on: On, answers: Record<string, Answer> = {}, { missing = false } = {}) {
  const runs: string[][] = [];
  const toasts: string[] = [];
  const status: (string | undefined)[] = [];
  const clock = mock.clock(on);
  mock.env(on, {});
  on('session.start', () => ({ cwd: '/' }));
  on('process.run', (_$, e) => {
    if (missing) return { deny: 'ENOENT' };
    runs.push([...e.argv]);
    const sub = e.argv[1] ?? '';
    const a =
      sub === '--version' ? { exitCode: 0, stdout: 'cswap 0.26.0' } : (answers[sub] ?? { exitCode: 0, stdout: LIST });
    return { value: { ...a, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on('ui.toast', (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on('ui.status', (_$, e) => {
    status.push(e.text);
    return { value: undefined };
  });
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test' } }));
  on('command.register', () => ({ value: { key: 'swap' } }));
  return { runs, toasts, status, clock };
}

const START = { cwd: '/', surface: null, isInteractive: true } as const;

test('status line shows the active account and its usage', async ($, on) => {
  const h = host(on);
  await $.session.start(START);
  await $.command.run({ command: 'swap', args: '' });
  expect(h.status.at(-1)).toBe('cswap #1 a@example.com · 5h 63% · 7d 40%');
});

test('/swap 2 runs cswap switch 2 and reports the target', async ($, on) => {
  const h = host(on, {
    switch: { exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, to: { number: 2, email: 'b@example.com' } }) },
  });
  await $.session.start(START);
  const r = await $.command.run({ command: 'swap', args: '2' });
  expect(h.runs).toContainEqual(['cswap', 'switch', '2', '--json']);
  expect(r).toEqual(expect.objectContaining({ text: 'Switched to #2 b@example.com.' }));
});

test('/swap shows cswap errors', async ($, on) => {
  host(on, {
    switch: {
      exitCode: 1,
      stdout: JSON.stringify({
        schemaVersion: 1,
        error: { type: 'ConfigError', message: 'No accounts are managed yet' },
      }),
    },
  });
  await $.session.start(START);
  const r = await $.command.run({ command: 'swap', args: 'next' });
  expect(r).toEqual(expect.objectContaining({ text: 'cswap: No accounts are managed yet' }));
});

test('/swap lists accounts when no pane can be placed', async ($, on) => {
  host(on);
  await $.session.start(START);
  const r = await $.command.run({ command: 'swap', args: '' });
  expect(r).toEqual(expect.objectContaining({ text: expect.stringContaining('#2 work (b@example.com): 5h –') }));
});

test('auto-switch is off by default', async ($, on) => {
  const h = host(on);
  await $.session.start(START);
  await $.command.run({ command: 'swap', args: '' });
  expect(h.runs.some((r) => r[1] === 'auto')).toBe(false);
});

test('auto-switch on: runs auto --once and toasts a switch', { options: { auto_switch: true } }, async ($, on) => {
  const switched = [
    JSON.stringify({ schemaVersion: 1, event: 'poll' }),
    JSON.stringify({
      schemaVersion: 1,
      event: 'switch',
      trigger: 'proactive',
      to: { number: 2, email: 'b@example.com' },
    }),
  ].join('\n');
  const h = host(on, { auto: { exitCode: 0, stdout: switched } });
  await $.session.start(START);
  await $.command.run({ command: 'swap', args: '' });
  expect(h.runs).toContainEqual(['cswap', 'auto', '--once', '--json']);
  expect(h.toasts).toContain('cswap switched to #2 b@example.com');
});

test('missing binary: the pane says how to install it', async ($, on) => {
  host(on, {}, { missing: true });
  await $.session.start(START);
  await $.command.run({ command: 'swap', args: '' });
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'cswap',
      surface,
      component: 'Pane',
      requestId: 'cswap',
      props: { title: 'Accounts', isFocused: true, bodyColumns: 80 },
    });
    expect(await ui.find({ type: 'Text', text: /cswap not found/ })).toBeDefined();
    await ui.unmount();
  }
});

test('pane draws a switch button per inactive account', async ($, on) => {
  const h = host(on, {
    switch: { exitCode: 0, stdout: JSON.stringify({ to: { number: 2, email: 'b@example.com' } }) },
  });
  await $.session.start(START);
  await $.command.run({ command: 'swap', args: '' });
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'cswap',
      surface,
      component: 'Pane',
      requestId: 'cswap',
      props: { title: 'Accounts', isFocused: true, bodyColumns: 80 },
    });
    expect(await ui.find({ key: 'switch-1' })).toBeUndefined();
    await ui.press({ key: 'switch-2' });
    await ui.unmount();
  }
  expect(h.runs.filter((r) => r[1] === 'switch')).toEqual([
    ['cswap', 'switch', '2', '--json'],
    ['cswap', 'switch', '2', '--json'],
  ]);
  expect(h.toasts).toContain('Switched to #2 b@example.com.');
});

test('refreshes every 2 minutes', async ($, on) => {
  const h = host(on);
  await $.session.start(START);
  await h.clock.settle();
  const lists = () => h.runs.filter((r) => r[1] === 'list').length;
  const before = lists();
  await h.clock.advance(120_000);
  expect(lists()).toBe(before + 1);
});
