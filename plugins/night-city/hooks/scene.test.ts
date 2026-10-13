import { expect, test } from 'claude-code/testing';

import { BAND_ROWS, INTRO_MS, frame } from './scene';

const PINK = 0xff2e97;
const decode = (cells: string) => new Uint32Array(Uint8Array.fromBase64(cells).buffer);
const pink = (cells: string) => decode(cells).filter((v, i) => i % 3 === 1 && v === PINK).length;
const row = (cells: string, width: number, y: number) =>
  String.fromCharCode(
    ...decode(cells)
      .filter((_v, i) => i % 3 === 0)
      .slice(y * width, (y + 1) * width),
  );

test('frame is width × height', () => {
  for (const [w, h] of [
    [80, 6],
    [144, 30],
    [200, 40],
  ] as const) {
    expect(decode(frame(w, h, 500)).length).toBe(w * h * 3);
  }
  expect(() => frame(20, 3, 0)).not.toThrow();
  expect(INTRO_MS).toBe(4000);
  expect(BAND_ROWS).toBe(6);
});

test('same t gives the same frame', () => {
  expect(frame(144, 30, 1234)).toBe(frame(144, 30, 1234));
  expect(frame(144, 30, 1234)).not.toBe(frame(144, 30, 1300));
});

test('the sign is present at t = 0', () => {
  const band = frame(100, BAND_ROWS, 0);
  expect([0, 1, 2].some((y) => row(band, 100, y).includes('NIGHT CITY'))).toBe(true);
  expect(pink(frame(144, 30, 0))).toBeGreaterThan(60);
});

test('the I is dark at some t in one cycle', () => {
  for (const [w, h] of [
    [100, BAND_ROWS],
    [144, 30],
  ] as const) {
    const lit = pink(frame(w, h, 0));
    const ts = Array.from({ length: 100 }, (_v, i) => i * 20);
    expect(ts.some((t) => pink(frame(w, h, t)) < lit)).toBe(true);
  }
});
