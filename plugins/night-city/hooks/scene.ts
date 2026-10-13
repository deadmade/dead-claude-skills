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

// Every background is an exact xterm-256 colour: terminals Claude Code draws in 256 colours snap dark purples like
// #2a0845 to grey, so the sky and towers use the darkest purples that palette has.
const PINK = 0xff2e97;
const HALO = 0x87005f; // the sign's glow, next to the strokes
const HAZE = 0x5f005f; // the glow's outer edge
const TUBE = 0x5f005f; // a dead letter's glass
const CYAN = 0x00f0ff;
const YELLOW = 0xfcee0a;
const SKY = [0x000000, 0x00005f] as const; // top to horizon, a shaded row between
const FAR = 0x5f0087;
const NEAR = 0x5f005f;
const TRIM = 0xff00ff;
const RAIN = 0x008787;
const STAR = 0x8787af;
const SUBTITLE = '// NETRUNNER UPLINK';

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
const SPUTTER = 1; // the I of NIGHT
const BIG_W = [...SIGN].reduce((w, c) => w + FONT[c]![0]!.length + 1, -1);

function hash(a: number, b = 0, c = 0): number {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1103515245);
  return (x ^ (x >>> 16)) >>> 0;
}

// The I buzzes out twice in every 1.6 s: a short stutter, then a longer drop.
const isILit = (t: number) => {
  const p = t % 1600;
  return !((p >= 900 && p < 960) || (p >= 1040 && p < 1400));
};
// Once in a while the whole sign browns out for a blink.
const isSignLit = (t: number) => {
  const p = t % 3700;
  return !((p >= 2900 && p < 2960) || (p >= 3020 && p < 3080));
};

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

  // A shaded sky cell has no single background to keep under a mark drawn on it, so marks pass behind it.
  const isShade = (x: number, y: number) => [0x2591, 0x2592].includes(cells[(y * w + x) * 3] ?? 0);

  const big = h >= 16 && w >= BIG_W + 4;
  const signTop = big ? Math.max(2, Math.floor(h * 0.1)) : Math.min(1, h - 1);
  const skylineTop = big ? signTop + 8 : signTop + 1;

  // Sky: black overhead shading down to indigo; a few stars up high.
  for (let y = 0; y < h; y++) {
    const f = h === 1 ? 1 : y / (h - 1);
    const fade = f >= 0.3 && f < 0.5; // the shaded rows between black and indigo
    const bg = SKY[f < 0.5 ? 0 : 1];
    for (let x = 0; x < w; x++) {
      if (fade) put(x, y, f < 0.4 ? '░' : '▒', SKY[1], bg);
      else put(x, y, hash(x, y, 7) % 41 === 0 && f < 0.5 ? '·' : ' ', STAR, bg);
    }
  }

  // Two rows of towers: a far, taller violet one and a near plum one in front.
  const room = Math.max(1, h - skylineTop - 1);
  for (const [layer, color, tall] of [
    [1, FAR, 1],
    [2, NEAR, 0.7],
  ] as const) {
    for (let bx = -(hash(layer, 99) % 4), i = 0; bx < w; i++) {
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
          const lamp = seed % 3 === 0 ? YELLOW : CYAN;
          if (isWindow && on) put(x, y, '▪', layer === 1 ? (lamp === CYAN ? 0x00afaf : 0xafaf00) : lamp, color);
          else put(x, y, ' ', color, color);
        }
      }
      // A neon trim on some near rooftops, an antenna on the tallest far towers.
      if (layer === 2 && hash(i, 5) % 4 === 0) for (let x = bx; x < bx + bw; x++) put(x, top, '▔', TRIM);
      if (layer === 1 && bh > room * 0.6 && bw >= 5 && top > 0 && !isShade(bx + (bw >> 1), top - 1))
        put(bx + (bw >> 1), top - 1, '╻', FAR);
      bx += bw + (hash(i, layer, 3) % 3);
    }
  }

  // Rain falls across everything but the sign.
  for (let x = 0; x < w; x++) {
    const seed = hash(x, 0, 11);
    if (seed % 5 >= 2) continue;
    const msPerRow = 35 + (seed % 40);
    const span = h + 3;
    const head = Math.floor(t / msPerRow + (seed % span)) % span;
    for (let k = 0; k < 2; k++) {
      const y = head - k;
      if (y >= 0 && y < h && !isShade(x, y)) put(x, y, k === 0 ? '│' : '╵', k === 0 ? CYAN : RAIN);
    }
  }

  // The horizon: one hot-pink line along the bottom edge.
  if (h >= 3) for (let x = 0; x < w; x++) put(x, h - 1, '▁', PINK);

  // The sign: pink tubes on the sky, a darker pink halo for glow.
  const signOn = isSignLit(t);
  const tube = (n: number) => (signOn && (n !== SPUTTER || isILit(t)) ? PINK : TUBE);
  if (big) {
    const left = Math.floor((w - BIG_W) / 2);
    const strokes: [number, number, number][] = [];
    let x = left;
    [...SIGN].forEach((c, n) => {
      const glyph = FONT[c]!;
      glyph.forEach((line, r) => [...line].forEach((px, k) => px === '#' && strokes.push([x + k, signTop + r, n])));
      x += glyph[0]!.length + 1;
    });
    // The cells touching a lit stroke glow: brighter beside it, dimmer at its corners.
    const glow = new Map<number, number>();
    for (const [sx, sy, n] of strokes) {
      if (tube(n) !== PINK) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const gx = sx + dx;
          const gy = sy + dy;
          if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
          const d = Math.abs(dx) + Math.abs(dy);
          if ((glow.get(gy * w + gx) ?? 3) > d) glow.set(gy * w + gx, d);
        }
      }
    }
    for (const [cell, d] of glow) put(cell % w, Math.floor(cell / w), ' ', PINK, d === 1 ? HALO : HAZE);
    for (const [sx, sy, n] of strokes) put(sx, sy, '█', tube(n));
    const subLeft = Math.floor((w - SUBTITLE.length) / 2);
    [...SUBTITLE].forEach((c, k) => put(subLeft + k, signTop + 7, c, CYAN));
  } else {
    const left = Math.floor((w - SIGN.length) / 2);
    put(left - 2, signTop, ' ', HAZE, HAZE);
    put(left - 1, signTop, ' ', HALO, HALO);
    put(left + SIGN.length, signTop, ' ', HALO, HALO);
    put(left + SIGN.length + 1, signTop, ' ', HAZE, HAZE);
    [...SIGN].forEach((c, n) => put(left + n, signTop, c, tube(n), signOn ? HALO : HAZE));
    const subLeft = left + SIGN.length + 4;
    if (subLeft + SUBTITLE.length <= w) [...SUBTITLE].forEach((c, k) => put(subLeft + k, signTop, c, CYAN));
  }

  return new Uint8Array(cells.buffer).toBase64();
}
