import type { On } from 'claude-code'
import { type Engine, expect, test } from 'claude-code/testing'

import { Kind, Lines, Manifest, fromBase64 } from '../hooks/chunks'
import * as fixture from './fixture.gen'
import { DIR, engine, pane, rowText } from './harness'

const PROGRESS = [`manifest ${DIR}`, 'text 0', 'hl 0', 'done']
const run = { command: 'tui-review', args: 'demo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const
const COLS = 160
const manifest = new Manifest(fromBase64(fixture.manifest))
const lines = new Lines(fromBase64(fixture.lines[0]!))
/** The first line of code in the review, and its line number in the new file. */
const code = (() => {
  for (let i = 0; i < lines.n; i++) {
    const kind = lines.kind[i]
    if (kind === Kind.Context || kind === Kind.Add) return { at: i, lineNo: lines.newNo[i]!, text: lines.line(i) }
  }
  throw new Error('no code line in the fixture')
})()

async function open($: Engine, on: On) {
  const recorded = engine(on, PROGRESS)
  await $.command.run(run)
  await recorded.opened
  const ui = await $.ui.mount(pane(COLS, 40))
  const row = (n: number) => rowText(recorded.blits.at(-1) ?? '', COLS, n)
  const buttons = async () => (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label))
  return { ui, recorded, row, buttons }
}

test('c asks for a comment on the cursor line; s sends it to Claude with its place and the diff, then clears it', async ($, on) => {
  const { ui, recorded, row, buttons } = await open($, on)
  for (let i = 0; i < code.at; i++) await ui.press({ key: 'j' })
  await ui.press({ key: 'c' })
  const field = await ui.find({ type: 'Input', key: 'comment' })
  expect(String(field?.props.label)).toContain(`${manifest.file(0).path}:${code.lineNo}`)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)

  await ui.input({ key: 'comment', text: 'why is this here?' })
  expect(await ui.find({ type: 'Input', key: 'comment' })).toBeUndefined()
  expect(await buttons()).toContain('send 1')
  await ui.press({ key: 'j' })
  expect(row(0)).toContain('✎ 1')
  expect(row(1 + code.at).charAt(6)).toBe('●')
  expect(row(2 + code.at)).toContain('✎ why is this here?')

  await ui.press({ key: 's' })
  expect(recorded.prompts).toHaveLength(1)
  const sent = recorded.prompts[0]!
  expect(sent).toContain(`${manifest.file(0).path}:${code.lineNo} (new)`)
  expect(sent).toContain('```diff')
  expect(sent).toContain(code.text)
  expect(sent).toContain('why is this here?')
  expect(await buttons()).toContain('send')
  await ui.press({ key: 'k' })
  expect(row(0)).not.toContain('✎')
  expect(row(2 + code.at)).not.toContain('why is this here?')
})

test('a long comment wraps under its line so all of it shows', async ($, on) => {
  const { ui, row } = await open($, on)
  for (let i = 0; i < code.at; i++) await ui.press({ key: 'j' })
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`)
  await ui.press({ key: 'c' })
  await ui.input({ key: 'comment', text: words.join(' ') })
  await ui.press({ key: 'j' })
  let shown = ''
  for (let r = 2 + code.at; r < 39 && row(r).startsWith(' '.repeat(9)); r++) shown += ` ${row(r).replace('✎', '').trim()}`
  expect(shown.trim()).toBe(words.join(' '))
})

test('c on a commented line edits it, and an empty comment deletes it', async ($, on) => {
  const { ui, buttons } = await open($, on)
  for (let i = 0; i < code.at; i++) await ui.press({ key: 'j' })
  await ui.press({ key: 'c' })
  await ui.input({ key: 'comment', text: 'first' })
  await ui.press({ key: 'c' })
  expect((await ui.find({ type: 'Input', key: 'comment' }))?.props.value).toBe('first')
  await ui.input({ key: 'comment', text: '' })
  expect(await buttons()).toContain('send')
  expect(await buttons()).not.toContain('send 1')
})

test('c on a file header comments on the whole file; s with nothing written sends nothing', async ($, on) => {
  const { ui, recorded } = await open($, on)
  await ui.press({ key: 's' })
  expect(recorded.prompts).toHaveLength(0)
  expect(recorded.toasts.at(-1)).toContain('no comments')
  await ui.press({ key: 'c' })
  await ui.input({ key: 'comment', text: 'split this file' })
  await ui.press({ key: 's' })
  expect(recorded.prompts[0]).toContain(`${manifest.file(0).path} (whole file)\nsplit this file`)
})
