// Stands in for the engine under the plugin: answers its file reads from the `brv gen` fixture (any chunk index gets
// one of the fixture's chunks, so a 100k-line review needs only three of them) and records what it paints.

import type { On } from 'claude-code'

import { hl, lines, manifest } from './fixture.gen'

export const DIR = '/fixture'

export type Recorded = {
  blits: string[]
  status: string[]
  reads: string[]
  opened: Promise<void>
}

/** Chunks read from "disk" per scroll, and how many are resident, read off the plugin's status line. */
export const residentOf = (status: string) => Number(/(\d+) chunks/.exec(status)?.[1] ?? NaN)

export function engine(on: On, progress: string[]): Recorded {
  let markOpened = () => {}
  const recorded: Recorded = {
    blits: [],
    status: [],
    reads: [],
    opened: new Promise(resolve => (markOpened = resolve)),
  }
  const fileOf = (path: string) => {
    const name = path.slice(DIR.length + 1)
    if (name === 'manifest.brv') return manifest
    const match = /^(\d{4})\.(lines|hl)$/.exec(name)
    if (match === null) return undefined
    const list = match[2] === 'lines' ? lines : hl
    return list[Number(match[1]) % list.length]
  }
  on('fs.exists', async (_$, e) => ({ value: fileOf(e.path) !== undefined }))
  on('fs.read', async (_$, e) => {
    recorded.reads.push(e.path)
    const base64 = fileOf(e.path)
    if (base64 === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: { base64 } }
  })
  on('process.spawn', async function* () {
    for (const line of progress) yield { stream: 'stdout' as const, text: `${line}\n` }
    return { value: { code: 0, signal: null } }
  })
  on('ui.open', async () => {
    markOpened()
    return { value: { isPlaced: true as const } }
  })
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) recorded.blits.push(e.cells)
    return { value: {} }
  })
  on('ui.status', async (_$, e) => {
    if (e.text !== undefined) recorded.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async () => ({ value: undefined }))
  return recorded
}

export const pane = (columns: number, rows: number) =>
  ({
    plugin: 'tui-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'review',
    viewport: { columns, rows, isFullscreen: true },
    props: {
      title: 'Review',
      isFocused: true,
      bodyColumns: columns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
  }) as const
