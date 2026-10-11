import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ReviewComment, TuiReviewOpen } from '../types'
import { Highlights, Kind, Lines, Manifest, chunkName, fromBase64, toBase64 } from './chunks'
import { message, upsert, wrap } from './comments'
import { reviewContext } from './context'
import { type Loaded, NOTE_TEXT, paint } from './paint'
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
/** What the view's comment rows were built from, so a frame rebuilds them only when a comment or the width changed. */
let notesFrom = ''
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
/** A brv run is reading; a refresh asked for meanwhile waits for it and runs once after. */
let running = false
/** Bumped per run, so a run ended by a newer one does not mark the newer one finished. */
let runId = 0
let refreshAgain = false
/** A new review whose comments from the last one still need moving onto it, once its chunks are written. */
let relocateTo: string | undefined
/** Focus moves within the pane come in bursts; one refresh per this many ms is enough. */
const FOCUS_REFRESH_MS = 2000
let focusRefreshAt = 0

/** How the running brv was started: what kind of review, and the base it was asked for. */
type Origin = { kind: TuiReviewOpen['kind']; base?: string }

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
    notesFrom = ''
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
  const drafts = (await $.state.get({ plugin: 'tui-review', key: 'comments' })).value ?? []
  const here = drafts.filter(c => c.dir === review.value!.dir)
  syncNotes(v, here, cols)
  await ensureChunks($, review.value.dir, windowChunks(v, top, rows - 1))
  const loadedAt = performance.now()
  if (cells.length !== cols * rows * 3) cells = new Uint32Array(cols * rows * 3)
  paint(cells, cols, rows, top, {
    view: v,
    cursor,
    viewed,
    comments: { lines: new Set(here.map(c => c.line)), count: drafts.length },
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

/** Shows each comment under its line, wrapped to the pane, keeping the cursor on its line. */
function syncNotes(v: View, comments: readonly ReviewComment[], cols: number) {
  const from = JSON.stringify([cols, comments.map(c => [c.line, c.text])])
  if (from === notesFrom) return
  notesFrom = from
  const width = Math.max(10, cols - NOTE_TEXT - 1)
  const keep = { line: v.lineOfRow(cursor), above: cursor - top }
  v.notes = new Map(comments.map(c => [c.line, wrap(c.text, width)]))
  v.rebuild()
  cursor = v.rowOfLine(keep.line)
  top = cursor - keep.above
  follow()
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

/** The command line of a branch review in the session's directory. */
async function reviewArgv($: $, brv: string, base: string | undefined): Promise<string[]> {
  const argv = [brv, 'review', '--repo', await $.session.cwd()]
  return base === undefined ? argv : [...argv, '--base', base]
}

/**
 * Runs the open branch review again: brv answers `cached` at once when HEAD has not moved, and writes the new review
 * when it has. Skipped while a comment is being written, so its text is not lost; the next refresh catches up. No
 * `--base`: the first run saved it for its branch, and passing it again would save it for whatever branch Claude has
 * checked out since.
 */
async function refresh($: $) {
  const review = await read($, reviewAtom)
  if (review === null || review.kind !== 'branch' || (await read($, composingAtom)) !== null) return
  if (running) {
    refreshAgain = true
    return
  }
  await run($, await reviewArgv($, brvPath, undefined), { kind: 'branch', base: review.base })
}

/** Reads brv's progress lines and acts on them; one run at a time, a new one ends the old. */
async function run($: $, argv: string[], origin: Origin) {
  stopRun?.()
  const id = ++runId
  running = true
  const stream = $.process.spawn({ argv })
  let isStopped = false
  stopRun = () => {
    isStopped = true
    void stream.return?.(undefined as never)
  }
  let pending = ''
  let errors = ''
  let isAnswered = false
  try {
    for await (const piece of stream) {
      if (isStopped) break
      if (piece.stream === 'stderr') {
        errors += piece.text
        continue
      }
      pending += piece.text
      for (let nl = pending.indexOf('\n'); nl >= 0; nl = pending.indexOf('\n')) {
        const line = pending.slice(0, nl).trimEnd()
        pending = pending.slice(nl + 1)
        isAnswered ||= /^(manifest|cached|error) /.test(line)
        try {
          await onLine($, line, origin)
        } catch (err) {
          $.ui.toast(`review: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  } catch (err) {
    $.ui.toast(`review: could not run ${argv[0]}: ${String(err)}`)
    return
  } finally {
    if (id === runId) running = false
    if (id === runId && refreshAgain) {
      refreshAgain = false
      void refresh($)
    }
  }
  // brv says what went wrong on stdout; a run that ends with nothing said gets its stderr shown instead.
  if (!isStopped && !isAnswered) {
    const why = errors.trim().split('\n')[0] ?? ''
    $.ui.toast(`review: ${argv.slice(0, 2).join(' ')} ended without a review${why === '' ? '' : `: ${why}`}`)
  }
}

/** Closes the pane and forgets its review. */
async function close($: $) {
  await $.ui.close({ id: PANE })
  await closed($)
}

/** Forgets the open review: stops brv and lets go of the chunks. Comments stay, for the review opened again. */
async function closed($: $) {
  stopRun?.()
  stopRun = undefined
  relocateTo = undefined
  refreshAgain = false
  manifest = undefined
  viewed = undefined
  view = undefined
  resident.clear()
  top = 0
  cursor = 0
  mounted = undefined
  await update($, composingAtom, () => null)
  await update($, reviewAtom, () => null)
  $.ui.status(undefined)
}

/**
 * Moves comments written on an earlier review of this branch onto `dir`'s review: onto the same line of the same file
 * when it is still in the diff, else onto that file's header. A comment whose file left the review stays as it was;
 * it is not drawn, but `s` still sends it.
 */
async function relocate($: $, dir: string) {
  relocateTo = undefined
  const m = view?.manifest
  const comments = await read($, commentsAtom)
  if (m === undefined || comments.every(c => c.dir === dir)) return
  const taken = new Set(comments.filter(c => c.dir === dir).map(c => c.line))
  const moved: ReviewComment[] = []
  for (const c of comments) {
    const file = c.dir === dir ? -1 : m.findFile(c.path)
    if (file < 0) {
      moved.push(c)
      continue
    }
    const line = (c.lineNo === null ? undefined : await findLine($, dir, m, file, c)) ?? m.firstLine(file)
    // Two comments cannot share a line; the later one keeps its old place.
    if (taken.has(line)) {
      moved.push(c)
      continue
    }
    taken.add(line)
    moved.push({ ...c, dir, line })
  }
  await update($, commentsAtom, () => moved)
  void repaint($)
}

/** The global line in `file` of `dir`'s review showing `c`'s line on `c`'s side, read from its chunks. */
async function findLine($: $, dir: string, m: Manifest, file: number, c: ReviewComment): Promise<number | undefined> {
  const first = m.firstLine(file)
  const end = first + m.lineCount(file)
  for (let chunk = Math.floor(first / m.chunkLines); chunk * m.chunkLines < end; chunk++) {
    const bytes = await readOptional($, `${dir}/${chunkName(chunk, 'lines')}`)
    if (bytes === undefined) return undefined
    const lines = new Lines(bytes)
    const base = chunk * m.chunkLines
    for (let i = Math.max(0, first - base); i < lines.n && base + i < end; i++) {
      const kind = lines.kind[i]
      const isOld = kind === Kind.Del || kind === Kind.Context
      const isNew = kind === Kind.Add || kind === Kind.Context
      const no = c.side === 'old' ? (isOld ? lines.oldNo[i] : 0) : isNew ? lines.newNo[i] : 0
      if (no === c.lineNo) return base + i
    }
  }
  return undefined
}

async function onLine($: $, line: string, origin: Origin) {
  const space = line.indexOf(' ')
  const word = space < 0 ? line : line.slice(0, space)
  const rest = space < 0 ? '' : line.slice(space + 1)
  switch (word) {
    case 'manifest':
    case 'cached': {
      const shown = await read($, reviewAtom)
      // The same review again (a refresh with HEAD where it was): keep the cursor, the chunks, everything.
      if (shown?.dir === rest) return
      // A refresh landing while a comment is written waits: the comment points into the review on screen.
      if (shown !== null && (await read($, composingAtom)) !== null) return
      const keep = view !== undefined && shown !== null ? view.manifest.file(view.fileOfRow(cursor)).path : undefined
      manifest = undefined
      top = 0
      cursor = 0
      await update($, composingAtom, () => null)
      let m: Manifest
      try {
        m = await loadManifest($, rest)
      } catch (err) {
        $.ui.toast(`review: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      // Back to the file the cursor was in, when the new review still has it.
      const file = keep === undefined ? -1 : m.findFile(keep)
      if (file >= 0 && view !== undefined) cursor = top = view.headerRow(file)
      const title = `${m.headName} ← ${m.baseName}`
      await update($, reviewAtom, () => ({ dir: rest, title, kind: origin.kind, base: origin.base }))
      // Opened by the person, it takes the keyboard; a refresh only retitles it.
      await $.ui.open({ id: PANE, title: `Review ${title}`, ...(shown === null ? { focus: true as const } : {}) })
      relocateTo = rest
      if (word === 'cached') await relocate($, rest)
      void repaint($)
      return
    }
    case 'done':
      if (relocateTo !== undefined) await relocate($, relocateTo)
      return
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

/** The brv binary: the plugin's `brvPath` option, or brv on PATH. */
let brvPath = 'brv'

export const register: Register = (on, options) => {
  brvPath = typeof options.brvPath === 'string' && options.brvPath !== '' ? options.brvPath : 'brv'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tui-review',
      description: 'A diff pane of this branch beside the chat, against the branch it is stacked on (or the one given)',
      argumentHint: '[base | demo]',
    })
    return next(e)
  })

  // The person's close (the frame's close mark, ctrl+x x) takes the review with it. The engine skips this hook for the
  // plugin's own $.ui.close, so close() cleans up itself.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    await closed($)
    return result
  })

  // A new conversation (exit, /clear, resume) starts without the last one's review.
  on('session.end', async ($, e, next) => {
    await close($)
    await update($, commentsAtom, () => [])
    return next(e)
  })

  on('command.run', { command: 'tui-review' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'demo') {
      void run($, [brvPath, 'gen', '--lines', '100000'], { kind: 'demo' })
      return { text: 'Opening a 100k-line demo review.' }
    }
    const base = arg === '' ? undefined : arg
    void run($, await reviewArgv($, brvPath, base), { kind: 'branch', base })
    return {
      text:
        base === undefined
          ? 'Opening a review of this branch against the branch it is stacked on.'
          : `Opening a review of this branch against ${base}; brv remembers it for this branch.`,
    }
  })

  // Claude never sees the pane: each prompt carries which diff is open and where the cursor is.
  on('prompt.submit', async ($, e, next) => {
    const review = await read($, reviewAtom)
    const m = view?.manifest
    if (review === null || review.kind !== 'branch' || m === undefined || m.files === 0) return next(e)
    const note = reviewContext(m, commentAtCursor(review.dir))
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  // A Bash call may have committed, checked out or rebased: show the branch as it is now.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  })

  // Coming back to the pane, it shows the branch as it is now.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const result = await next(e)
    const now = Date.now()
    if (now - focusRefreshAt >= FOCUS_REFRESH_MS) {
      focusRefreshAt = now
      void refresh($)
    }
    return result
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
          {key('q', 'close', () => close($))}
        </Box>
      </Box>
    )
  })
}
