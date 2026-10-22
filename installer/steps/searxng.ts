// SearXNG in Docker for web-mcp's search. True when it answers JSON on 127.0.0.1:8888 within 30 s. Every failure is a
// summary line, never a crash. An existing settings.yml is kept so the running container's secret stays valid.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { searxngRun } from '../core/options.ts';
import { CONFIG, asset, done, failures } from '../context.ts';
import { writeSearxng } from '../system/files.ts';
import { errCode, startSync, which } from '../system/proc.ts';
import { log, progress } from '../ui/ui.ts';

const SEARXNG = join(CONFIG, 'searxng');

export async function applySearxng(denied: boolean) {
  const file = which('docker');
  if (!file) {
    failures.push(
      `SearXNG: docker not found; write ${join(SEARXNG, 'settings.yml')} (see installer/assets/searxng.yml) and run: docker ${searxngRun(SEARXNG).join(' ')}`,
    );
    return false;
  }
  const docker = (...args: string[]) => startSync(file, args);
  try {
    if (writeSearxng(SEARXNG, asset('searxng.yml'), randomBytes(32).toString('hex')))
      done.push(`wrote ${join(SEARXNG, 'settings.yml')}`);
    const exists = docker('container', 'inspect', 'searxng').status === 0;
    if (!exists) log('info', 'First run pulls the SearXNG image and may take a minute');
    const r = exists ? docker('start', 'searxng') : docker(...searxngRun(SEARXNG));
    if (r.status !== 0) {
      failures.push(
        `SearXNG: docker ${exists ? 'start' : 'run'} failed (${errCode(r.error) ?? (r.stderr || `exit ${r.status}`).trim()})`,
      );
      return false;
    }
  } catch (e) {
    failures.push(`SearXNG: ${e.message}`);
    return false;
  }
  const healthy = await progress('Waiting for SearXNG', async () => {
    for (const end = Date.now() + 30000; Date.now() < end; await new Promise((r) => setTimeout(r, 1000))) {
      try {
        const res = await fetch('http://127.0.0.1:8888/search?q=test&format=json', {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok && (await res.json())) return { ok: true };
      } catch {
        /* not up yet */
      }
    }
    return { ok: false };
  });
  if (healthy.ok) done.push('SearXNG answers on 127.0.0.1:8888');
  else
    failures.push(
      `SearXNG did not answer JSON within 30 s; ${denied ? 'WebSearch and WebFetch stay denied; start SearXNG (docker start searxng)' : 'the built-in WebSearch and WebFetch stay on'}. If ${join(SEARXNG, 'settings.yml')} predates this installer, check that search.formats includes json`,
    );
  return healthy.ok;
}
