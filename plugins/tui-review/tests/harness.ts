// Stands in for the engine under the plugin: answers its file reads from the `brv gen` fixture (any chunk index gets
// one of the fixture's chunks, so a 100k-line review needs only three of them) and records what it paints.

import type { On } from 'claude-code'

import { fromBase64 } from '../hooks/chunks'

import { hl, lines, manifest } from './fixture.gen'

export const DIR = '/fixture'

export type Recorded = {
  /** The plugin's $.store, in memory, readable by the test. */
  store: Map<string, unknown>
  blits: string[]
  status: string[]
  reads: string[]
  /** The prompts the plugin submitted, as Claude would get them. */
  prompts: string[]
  /** The hidden context each prompt carried, in the same order. */
  contexts: (readonly string[])[]
  toasts: string[]
  /** The ids of the panes closed. */
  closed: string[]
  /** Each process started, by its argv. */
  spawns: string[][]
  /** The ids of the panes opened, and whether each took the keyboard. */
  opens: { id: string; focus: boolean }[]
  opened: Promise<void>
}

/** The session directory the plugin sees. */
export const CWD = '/work/repo'

/** brv's progress lines per run: the same for every run, or chosen by its argv. */
export type Script = readonly string[] | ((argv: readonly string[]) => readonly string[])

/** Chunks read from "disk" per scroll, and how many are resident, read off the plugin's status line. */
export const residentOf = (status: string) => Number(/(\d+) chunks/.exec(status)?.[1] ?? NaN)

/** Row `row` of a painted frame as text, read back from the Raster's cells. */
export function rowText(cellsBase64: string, cols: number, row: number): string {
  const bytes = fromBase64(cellsBase64)
  const cells = new Uint32Array(bytes.buffer, row * cols * 12, cols * 3)
  let text = ''
  for (let i = 0; i < cells.length; i += 3) text += String.fromCharCode(cells[i]!)
  return text.trimEnd()
}

/** The background colour of cell `col` in row `row` of a painted frame. */
export function cellBg(cellsBase64: string, cols: number, row: number, col = 0): number {
  const bytes = fromBase64(cellsBase64)
  return new Uint32Array(bytes.buffer, (row * cols + col) * 12, 3)[2]!
}

export function engine(on: On, progress: Script, store: Record<string, unknown> = {}): Recorded {
  let markOpened = () => {}
  const recorded: Recorded = {
    store: new Map(Object.entries(store)),
    blits: [],
    status: [],
    reads: [],
    prompts: [],
    contexts: [],
    toasts: [],
    closed: [],
    spawns: [],
    opens: [],
    opened: new Promise(resolve => (markOpened = resolve)),
  }
  const fileOf = (path: string) => {
    // By file name: on Windows the engine hands the hook `/fixture/x` resolved, as `D:\fixture\x`.
    const name = path.split(/[\\/]/).at(-1) ?? ''
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
  on('process.spawn', async function* (_$, e) {
    recorded.spawns.push([...e.argv])
    const lines = typeof progress === 'function' ? progress(e.argv) : progress
    for (const line of lines) yield { stream: 'stdout' as const, text: `${line}\n` }
    return { value: { code: 0, signal: null } }
  })
  on('session.cwd', async () => ({ value: CWD }))
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('ui.open', async (_$, e) => {
    recorded.opens.push({ id: e.id, focus: e.focus === true })
    markOpened()
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async (_$, e) => {
    recorded.closed.push(e.id)
    return { value: undefined }
  })
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) recorded.blits.push(e.cells)
    return { value: {} }
  })
  on('ui.status', async (_$, e) => {
    if (e.text !== undefined) recorded.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async (_$, e) => {
    recorded.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', async (_$, e) => {
    recorded.prompts.push(e.text)
    recorded.contexts.push(e.context ?? [])
    return { text: e.text }
  })
  on('store.get', async (_$, e) => ({ value: structuredClone(recorded.store.get(e.key)) }))
  on('store.set', async (_$, e) => {
    recorded.store.set(e.key, structuredClone(e.value))
    return { value: undefined }
  })
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
