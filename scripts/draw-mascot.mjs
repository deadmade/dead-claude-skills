// Draws Onibi, Night City's mascot: a masked netrunner whose cybereye is the eight-point spark, as 64x64 pixel art and
// writes plugins/default/assets/mascot.png plus an 8x nearest-neighbour mascot-512.png, and a brightened crop of her
// face as the notification icon (`plugins/default/icon.png`). The PNGs are generated:
// change the drawing here and rerun `node scripts/draw-mascot.mjs`; draw-mascot.test.mjs fails on drift.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const PLUGINS = join(import.meta.dirname, '..', 'plugins');
export const ASSETS = join(PLUGINS, 'default', 'assets');
export const SIZE = 64;
export const SCALE = 8;

// Notifications show the icon at about 48px, where the full drawing is mostly dark hood: crop to her face, eye and
// mask and lift the colours 8% towards white.
export const notifyIcon = (rgb) =>
  rgb.slice(6, 52).map((row) => row.slice(10, 56).map((p) => p.map((v) => Math.round(v + (255 - v) * 0.08))));

// Every PNG this script writes; `pixels` turns the drawing into that file's art. 6x keeps the icon's pixels sharp
// when the notification server scales it down.
export const OUTPUTS = [
  { file: join(ASSETS, 'mascot.png'), scale: 1 },
  { file: join(ASSETS, 'mascot-512.png'), scale: SCALE },
  { file: join(PLUGINS, 'default', 'icon.png'), scale: 6, pixels: notifyIcon },
];

const PAL = {
  // background
  K: '#0C0914',
  k: '#151022',
  b: '#211833',
  q: '#3A1E3C',
  O: '#07050C',
  // hood and jacket
  j: '#17121F',
  J: '#262038',
  h: '#3A3058',
  // skin, hair
  s: '#8E6E9C',
  S: '#D2AEC6',
  c: '#9FB0D4',
  R: '#100C18',
  r: '#2A2244',
  // neon
  P: '#F08BB4',
  p: '#7A3B5E',
  W: '#FFF0F6',
  T: '#7CCFE0',
  t: '#2E5F70',
  U: '#E0FAFF',
  E: '#CFC8DE',
  // chrome
  g: '#34324A',
  G: '#6E6C8C',
  H: '#B4B2CE',
  X: '#F2F0FF',
  // respirator
  n: '#2E2A42',
  N: '#1C1929',
  Z: '#5A5478',
  z: '#454062',
};

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
// Half-to-even, so the row spans land on the same pixels as the original Python sketch.
const round = (v) => {
  const f = Math.floor(v);
  const d = v - f;
  return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
};

// Row spans {y: [x0, x1]} interpolated linearly between a few key rows.
function interp(table) {
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

function inside(poly, x, y) {
  x += 0.5;
  y += 0.5;
  let hit = false;
  poly.forEach(([x1, y1], i) => {
    const [x2, y2] = poly[(i + 1) % poly.length];
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) hit = !hit;
  });
  return hit;
}

const polyPixels = (poly) =>
  range(0, SIZE).flatMap((y) => range(0, SIZE).flatMap((x) => (inside(poly, x, y) ? [[x, y]] : [])));

function layer(fillWith) {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(fillWith));
  const px = (x, y, c) => {
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) grid[y][x] = c;
  };
  return {
    grid,
    px,
    spans: (rows, c) => {
      for (const [y, [x0, x1]] of rows) for (let x = x0; x <= x1; x++) px(x, y, c);
    },
    fill: (poly, c) => polyPixels(poly).forEach(([x, y]) => px(x, y, c)),
    stamp: (x0, y0, art) => {
      const rows = art.trim().split('\n');
      if (new Set(rows.map((r) => r.length)).size !== 1) throw new Error('ragged stamp');
      rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch !== '.' && px(x0 + dx, y0 + dy, ch)));
    },
  };
}

const rowsOf = (from, to, x0, x1) => new Map(range(from, to).map((y) => [y, [x0, x1]]));

// Returns SIZE rows of SIZE [r, g, b] pixels.
export function drawMascot() {
  const bg = layer('K');
  const fig = layer(null);
  const { px } = fig;

  // background: pink haze behind her head
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - 44, y - 18);
      const odd = (x + y) % 2;
      if (d < 16) bg.grid[y][x] = d < 11 || odd ? 'q' : 'b';
      else if (d < 22) bg.grid[y][x] = d < 19 || odd ? 'b' : 'k';
      else if (d < 28 && odd) bg.grid[y][x] = 'k';
    }

  // jacket and hood
  fig.spans(
    interp({
      54: [14, 49],
      57: [4, 59],
      63: [0, 63],
    }),
    'J',
  );
  for (let y = 57; y < 64; y++) {
    px(22 + Math.floor((y - 57) / 3), y, 'j');
    px(41 - Math.floor((y - 57) / 3), y, 'j');
  }
  const hood = interp({
    1: [24, 39],
    3: [16, 47],
    6: [10, 53],
    11: [6, 57],
    18: [4, 59],
    50: [4, 59],
    56: [8, 55],
  });
  fig.spans(hood, 'J');
  for (const [y, [x0, x1]] of hood) {
    px(x0, y, 'h');
    px(x0 + 1, y, 'h');
    px(x1, y, 'j');
  }
  fig.spans(
    interp({
      5: [25, 38],
      7: [17, 46],
      10: [12, 51],
      15: [10, 53],
      48: [10, 53],
      54: [14, 49],
    }),
    'O',
  );

  // hair, long on her left (the viewer's right)
  fig.fill(
    [
      [15, 9],
      [24, 5],
      [40, 5],
      [50, 10],
      [53, 20],
      [53, 52],
      [47, 54],
      [46, 30],
      [16, 26],
    ],
    'R',
  );
  for (let y = 22; y < 52; y++) px(51, y, 'r');

  // neck and collar
  fig.spans(rowsOf(48, 55, 26, 37), 's');
  fig.spans(interp({ 51: [20, 43], 56: [16, 47] }), 'h');
  fig.spans(
    new Map([
      [51, [26, 37]],
      [52, [27, 36]],
    ]),
    's',
  );
  for (let x = 18; x < 46; x++) px(x, 56, 'J');
  for (let x = 20; x < 44; x++) if (x % 3) px(x, 54, 'p');

  // face, lit teal from the left
  const face = interp({
    14: [19, 44],
    17: [17, 46],
    34: [16, 47],
    42: [18, 45],
    47: [23, 40],
    50: [27, 36],
  });
  fig.spans(face, 'S');
  for (const [y, [x0, x1]] of face) {
    px(x0, y, 'c');
    px(x0 + 1, y, 'S');
    px(x1, y, 's');
  }

  // shaved side with stubble and a circuit tattoo
  for (const [x, y] of polyPixels([
    [15, 9],
    [24, 6],
    [24, 10],
    [21, 24],
    [16, 25],
  ]))
    px(x, y, (x * 3 + y) % 5 === 0 ? 'r' : 's');
  for (const [x, y] of [
    [18, 11],
    [18, 12],
    [18, 13],
    [19, 13],
    [20, 13],
    [20, 14],
    [20, 15],
    [20, 16],
    [17, 16],
    [17, 17],
    [18, 17],
    [19, 17],
    [21, 10],
    [22, 10],
    [22, 9],
  ])
    px(x, y, 'T');
  px(20, 17, 'U');

  // bangs sweeping across to her left, with a pink streak
  fig.fill(
    [
      [23, 6],
      [40, 5],
      [50, 10],
      [52, 19],
      [50, 24],
      [47, 19],
      [43, 21],
      [40, 17],
      [35, 19],
      [32, 15],
      [28, 17],
      [24, 13],
    ],
    'R',
  );
  for (let i = 0; i < 10; i++) px(30 + i, 7 + i, 'P');
  for (const [x, y] of [
    [41, 8],
    [43, 10],
    [45, 12],
    [46, 14],
    [47, 16],
    [26, 9],
    [27, 11],
  ])
    px(x, y, 'r');

  // chrome plate around her left eye, under the bangs; lit from the top left
  const plate = [
    [31, 22],
    [37, 20],
    [45, 21],
    [49, 25],
    [49, 34],
    [45, 38],
    [35, 38],
    [31, 34],
  ];
  const platePx = polyPixels(plate);
  const onPlate = new Set(platePx.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of platePx) {
    if (fig.grid[y][x] === 'R') continue;
    const t = (x - 31) / 18 + (y - 20) / 18;
    let c = t < 0.55 ? 'H' : t < 1.15 ? 'G' : 'g';
    if (t >= 0.5 && t < 0.6 && (x + y) % 2) c = 'G';
    if (t >= 1.1 && t < 1.2 && (x + y) % 2) c = 'g';
    px(x, y, c);
  }
  for (const [x, y] of platePx)
    if (fig.grid[y][x] !== 'R' && N4.some(([dx, dy]) => !onPlate.has(`${x + dx},${y + dy}`))) px(x, y, 'O');
  for (const [x, y] of [
    [32, 33],
    [33, 34],
    [34, 35],
    [35, 36],
    [46, 24],
    [47, 25],
    [48, 26],
  ])
    px(x, y, x < 40 ? 'X' : 'H');
  px(44, 36, 'X');
  px(33, 25, 'X');

  // the spark: her cybereye
  const [cx, cy] = [40, 29];
  for (let i = -7; i <= 7; i++)
    for (const [dx, dy] of [
      [i, 0],
      [0, i],
    ]) {
      const d = Math.abs(dx) + Math.abs(dy);
      px(cx + dx, cy + dy, d <= 2 ? 'W' : d <= 4 ? 'P' : 'p');
    }
  const diagonals = [
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ];
  for (const [sx, sy] of diagonals) px(cx + sx, cy + sy, 'W');
  for (const d of [2, 3, 4]) for (const [sx, sy] of diagonals) px(cx + sx * d, cy + sy * d, d < 4 ? 'P' : 'p');
  px(cx, cy, 'X');

  // cable from the plate's temple port back into the hood
  for (const [x, y] of [
    [50, 29],
    [51, 30],
    [52, 31],
    [52, 32],
    [53, 33],
    ...range(34, 64).map((y) => [y > 50 ? 53 : 54, y]),
  ])
    px(x, y, 'T');
  px(49, 29, 'P');
  px(49, 30, 'P');

  // her right eye: narrowed, glaring
  fig.stamp(
    18,
    24,
    `
.OOOOO......
..OOOOOOO...
.......OO...
............
.OOOOOOOO...
.OEETUTEO...
..sssssss...`,
  );

  // respirator over nose and mouth, an LED bar where the mouth is
  const mask = [
    [16, 37],
    [22, 34],
    [28, 33],
    [32, 32],
    [36, 33],
    [42, 34],
    [47, 37],
    [47, 42],
    [43, 47],
    [36, 51],
    [31, 52],
    [27, 51],
    [20, 47],
    [16, 42],
  ];
  const maskPx = polyPixels(mask);
  const onMask = new Set(maskPx.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of maskPx) px(x, y, x < 24 ? 'z' : x > 41 ? 'N' : 'n');
  for (const [x, y] of maskPx) {
    if (N4.some(([dx, dy]) => !onMask.has(`${x + dx},${y + dy}`))) px(x, y, 'O');
    else if (!onMask.has(`${x},${y - 2}`)) px(x, y, x < 36 ? 'Z' : 'p');
  }
  for (let y = 34; y < 51; y++) {
    px(31, y, 'N');
    px(32, y, 'N');
  }
  for (let x = 25; x < 39; x++)
    if (x !== 29 && x !== 34) {
      px(x, 44, 'P');
      px(x, 45, 'p');
    }
  for (const [x, y] of [
    [28, 47],
    [30, 47],
    [33, 47],
    [35, 47],
    [29, 48],
    [31, 48],
    [32, 48],
    [34, 48],
  ])
    px(x, y, 'N');
  fig.stamp(
    14,
    38,
    `
.ZZZ.
ZNNNZ
ZNTNZ
ZNNNZ
.ZZZ.`,
  );

  // compose: outline around the figure, then neon rim light on the hood
  const out = bg.grid.map((row) => [...row]);
  const isFig = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE && fig.grid[y][x] !== null;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (isFig(x, y)) out[y][x] = fig.grid[y][x];
      else if (N4.some(([dx, dy]) => isFig(x + dx, y + dy))) out[y][x] = 'O';
    }
  for (const [y, [x0, x1]] of hood) {
    if (y < 3 || y > 55) continue;
    if (x0 - 1 >= 0) out[y][x0 - 1] = y % 8 ? 'T' : 't';
    if (x1 + 1 < SIZE) out[y][x1 + 1] = y % 8 ? 'P' : 'p';
  }

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgb = out.map((row) => row.map((ch) => hex(PAL[ch])));

  // glitch tear across the eye line, its edges split pink and teal
  const rotate = (row, by) => [...row.slice(-by), ...row.slice(0, -by)];
  rgb[26] = rotate(rgb[26], 2);
  rgb[27] = rotate(rgb[27], 2);
  rgb[35] = rotate(rgb[35], SIZE - 2);
  for (const y of [26, 27]) {
    rgb[y][2] = rgb[y][3] = hex(PAL.P);
    rgb[y][60] = rgb[y][61] = hex(PAL.T);
  }

  // scanlines
  for (let y = 1; y < SIZE; y += 2) rgb[y] = rgb[y].map((p) => p.map((v) => Math.trunc(v * 0.88)));
  return rgb;
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

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const rgb = drawMascot();
  for (const { file, scale, pixels = (p) => p } of OUTPUTS) {
    writeFileSync(file, encodePng(pixels(rgb), scale));
    console.log(`wrote ${file}`);
  }
}
