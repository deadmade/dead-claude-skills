import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TuiReviewOpen } from '../types'
import { Highlights, Lines, Manifest, chunkName, fromBase64, toBase64 } from './chunks'
import { type Loaded, paint } from './paint'
import { VIEWED_KEY, Viewed } from './viewed'

const PANE = 'review'
const RASTER = 'diff'
/** Chunks kept in memory: the one or two the window spans plus one ahead. */
const RESIDENT = 3

const reviewAtom = atom({ plugin: 'tui-review', key: 'review' } as const, null as TuiReviewOpen | null)

// What the pane draws from. Module memory, not $.state: it changes on every scroll, and a reload just reads it again.
let manifest: { dir: string; value: Manifest } | undefined
let viewed: { marks: Viewed; files: Uint8Array; count: number } | undefined
const resident = new Map<number, Loaded>()
let top = 0
let mounted: { cols: number; rows: number } | undefined
/** The frame's cells, reused while the size holds, so a scroll allocates nothing. */
let cells = new Uint32Array(0)
let painting: Promise<void> | undefined
let paintAgain = false
let stopRun: (() => void) | undefined

type $ = EngineInterface

async function readBytes($: $, path: string) {
  const { base64 } = await $.fs.read(path, { as: 'bytes' })
  return fromBase64(base64)
}

async function loadManifest($: $, dir: string): Promise<Manifest> {
  if (manifest?.dir !== dir) {
    const value = new Manifest(await readBytes($, `${dir}/manifest.brv`))
    const marks = Viewed.from(await $.store.get(VIEWED_KEY))
    const files = new Uint8Array(value.files)
    let count = 0
    for (let i = 0; i < value.files; i++) {
      if (marks.has(value.blob(i))) {
        files[i] = 1
        count++
      }
    }
    manifest = { dir, value }
    viewed = { marks, files, count }
    resident.clear()
  }
  return manifest.value
}

/** Loads the chunks lines `[from, to)` need, plus the next, and evicts the rest down to RESIDENT. */
async function ensureChunks($: $, dir: string, m: Manifest, from: number, to: number) {
  const first = Math.floor(from / m.chunkLines)
  const last = Math.min(m.chunks - 1, Math.floor(Math.max(from, to - 1) / m.chunkLines) + 1)
  const wanted: number[] = []
  for (let c = first; c <= last; c++) wanted.push(c)
  await Promise.all(
    wanted.map(async c => {
      const have = resident.get(c)
      if (have?.hl !== undefined) return
      const lines = have?.lines ?? (await readOptional($, `${dir}/${chunkName(c, 'lines')}`).then(b => b && new Lines(b)))
      if (lines === undefined) return
      const hlBytes = await readOptional($, `${dir}/${chunkName(c, 'hl')}`)
      resident.set(c, { lines, hl: hlBytes && new Highlights(hlBytes) })
    }),
  )
  for (const c of resident.keys()) {
    if (resident.size <= RESIDENT) break
    if (!wanted.includes(c)) resident.delete(c)
  }
}

/** A chunk brv has not written yet reads as undefined. */
async function readOptional($: $, path: string) {
  return (await $.fs.exists(path)) ? readBytes($, path) : undefined
}

/** Paints the frame for the mounted size; undefined until the pane has drawn once. */
async function frame($: $): Promise<string | undefined> {
  const review = await $.state.get({ plugin: 'tui-review', key: 'review' })
  if (mounted === undefined || !review.value) return undefined
  const started = performance.now()
  const m = await loadManifest($, review.value.dir)
  const { cols, rows } = mounted
  await ensureChunks($, review.value.dir, m, top, top + rows)
  const loadedAt = performance.now()
  if (cells.length !== cols * rows * 3) cells = new Uint32Array(cols * rows * 3)
  paint(cells, cols, rows, top, { manifest: m, viewed, chunk: c => resident.get(c) })
  const encoded = toBase64(new Uint8Array(cells.buffer))
  const done = performance.now()
  $.ui.status(
    `review · load ${(loadedAt - started).toFixed(1)}ms · paint ${(done - loadedAt).toFixed(1)}ms · ${resident.size} chunks`,
  )
  return encoded
}

/** Repaints in place with $.ui.blit; scrolls that land while a paint runs fold into one more paint. */
function repaint($: $): Promise<void> {
  if (painting !== undefined) {
    paintAgain = true
    return painting
  }
  painting = (async () => {
    do {
      paintAgain = false
      const next = await frame($)
      if (next === undefined) break
      const blit = await $.ui.blit({ requestId: PANE, key: RASTER, cells: next })
      if (blit.deny !== undefined) {
        $.ui.invalidate('ui.render')
        break
      }
    } while (paintAgain)
  })().finally(() => {
    painting = undefined
  })
  return painting
}

function maxTop(): number {
  const total = manifest?.value.totalLines ?? 0
  return Math.max(0, total - Math.max(1, (mounted?.rows ?? 2) - 1))
}

function scrollTo($: $, line: number) {
  const next = Math.min(maxTop(), Math.max(0, Math.round(line)))
  if (next === top) return
  top = next
  void repaint($)
}

function fileJump($: $, by: 1 | -1) {
  const m = manifest?.value
  if (m === undefined || m.files === 0) return
  const at = m.fileAt(top)
  // Back from inside a file goes to its own header first.
  const target = by < 0 && m.firstLine(at) < top ? at : Math.min(m.files - 1, Math.max(0, at + by))
  scrollTo($, m.firstLine(target))
}

/** Marks the file at the top viewed and moves to the next unviewed one, or clears the mark and stays. */
async function toggleViewed($: $) {
  const m = manifest?.value
  if (m === undefined || viewed === undefined || m.files === 0) return
  const index = m.fileAt(top)
  const isViewed = viewed.marks.toggle(m.blob(index))
  await $.store.set(VIEWED_KEY, viewed.marks.stored())
  viewed.files[index] = isViewed ? 1 : 0
  viewed.count += isViewed ? 1 : -1
  let next = index
  if (isViewed) {
    for (let i = index + 1; i < m.files; i++) {
      if (viewed.files[i] === 0) {
        next = i
        break
      }
    }
  }
  if (next !== index) scrollTo($, m.firstLine(next))
  else {
    top = m.firstLine(index)
    await repaint($)
  }
}

/** Reads brv's progress lines and acts on them; one run at a time, a new one ends the old. */
async function run($: $, argv: string[]) {
  stopRun?.()
  const stream = $.process.spawn({ argv })
  let isStopped = false
  stopRun = () => {
    isStopped = true
    void stream.return?.(undefined as never)
  }
  let pending = ''
  try {
    for await (const piece of stream) {
      if (isStopped) break
      if (piece.stream === 'stderr') continue
      pending += piece.text
      for (let nl = pending.indexOf('\n'); nl >= 0; nl = pending.indexOf('\n')) {
        const line = pending.slice(0, nl).trimEnd()
        pending = pending.slice(nl + 1)
        await onLine($, line)
      }
    }
  } catch (err) {
    $.ui.toast(`review: could not run ${argv[0]}: ${String(err)}`)
  }
}

async function onLine($: $, line: string) {
  const space = line.indexOf(' ')
  const word = space < 0 ? line : line.slice(0, space)
  const rest = space < 0 ? '' : line.slice(space + 1)
  switch (word) {
    case 'manifest':
    case 'cached': {
      manifest = undefined
      top = 0
      const m = await loadManifest($, rest)
      const title = `${m.headName} ← ${m.baseName}`
      await update($, reviewAtom, () => ({ dir: rest, title }))
      await $.ui.open({ id: PANE, title: `Review ${title}`, focus: true })
      void repaint($)
      return
    }
    case 'text':
    case 'hl': {
      const index = Number(rest)
      const m = manifest?.value
      if (m === undefined || mounted === undefined) return
      const first = Math.floor(top / m.chunkLines)
      const last = Math.floor((top + mounted.rows) / m.chunkLines)
      if (index < first || index > last) return
      if (word === 'hl') resident.delete(index)
      void repaint($)
      return
    }
    case 'error':
      $.ui.toast(`review: ${rest}`)
      return
  }
}

export const register: Register = (on, options) => {
  const brv = typeof options.brvPath === 'string' && options.brvPath !== '' ? options.brvPath : 'brv'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tui-review',
      description: 'Review this branch against the one it is based on, in a pane beside the chat',
      argumentHint: '[base] | demo',
    })
    return next(e)
  })

  on('command.run', { command: 'tui-review' }, async ($, e) => {
    const arg = e.args.trim()
    const argv = arg === 'demo' ? [brv, 'gen', '--lines', '100000'] : [brv, 'review', ...(arg ? ['--base', arg] : [])]
    void run($, argv)
    return { text: arg === 'demo' ? 'Opening a 100k-line demo review.' : 'Opening the review.' }
  })

  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    scrollTo($, top + e.by)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const review = await read($, reviewAtom)
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The review pane draws in the terminal for now.</Text>
    }
    const { Box, Text, Raster, Button } = $.ui.resolve(e)
    if (review === null) return <Text dimColor>No review open. Run /tui-review.</Text>

    const cols = Math.max(20, Math.min(512, e.props.bodyColumns))
    const rows = Math.max(3, Math.min(256, e.props.scroll.bodyRows - 1))
    mounted = { cols, rows }
    top = Math.min(top, maxTop())
    const drawn = (await frame($)) ?? ''

    const key = (hotkey: string, label: string, act: () => void) => (
      <Button key={hotkey} plain hotkey={hotkey} label={label} onPress={act} />
    )
    return (
      <Box flexDirection="column">
        <Raster key={RASTER} columns={cols} rows={rows} cells={drawn} />
        <Box flexDirection="row" gap={1}>
          {key('j', '↓', () => scrollTo($, top + 1))}
          {key('k', '↑', () => scrollTo($, top - 1))}
          {key('d', 'page↓', () => scrollTo($, top + rows - 2))}
          {key('u', 'page↑', () => scrollTo($, top - rows + 2))}
          {key('n', 'file↓', () => fileJump($, 1))}
          {key('p', 'file↑', () => fileJump($, -1))}
          {key('v', 'viewed', () => void toggleViewed($))}
        </Box>
      </Box>
    )
  })
}
