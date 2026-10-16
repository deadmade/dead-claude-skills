// Onibi (鬼火, "demon fire"), the cast's first character and night-city's mascot: a masked netrunner whose chrome
// cybereye is the eight-point spark. The reference drawing for new characters: same kit, same framing, same finish.
// dead-claude-skills renders her with scripts/draw-mascot.mjs; `node preview.mjs cast/onibi.mjs <prefix>` previews her.
import {
  N4,
  PALETTE,
  canvas,
  compose,
  finish,
  glitchTear,
  haze,
  interp,
  polyPixels,
  range,
  rimLight,
  rows,
  toRgb,
} from '../pixel-kit.mjs';

const SIZE = 64;

export default function drawOnibi() {
  const bg = canvas(SIZE, 'K');
  const fig = canvas(SIZE);
  const { px } = fig;

  // background: pink haze behind her head, where the spark's light comes from
  haze(bg, 44, 18);

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
  fig.spans(rows(48, 55, 26, 37), 's');
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
  for (const [x, y] of polyPixels(
    [
      [15, 9],
      [24, 6],
      [24, 10],
      [21, 24],
      [16, 25],
    ],
    SIZE,
  ))
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
  const platePx = polyPixels(plate, SIZE);
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
  const maskPx = polyPixels(mask, SIZE);
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

  // compose: outline around the figure, neon rim light on the hood, glitch tear across her eyes, scanlines
  const out = compose(bg, fig);
  rimLight(out, hood, 3, 55);
  return finish(glitchTear(toRgb(out, PALETTE), { rows: [26, 27], back: [35] }));
}
