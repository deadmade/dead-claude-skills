// Pixel-art kit for the night-city-cast skill: the grid primitives, the cast's shared palette and finishing effects,
// PNG output and a preview sheet. Node's standard library only.
//
// A drawing is a grid of palette keys (one character per colour). Draw the figure on its own canvas, compose it over
// a background canvas (which adds the 1px outline), map the keys to RGB, then encode or preview:
//
//   import { PALETTE, canvas, interp, compose, toRgb, finish, writeImages } from './pixel-kit.mjs';
//   const bg = canvas(64, 'K');
//   const fig = canvas(64);
//   fig.spans(interp({ 10: [20, 43], 40: [16, 47] }), 'J'); // rows 10..40, edges interpolated
//   fig.fill([[20, 12], [44, 12], [32, 30]], 'P');            // polygon
//   fig.stamp(26, 20, `.OO.\nOEEO`);                          // hand-placed pixels, '.' = leave
//   const rgb = finish(toRgb(compose(bg, fig), PALETTE));
//   writeImages(rgb, 'out');                                  // out.png, out-512.png, out-preview.png
//
// To render a drawing module (default export: a function returning RGB rows), run preview.mjs.
import { writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

export const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

// Half to even, so spans are stable when a key row lands exactly between two pixels.
export function round(v) {
  const f = Math.floor(v);
  const d = v - f;
  return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
}

// Row spans Map(y -> [x0, x1]) interpolated linearly between key rows {y: [x0, x1]}.
export function interp(table) {
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  const out = new Map();
  for (let i = 0; i + 1 < keys.length; i++) {
    const [a, b] = [keys[i], keys[i + 1]];
    const [[a0, a1], [b0, b1]] = [table[a], table[b]];
    for (let y = a; y <= b; y++) {
      const t = (y - a) / (b - a);
      out.set(y, [round(a0 + (b0 - a0) * t), round(a1 + (b1 - a1) * t)]);
    }
  }
  return out;
}

// Map(y -> [x0, x1]) for rows from..to-1 that all span x0..x1.
export const rows = (from, to, x0, x1) => new Map(range(from, to).map((y) => [y, [x0, x1]]));

// Pixels whose centres fall inside the polygon [[x, y], ...], row by row.
export function polyPixels(poly, size) {
  const inside = (x, y) => {
    let hit = false;
    poly.forEach(([x1, y1], i) => {
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) hit = !hit;
    });
    return hit;
  };
  return range(0, size).flatMap((y) => range(0, size).flatMap((x) => (inside(x + 0.5, y + 0.5) ? [[x, y]] : [])));
}

// Pixels of `pixels` with a 4-neighbour outside the set: a region's own edge.
export function edgeOf(pixels) {
  const set = new Set(pixels.map(([x, y]) => `${x},${y}`));
  return pixels.filter(([x, y]) => N4.some(([dx, dy]) => !set.has(`${x + dx},${y + dy}`)));
}

// A square grid of palette keys; `fillWith` null means transparent (for a figure layer).
export function canvas(size, fillWith = null) {
  const grid = Array.from({ length: size }, () => Array(size).fill(fillWith));
  const px = (x, y, c) => {
    if (x >= 0 && x < size && y >= 0 && y < size) grid[y][x] = c;
  };
  return {
    size,
    grid,
    px,
    get: (x, y) => (x >= 0 && x < size && y >= 0 && y < size ? grid[y][x] : undefined),
    spans(spanRows, c) {
      for (const [y, [x0, x1]] of spanRows) for (let x = x0; x <= x1; x++) px(x, y, c);
    },
    fill(poly, c) {
      for (const [x, y] of polyPixels(poly, size)) px(x, y, c);
    },
    // Rows of characters; '.' leaves the pixel alone. Throws on ragged rows, the usual typo.
    stamp(x0, y0, art) {
      const lines = art.trim().split('\n');
      if (new Set(lines.map((l) => l.length)).size !== 1) throw new Error(`ragged stamp at ${x0},${y0}`);
      lines.forEach((line, dy) => [...line].forEach((ch, dx) => ch !== '.' && px(x0 + dx, y0 + dy, ch)));
    },
  };
}

// The figure over the background, with an `outline` key on every background pixel that touches the figure.
export function compose(bg, fig, outline = 'O') {
  const size = bg.size;
  const isFig = (x, y) => fig.get(x, y) != null;
  return range(0, size).map((y) =>
    range(0, size).map((x) => {
      if (isFig(x, y)) return fig.grid[y][x];
      return outline && N4.some(([dx, dy]) => isFig(x + dx, y + dy)) ? outline : bg.grid[y][x];
    }),
  );
}

export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Palette keys to RGB rows. Throws on a key the palette doesn't have.
export function toRgb(grid, palette) {
  return grid.map((row) =>
    row.map((k) => {
      if (!(k in palette)) throw new Error(`palette has no key ${JSON.stringify(k)}`);
      return hex(palette[k]);
    }),
  );
}

// CRT scanlines: every odd row darkened by `factor`.
export const scanlineDim = (rgb, factor = 0.88) =>
  rgb.map((row, y) => (y % 2 ? row.map((p) => p.map((v) => Math.trunc(v * factor))) : row));

// ---- The cast's shared look (references/style.md). Every character uses these, so they read as one world.

// Palette keys shared by the whole cast. A character may add a few accent keys of its own (style.md).
export const PALETTE = {
  // background: night sky, haze
  K: '#0C0914',
  k: '#151022',
  b: '#211833',
  q: '#3A1E3C',
  // outline
  O: '#07050C',
  // hood and jacket
  j: '#17121F',
  J: '#262038',
  h: '#3A3058',
  // skin: shadow, base, teal-lit edge
  s: '#8E6E9C',
  S: '#D2AEC6',
  c: '#9FB0D4',
  // hair
  R: '#100C18',
  r: '#2A2244',
  // neon: pink, dim pink, white-hot; teal, dim teal, teal highlight
  P: '#F08BB4',
  p: '#7A3B5E',
  W: '#FFF0F6',
  T: '#7CCFE0',
  t: '#2E5F70',
  U: '#E0FAFF',
  // eye white
  E: '#CFC8DE',
  // chrome: shadow, mid, light, specular
  g: '#34324A',
  G: '#6E6C8C',
  H: '#B4B2CE',
  X: '#F2F0FF',
  // techwear (masks, plates, gear): mid, dark, light, light shadow
  n: '#2E2A42',
  N: '#1C1929',
  Z: '#5A5478',
  z: '#454062',
};

// The background every character stands in: night sky with a dithered pink haze centred on (cx, cy), where the
// character's neon light comes from.
export function haze(bg, cx, cy) {
  for (let y = 0; y < bg.size; y++)
    for (let x = 0; x < bg.size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const odd = (x + y) % 2;
      if (d < 16) bg.grid[y][x] = d < 11 || odd ? 'q' : 'b';
      else if (d < 22) bg.grid[y][x] = d < 19 || odd ? 'b' : 'k';
      else if (d < 28 && odd) bg.grid[y][x] = 'k';
    }
}

// Neon rim light just outside a silhouette's row spans: teal on the left (the street signs), pink on the right (the
// character's own light), with a dim pixel every 8 rows. Call on the composed grid.
export function rimLight(grid, spanRows, from, to) {
  const size = grid.length;
  for (const [y, [x0, x1]] of spanRows) {
    if (y < from || y > to) continue;
    if (x0 - 1 >= 0) grid[y][x0 - 1] = y % 8 ? 'T' : 't';
    if (x1 + 1 < size) grid[y][x1 + 1] = y % 8 ? 'P' : 'p';
  }
}

// The glitch tear: `rows` shifted right by `shift` with pink and teal fringes at the edges, `back` rows shifted left.
export function glitchTear(rgb, { rows: torn, shift = 2, back = [] }) {
  const size = rgb.length;
  const rotate = (row, by) => [...row.slice(-by), ...row.slice(0, -by)];
  for (const y of torn) {
    rgb[y] = rotate(rgb[y], shift);
    rgb[y][shift] = rgb[y][shift + 1] = hex(PALETTE.P);
    rgb[y][size - 4] = rgb[y][size - 3] = hex(PALETTE.T);
  }
  for (const y of back) rgb[y] = rotate(rgb[y], size - shift);
  return rgb;
}

// Every character's last step: CRT scanlines.
export const finish = (rgb) => scanlineDim(rgb, 0.88);

// Resize to `size` x `size`: nearest neighbour for whole-number upscales (pixel art stays crisp), area averaging
// otherwise, which is roughly what an OS does to a notification icon.
export function resize(rgb, size) {
  const n = rgb.length;
  if (size >= n && size % n === 0) {
    const k = size / n;
    return range(0, size).map((y) => range(0, size).map((x) => rgb[Math.floor(y / k)][Math.floor(x / k)]));
  }
  const f = n / size;
  return range(0, size).map((ty) =>
    range(0, size).map((tx) => {
      const acc = [0, 0, 0];
      let total = 0;
      for (let sy = Math.floor(ty * f); sy < Math.ceil((ty + 1) * f); sy++)
        for (let sx = Math.floor(tx * f); sx < Math.ceil((tx + 1) * f); sx++) {
          const w =
            (Math.min(sx + 1, (tx + 1) * f) - Math.max(sx, tx * f)) *
            (Math.min(sy + 1, (ty + 1) * f) - Math.max(sy, ty * f));
          if (w <= 0) continue;
          rgb[Math.min(sy, n - 1)][Math.min(sx, n - 1)].forEach((v, i) => (acc[i] += v * w));
          total += w;
        }
      return acc.map((v) => Math.round(v / total));
    }),
  );
}

// A contact sheet: the art at 512 (crisp), 128 and its native size, then 48/32/16 as an OS would shrink it, on a
// dark and on a light tile. Look at this before showing the user anything.
export function previewSheet(rgb) {
  const [W, H] = [920, 544];
  const sheet = range(0, H).map(() => range(0, W).map(() => [13, 11, 20]));
  const paste = (img, x0, y0) => img.forEach((row, y) => row.forEach((p, x) => (sheet[y0 + y][x0 + x] = p)));
  const tile = (x0, y0, w, h, c) =>
    paste(
      range(0, h).map(() => range(0, w).map(() => c)),
      x0,
      y0,
    );
  paste(resize(rgb, 512), 16, 16);
  paste(resize(rgb, 128), 544, 16);
  paste(resize(rgb, rgb.length), 544, 160);
  [
    [688, 16, [30, 30, 30]],
    [688, 112, [243, 243, 243]],
  ].forEach(([x, y, c]) => {
    tile(x, y, 216, 80, c);
    paste(resize(rgb, 48), x + 16, y + 16);
    paste(resize(rgb, 32), x + 80, y + 24);
    paste(resize(rgb, 16), x + 128, y + 32);
  });
  return sheet;
}

// Raw PNG scanlines (filter byte 0, then RGB) for `rgb` scaled up by `scale` with nearest neighbour.
export function scanlines(rgb, scale = 1) {
  const w = rgb[0].length * scale;
  const raw = Buffer.alloc((w * 3 + 1) * rgb.length * scale);
  let o = 0;
  for (const row of rgb)
    for (let r = 0; r < scale; r++) {
      raw[o++] = 0;
      for (const p of row) for (let s = 0; s < scale; s++) for (const v of p) raw[o++] = v;
    }
  return raw;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// An 8-bit RGB PNG of `rgb` (rows may be any width), scaled up by `scale` with nearest neighbour.
export function encodePng(rgb, scale = 1) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(rgb[0].length * scale, 0);
  ihdr.writeUInt32BE(rgb.length * scale, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines(rgb, scale), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Width, height and decompressed scanlines of a PNG written by encodePng (one IDAT, filter 0). For drift tests that
// shouldn't depend on the zlib build's exact deflate output.
export function decodePng(buf) {
  const at = buf.indexOf('IDAT');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    raw: inflateSync(buf.subarray(at + 4, at + 4 + buf.readUInt32BE(at - 4))),
  };
}

// <prefix>.png (native), <prefix>-512.png (crisp) and <prefix>-preview.png (contact sheet).
export function writeImages(rgb, prefix) {
  writeFileSync(`${prefix}.png`, encodePng(rgb));
  writeFileSync(`${prefix}-512.png`, encodePng(resize(rgb, 512)));
  writeFileSync(`${prefix}-preview.png`, encodePng(previewSheet(rgb)));
  return [`${prefix}.png`, `${prefix}-512.png`, `${prefix}-preview.png`];
}
