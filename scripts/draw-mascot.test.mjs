import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inflateSync } from 'node:zlib';
import { OUTPUTS, SIZE, drawMascot, encodePng, scanlines } from './draw-mascot.mjs';

// Size and decompressed scanlines of a PNG written by encodePng (one IDAT, filter 0), so the check doesn't depend
// on the zlib build's exact deflate output.
function decode(buf) {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const at = buf.indexOf('IDAT');
  const data = buf.subarray(at + 4, at + 4 + buf.readUInt32BE(at - 4));
  return { width, height, raw: inflateSync(data) };
}

test('encodePng round-trips through decode', () => {
  const rgb = [
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
  ];
  const { width, height, raw } = decode(encodePng(rgb, 2));
  assert.deepEqual([width, height], [4, 2]);
  assert.deepEqual([...raw.subarray(0, 13)], [0, 1, 2, 3, 1, 2, 3, 4, 5, 6, 4, 5, 6]);
});

test('the committed mascot PNGs match the drawing', () => {
  const rgb = drawMascot();
  for (const { file, scale } of OUTPUTS) {
    const { width, height, raw } = decode(readFileSync(file));
    assert.deepEqual([width, height], [SIZE * scale, SIZE * scale], file);
    assert.ok(raw.equals(scanlines(rgb, scale)), `${file} is stale: run node scripts/draw-mascot.mjs`);
  }
});

test("Onibi is night-city's mascot and notify's icon", () => {
  const rel = (f) => relative(join(import.meta.dirname, '..'), f).replaceAll('\\', '/');
  assert.deepEqual(
    OUTPUTS.map(({ file, scale }) => [rel(file), scale]),
    [
      ['plugins/night-city/assets/mascot.png', 1],
      ['plugins/night-city/assets/mascot-512.png', 8],
      ['plugins/notify/icon.png', 4],
    ],
  );
});
