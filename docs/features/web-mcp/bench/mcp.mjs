// Minimal MCP client over stdio (newline-delimited JSON-RPC): enough to call one server's tools and time them.
import { spawn } from 'node:child_process';

export async function mcpSession(bin, env = {}) {
  const child = spawn(bin, [], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let nextId = 1;
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const m = JSON.parse(line);
      const p = pending.get(m.id);
      if (!p) continue;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message ?? JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  });
  child.on('exit', () => {
    for (const p of pending.values()) p.reject(new Error('server exited'));
    pending.clear();
  });
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, params });
    });

  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'web-mcp-bench', version: '0' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  return {
    async call(tool, args) {
      const t0 = process.hrtime.bigint();
      const r = await request('tools/call', { name: tool, arguments: args });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
      if (r.isError) throw new Error(text || 'tool error');
      return { ms, text };
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}
