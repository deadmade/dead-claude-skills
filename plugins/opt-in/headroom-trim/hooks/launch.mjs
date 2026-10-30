import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { main } from './launcher.mjs';

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
await main({ argv: process.argv.slice(2), env: process.env, fetch, spawn, isFile });
