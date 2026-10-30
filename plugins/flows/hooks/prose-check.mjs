import { readFileSync } from 'node:fs';
import { main } from './prose.mjs';

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;

const { code, stderr } = main({ stdin, readFile: (p) => readFileSync(p, 'utf8') });
if (stderr) process.stderr.write(`${stderr}
`);
process.exit(code);
