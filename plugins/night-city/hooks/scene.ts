// The intro's art: one frame of the Night City skyline as Raster cells (`[codePoint, fg, bg]` u32 triplets,
// row-major, base64), the shape `$.ui.blit` takes. Pure and deterministic: the same size and time give the same frame.

declare global {
  interface Uint8Array {
    toBase64(): string;
  }
  interface Uint8ArrayConstructor {
    fromBase64(base64: string): Uint8Array<ArrayBuffer>;
  }
}

export const INTRO_MS = 4000;
export const BAND_ROWS = 6;

const PINK = 0xff2e97;
const TUBE = 0x4a1033; // the sign's unlit glass
const GLOW = 0x1e0433;
const CYAN = 0x00f0ff;
const YELLOW = 0xfcee0a;
const SKY_TOP = 0x0d0221;
const SKY_LOW = 0x2a0845;
const FAR = 0x1a0535;
const NEAR = 0x090116;
const RAIN = 0x0a6a7d;
const STAR = 0x5b3f86;

// 5 rows per letter; `#` is lit tube.
const FONT: Record<string, string[]> = {
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  I: ['###', ' # ', ' # ', ' # ', '###'],
  G: [' ####', '#    ', '#  ##', '#   #', ' ### '],
  H: ['#   #', '#   #', '#####', '#   #', '#   #'],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  C: [' ####', '#    ', '#    ', '#    ', ' ####'],
  Y: ['#   #', ' # # ', '  #  ', '  #  ', '  #  '],
  ' ': ['  ', '  ', '  ', '  ', '  '],
};
const SIGN = 'NIGHT CITY';
const FLICKER = 1 as const; // the I of NIGHT
const BIG_W = [...SIGN].reduce((w, c) => w + FONT[c]![0]!.length + 1, -1);

function hash(a: number, b = 0, c = 0): number {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1103515245);
  return (x ^ (x >>> 16)) >>> 0;
}

// The I buzzes out twice in every 1.6 s: a short stutter, then a longer drop.
function isLit(t: number): boolean {
  const p = t % 1600;
  return !((p >= 900 && p < 960) || (p >= 1040 && p < 1400));
}

function mix(a: number, b: number, k: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k) << s;
  return ch(16) | ch(8) | ch(0);
}

const dim = (c: number) => mix(c, FAR, 0.55);

export function frame(width: number, height: number, t: number): string {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const cells = new Uint32Array(w * h * 3);
  const put = (x: number, y: number, ch: string, fg: number, bg?: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    cells[i] = ch.charCodeAt(0);
    cells[i + 1] = fg;
    if (bg !== undefined) cells[i + 2] = bg;
  };

  const big = h >= 16 && w >= BIG_W + 6;
  const signTop = big ? Math.max(1, Math.floor(h * 0.12)) : Math.min(1, h - 1);
  const signBottom = big ? signTop + 7 : signTop + 1;

  // Sky: a gradient to the horizon, a few faint stars.
  for (let y = 0; y < h; y++) {
    const bg = mix(SKY_TOP, SKY_LOW, h === 1 ? 1 : y / (h - 1));
    for (let x = 0; x < w; x++) put(x, y, hash(x, y, 7) % 47 === 0 && y < h / 2 ? '·' : ' ', STAR, bg);
  }

  // Two rows of towers: a far, taller, dimmer one, and a near one in front.
  const room = Math.max(1, h - signBottom - (big ? 1 : 0));
  for (const [layer, color, tall] of [
    [1, FAR, 1],
    [2, NEAR, 0.7],
  ] as const) {
    for (let bx = -hash(layer, 99) % 4, i = 0; bx < w; i++) {
      const bw = 3 + (hash(i, layer, 1) % 6);
      const bh = Math.max(1, Math.round(room * tall * (0.35 + (hash(i, layer, 2) % 65) / 100)));
      const top = h - bh;
      for (let y = top; y < h; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const isWindow = (x - bx) % 2 === 1 && x < bx + bw - 1 && (y - top) % 2 === 1;
          const seed = hash(x, y, layer);
          // Most lit windows hold; one in six blinks on its own slow beat.
          const blinks = seed % 6 === 0;
          const on = seed % 5 < 2 !== (blinks && Math.floor(t / (500 + (seed % 900))) % 2 === 1);
          if (isWindow && on) {
            const lamp = seed % 3 === 0 ? YELLOW : CYAN;
            put(x, y, '▪', layer === 1 ? dim(lamp) : lamp, color);
          } else {
            put(x, y, ' ', color, color);
          }
        }
      }
      // An antenna on the tallest towers.
      if (bh > room * 0.6 && bw >= 5) put(bx + (bw >> 1), top - 1, '╻', color === FAR ? STAR : 0x3a1a5c);
      bx += bw + (hash(i, layer, 3) % 3);
    }
  }

  // Rain falls across everything but the sign.
  for (let x = 0; x < w; x++) {
    const seed = hash(x, 0, 11);
    if (seed % (big ? 3 : 4) !== 0) continue;
    const msPerRow = 35 + (seed % 40);
    const span = h + 3;
    const head = Math.floor(t / msPerRow + (seed % span)) % span;
    for (let k = 0; k < 2; k++) {
      const y = head - k;
      const i = (y * w + x) * 3;
      if (y >= 0 && y < h) put(x, y, k === 0 ? '│' : '╵', k === 0 ? CYAN : RAIN, cells[i + 2]);
    }
  }

  // The sign.
  const lit = isLit(t);
  if (big) {
    const left = Math.floor((w - BIG_W) / 2);
    for (let y = signTop; y < signTop + 7; y++) {
      for (let x = left - 2; x < left + BIG_W + 2; x++) put(x, y, ' ', PINK, GLOW);
    }
    const frameRow = (y: number, l: string, r: string) => {
      put(left - 2, y, l, PINK);
      for (let x = left - 1; x < left + BIG_W + 1; x++) put(x, y, '─', PINK);
      put(left + BIG_W + 1, y, r, PINK);
    };
    frameRow(signTop, '╭', '╮');
    frameRow(signTop + 6, '╰', '╯');
    for (let r = 1; r < 6; r++) {
      put(left - 2, signTop + r, '│', PINK);
      put(left + BIG_W + 1, signTop + r, '│', PINK);
    }
    let x = left;
    [...SIGN].forEach((c, n) => {
      const glyph = FONT[c]!;
      const fg = n === FLICKER && !lit ? TUBE : PINK;
      glyph.forEach((line, r) => [...line].forEach((px, k) => px === '#' && put(x + k, signTop + 1 + r, '█', fg)));
      x += glyph[0]!.length + 1;
    });
  } else {
    const left = Math.floor((w - SIGN.length) / 2);
    put(left - 1, signTop, ' ', PINK, GLOW);
    put(left + SIGN.length, signTop, ' ', PINK, GLOW);
    [...SIGN].forEach((c, n) => put(left + n, signTop, c, n === FLICKER && !lit ? TUBE : PINK, GLOW));
  }

  return new Uint8Array(cells.buffer).toBase64();
}
