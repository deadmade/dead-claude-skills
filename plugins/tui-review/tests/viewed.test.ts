import type { On } from 'claude-code';
import { type Engine, expect, test } from 'claude-code/testing';

import { Manifest, fromBase64 } from '../hooks/chunks';
import * as fixture from './fixture.gen';
import { DIR, engine, pane, rowText } from './harness';

const PROGRESS = [`manifest ${DIR}`, 'text 0', 'hl 0', 'done'];
const run = {
  command: 'tui-review',
  args: 'demo',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 200 },
} as const;
const COLS = 160;
const manifest = new Manifest(fromBase64(fixture.manifest));
const today = () => Math.floor(Date.now() / 86_400_000);

async function open($: Engine, on: On, store?: Record<string, unknown>) {
  const recorded = engine(on, PROGRESS, store);
  await $.command.run(run);
  await recorded.opened;
  const ui = await $.ui.mount(pane(COLS, 40));
  const row = async (n: number) => {
    const raster = await ui.find({ type: 'Raster', key: 'diff' });
    return rowText(recorded.blits.at(-1) ?? String(raster?.props.cells), COLS, n);
  };
  return { ui, recorded, row };
}

test('r marks the file viewed, saves it by blob and collapses it where it is', async ($, on) => {
  const { ui, row, recorded } = await open($, on);
  expect(await row(0)).toContain('✓ 0/');
  await ui.press({ key: 'r' });
  const bar = await row(0);
  expect(bar).toContain(`1/${manifest.files} ✓ ${manifest.file(0).path}`);
  expect(bar).toContain('✓ 1/');
  expect(await row(1)).toContain(`✓ ${manifest.file(0).path}`);
  // The next file follows right under the collapsed one; the cursor did not move to it.
  expect(await row(2)).toContain(manifest.file(1).path);
  const saved = recorded.store.get('viewed') as Record<string, number>;
  expect(Object.keys(saved)).toEqual([manifest.blob(0)]);
});

test('r with the cursor inside a file collapses that file and puts the cursor on its header', async ($, on) => {
  const { ui, row } = await open($, on);
  for (let i = 0; i < 5; i++) await ui.press({ key: 'j' });
  await ui.press({ key: 'r' });
  expect(await row(1)).toContain(`✓ ${manifest.file(0).path}`);
  await ui.press({ key: 'j' });
  expect(await row(0)).toContain(`2/${manifest.files} ${manifest.file(1).path}`);
});

test('files viewed in an earlier session open collapsed, and r on one opens it again', async ($, on) => {
  const { ui, row, recorded } = await open($, on, { viewed: { [manifest.blob(0)]: today() } });
  expect(await row(0)).toContain(`1/${manifest.files} ✓ ${manifest.file(0).path}`);
  expect(await row(0)).toContain('✓ 1/');
  expect(await row(2)).toContain(manifest.file(1).path);
  await ui.press({ key: 'r' });
  expect(await row(0)).toContain('✓ 0/');
  expect(await row(2)).not.toContain(manifest.file(1).path);
  expect(recorded.store.get('viewed')).toEqual({});
});

test('a mark on an older version of the file does not collapse it', async ($, on) => {
  const { row } = await open($, on, { viewed: { ['0'.repeat(40)]: today() } });
  expect(await row(0)).toContain('✓ 0/');
  expect(await row(2)).not.toContain(manifest.file(1).path);
});
