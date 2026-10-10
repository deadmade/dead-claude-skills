import type { On } from 'claude-code'
import { type Engine, expect, test } from 'claude-code/testing'

import { Manifest, fromBase64 } from '../hooks/chunks'
import * as fixture from './fixture.gen'
import { DIR, engine, pane, rowText } from './harness'

const PROGRESS = [`manifest ${DIR}`, 'text 0', 'hl 0', 'done']
const run = { command: 'tui-review', args: 'demo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const
const COLS = 160
const manifest = new Manifest(fromBase64(fixture.manifest))

async function open($: Engine, on: On, store?: Record<string, unknown>) {
  const recorded = engine(on, PROGRESS, store)
  await $.command.run(run)
  await recorded.opened
  const ui = await $.ui.mount(pane(COLS, 40))
  const bar = async () => {
    const raster = await ui.find({ type: 'Raster', key: 'diff' })
    return rowText(recorded.blits.at(-1) ?? String(raster?.props.cells), COLS, 0)
  }
  return { ui, recorded, bar }
}

test('v marks the file viewed, saves it by blob and moves to the next file', async ($, on) => {
  const { ui, bar, recorded } = await open($, on)
  expect(await bar()).toContain('✓ 0/')
  await ui.press({ key: 'v' })
  const header = await bar()
  expect(header).toContain(`2/${manifest.files} ${manifest.file(1).path}`)
  expect(header).toContain('✓ 1/')
  const saved = recorded.store.get('viewed') as Record<string, number>
  expect(Object.keys(saved)).toEqual([manifest.blob(0)])
})

test('marks from earlier sessions show, and v on a viewed file clears it', async ($, on) => {
  const { ui, bar, recorded } = await open($, on, { viewed: { [manifest.blob(0)]: Math.floor(Date.now() / 86_400_000) } })
  const header = await bar()
  expect(header).toContain(`1/${manifest.files} ✓ ${manifest.file(0).path}`)
  expect(header).toContain('✓ 1/')
  await ui.press({ key: 'v' })
  expect(await bar()).toContain('✓ 0/')
  expect(recorded.store.get('viewed')).toEqual({})
})
