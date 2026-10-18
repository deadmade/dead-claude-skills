import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

import { PS, PS_ENCODED, PS_PATH, RESET, SET, SH_PATH, isNightCity } from './background';

const NIGHT = 'custom:dead-skills:night-city';

// Fakes the host beneath the plugin: the theme row, config writes and the child processes, recording what each ran.
function host(on: On, { theme = NIGHT, shExit = 0 } = {}) {
  const clock = mock.clock(on);
  const runs: { argv0: string; osc: string }[] = [];
  on('session.start', () => ({ cwd: '/' }));
  on('session.end', () => ({ sessionId: 's' }) as never);
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'text', value: theme }] as never }));
  on('config.set', (_$, e) => ({ value: e.value }) as never);
  on('process.run', (_$, e) => {
    const sh = e.argv[0] === SH_PATH;
    runs.push({ argv0: e.argv[0]!, osc: sh ? e.argv[4]! : e.init!.env!.NIGHT_CITY_OSC! });
    return { value: { exitCode: sh ? shExit : 0, stdout: '', stderr: '' } as never };
  });
  return { clock, runs };
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const;

// The person picking a theme in /theme.
const pickTheme = (value: string) =>
  ({
    key: 'theme',
    value,
    previous: '',
    provider: { plugin: 'engine', tier: 'core' },
    origin: { kind: 'composer' },
  }) as const;

test('the stored value of the plugin theme counts as Night City, other themes do not', () => {
  expect(isNightCity(NIGHT)).toBe(true);
  expect(isNightCity('dark')).toBe(false);
  expect(isNightCity(undefined)).toBe(false);
});

test('with Night City selected the terminal background is set at start and reset at exit', async ($, on) => {
  const h = host(on);
  await $.session.start(START);
  await h.clock.settle();
  expect(h.runs).toEqual([{ argv0: SH_PATH, osc: SET }]);
  await $.session.end({ reason: 'prompt_input_exit' } as never);
  expect(h.runs.at(-1)).toEqual({ argv0: SH_PATH, osc: RESET });
});

test('another theme leaves the terminal alone', async ($, on) => {
  const h = host(on, { theme: 'dark' });
  await $.session.start(START);
  await h.clock.settle();
  await $.session.end({ reason: 'other' } as never);
  expect(h.runs).toEqual([]);
});

test('a session outside the terminal leaves it alone', async ($, on) => {
  const h = host(on);
  await $.session.start({ ...START, isInteractive: false });
  await h.clock.settle();
  expect(h.runs).toEqual([]);
});

test('switching the theme away resets the background, switching back sets it', async ($, on) => {
  const h = host(on);
  await $.session.start(START);
  await h.clock.settle();
  await $.config.set(pickTheme('dark'));
  await h.clock.settle();
  await $.config.set(pickTheme(NIGHT));
  await h.clock.settle();
  expect(h.runs.map((r) => r.osc)).toEqual([SET, RESET, SET]);
});

test('a /clear keeps the background, since the terminal goes on', async ($, on) => {
  const h = host(on);
  await $.session.start(START);
  await h.clock.settle();
  await $.session.end({ reason: 'clear' } as never);
  expect(h.runs.map((r) => r.osc)).toEqual([SET]);
});

test('when sh finds no tty, PowerShell writes to the console instead', async ($, on) => {
  const h = host(on, { shExit: 1 });
  await $.session.start(START);
  await h.clock.settle();
  expect(h.runs).toEqual([
    { argv0: SH_PATH, osc: SET },
    { argv0: PS_PATH, osc: SET },
  ]);
});

test('the PowerShell script is encoded as UTF-16LE base64, as -EncodedCommand expects', () => {
  expect(atob(PS_ENCODED).replaceAll('\0', '')).toBe(PS);
  expect(atob(PS_ENCODED).length).toBe(PS.length * 2);
});
