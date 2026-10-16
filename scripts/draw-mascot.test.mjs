import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { OUTPUTS, drawMascot, notifyIcon } from './draw-mascot.mjs';
import { decodePng, scanlines } from '../plugins/night-city-cast/skills/night-city-cast/scripts/pixel-kit.mjs';

// decodePng compares decompressed scanlines, so the check doesn't depend on the zlib build's exact deflate output.
test('the committed mascot PNGs match the drawing', () => {
  const rgb = drawMascot();
  for (const { file, scale, pixels = (p) => p } of OUTPUTS) {
    const art = pixels(rgb);
    const { width, height, raw } = decodePng(readFileSync(file));
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
