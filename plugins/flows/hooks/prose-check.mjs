import { readFileSync } from 'node:fs';

// Fails open like main(): a prose.mjs that won't load, or stdin that can't be read, exits 0 silently.
try {
  const { main } = await import('./prose.mjs');
  let stdin = '';
  for await (const chunk of process.stdin) stdin += chunk;
  const { code, stderr } = main({ stdin, readFile: (p) => readFileSync(p, 'utf8') });
  if (stderr) process.stderr.write(`${stderr}\n`);
  process.exit(code);
} catch {
  process.exit(0);
}
