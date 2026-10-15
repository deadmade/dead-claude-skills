import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inflateSync } from 'node:zlib';
import { OUTPUTS, drawMascot, encodePng, notifyIcon, scanlines } from './draw-mascot.mjs';

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
  for (const { file, scale, pixels = (p) => p } of OUTPUTS) {
    const art = pixels(rgb);
    const { width, height, raw } = decode(readFileSync(file));
    assert.deepEqual([width, height], [art[0].length * scale, art.length * scale], file);
    assert.ok(raw.equals(scanlines(art, scale)), `${file} is stale: run node scripts/draw-mascot.mjs`);
  }
});

test("Onibi is night-city's mascot and notify's icon", () => {
  const rel = (f) => relative(join(import.meta.dirname, '..'), f).replaceAll('\\', '/');
  assert.deepEqual(
    OUTPUTS.map(({ file, scale }) => [rel(file), scale]),
    [
      ['plugins/night-city/assets/mascot.png', 1],
      ['plugins/night-city/assets/mascot-512.png', 8],
      ['plugins/notify/icon.png', 6],
    ],
  );
});

test("notify's icon is a brightened crop of her face", () => {
  const rgb = drawMascot();
  const icon = notifyIcon(rgb);
  assert.deepEqual([icon[0].length, icon.length], [46, 46]);
  // Top-left of the crop is the drawing's pixel (10, 6), lifted 8% towards white.
  assert.deepEqual(
    icon[0][0],
    rgb[6][10].map((v) => Math.round(v + (255 - v) * 0.08)),
  );
  assert.equal(OUTPUTS.find(({ file }) => file.endsWith('icon.png')).pixels, notifyIcon);
});
