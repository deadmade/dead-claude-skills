// Renders Onibi, night-city's mascot, to plugins/night-city/assets/mascot.png plus an 8x nearest-neighbour
// mascot-512.png, and a brightened crop of her face as the notify plugin's icon (a plugin can't read another plugin's
// files once installed). Her drawing and the kit live in the night-city-cast skill (cast/onibi.mjs, pixel-kit.mjs);
// change the drawing there and rerun `node scripts/draw-mascot.mjs`. draw-mascot.test.mjs fails when the PNGs drift.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import drawOnibi from '../plugins/night-city-cast/skills/night-city-cast/scripts/cast/onibi.mjs';
import { encodePng } from '../plugins/night-city-cast/skills/night-city-cast/scripts/pixel-kit.mjs';

const PLUGINS = join(import.meta.dirname, '..', 'plugins');
export const ASSETS = join(PLUGINS, 'night-city', 'assets');
export const SIZE = 64;
export const SCALE = 8;
export const drawMascot = drawOnibi;

// Notifications show the icon at about 48px, where the full drawing is mostly dark hood: crop to her face, eye and
// mask and lift the colours 8% towards white.
export const notifyIcon = (rgb) =>
  rgb.slice(6, 52).map((row) => row.slice(10, 56).map((p) => p.map((v) => Math.round(v + (255 - v) * 0.08))));

// Every PNG this script writes; `pixels` turns the drawing into that file's art. 6x keeps the icon's pixels sharp
// when the notification server scales it down.
export const OUTPUTS = [
  { file: join(ASSETS, 'mascot.png'), scale: 1 },
  { file: join(ASSETS, 'mascot-512.png'), scale: SCALE },
  { file: join(PLUGINS, 'notify', 'icon.png'), scale: 6, pixels: notifyIcon },
];

if (process.argv[1] === import.meta.filename) {
  const rgb = drawMascot();
  for (const { file, scale, pixels = (p) => p } of OUTPUTS) {
    writeFileSync(file, encodePng(pixels(rgb), scale));
    console.log(`wrote ${file}`);
  }
}
