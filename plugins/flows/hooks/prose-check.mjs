import { readFileSync } from 'node:fs';
import { loadTerms, main } from './prose.mjs';

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;

let terms;
try {
  terms = loadTerms(readFileSync(new URL('./common-terms.txt', import.meta.url), 'utf8'));
} catch {
  process.exit(0);
}

const { code, stderr } = main({ stdin, readFile: (p) => readFileSync(p, 'utf8'), terms });
if (stderr) process.stderr.write(`${stderr}\n`);
process.exit(code);
