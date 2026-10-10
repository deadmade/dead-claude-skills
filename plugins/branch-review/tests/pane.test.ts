import { expect, test } from 'claude-code/testing'

import { DIR, engine, pane, residentOf } from './harness'

const PROGRESS = [`manifest ${DIR}`, 'text 0', 'hl 0', 'done']
const run = { command: 'brv', args: 'demo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const

test('/review demo opens the pane and draws the diff', async ($, on) => {
  const recorded = engine(on, PROGRESS)
  await $.command.run(run)
  await recorded.opened
  const ui = await $.ui.mount(pane(120, 40))
  const raster = await ui.find({ type: 'Raster', key: 'diff' })
  expect(raster?.props.columns).toBe(120)
  expect(raster?.props.rows).toBe(39)
  expect(String(raster?.props.cells).length).toBeGreaterThan(0)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(6)
})

test('scrolling repaints in place without a render pass', async ($, on) => {
  const recorded = engine(on, PROGRESS)
  await $.command.run(run)
  await recorded.opened
  const ui = await $.ui.mount(pane(120, 40))
  const before = recorded.blits.length
  await ui.press({ key: 'd' })
  await ui.press({ key: 'j' })
  expect(recorded.blits.length).toBeGreaterThan(before)
  await ui.press({ key: 'n' })
  expect(residentOf(recorded.status.at(-1) ?? '')).toBeLessThanOrEqual(3)
})
