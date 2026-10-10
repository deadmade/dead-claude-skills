import { expect, test } from 'claude-code/testing'

import { theme } from '../hooks/theme'
import { DIR, cellBg, engine, pane, residentOf, rowText } from './harness'

const PROGRESS = [`manifest ${DIR}`, 'text 0', 'hl 0', 'done']
const run = { command: 'tui-review', args: 'demo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const
const COLS = 120
const ROWS = 40

test('/tui-review demo opens the pane and draws the diff', async ($, on) => {
  const recorded = engine(on, PROGRESS)
  await $.command.run(run)
  await recorded.opened
  const ui = await $.ui.mount(pane(COLS, ROWS))
  const raster = await ui.find({ type: 'Raster', key: 'diff' })
  expect(raster?.props.columns).toBe(COLS)
  expect(raster?.props.rows).toBe(ROWS - 1)
  expect(String(raster?.props.cells).length).toBeGreaterThan(0)
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.props.hotkey)
  expect(keys).toEqual(['j', 'k', 'n', 'p', 'r', 'c', 's'])
})

test('j and k move the cursor, and the window follows it past the bottom', async ($, on) => {
  const recorded = engine(on, PROGRESS)
  await $.command.run(run)
  await recorded.opened
  const ui = await $.ui.mount(pane(COLS, ROWS))
  const frame = () => recorded.blits.at(-1) ?? ''
  const before = recorded.blits.length

  await ui.press({ key: 'j' })
  expect(recorded.blits.length).toBeGreaterThan(before)
  expect(cellBg(frame(), COLS, 1)).not.toBe(theme.cursorBg)
  expect(cellBg(frame(), COLS, 2)).toBe(theme.cursorBg)
  await ui.press({ key: 'k' })
  expect(cellBg(frame(), COLS, 1)).toBe(theme.cursorBg)

  // The diff fills rows 1..ROWS-2; one more j than that scrolls the window by a line.
  const firstRow = rowText(frame(), COLS, 1)
  for (let i = 0; i < ROWS - 2; i++) await ui.press({ key: 'j' })
  expect(cellBg(frame(), COLS, ROWS - 2)).toBe(theme.cursorBg)
  expect(rowText(frame(), COLS, 1)).not.toBe(firstRow)
})

test('n and p move the cursor between files with few chunks resident', async ($, on) => {
  const recorded = engine(on, PROGRESS)
  await $.command.run(run)
  await recorded.opened
  const ui = await $.ui.mount(pane(COLS, ROWS))
  const bar = () => rowText(recorded.blits.at(-1) ?? '', COLS, 0)
  await ui.press({ key: 'n' })
  expect(bar()).toContain(' 2/')
  expect(cellBg(recorded.blits.at(-1) ?? '', COLS, 1)).toBe(theme.cursorBg)
  await ui.press({ key: 'j' })
  await ui.press({ key: 'p' })
  expect(bar()).toContain(' 2/')
  await ui.press({ key: 'p' })
  expect(bar()).toContain(' 1/')
  expect(residentOf(recorded.status.at(-1) ?? '')).toBeLessThanOrEqual(3)
})
