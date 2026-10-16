// node preview.mjs <drawing.mjs> <out-prefix>
// Renders a character drawing (a module whose default export returns RGB rows) to <prefix>.png, <prefix>-512.png and
// <prefix>-preview.png, the contact sheet to look at before showing anyone.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeImages } from './pixel-kit.mjs';

const [drawing, prefix] = process.argv.slice(2);
if (!drawing || !prefix) {
  console.error('usage: node preview.mjs <drawing.mjs> <out-prefix>');
  process.exit(2);
}
const { default: draw } = await import(pathToFileURL(resolve(drawing)).href);
console.log(writeImages(draw(), prefix).join('\n'));
