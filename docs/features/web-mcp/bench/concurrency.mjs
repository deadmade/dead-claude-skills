// H5: the p95 of 16 simultaneous `search` calls stays within 1.5x the p95 of one call.
// node concurrency.mjs --bin <web-mcp built with --features test-hooks> [--live]
// Default mode runs against a stub SearXNG and 20 local page servers (127.0.0.2-21, 200 ms per page).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpSession } from './mcp.mjs';

const args = process.argv.slice(2);
const bin = args[args.indexOf('--bin') + 1];
const live = args.includes('--live');
if (!bin || args.indexOf('--bin') < 0) {
  console.error('usage: node concurrency.mjs --bin <path to web-mcp> [--live]');
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const { queries } = JSON.parse(fs.readFileSync(path.join(here, 'inputs.json'), 'utf8'));
const HOSTS = Array.from({ length: 20 }, (_, i) => `127.0.0.${i + 2}`);
const PAGE_MS = 200;
const SINGLE = 30;
const ROUNDS = 30;
const PAR = 16;

const listen = (srv, host) =>
  new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, host, () => resolve(srv.address().port));
  });

const article = (q, id) => {
  const para = (i) =>
    `<p>Notes ${i} on ${q}. Engineers comparing ${q} usually start from the documentation, then try a small example ` +
    `and measure it. The trade-offs around ${q} depend on the workload, the team and how much latency is acceptable. ` +
    `Copy ${id}-${i} of this article explains the common pitfalls, shows a worked example and lists what to check before ` +
    `relying on ${q} in production, including configuration, error handling and observability.</p>`;
  return `<!doctype html><html><head><title>${q} (${id})</title></head><body><article><h1>${q}</h1>${[1, 2, 3, 4, 5, 6].map(para).join('')}</article></body></html>`;
};

const servers = [];
let env = {};
if (!live) {
  const pages = [];
  for (const host of HOSTS) {
    const srv = http.createServer((req, res) => {
      const id = req.url.split('/').pop();
      const q = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('q') ?? 'the topic');
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(article(q, id));
      }, PAGE_MS);
    });
    pages.push({
      host,
      port: await listen(srv, host).catch((e) => {
        console.error(`cannot bind ${host}: ${e.message}`);
        process.exit(1);
      }),
    });
    servers.push(srv);
  }
  // Every search gets fresh URLs (a repeat would come from the archive cache); consecutive searches rotate
  // over the 20 hosts, so 16 parallel calls put 4 requests on each host.
  let k = 0;
  const stub = http.createServer((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams.get('q') ?? '';
    const call = k++;
    const results = [0, 1, 2, 3, 4].map((n) => {
      const p = pages[(call * 5 + n) % pages.length];
      return {
        url: `http://${p.host}:${p.port}/p/${call}-${n}?q=${encodeURIComponent(q)}`,
        title: `${q} article ${call}-${n}`,
        content: `About ${q}`,
      };
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ query: q, results }));
  });
  const port = await listen(stub, '127.0.0.1');
  servers.push(stub);
  // A proxy in the environment would send the local pages through it.
  for (const k of Object.keys(process.env)) if (/^(http|https|all)_proxy$/i.test(k)) delete process.env[k];
  env = { WEB_MCP_SEARXNG_URL: `http://127.0.0.1:${port}`, WEB_MCP_TEST_PUBLIC_IP: HOSTS.join(',') };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-h5-'));
const session = await mcpSession(bin, { ...env, CLAUDE_PROJECT_DIR: dir });
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];
let code = 0;
try {
  // A hung server fails the run instead of waiting forever; an answer without passages isn't a timed search.
  const search = async (i) => {
    let timer;
    const r = await Promise.race([
      session.call('search', { query: queries[i % queries.length] }),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('search took over 60 s')), 60_000))),
    ]).finally(() => clearTimeout(timer));
    if (!live && /No passages matched/.test(r.text)) {
      throw new Error('a search returned no passages: is this a --features test-hooks build?');
    }
    return r;
  };
  await search(0);
  const single = [];
  for (let i = 0; i < SINGLE; i++) single.push((await search(i)).ms);
  const conc = [];
  for (let r = 0; r < ROUNDS; r++) {
    conc.push(...(await Promise.all(Array.from({ length: PAR }, (_, i) => search(r * PAR + i)))).map((x) => x.ms));
  }
  const ps = p95(single);
  const pc = p95(conc);
  const ratio = pc / ps;
  console.log(`p95 single      ${ps.toFixed(0)} ms (${single.length} calls)`);
  console.log(`p95 concurrent  ${pc.toFixed(0)} ms (${conc.length} calls, ${PAR} at a time)`);
  console.log(`ratio           ${ratio.toFixed(2)}`);
  console.log(live ? 'live mode: reported, not judged' : ratio <= 1.5 ? 'H5 holds' : 'H5 fails');
} catch (e) {
  console.error(e.message);
  code = 1;
} finally {
  session.close();
  for (const s of servers) s.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
