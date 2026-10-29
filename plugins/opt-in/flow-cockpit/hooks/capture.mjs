import { main } from './lib.mjs';

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
await main({ stdin, env: process.env, platform: process.platform, now: Date.now() });
