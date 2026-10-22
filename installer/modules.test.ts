// Loads every installer module, so one without tests still shows up in the coverage report instead of hiding from it.
// install.ts is left out: importing it runs the installer.
import { test } from 'node:test';
import { readdirSync } from 'node:fs';

const modules = readdirSync(import.meta.dirname, { recursive: true, encoding: 'utf8' })
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'install.ts' && !f.includes('node_modules'));

for (const m of modules) test(`${m} loads without running anything`, () => import(`./${m}`));
