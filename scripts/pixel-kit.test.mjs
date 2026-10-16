import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PALETTE,
  canvas,
  compose,
  decodePng,
  encodePng,
  interp,
  polyPixels,
  previewSheet,
  resize,
  toRgb,
} from '../plugins/night-city/skills/night-city-cast/scripts/pixel-kit.mjs';

const CAST = join(import.meta.dirname, '..', 'plugins', 'night-city', 'skills', 'night-city-cast', 'scripts', 'cast');

test('interp spans every row between key rows, rounding half to even', () => {
  assert.deepEqual(
    [...interp({ 0: [0, 10], 2: [1, 13] })],
    [
      [0, [0, 10]],
      [1, [0, 12]],
      [2, [1, 13]],
    ],
  );
});

test('polyPixels takes the pixels whose centres are inside', () => {
  assert.deepEqual(
    polyPixels(
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
      4,
    ),
    [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ],
  );
});

test('compose outlines the figure on the background and keeps stamps intact', () => {
  const bg = canvas(3, 'K');
  const fig = canvas(3);
  fig.stamp(1, 1, 'P');
  assert.deepEqual(compose(bg, fig), [
    ['K', 'O', 'K'],
    ['O', 'P', 'O'],
    ['K', 'O', 'K'],
  ]);
  assert.throws(() => fig.stamp(0, 0, 'PP\nP'), /ragged/);
  assert.throws(() => toRgb([['?']], PALETTE), /no key/);
});

test('resize upscales crisply and area-averages otherwise', () => {
  const rgb = [
    [
      [0, 0, 0],
      [200, 100, 50],
    ],
    [
      [200, 100, 50],
      [0, 0, 0],
    ],
  ];
  assert.deepEqual(resize(rgb, 4)[0], [
    [0, 0, 0],
    [0, 0, 0],
    [200, 100, 50],
    [200, 100, 50],
  ]);
  assert.deepEqual(resize(rgb, 1), [[[100, 50, 25]]]);
});

test('encodePng round-trips through decodePng', () => {
  const { width, height, raw } = decodePng(
    encodePng(
      [
        [
          [1, 2, 3],
          [4, 5, 6],
        ],
      ],
      2,
    ),
  );
  assert.deepEqual([width, height], [4, 2]);
  assert.deepEqual([...raw.subarray(0, 13)], [0, 1, 2, 3, 1, 2, 3, 4, 5, 6, 4, 5, 6]);
});

test('every cast drawing is 64x64 and fits the preview sheet', async () => {
  const files = readdirSync(CAST).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.includes('onibi.mjs'));
  for (const f of files) {
    const { default: draw } = await import(pathToFileURL(join(CAST, f)).href);
    const rgb = draw();
    assert.equal(rgb.length, 64, f);
    assert.ok(
      rgb.every((row) => row.length === 64),
      f,
    );
    assert.equal(previewSheet(rgb).length, 544, f);
  }
});
