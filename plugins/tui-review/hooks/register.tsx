import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ReviewComment, TuiReviewOpen } from '../types'
import { Highlights, Kind, Lines, Manifest, chunkName, fromBase64, toBase64 } from './chunks'
import { message, upsert } from './comments'
import { type Loaded, paint } from './paint'
import { View } from './view'
import { VIEWED_KEY, Viewed } from './viewed'

const PANE = 'review'
const RASTER = 'diff'
/** Chunks kept in memory: the one or two the window spans plus one ahead. */
const RESIDENT = 3
/** Diff lines quoted with a comment: the commented line and up to this many before it in its hunk. */
const QUOTE_BEFORE = 2

const reviewAtom = atom({ plugin: 'tui-review', key: 'review' } as const, null as TuiReviewOpen | null)
const commentsAtom = atom({ plugin: 'tui-review', key: 'comments' } as const, [] as ReviewComment[])
const composingAtom = atom({ plugin: 'tui-review', key: 'composing' } as const, null as ReviewComment | null)

// What the pane draws from. Module memory, not $.state: it changes on every scroll, and a reload just reads it again.
let manifest: { dir: string; value: Manifest } | undefined
/** Viewed files are the collapsed ones: `files` is the view's `collapsed`. */
let viewed: { marks: Viewed; files: Uint8Array; count: number } | undefined
let view: View | undefined
const resident = new Map<number, Loaded>()
/** The view row drawn first, and the cursor's row. */
let top = 0
let cursor = 0
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
    view = new View(value, files)
    resident.clear()
  }
  return manifest.value
}

/** The chunks the window's rows show, in order, plus the next one. A collapsed file's row needs none. */
function windowChunks(v: View, from: number, count: number): number[] {
  const m = v.manifest
  const wanted: number[] = []
  for (let row = from, end = Math.min(v.rows, from + count); row < end; row++) {
    if (v.collapsed[v.fileOfRow(row)] === 1) continue
    const c = Math.floor(v.lineOfRow(row) / m.chunkLines)
    if (wanted.at(-1) !== c) wanted.push(c)
  }
  const ahead = (wanted.at(-1) ?? -1) + 1
  if (ahead > 0 && ahead < m.chunks) wanted.push(ahead)
  return wanted
}

/** Loads the chunks the window needs, plus the next, and evicts the rest down to RESIDENT. */
async function ensureChunks($: $, dir: string, wanted: number[]) {
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
  await loadManifest($, review.value.dir)
  const v = view!
  const { cols, rows } = mounted
  await ensureChunks($, review.value.dir, windowChunks(v, top, rows - 1))
  const loadedAt = performance.now()
  const drafts = (await $.state.get({ plugin: 'tui-review', key: 'comments' })).value ?? []
  const here = new Set<number>()
  for (const c of drafts) if (c.dir === review.value.dir) here.add(c.line)
  if (cells.length !== cols * rows * 3) cells = new Uint32Array(cols * rows * 3)
  paint(cells, cols, rows, top, {
    view: v,
    cursor,
    viewed,
    comments: { lines: here, count: drafts.length },
    chunk: c => resident.get(c),
  })
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

/** Rows of diff the window shows, below the header bar. */
const bodyRows = () => Math.max(1, (mounted?.rows ?? 2) - 1)

function maxTop(): number {
  return Math.max(0, (view?.rows ?? 0) - bodyRows())
}

/** Keeps `top` in range and the cursor inside the window, moving the window to it. */
function follow() {
  const last = Math.max(0, (view?.rows ?? 0) - 1)
  cursor = Math.min(last, Math.max(0, cursor))
  if (cursor < top) top = cursor
  if (cursor >= top + bodyRows()) top = cursor - bodyRows() + 1
  top = Math.min(maxTop(), Math.max(0, top))
}

function moveCursor($: $, row: number) {
  const before = { top, cursor }
  cursor = Math.round(row)
  follow()
  if (top !== before.top || cursor !== before.cursor) void repaint($)
}

/** The mouse wheel moves the window; the cursor stays on its row while that row stays in view. */
function scrollTo($: $, row: number) {
  const before = { top, cursor }
  top = Math.min(maxTop(), Math.max(0, Math.round(row)))
  cursor = Math.min(top + bodyRows() - 1, Math.max(top, cursor))
  follow()
  if (top !== before.top || cursor !== before.cursor) void repaint($)
}

/** The cursor to the next or previous file's header, shown at the top of the window. */
function fileJump($: $, by: 1 | -1) {
  const v = view
  if (v === undefined || v.manifest.files === 0) return
  const at = v.fileOfRow(cursor)
  // Back from inside a file goes to its own header first.
  const target = by < 0 && v.headerRow(at) < cursor ? at : Math.min(v.manifest.files - 1, Math.max(0, at + by))
  cursor = v.headerRow(target)
  top = cursor
  follow()
  void repaint($)
}

/** Marks the cursor's file viewed, collapsing it to its header, or clears the mark and opens it again. */
async function toggleViewed($: $) {
  const v = view
  if (v === undefined || viewed === undefined || v.manifest.files === 0) return
  const index = v.fileOfRow(cursor)
  const isViewed = viewed.marks.toggle(v.manifest.blob(index))
  await $.store.set(VIEWED_KEY, viewed.marks.stored())
  viewed.files[index] = isViewed ? 1 : 0
  viewed.count += isViewed ? 1 : -1
  v.rebuild()
  cursor = v.headerRow(index)
  follow()
  await repaint($)
}

/** The comment the cursor's line would get: where it is and the diff lines it quotes; text still empty. */
function commentAtCursor(dir: string): ReviewComment | string {
  const v = view
  if (v === undefined || v.manifest.files === 0) return 'nothing to comment on'
  const m = v.manifest
  const file = v.fileOfRow(cursor)
  const line = v.lineOfRow(cursor)
  const path = m.file(file).path
  const whole = { dir, line, path, lineNo: null, side: null, quote: [], text: '' }
  if (v.collapsed[file] === 1) return whole
  const at = (l: number) => {
    const chunk = resident.get(Math.floor(l / m.chunkLines))
    return chunk && { lines: chunk.lines, i: l % m.chunkLines }
  }
  const here = at(line)
  if (here === undefined) return 'that line is still loading'
  const kind = here.lines.kind[here.i]!
  if (kind === Kind.File) return whole
  if (kind !== Kind.Context && kind !== Kind.Add && kind !== Kind.Del) return 'put the cursor on a line of code or a file header'
  const quote: string[] = []
  for (let l = line; l >= Math.max(0, line - QUOTE_BEFORE); l--) {
    const q = at(l)
    const k = q?.lines.kind[q.i]
    if (q === undefined || (k !== Kind.Context && k !== Kind.Add && k !== Kind.Del)) break
    quote.unshift(`${k === Kind.Add ? '+' : k === Kind.Del ? '-' : ' '}${q.lines.line(q.i)}`)
  }
  const isDel = kind === Kind.Del
  return {
    ...whole,
    lineNo: isDel ? here.lines.oldNo[here.i]! : here.lines.newNo[here.i]!,
    side: isDel ? 'old' : 'new',
    quote,
  }
}

/** Sends every comment to Claude as one prompt, then clears them. */
async function sendComments($: $) {
  const comments = await read($, commentsAtom)
  if (comments.length === 0) {
    $.ui.toast('review: no comments to send; c on a line writes one')
    return
  }
  const review = await read($, reviewAtom)
  const sent = await $.prompt.submit({ text: message(review?.title, comments), asUser: true })
  if (sent.drop !== undefined) {
    $.ui.toast(`review: comments not sent: ${sent.drop}`)
    return
  }
  await update($, commentsAtom, () => [])
  $.ui.toast(`review: sent ${comments.length} comment${comments.length === 1 ? '' : 's'} to Claude`)
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
      cursor = 0
      await update($, composingAtom, () => null)
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
      if (view === undefined || mounted === undefined) return
      if (!windowChunks(view, top, mounted.rows - 1).includes(index)) return
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
    const { Box, Text, Raster, Button, Input } = $.ui.resolve(e)
    if (review === null) return <Text dimColor>No review open. Run /tui-review.</Text>
    const comments = await read($, commentsAtom)
    const composing = await read($, composingAtom)

    const cols = Math.max(20, Math.min(512, e.props.bodyColumns))
    const rows = Math.max(3, Math.min(256, e.props.scroll.bodyRows - 1))
    mounted = { cols, rows }
    follow()
    const drawn = (await frame($)) ?? ''
    const raster = <Raster key={RASTER} columns={cols} rows={rows} cells={drawn} />

    if (composing !== null) {
      return (
        <Box flexDirection="column">
          {raster}
          <Input
            key="comment"
            label={`${composing.lineNo === null ? composing.path : `${composing.path}:${composing.lineNo}`} `}
            placeholder="your comment; Enter saves, empty Enter cancels or deletes"
            value={composing.text}
            submitLabel="save"
            autoFocus
            onSubmit={text => {
              void (async () => {
                await update($, commentsAtom, list => upsert(list, { ...composing, text }))
                await update($, composingAtom, () => null)
              })()
            }}
          />
        </Box>
      )
    }

    const key = (hotkey: string, label: string, act: () => void) => (
      <Button key={hotkey} plain hotkey={hotkey} label={label} onPress={act} />
    )
    const startComment = () => {
      const at = commentAtCursor(review.dir)
      if (typeof at === 'string') $.ui.toast(`review: ${at}`)
      // On a line that has a comment already, edit that one.
      else void update($, composingAtom, () => comments.find(c => c.dir === at.dir && c.line === at.line) ?? at)
    }
    return (
      <Box flexDirection="column">
        {raster}
        <Box flexDirection="row" gap={1}>
          {key('j', '↓', () => moveCursor($, cursor + 1))}
          {key('k', '↑', () => moveCursor($, cursor - 1))}
          {key('n', 'file↓', () => fileJump($, 1))}
          {key('p', 'file↑', () => fileJump($, -1))}
          {key('r', 'viewed', () => void toggleViewed($))}
          {key('c', 'comment', startComment)}
          {key('s', comments.length === 0 ? 'send' : `send ${comments.length}`, () => void sendComments($))}
        </Box>
      </Box>
    )
  })
}
