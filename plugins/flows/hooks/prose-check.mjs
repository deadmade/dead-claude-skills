import { readFileSync } from 'node:fs';
import { main } from './prose.mjs';

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;

let terms = new Set();
try {
  terms = new Set(
    readFileSync(new URL('./common-terms.txt', import.meta.url), 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*/, '').trim())
      .filter(Boolean),
  );
} catch {}

const { code, stderr } = main({ stdin, readFile: (p) => readFileSync(p, 'utf8'), terms });
if (stderr) process.stderr.write(`${stderr}\n`);
process.exit(code);
