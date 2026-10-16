#!/usr/bin/env node
// Baseline for the web-mcp research flow: measures Claude Code's built-in WebSearch and WebFetch, and the
// paper-lookup curl + script pipelines, on the fixed inputs in inputs.json. Phase 7 reruns the same script against
// the new server, so keep inputs and method fixed once Gate 1 has passed.
//
//   node baseline.mjs [--runs 3] [--only search,fetch,parallel,papers] [--limit N] [--out results/<host>-<date>]
//
// Tool latency is the time between Claude Code's PreToolUse and PostToolUse hooks for that call, so model time is
// excluded. Needs `claude` (authenticated), curl and python3 on PATH. Node standard library only.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const scripts = path.join(repo, 'plugins/paper-lookup/skills/paper-lookup/scripts');
const inputs = JSON.parse(fs.readFileSync(path.join(here, 'inputs.json'), 'utf8'));

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : args[i + 1];
};
const runs = Number(opt('runs', 3));
const only = new Set(opt('only', 'search,fetch,parallel,papers').split(','));
// --limit N keeps the first N items of each list, for a smoke run of the harness itself.
const limit = Number(opt('limit', 0));
if (limit) for (const k of ['queries', 'urls', 'papers']) inputs[k] = inputs[k].slice(0, limit);
const stamp = new Date().toISOString().slice(0, 10);
const out = path.resolve(opt('out', path.join(here, 'results', `${os.hostname()}-${stamp}`)));
fs.mkdirSync(out, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-bl-'));
const hook = path.join(tmp, 'hook.mjs');
fs.writeFileSync(
  hook,
  `import fs from "node:fs";
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  const j = JSON.parse(d);
  fs.appendFileSync(process.env.BL_LOG, JSON.stringify({ t: Date.now(), ev: j.hook_event_name, tool: j.tool_name,
    id: j.tool_use_id, input: j.tool_input, resp: j.tool_response }) + "\\n");
});`,
);
const settings = path.join(tmp, 'settings.json');
const hookEntry = [{ matcher: 'WebFetch|WebSearch', hooks: [{ type: 'command', command: `node ${hook}` }] }];
fs.writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: hookEntry, PostToolUse: hookEntry } }));

const records = [];
const record = (r) => {
  records.push(r);
  fs.appendFileSync(path.join(out, 'raw.jsonl'), JSON.stringify(r) + '\n');
};

// One `claude -p` run; returns the hook log entries of its WebFetch/WebSearch calls, paired by tool_use_id.
function claudeCalls(prompt) {
  const log = path.join(tmp, `log-${Date.now()}.jsonl`);
  const t0 = Date.now();
  const p = spawnSync(
    'claude',
    ['-p', prompt, '--settings', settings, '--allowedTools', 'WebFetch', 'WebSearch', '--output-format', 'json'],
    { env: { ...process.env, BL_LOG: log }, encoding: 'utf8', timeout: 300_000 },
  );
  const wall = Date.now() - t0;
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  const events = lines.map((l) => JSON.parse(l));
  const calls = new Map();
  for (const e of events) {
    const c = calls.get(e.id) ?? { tool: e.tool, input: e.input };
    if (e.ev === 'PreToolUse') c.start = e.t;
    else {
      c.end = e.t;
      c.resp = e.resp;
    }
    calls.set(e.id, c);
  }
  return { wall, status: p.status, calls: [...calls.values()].filter((c) => c.start && c.end) };
}

// Raw page text, to check how much of it WebFetch hands back word for word.
function pageText(url) {
  const r = spawnSync('curl', ['-sL', '--max-time', '30', url], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) return null;
  let s = r.stdout;
  if (/<html|<body|<div/i.test(s)) {
    s = s
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  return s;
}

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[`*_#>\[\]()|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Share of up to 20 evenly spread sentences (60-300 chars) of the page that appear verbatim in the result.
function verbatimRecall(text, result) {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 60 && s.length <= 300);
  if (!sentences.length) return null;
  const step = Math.max(1, Math.floor(sentences.length / 20));
  const sample = sentences.filter((_, i) => i % step === 0).slice(0, 20);
  const r = norm(result);
  return sample.filter((s) => r.includes(norm(s))).length / sample.length;
}

const resultText = (resp) => (typeof resp === 'string' ? resp : (resp?.result ?? JSON.stringify(resp ?? '')));

if (only.has('search')) {
  for (let run = 0; run < runs; run++)
    for (const q of inputs.queries) {
      const r = claudeCalls(`Call WebSearch exactly once with the query ${JSON.stringify(q)}. Then reply "done".`);
      for (const c of r.calls) {
        const results = (c.resp?.results ?? []).flatMap((x) => x?.content ?? []);
        record({
          kind: 'search',
          run,
          q,
          ms: c.end - c.start,
          results: results.length,
          chars: resultText(c.resp).length,
        });
      }
      if (!r.calls.length) record({ kind: 'search', run, q, error: `no call (exit ${r.status})` });
    }
}

if (only.has('fetch')) {
  const texts = new Map(inputs.urls.map((u) => [u, pageText(u)]));
  for (let run = 0; run < runs; run++)
    for (const url of inputs.urls) {
      const r = claudeCalls(
        `Call WebFetch exactly once on ${url} with the prompt "Return the full content of this page verbatim, without summarising." Then reply "done".`,
      );
      for (const c of r.calls) {
        const text = resultText(c.resp);
        const page = texts.get(url);
        record({
          kind: 'fetch',
          run,
          url,
          ms: c.end - c.start,
          code: c.resp?.code,
          bytes: c.resp?.bytes,
          chars: text.length,
          pageChars: page?.length ?? null,
          recall: page ? verbatimRecall(page, text) : null,
        });
      }
      if (!r.calls.length) record({ kind: 'fetch', run, url, error: `no call (exit ${r.status})` });
    }
}

if (only.has('parallel')) {
  for (let run = 0; run < runs; run++) {
    const list = inputs.parallel_urls.map((u) => `- ${u}`).join('\n');
    const r = claudeCalls(
      `In one single message, call WebFetch on each of these URLs in parallel, with the prompt "Return the full content verbatim.":\n${list}\nThen reply "done".`,
    );
    if (!r.calls.length) {
      record({ kind: 'parallel', run, error: `no call (exit ${r.status})` });
      continue;
    }
    const start = Math.min(...r.calls.map((c) => c.start));
    const end = Math.max(...r.calls.map((c) => c.end));
    const sum = r.calls.reduce((a, c) => a + (c.end - c.start), 0);
    record({ kind: 'parallel', run, calls: r.calls.length, spanMs: end - start, sumMs: sum });
  }
}

if (only.has('papers')) {
  const lastHit = {};
  for (let run = 0; run < runs; run++)
    for (const p of inputs.papers) {
      // Respect the documented rate limits (arXiv 1 request / 3 s); the wait is not measured.
      const wait = (p.host === 'arxiv' ? 3100 : 1100) - (Date.now() - (lastHit[p.host] ?? 0));
      if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
      const cmd = p.script
        ? `curl -sS --max-time 30 '${p.url}' | python3 '${path.join(scripts, p.script)}' -`
        : `curl -sS --max-time 30 -o /dev/null -w '%{http_code}' '${p.url}'`;
      const t0 = process.hrtime.bigint();
      const r = spawnSync('bash', ['-o', 'pipefail', '-c', cmd], { encoding: 'utf8', maxBuffer: 64 << 20 });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      lastHit[p.host] = Date.now();
      record({
        kind: 'papers',
        run,
        name: p.name,
        ms,
        exit: r.status,
        outChars: r.stdout.length,
        err: r.stderr.slice(0, 200),
      });
    }
}

// Summary: p50 / p95 per kind and item.
const pct = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const lines = [`# Baseline ${stamp} on ${os.hostname()} (${os.platform()}), ${runs} runs`, ''];
const group = (kind, key, cols) => {
  const rs = records.filter((r) => r.kind === kind);
  if (!rs.length) return;
  lines.push(
    `## ${kind}`,
    '',
    `| ${key} | ok/n | p50 ms | p95 ms | ${cols.join(' | ')} |`,
    `|${'---|'.repeat(4 + cols.length)}`,
  );
  const by = Map.groupBy(rs, (r) => r[key] ?? 'all');
  for (const [k, g] of [...by, ['**all**', rs]]) {
    const ok = g.filter((r) => !r.error && (r.exit === undefined || r.exit === 0));
    const ms = ok.map((r) => r.ms ?? r.spanMs);
    const extra = cols.map((c) => {
      const v = ok.map((r) => r[c]).filter((x) => typeof x === 'number');
      return v.length ? (pct(v, 0.5) % 1 ? pct(v, 0.5).toFixed(2) : pct(v, 0.5)) : '';
    });
    lines.push(
      `| ${k} | ${ok.length}/${g.length} | ${pct(ms, 0.5)?.toFixed(0) ?? ''} | ${pct(ms, 0.95)?.toFixed(0) ?? ''} | ${extra.join(' | ')} |`,
    );
  }
  lines.push('');
};
group('search', 'q', ['results', 'chars']);
group('fetch', 'url', ['chars', 'pageChars', 'recall']);
group('parallel', 'kind', ['calls', 'sumMs']);
group('papers', 'name', ['outChars']);
fs.writeFileSync(path.join(out, 'summary.md'), lines.join('\n'));
console.log(lines.join('\n'));
fs.rmSync(tmp, { recursive: true, force: true });
