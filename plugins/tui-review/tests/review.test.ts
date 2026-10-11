import { expect, mock, test } from 'claude-code/testing';

import { Kind, Lines, Manifest, fromBase64 } from '../hooks/chunks';
import * as fixture from './fixture.gen';
import { CWD, engine, pane, rowText } from './harness';

const COLS = 160;
const ROWS = 40;
const branch = (args: string) =>
  ({
    command: 'tui-review',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  }) as const;
const manifest = new Manifest(fromBase64(fixture.manifest));
const lines = new Lines(fromBase64(fixture.lines[0]!));
const firstCode = (() => {
  for (let i = 0; i < lines.n; i++) if (lines.kind[i] === Kind.Add || lines.kind[i] === Kind.Context) return i;
  throw new Error('no code line in the fixture');
})();

/** brv answers each run with the review in `dirs[n]`, the last one again once they run out. */
function reviews(dirs: string[]) {
  let n = 0;
  return (argv: readonly string[]) => {
    const dir = dirs[Math.min(n, dirs.length - 1)]!;
    n++;
    return argv[1] === 'review' && n > 1 && dirs[n - 2] === dir
      ? [`cached ${dir}`]
      : [`manifest ${dir}`, 'text 0', 'hl 0', 'done'];
  };
}

const ask = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const;

test('/tui-review reviews the branch in the session directory; a base given goes along', async ($, on) => {
  const clock = mock.clock(on);
  const recorded = engine(on, reviews(['/fixture']));
  const answer = await $.command.run(branch(''));
  expect(JSON.stringify(answer)).toContain('stacked on');
  await recorded.opened;
  expect(recorded.spawns[0]).toEqual(['brv', 'review', '--repo', CWD]);
  expect(recorded.opens[0]).toEqual({ id: 'review', focus: true });

  await $.command.run(branch('origin/main'));
  await clock.settle();
  expect(recorded.spawns[1]).toEqual(['brv', 'review', '--repo', CWD, '--base', 'origin/main']);
});

test('each prompt tells Claude which diff is open and where the cursor is', async ($, on) => {
  const recorded = engine(on, reviews(['/fixture']));
  await $.command.run(branch(''));
  await recorded.opened;
  const ui = await $.ui.mount(pane(COLS, ROWS));
  for (let i = 0; i < firstCode; i++) await ui.press({ key: 'j' });

  await $.prompt.submit(ask('what does this do?'));
  const note = recorded.contexts.at(-1)?.join('\n') ?? '';
  expect(note).toContain(`reviewing ${manifest.headName} against ${manifest.baseName}`);
  expect(note).toContain(`git diff ${manifest.mergeBaseSha.slice(0, 12)}..${manifest.headSha.slice(0, 12)}`);
  expect(note).toContain(`${manifest.file(0).path}:${lines.newNo[firstCode]} (new)`);

  await ui.press({ key: 'q' });
  await $.prompt.submit(ask('and now?'));
  expect(recorded.contexts.at(-1)).toEqual([]);
});

test('the demo review adds no context', async ($, on) => {
  const recorded = engine(on, reviews(['/fixture']));
  await $.command.run(branch('demo'));
  await recorded.opened;
  await $.ui.mount(pane(COLS, ROWS));
  await $.prompt.submit(ask('hi'));
  expect(recorded.contexts.at(-1)).toEqual([]);
});

test('a Bash call runs the review again; unchanged, the pane keeps its place', async ($, on) => {
  const clock = mock.clock(on);
  const recorded = engine(on, reviews(['/fixture']));
  await $.command.run(branch('b1'));
  await recorded.opened;
  const ui = await $.ui.mount(pane(COLS, ROWS));
  await ui.press({ key: 'n' });
  const bar = rowText(recorded.blits.at(-1) ?? '', COLS, 0);

  await $.tool.call({ tool: 'Bash', input: { command: 'git status' } } as never);
  await clock.settle();
  expect(recorded.spawns).toHaveLength(2);
  expect(recorded.spawns[1]).toEqual(['brv', 'review', '--repo', CWD, '--base', 'b1']);
  expect(recorded.opens).toHaveLength(1);
  await ui.press({ key: 'j' });
  await ui.press({ key: 'k' });
  expect(rowText(recorded.blits.at(-1) ?? '', COLS, 0)).toBe(bar);
});

test('a new commit opens the new review in place, on the same file, with comments moved onto it', async ($, on) => {
  const clock = mock.clock(on);
  const recorded = engine(on, reviews(['/fixture', '/fixture2']));
  await $.command.run(branch(''));
  await recorded.opened;
  const ui = await $.ui.mount(pane(COLS, ROWS));
  const row = (n: number) => rowText(recorded.blits.at(-1) ?? '', COLS, n);
  for (let i = 0; i < firstCode; i++) await ui.press({ key: 'j' });
  await ui.press({ key: 'c' });
  await ui.input({ key: 'comment', text: 'still here?' });

  await $.tool.call({ tool: 'Bash', input: { command: 'git commit -am x' } } as never);
  await clock.settle();
  expect(recorded.spawns).toHaveLength(2);
  expect(recorded.toasts).toEqual([]);
  expect(recorded.opens.at(-1)).toEqual({ id: 'review', focus: false });
  await ui.press({ key: 'k' });
  await ui.press({ key: 'j' });
  // The fixture's review is the same in both directories, so the comment lands back on its line.
  expect(row(0)).toContain('✎ 1');
  expect(row(2 + firstCode)).toContain('✎ still here?');
});

test('no refresh while a comment is being written', async ($, on) => {
  const clock = mock.clock(on);
  const recorded = engine(on, reviews(['/fixture', '/fixture2']));
  await $.command.run(branch(''));
  await recorded.opened;
  const ui = await $.ui.mount(pane(COLS, ROWS));
  await ui.press({ key: 'c' });
  await $.tool.call({ tool: 'Bash', input: { command: 'git commit -am x' } } as never);
  await clock.settle();
  expect(recorded.spawns).toHaveLength(1);
  expect(await ui.find({ type: 'Input', key: 'comment' })).toBeDefined();
});
