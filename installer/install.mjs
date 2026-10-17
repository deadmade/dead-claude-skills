#!/usr/bin/env node
// Interactive installer for the dead-claude-skills marketplace. Decisions live in core.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { styleText } from 'node:util';
import {
  BUNDLE,
  CLEAN_TARGETS,
  HINTS,
  MARKETPLACE,
  OFFICIAL,
  TOGGLES,
  BIN_PLUGINS,
  binAction,
  binAsset,
  bundleIds,
  categorize,
  cswapCurrent,
  cswapDownload,
  dcgCommand,
  duplicates,
  foreignMarketplaces,
  foreignPlugins,
  retiredPlugins,
  hasDcgHook,
  isOurStatusLine,
  isSandboxOn,
  isWebBuiltinsOff,
  searxngRun,
  webBuiltinsDecision,
  isStripped,
  mergeSettings,
  isShipped,
  marketplaceArg,
  missingBinaries,
  agentBrowserAction,
  agentBrowserVersion,
  nameOf,
  manifestPath,
  needsToken,
  optIns,
  pathWith,
  pinMarketplace,
  outdated,
  planPlugins,
  resetSettings,
  safeArg,
  settingsChange,
  settingsText,
  sha256Of,
  shippedVersions,
  stripDefaults,
  unavailable,
  INCLUDED,
  idOf,
  withDependencies,
} from './core.mjs';
import { backup, clearTargets, writeAtomic, writeSearxng } from './files.mjs';
import { confirm, line, log, note, progress, screen } from './ui.mjs';
import { changeList, initial, move, render } from './view.mjs';

const PKG = join(import.meta.dirname, '..');
const CONFIG = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const SETTINGS = join(CONFIG, 'settings.json');
const SEARXNG = join(CONFIG, 'searxng');
const RULES = join(CONFIG, 'rules', 'dead-claude-skills.md');
const CCSL = join(homedir(), '.config', 'ccstatusline', 'settings.json');
const WIN = process.platform === 'win32';
const FLAGS = process.argv.slice(2);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const tryJson = (file) => {
  try {
    return readJson(file);
  } catch {
    return undefined;
  }
};
const VERSION = readJson(join(PKG, 'package.json')).version;
const failures = [];
const done = [];

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this in a terminal: npx --allow-git=root github:deadmade/dead-claude-skills#semver:*');
  process.exit(1);
}

// --- terminal UI ------------------------------------------------------------------------------------------------
const red = (s) => styleText('red', s);
const green = (s) => styleText('green', s);

// The answer of a prompt; ctrl-c (null) ends the installer.
function must(answer) {
  if (answer !== null) return answer;
  log('error', done.length ? 'Stopped. What ran so far is kept.' : 'Cancelled before installing anything.');
  process.exit(130);
}

const ask = async (message, initialValue) => must(await confirm(message, initialValue));

// --- claude CLI -------------------------------------------------------------------------------------------------
// input: what the command reads on stdin, or undefined.
function claude(input, ...args) {
  args.forEach(safeArg);
  // Windows: one string through the shell so both claude.cmd and claude.exe resolve; args are safeArg-checked.
  const child = WIN ? spawn(['claude', ...args].join(' '), { shell: true }) : spawn('claude', args);
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8').on('data', (d) => {
    out += d;
  });
  child.stderr.setEncoding('utf8').on('data', (d) => {
    err += d;
  });
  child.stdin.on('error', () => {}).end(input);
  return new Promise((resolve) => {
    child.on('error', (e) => {
      log('error', `Can't run claude (${e.code}). Install Claude Code and make sure it's on PATH.`);
      process.exit(1);
    });
    child.on('close', (code) => resolve({ ok: code === 0, out: out.trim(), err: (err || out).trim() }));
  });
}

const record = (label, r) => {
  (r.ok ? done : failures).push(r.ok ? label : `${label}: ${r.err}`);
  return r.ok;
};

// One claude command on its own progress line. doing: shown while it runs; label: what the summary says.
const run = async (doing, label, ...args) => record(label, await progress(doing, () => claude(undefined, ...args)));

// --- files ------------------------------------------------------------------------------------------------------
const remove = (file, label) => {
  if (!existsSync(file)) return;
  rmSync(file);
  done.push(`deleted ${label}`);
};

// strip: add the default-disabling keys. reset: clean slate, replace instead of merge.
async function applySettings(toggles, { strip, reset }) {
  const build = (s) =>
    reset ? resetSettings(s, toggles) : strip ? stripDefaults(mergeSettings(s, toggles)) : mergeSettings(s, toggles);
  const snippet = (title) => note(title, JSON.stringify(build({}), null, 2).split('\n'));
  if (existsSync(SETTINGS) && lstatSync(SETTINGS).isSymbolicLink()) {
    failures.push(`${SETTINGS} is a symlink; merge these keys where it's managed (printed above)`);
    return snippet(`${SETTINGS} is a symlink, not writing it. Merge these keys where it's managed`);
  }
  const raw = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : '{}';
  const change = settingsChange(raw, build);
  if (change === undefined) {
    failures.push(`${SETTINGS} is not valid JSON; merge these keys by hand (printed above)`);
    return snippet(`${SETTINGS} is not valid JSON. Merge these keys by hand`);
  }
  if (!change) return;
  const { before, after, changed } = change;
  const lines = (sign, k, v) => `${k}: ${JSON.stringify(v, null, 2)}`.split('\n').map((l) => `${sign} ${l}`);
  const diff = changed.flatMap((k) => [
    ...(k in before ? lines('-', k, before[k]).map(red) : []),
    ...(k in after ? lines('+', k, after[k]).map(green) : []),
  ]);
  note('settings.json changes', [SETTINGS, '', ...diff]);
  if (!(await ask('Write these changes?', true))) return done.push('settings.json: skipped by you');
  writeAtomic(SETTINGS, change.text);
  done.push(`settings.json: updated ${changed.join(', ')}`);
}

// Off only deletes the config when this installer's status line was on: the toggle also reads off for a ccstatusline
// set up some other way, whose config isn't ours to delete.
async function applyCcstatusline(was, on, nightCity) {
  if (!on) return was ? remove(CCSL, CCSL) : undefined;
  const shippedFile = (f) => readFileSync(join(PKG, 'installer', f), 'utf8');
  const shipped = shippedFile(nightCity ? 'ccstatusline-night-city.json' : 'ccstatusline.json');
  if (!existsSync(CCSL)) {
    writeAtomic(CCSL, shipped);
    return done.push(`wrote ${CCSL}`);
  }
  const current = readFileSync(CCSL, 'utf8');
  if (isShipped(current, [shipped])) return;
  const newer = (tryJson(CCSL)?.version ?? 0) > JSON.parse(shipped).version;
  if (newer) log('warn', `${CCSL} has a newer config version than the shipped one; keeping it is safer.`);
  // The other shipped config (stock vs Night City) is ours, not a customization: swap it without asking.
  const ours = isShipped(current, [shippedFile('ccstatusline.json'), shippedFile('ccstatusline-night-city.json')]);
  if (ours || (await ask(`${CCSL} differs from the shipped config. Replace it?`, false))) {
    writeAtomic(CCSL, shipped);
    done.push(`replaced ${CCSL}`);
  } else if (current) done.push(`kept your ${CCSL}`);
}

async function applyDcg(was, on) {
  if (was === on) return;
  const action = on ? 'install' : 'uninstall';
  if (
    !(await ask(
      `Run dcg's official ${action}er? It ${on ? 'installs dcg and adds' : 'removes dcg and'} its Claude Code hook.`,
      true,
    ))
  ) {
    return done.push(`dcg: ${action} skipped by you`);
  }
  log('info', `Running dcg's ${action}er`);
  const [bin, args] = dcgCommand(process.platform, action);
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (r.status !== 0) return failures.push(`dcg ${action} failed (${r.error?.code ?? `exit ${r.status}`})`);
  done.push(`dcg: ${action}ed`);
  if (on && !WIN && !onPath('dcg')) log('warn', 'dcg is not on PATH: add ~/.local/bin (NixOS: home.sessionPath).');
}

// Windows: download cswap.exe from this version's release (checked against its .sha256), put its folder on PATH.
async function applyCswap(on) {
  const version = readJson(join(PKG, 'installer', 'cswap.json')).upstream;
  const dl = cswapDownload(process.platform, process.env, VERSION);
  if (!on || !dl) return;
  const have = existsSync(dl.exe) ? spawnSync(dl.exe, ['--version'], { encoding: 'utf8' }) : undefined;
  if (!(have?.status === 0 && cswapCurrent(have.stdout, version))) {
    if (!(await ask(`Download cswap.exe ${version} (claude-swap, built by this repo's CI) to ${dl.dir}?`, true))) {
      return done.push('cswap: download skipped by you');
    }
    const r = await progress(`Downloading cswap.exe ${version}`, async () => {
      const get = async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res;
      };
      const [exe, sum] = await Promise.all([
        get(dl.url).then((res) => res.arrayBuffer()),
        get(dl.sha256Url).then((res) => res.text()),
      ]);
      const bytes = Buffer.from(exe);
      const want = sum.trim().split(/\s+/)[0].toLowerCase();
      const got = createHash('sha256').update(bytes).digest('hex');
      if (got !== want) throw new Error(`checksum mismatch (got ${got}, want ${want}), nothing written`);
      mkdirSync(dl.dir, { recursive: true });
      const tmp = `${dl.exe}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes);
      // A running cswap.exe (the plugin polls it) can be renamed but not replaced: move it aside first.
      const old = `${dl.exe}.old-${process.pid}`;
      if (existsSync(dl.exe)) renameSync(dl.exe, old);
      renameSync(tmp, dl.exe);
      try {
        rmSync(old, { force: true });
      } catch {
        /* still running: left beside it */
      }
      return { ok: true };
    });
    if (!r.ok) return failures.push(`cswap download failed: ${r.err}`);
    done.push(`cswap: installed ${version} to ${dl.exe}`);
  }
  if (!process.env.PATH?.toLowerCase().includes(dl.dir.toLowerCase()))
    process.env.PATH = `${process.env.PATH};${dl.dir}`;
  const ps = (cmd, env) =>
    spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', env: { ...process.env, ...env } });
  const read = ps("[Environment]::GetEnvironmentVariable('Path', 'User')");
  // Without the current PATH, writing would replace it with only this folder.
  if (read.status !== 0) return failures.push(`cswap: couldn't read your user PATH; add ${dl.dir} to it by hand`);
  const next = pathWith(read.stdout.trim(), dl.dir);
  if (!next) return;
  // The new PATH goes through the environment, never into the command text.
  const r = ps("[Environment]::SetEnvironmentVariable('Path', $env:DCS_PATH, 'User')", { DCS_PATH: next });
  if (r.status === 0) done.push(`cswap: added ${dl.dir} to your user PATH (new terminals see it)`);
  else failures.push(`cswap: couldn't add ${dl.dir} to PATH; add it by hand`);
}

// web-mcp's `browser` tool drives the npm CLI agent-browser, pinned in installer/agent-browser.json. Asks first; every
// failure is a summary line. Linux's --with-deps runs sudo, so it has its own prompt (default no).
async function applyAgentBrowser() {
  const pinned = readJson(join(PKG, 'installer', 'agent-browser.json')).upstream;
  // The pin goes into a shell string on Windows (npm's .cmd shim), so it must be a plain version.
  if (!/^\d+\.\d+\.\d+$/.test(pinned)) return failures.push(`agent-browser: bad pin ${JSON.stringify(pinned)}`);
  const have = onPath('agent-browser')
    ? spawnSync('agent-browser', ['--version'], { encoding: 'utf8', shell: WIN })
    : undefined;
  const installed = have?.status === 0 ? agentBrowserVersion(have.stdout) : undefined;
  const action = agentBrowserAction({ installed, pinned });
  if (action === 'skip') return;
  const what = action === 'install' ? 'Install' : `Upgrade ${installed} to`;
  if (!(await ask(`${what} agent-browser ${pinned} (npm -g, then its browser download)?`, true)))
    return done.push('agent-browser: install skipped by you');
  const deps =
    process.platform === 'linux' &&
    (await ask('Also install the browser system packages (agent-browser install --with-deps, runs sudo)?', false));
  const steps = [
    ['npm', ['install', '-g', `agent-browser@${pinned}`]],
    ['agent-browser', deps ? ['install', '--with-deps'] : ['install']],
  ];
  for (const [bin, args] of steps) {
    log('info', `Running ${bin} ${args.join(' ')}`);
    const r = spawnSync(bin, args, { stdio: 'inherit', shell: WIN });
    if (r.status !== 0)
      return failures.push(
        `agent-browser: \`${bin} ${args.join(' ')}\` failed (${r.error?.code ?? `exit ${r.status}`})`,
      );
  }
  done.push(`agent-browser: ${action === 'install' ? 'installed' : 'upgraded to'} ${pinned}`);
}

// --- brv and web-mcp, the binaries of tui-review and web-mcp ---------------------------------------------------------
const TUI_REVIEW = `tui-review@${MARKETPLACE}`;
const WEB_MCP = `web-mcp@${MARKETPLACE}`;
const BIN_DIR = join(CONFIG, 'bin');
// One repo version: tui-review's plugin.json is the release both binaries come from.
const BIN_VERSION = readJson(join(PKG, 'plugins', 'tui-review', '.claude-plugin', 'plugin.json')).version;

// The version a binary reports (`<name> <version>`), or undefined when there is none or it does not run.
function binVersionAt(name, path) {
  if (!existsSync(path)) return undefined;
  const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
  return new RegExp(`^${name} (\\S+)`).exec(r.stdout ?? '')?.[1];
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (res.status === 404) throw new Error(`no release at ${url} yet`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// Downloads the release archive, checks it against its .sha256, and puts the binary at `bin` in one rename.
async function downloadBin(name, asset, bin) {
  const [archive, sum] = await Promise.all([
    fetchOk(asset.url).then((r) => r.arrayBuffer()),
    fetchOk(asset.sha256).then((r) => r.text()),
  ]);
  const bytes = Buffer.from(archive);
  if (sha256Of(sum) !== createHash('sha256').update(bytes).digest('hex'))
    throw new Error(`${asset.file}: checksum mismatch`);
  const tmp = mkdtempSync(join(tmpdir(), `${name}-`));
  try {
    const file = join(tmp, asset.file);
    writeFileSync(file, bytes);
    // GNU tar on Linux, bsdtar on macOS and Windows 10+, which reads the zip too.
    const r = spawnSync('tar', ['-xf', file, '-C', tmp], { encoding: 'utf8' });
    if (r.status !== 0)
      throw new Error(`could not unpack ${asset.file}: ${(r.stderr || r.error?.message || '').trim()}`);
    mkdirSync(BIN_DIR, { recursive: true });
    const staged = `${bin}.tmp-${process.pid}`;
    cpSync(join(tmp, asset.exe), staged);
    chmodSync(staged, 0o755);
    renameSync(staged, bin);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// A plugin that needs its binary: one on PATH is used as is; otherwise the release for this version goes to
// ~/.claude/bin and the plugin's userConfig key points at it.
async function applyBin(pluginName, plugin) {
  const { name, key } = BIN_PLUGINS[pluginName];
  const version = BIN_VERSION;
  const asset = binAsset(name, process.platform, process.arch, version);
  const bin = join(BIN_DIR, asset?.exe ?? (WIN ? `${name}.exe` : name));
  const action = binAction({
    onPath: onPath(name),
    installed: binVersionAt(name, bin),
    version,
    supported: asset !== undefined,
  });
  const build = `build it with \`cargo build --release\` in plugins/${pluginName}/${pluginName === 'web-mcp' ? 'server' : 'brv'} and set its path with /plugin configure ${pluginName}`;
  if (action === 'skip') return done.push(`${name}: using the one on PATH`);
  if (action === 'unsupported')
    return failures.push(`${name}: no release build for ${process.platform}-${process.arch}; ${build}`);
  if (action === 'download') {
    const r = await progress(`Downloading ${name} ${version}`, async () => {
      await downloadBin(name, asset, bin);
      return { ok: true };
    });
    if (!r.ok) return failures.push(`${name} ${version}: ${r.err}; ${build}`);
    done.push(`installed ${name} ${version} to ${bin}`);
  }
  const r = await claude(JSON.stringify({ [key]: bin }), 'plugin', 'configure', plugin, '--values-stdin');
  if (r.ok) done.push(`${pluginName}: ${key} is ${bin}`);
  else
    failures.push(
      `${pluginName}: could not set ${key} (${r.err}); set it to ${bin} with /plugin configure ${pluginName}`,
    );
}

// SearXNG in Docker for web-mcp's search. True when it answers JSON on 127.0.0.1:8888 within 30 s. Every failure is a
// summary line, never a crash. An existing settings.yml is kept so the running container's secret stays valid.
async function applySearxng(denied) {
  if (!onPath('docker')) {
    failures.push(
      `SearXNG: docker not found; write ${join(SEARXNG, 'settings.yml')} (see installer/searxng.yml) and run: docker ${searxngRun(SEARXNG).join(' ')}`,
    );
    return false;
  }
  const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
  try {
    if (
      writeSearxng(
        SEARXNG,
        readFileSync(join(PKG, 'installer', 'searxng.yml'), 'utf8'),
        randomBytes(32).toString('hex'),
      )
    )
      done.push(`wrote ${join(SEARXNG, 'settings.yml')}`);
    const exists = docker('container', 'inspect', 'searxng').status === 0;
    if (!exists) log('info', 'First run pulls the SearXNG image and may take a minute');
    const r = exists ? docker('start', 'searxng') : docker(...searxngRun(SEARXNG));
    if (r.status !== 0) {
      failures.push(
        `SearXNG: docker ${exists ? 'start' : 'run'} failed (${r.error?.code ?? (r.stderr || `exit ${r.status}`).trim()})`,
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

function onPath(bin) {
  const exts = WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  return (process.env.PATH || '').split(delimiter).some((d) => exts.some((e) => existsSync(join(d, bin + e))));
}

// --- run --------------------------------------------------------------------------------------------------------
const HANDOFF = {
  'mcp-github': [
    'Needs a fine-grained PAT: https://github.com/settings/personal-access-tokens/new',
    'with the repository permissions Claude should have.',
  ],
  'mcp-azure': [
    'Needs the collection URL (e.g. https://tfs.company/tfs/DefaultCollection), a PAT with Code (Read),',
    'Work Items (Read & Write), Build (Read), Wiki (Read), the REST API version (2022 → 7.0, 2020 → 6.0,',
    '2019 → 5.0) and optionally a default project.',
  ],
};

// The settings entry Claude Code checks the add against; a symlinked or broken settings.json is left as it is.
// Returns the file as it was, or undefined when nothing was written.
function pinSettingsEntry() {
  if (!existsSync(SETTINGS) || lstatSync(SETTINGS).isSymbolicLink()) return undefined;
  const raw = readFileSync(SETTINGS, 'utf8');
  const before = tryJson(SETTINGS);
  const after = before && pinMarketplace(before, VERSION);
  if (!after || after === before) return undefined;
  writeAtomic(SETTINGS, settingsText(raw, after));
  done.push(`settings.json: pinned the ${MARKETPLACE} marketplace to v${VERSION}`);
  return raw;
}

log('info', `${styleText(['bold', 'magenta'], 'dead-claude-skills')} v${VERSION}`);

// A failed list would read as "nothing installed": stop instead of planning from it.
function listed(what, r) {
  try {
    if (r.ok) return JSON.parse(r.out || '[]');
  } catch {
    /* falls through to the error */
  }
  log('error', `Can't read the ${what} (claude plugin … list --json): ${r.err || r.out}`);
  process.exit(1);
}

const marketplaces = listed('marketplaces', await claude(undefined, 'plugin', 'marketplace', 'list', '--json'));
const unpinned = pinSettingsEntry();
// Adding again also moves an existing checkout to this installer's tag.
const market = await progress(`Adding the ${MARKETPLACE} marketplace at v${VERSION}`, () =>
  claude(undefined, 'plugin', 'marketplace', 'add', marketplaceArg(VERSION)),
);
if (!market.ok) {
  // A pinned entry the checkout doesn't match hides the marketplace from Claude Code.
  if (unpinned !== undefined) writeAtomic(SETTINGS, unpinned);
  log('error', `Adding the marketplace at v${VERSION} failed (does the release exist?)`);
  process.exit(1);
}
// The bundle's core plugins and some opt-ins install from Anthropic's marketplace.
if (!marketplaces.some((m) => m.name === OFFICIAL)) {
  await run(
    `Adding ${OFFICIAL}`,
    `added marketplace ${OFFICIAL}`,
    'plugin',
    'marketplace',
    'add',
    `anthropics/${OFFICIAL}`,
  );
}
const plugins = listed(
  'installed plugins',
  await progress('Reading installed plugins', () => claude(undefined, 'plugin', 'list', '--json')),
);
const rows = Array.isArray(plugins) ? plugins : (plugins.installed ?? []);

const manifest = readJson(join(PKG, '.claude-plugin', 'marketplace.json'));
const bundle = readJson(join(PKG, 'plugins', BUNDLE, '.claude-plugin', 'plugin.json'));
const opts = optIns(manifest, bundle);
const tokenPlugins = opts.filter((id) => {
  const path = manifestPath(manifest, id);
  return needsToken((path && tryJson(join(PKG, path))) || {});
});
const BUNDLE_ID = `${BUNDLE}@${MARKETPLACE}`;
const FLOWS = `flows@${MARKETPLACE}`;
// Each opt-in's dependencies that are opt-ins too; bundle plugins are installed anyway.
const depsOf = (id) => {
  const path = manifestPath(manifest, id);
  return ((path && tryJson(join(PKG, path))?.dependencies) || []).map(idOf).filter((d) => opts.includes(d));
};
const deps = Object.fromEntries(opts.map((id) => [id, depsOf(id)]).filter(([, d]) => d.length));
const managed = [...bundleIds(bundle), ...opts];

const installedIds = rows.map((pl) => pl.id);
// By name, so a plugin that moved marketplaces stays selected; its old copy is removed as a duplicate.
const has = (id) => installedIds.some((i) => nameOf(i) === nameOf(id));
const settingsNow = tryJson(SETTINGS) ?? {};

// What each option is right now, and what the pages start from.
const current = {
  ...Object.fromEntries(opts.map((id) => [id, has(id)])),
  ccstatusline: isOurStatusLine(settingsNow.statusLine),
  sandbox: isSandboxOn(settingsNow),
  dcg: hasDcgHook(settingsNow),
  'strip-defaults': isStripped(settingsNow),
  clean: false,
  'web-builtins-off': isWebBuiltinsOff(settingsNow),
};
const chosen = {
  ...current,
  'strip-defaults': FLAGS.includes('--strip-defaults') || current['strip-defaults'],
  clean: FLAGS.includes('--clean'),
  // flows replaced feature-flow and brings the picks: a machine that had either keeps them.
  [FLOWS]: current[FLOWS] || has(`feature-flow@${MARKETPLACE}`) || INCLUDED.some(has),
  // On by default where offered, until web-mcp is installed; then it keeps the user's choice. It does nothing unless
  // web-mcp is selected and SearXNG answers.
  'web-builtins-off': has(WEB_MCP)
    ? current['web-builtins-off']
    : unavailable('web-builtins-off', process.platform, process.arch, BIN_VERSION) === undefined,
};

// Options that can't work here stay off the pages, unless they're on already: hiding never removes anything.
const hidden = [...opts, ...TOGGLES]
  .map((key) => ({ key, why: unavailable(key, process.platform, process.arch, BIN_VERSION) }))
  .filter((h) => h.why && !current[h.key]);
const pages = categorize([...opts, ...TOGGLES].filter((k) => !hidden.some((h) => h.key === k)));

const describe = Object.fromEntries(manifest.plugins.map((pl) => [pl.name, pl.description.split(/(?<=\.)\s/)[0]]));
function option(key) {
  const name = nameOf(key);
  const notes = [
    tokenPlugins.includes(key) && 'token entered in Claude Code',
    key.endsWith(`@${OFFICIAL}`) && `from ${OFFICIAL}`,
    deps[key] && `brings ${deps[key].length} plugins`,
    ...Object.keys(deps)
      .filter((p) => deps[p].includes(key))
      .map((p) => `comes with ${nameOf(p)}`),
  ].filter(Boolean);
  const detail = [HINTS[name] ?? describe[name] ?? '', ...notes].filter(Boolean).join(' · ');
  return { label: name, detail };
}

// Versions this release ships; what's installed of each option, by name like has().
const shipped = shippedVersions(
  manifest.plugins,
  (src) => tryJson(join(PKG, src, '.claude-plugin', 'plugin.json'))?.version,
);
const rowOf = (key) => rows.find((r) => nameOf(r.id) === nameOf(key));
const data = {
  version: VERSION,
  platform: `${process.platform}-${process.arch}`,
  pages,
  current,
  versions: Object.fromEntries(opts.flatMap((k) => (rowOf(k)?.version ? [[k, rowOf(k).version]] : []))),
  disabled: Object.fromEntries(opts.flatMap((k) => (rowOf(k)?.enabled === false ? [[k, true]] : []))),
  tokens: tokenPlugins,
  deps,
  describe: option,
  updates: outdated(rows, shipped),
  core: `${BUNDLE} + ${bundle.dependencies.length}, always installed`,
  hidden,
  retired: retiredPlugins(installedIds, managed),
  // What strip-defaults / clean remove on top of the choices, so the review shows it.
  sweep: [
    ...new Set([...foreignPlugins(installedIds, managed), ...duplicates(installedIds, managed)]),
    ...foreignMarketplaces(marketplaces.map((m) => m.name)).map((n) => `marketplace ${n}`),
  ],
};

let state = initial({ ...chosen });
for (;;) {
  state = await screen(state, { move: (s, k) => move(s, k, data), render: (s, o) => render(s, data, o) });
  if (state.result === 'ask-quit') {
    const keep = await confirm(`Quit without applying ${changeList(state, data).count} changes?`, false);
    if (keep === false) {
      state = { ...state, result: undefined };
      continue;
    }
  }
  if (state.result === 'apply') break;
  log('info', 'Cancelled before installing anything.');
  process.exit(0);
}
Object.assign(chosen, state.chosen);
const on = (k) => chosen[k];

let clean = on('clean');
let backupDir;
if (clean) {
  backupDir = `${CONFIG}.dead-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  note('Clean slate', [
    ...[
      `${SETTINGS} is replaced with only this installer's settings, and these are deleted:`,
      ...CLEAN_TARGETS.map((t) => join(CONFIG, t))
        .filter(existsSync)
        .map((t) => `  ${t}`),
      `Every plugin and marketplace not from dead-claude-skills is removed too, except the ${OFFICIAL} plugins used here.`,
    ].map(red),
    `A backup goes to ${backupDir} first.`,
  ]);
  const word = must(await line('Really wipe your Claude Code config? Type "clean" to continue:'));
  clean = word?.trim() === 'clean';
  if (!clean) done.push('clean slate: skipped by you');
  else {
    try {
      backup(CONFIG, backupDir);
    } catch (e) {
      log('error', `Backup failed, nothing was deleted: ${e.message}`);
      process.exit(1);
    }
    done.push(`backed up your config to ${backupDir}`);
  }
}
const strip = clean || on('strip-defaults');

const dupes = duplicates(installedIds, managed);
const foreign = strip ? [...new Set([...foreignPlugins(installedIds, managed), ...dupes])] : [];
if (foreign.length) {
  log('info', `Removing plugins this setup doesn't use:\n${foreign.join('\n')}`);
  for (const id of foreign) await run(`Uninstalling ${id}`, `uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');
} else if (dupes.length) {
  log('warn', `Same plugins installed from another marketplace (they'd load twice):\n${dupes.join('\n')}`);
  if (await ask('Uninstall them?', true)) {
    for (const id of dupes) await run(`Uninstalling ${id}`, `uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');
  }
}
// After their plugins are gone, so nothing is left pointing at a removed marketplace.
const foreignMarkets = strip ? foreignMarketplaces(marketplaces.map((m) => m.name)) : [];
for (const name of foreignMarkets)
  await run(`Removing marketplace ${name}`, `removed marketplace ${name}`, 'plugin', 'marketplace', 'remove', name);

// INCLUDED plugins have no row: only a chosen plugin's dependencies select them.
const selected = withDependencies(
  [BUNDLE_ID, ...opts.filter((id) => on(id) && !INCLUDED.includes(nameOf(id)))],
  (id) => deps[id],
  opts,
);
const plan = planPlugins(
  selected,
  installedIds.filter((id) => [BUNDLE_ID, ...opts].includes(id)),
  tokenPlugins,
);
// Opt-ins that were once bundle dependencies are still marked auto and would be pruned; installing clears that.
const installedJson = tryJson(join(CONFIG, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
plan.install.push(...selected.filter((id) => opts.includes(id) && installedJson[id]?.some((e) => e.auto)));
for (const id of plan.install)
  await run(`Installing ${nameOf(id)}`, `installed ${id}`, 'plugin', 'install', id, '--scope', 'user', '--json');
for (const id of plan.uninstall)
  await run(`Uninstalling ${nameOf(id)}`, `uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');
for (const id of data.retired)
  await run(`Uninstalling ${nameOf(id)}`, `uninstalled ${id} (retired)`, 'plugin', 'uninstall', id, '--json');
for (const u of changeList(state, data).update) {
  await run(
    `Updating ${nameOf(u.id)} ${u.from} → ${u.to}`,
    `updated ${u.id} ${u.from} → ${u.to}`,
    'plugin',
    'update',
    u.id,
    '--json',
  );
}
if (plan.uninstall.length || data.retired.length || dupes.length || foreign.length)
  await run('Pruning unused dependencies', 'pruned unused dependencies', 'plugin', 'prune', '-y');
if (selected.includes(TUI_REVIEW)) await applyBin('tui-review', TUI_REVIEW);
if (selected.includes(WEB_MCP)) await applyBin('web-mcp', WEB_MCP);

const webBuiltinsOff = webBuiltinsDecision({
  toggle: selected.includes(WEB_MCP) && on('web-builtins-off'),
  was: current['web-builtins-off'],
  installed: has(WEB_MCP),
  healthy: selected.includes(WEB_MCP) && (await applySearxng(current['web-builtins-off'])),
});

const nightCity = selected.some((id) => nameOf(id) === 'night-city');
const notify = selected.some((id) => nameOf(id) === 'notify');
const toggles = {
  statusLine: on('ccstatusline'),
  sandbox: on('sandbox'),
  dcg: on('dcg'),
  version: VERSION,
  nightCity,
  notify,
  webBuiltinsOff,
};
await applySettings(toggles, { strip, reset: clean });
const autoUpdate = tryJson(join(CONFIG, 'plugins', 'known_marketplaces.json'))?.[MARKETPLACE]?.autoUpdate;
await applyCcstatusline(current.ccstatusline, on('ccstatusline'), nightCity);
await applyDcg(current.dcg, on('dcg'));
if (selected.includes(WEB_MCP)) await applyAgentBrowser();
await applyCswap(selected.some((id) => nameOf(id) === 'cswap'));
if (clean) done.push(...clearTargets(CONFIG));
// The global instructions moved into a dead-skills SessionStart hook; the old file would duplicate them.
remove(RULES, RULES);

const wanted = [...selected.map(nameOf), ...TOGGLES.filter(on)];
const missing = missingBinaries(process.platform, wanted, onPath);

note('Summary', [
  ...(done.length ? done.map((d) => green(`✓ ${d}`)) : [green('✓ nothing to change')]),
  ...failures.map((f) => red(`✗ ${f}`)),
  `marketplace autoUpdate (known_marketplaces.json): ${autoUpdate ?? 'not set'}`,
  ...(clean ? [`restore the backup: cp -a ${backupDir}/. ${CONFIG}/`] : []),
]);
for (const id of plan.handoff) {
  note(`${nameOf(id)}: run this in Claude Code, it asks for the token`, [
    `/plugin install ${id}`,
    ...(HANDOFF[nameOf(id)] ?? []),
  ]);
}
if (missing.length) {
  const width = Math.max(...missing.map((m) => m.binary.length)) + 2;
  note(
    'Missing on PATH (nothing was installed, copy what you need)',
    missing.map((m) => `${m.binary.padEnd(width)}${m.command}`),
  );
}
if (failures.length)
  log(
    'error',
    `Finished with ${failures.length} problem${failures.length > 1 ? 's' : ''}. Restart Claude Code (or /reload-plugins) to load what worked.`,
  );
else log('info', 'Restart Claude Code (or run /reload-plugins) to load the changes.');
process.exit(failures.length ? 1 : 0);
