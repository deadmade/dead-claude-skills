// web-mcp's `browser` tool drives agent-browser. A current one on PATH is used as is; otherwise upstream's release
// binary for the version pinned in installer/assets/agent-browser.json goes to ~/.claude/bin. Either way its browser is
// installed and web-mcp's agentBrowserPath names it. Asks before a download; every failure is a summary line.
import { join } from 'node:path';
import {
  AGENT_BROWSER_FILES,
  type AgentBrowserPin,
  agentBrowserAsset,
  agentBrowserPlan,
  agentBrowserVersion,
} from '../core/binaries.ts';
import { ASSETS, ask, done, failures, readJson } from '../context.ts';
import { downloadBin } from '../system/net.ts';
import { claude, errCode, startSync, which } from '../system/proc.ts';
import { log, progress } from '../ui/ui.ts';
import { BIN_DIR, WEB_MCP } from './binaries.ts';

export async function applyAgentBrowser() {
  const pin: AgentBrowserPin = readJson(join(ASSETS, 'agent-browser.json'));
  const pinned = pin.upstream ?? '';
  const key = `${process.platform}-${process.arch}`;
  const versionOf = (bin: string) => {
    const r = startSync(bin, ['--version']);
    return r.status === 0 ? agentBrowserVersion(r.stdout) : undefined;
  };
  const asset = agentBrowserAsset(process.platform, process.arch, pin);
  const bin = asset && join(BIN_DIR, asset.exe);
  const ours = bin && versionOf(bin);
  const theirs = which('agent-browser');
  const plan = agentBrowserPlan({
    theirs: theirs && versionOf(theirs),
    ours,
    pinned,
  });
  if (plan.use === 'path') return useAgentBrowser(theirs!, false);
  if (!asset)
    return failures.push(
      AGENT_BROWSER_FILES[key]
        ? `agent-browser: bad pin in installer/assets/agent-browser.json (${JSON.stringify(pin)})`
        : `agent-browser: no upstream build for ${key}`,
    );
  // --with-deps runs sudo, so it is offered only with a download, behind its own prompt (default no).
  let deps = false;
  if (plan.download !== 'skip') {
    const what = plan.download === 'install' ? 'Download' : `Upgrade ${ours} to`;
    if (!(await ask(`${what} agent-browser ${pinned} (upstream's release binary) to ${bin}, then its browser?`, true)))
      return done.push('agent-browser: install skipped by you');
    deps =
      process.platform === 'linux' &&
      (await ask('Also install the browser system packages (agent-browser install --with-deps, runs sudo)?', false));
    const r = await progress(`Downloading agent-browser ${pinned}`, async () => {
      await downloadBin('agent-browser', asset, bin!);
      return { ok: true };
    });
    if (!r.ok) return failures.push(`agent-browser ${pinned}: ${r.err}`);
    done.push(`agent-browser: ${plan.download === 'install' ? 'installed' : 'upgraded to'} ${pinned} at ${bin}`);
  }
  await useAgentBrowser(bin!, deps);
}

// Runs `agent-browser install` (the browser download) on the copy in use, every run, so a download that failed before
// is retried, then points web-mcp's agentBrowserPath at it. path: a full path, npm's .cmd shim on Windows included.
async function useAgentBrowser(path: string, deps: boolean) {
  const args = deps ? ['install', '--with-deps'] : ['install'];
  log('info', `Running agent-browser ${args.join(' ')}`);
  const run = startSync(path, args, { stdio: 'inherit' });
  if (run.status !== 0)
    failures.push(
      `agent-browser: \`${path} ${args.join(' ')}\` failed (${errCode(run.error) ?? `exit ${run.status}`})`,
    );
  const r = await claude(JSON.stringify({ agentBrowserPath: path }), 'plugin', 'configure', WEB_MCP, '--values-stdin');
  if (r.ok) done.push(`web-mcp: agentBrowserPath is ${path}`);
  else
    failures.push(
      `web-mcp: could not set agentBrowserPath (${r.err}); set it to ${path} with /plugin configure web-mcp`,
    );
}
