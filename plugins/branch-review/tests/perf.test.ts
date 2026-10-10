// Speed budgets. A change that makes these slower fails the build instead of slipping in. Budgets are set from the
// spike's measurements with headroom for CI machines.

import { expect, test } from 'claude-code/testing'

import { Highlights, Lines, Manifest, fromBase64, toBase64 } from '../hooks/chunks'
import { paint } from '../hooks/paint'
import * as fixture from './fixture.gen'
import { DIR, engine, pane, residentOf } from './harness'

const PROGRESS = [`manifest ${DIR}`, 'text 0', 'hl 0', 'done']
const run = { command: 'brv', args: 'demo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const

/** Timings go to the test output where the runner has a console. */
const report = (line: string) => (globalThis as { console?: { log(s: string): void } }).console?.log(`  perf: ${line}`)

/**
 * What one call costs, in ms: `times` calls in 5 batches, the best batch's median. Other tests and garbage collection
 * only ever add time, so the best batch is the code's own cost; a real slowdown raises every batch.
 */
function typical(times: number, body: () => void): number {
  for (let i = 0; i < 5; i++) body()
  const batch = Math.ceil(times / 5)
  let best = Infinity
  for (let b = 0; b < 5; b++) {
    const samples: number[] = []
    for (let i = 0; i < batch; i++) {
      const t = performance.now()
      body()
      samples.push(performance.now() - t)
    }
    samples.sort((x, y) => x - y)
    best = Math.min(best, samples[Math.floor(samples.length / 2)]!)
  }
  return best
}

test('a chunk loads (decode + views) in under 2 ms', async () => {
  const ms = typical(50, () => {
    new Lines(fromBase64(fixture.lines[0]!))
    new Highlights(fromBase64(fixture.hl[0]!))
  })
  report(`chunk load: ${ms.toFixed(3)} ms`)
  expect(ms).toBeLessThan(2)
})

test('a 200×60 frame paints and encodes in under 2 ms', async () => {
  const manifest = new Manifest(fromBase64(fixture.manifest))
  const chunks = fixture.lines.map((l, c) => ({
    lines: new Lines(fromBase64(l)),
    hl: new Highlights(fromBase64(fixture.hl[c]!)),
  }))
  const cols = 200
  const rows = 60
  let top = 0
  const cells = new Uint32Array(cols * rows * 3)
  const ms = typical(200, () => {
    paint(cells, cols, rows, top, { manifest, chunk: c => chunks[c % chunks.length] })
    toBase64(new Uint8Array(cells.buffer))
    top = (top + 37) % 3000
  })
  report(`frame paint + encode: ${ms.toFixed(3)} ms`)
  expect(ms).toBeLessThan(2)
})

test('the first frame is drawn in under 150 ms after the manifest', async ($, on) => {
  const recorded = engine(on, PROGRESS)
  await $.command.run(run)
  await recorded.opened
  const started = performance.now()
  await $.ui.mount(pane(200, 60))
  const ms = performance.now() - started
  report(`first frame: ${ms.toFixed(1)} ms`)
  expect(ms).toBeLessThan(150)
})

test('paging through a 100k-line review keeps at most 3 chunks resident', { timeoutMs: 60_000 }, async ($, on) => {
  const recorded = engine(on, PROGRESS)
  await $.command.run(run)
  await recorded.opened
  const rows = 60
  const ui = await $.ui.mount(pane(200, rows))
  const manifest = new Manifest(fromBase64(fixture.manifest))
  const pages = Math.ceil(manifest.totalLines / (rows - 3))
  const started = performance.now()
  let most = 0
  for (let page = 0; page < pages; page++) {
    await ui.press({ key: 'd' })
    most = Math.max(most, residentOf(recorded.status.at(-1) ?? ''))
  }
  const perPage = (performance.now() - started) / pages
  const reads = recorded.reads.filter(p => p.endsWith('.lines')).length
  report(`${pages} pages: ${perPage.toFixed(2)} ms/page, ${reads} chunk reads for ${manifest.chunks} chunks, ≤ ${most} resident`)
  expect(most).toBeLessThanOrEqual(3)
  expect(reads).toBeLessThanOrEqual(manifest.chunks + 2)
})
