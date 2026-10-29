import { main } from './lib.mjs';

// Watch only: whatever goes wrong (even reading stdin), print nothing and exit 0.
try {
  let stdin = '';
  for await (const chunk of process.stdin) stdin += chunk;
  await main({ stdin, env: process.env, platform: process.platform, now: Date.now() });
} catch {}
