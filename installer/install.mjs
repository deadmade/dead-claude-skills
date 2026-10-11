#!/usr/bin/env node
// Interactive installer for the dead-claude-skills marketplace. Decisions live in core.mjs.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createInterface, emitKeypressEvents } from 'node:readline';
import {
  BUNDLE, CLEAN_TARGETS, MARKETPLACE, OFFICIAL, brvAction, brvAsset, bundleIds, cswapCurrent, cswapDownload, dcgCommand,
  duplicates, foreignMarketplaces, foreignPlugins, hasDcgHook, isOurStatusLine, isSandboxOn, isStripped, mergeSettings,
  marketplaceArg, missingBinaries, nameOf, needsToken, optIns, pathWith, pinMarketplace, planPlugins, resetSettings, safeArg,
  sha256Of, stripDefaults,
} from './core.mjs';

const PKG = join(import.meta.dirname, '..');
const CONFIG = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const SETTINGS = join(CONFIG, 'settings.json');
const RULES = join(CONFIG, 'rules', 'dead-claude-skills.md');
const CCSL = join(homedir(), '.config', 'ccstatusline', 'settings.json');
const WIN = process.platform === 'win32';
const FLAGS = process.argv.slice(2);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const tryJson = (p) => { try { return readJson(p); } catch { return undefined; } };
const VERSION = readJson(join(PKG, 'package.json')).version;
const failures = [];
const done = [];

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this in a terminal: npx --allow-git=root github:deadmade/dead-claude-skills');
  process.exit(1);
}

// --- claude CLI -------------------------------------------------------------------------------------------------
const claude = (...args) => claudeWith(undefined, ...args);

// input: what the command reads on stdin, or undefined.
function claudeWith(input, ...args) {
  args.forEach(safeArg);
  // Windows: one string through the shell so both claude.cmd and claude.exe resolve; args are safeArg-checked.
  const r = WIN
    ? spawnSync(['claude', ...args].join(' '), { shell: true, encoding: 'utf8', input })
    : spawnSync('claude', args, { encoding: 'utf8', input });
  if (r.error) {
    console.error(`Can't run claude (${r.error.code}). Install Claude Code and make sure it's on PATH.`);
    process.exit(1);
  }
  return { ok: r.status === 0, out: r.stdout.trim(), err: (r.stderr || r.stdout).trim() };
}

function step(label, ...args) {
  const r = claude(...args);
  (r.ok ? done : failures).push(r.ok ? label : `${label}: ${r.err}`);
  return r.ok;
}

// --- terminal UI ------------------------------------------------------------------------------------------------
emitKeypressEvents(process.stdin);

function keys(onKey) {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const handler = (_, key) => {
      if (key?.ctrl && key.name === 'c') {
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(130);
      }
      const result = onKey(key ?? {});
      if (result === undefined) return;
      process.stdin.off('keypress', handler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(result);
    };
    process.stdin.on('keypress', handler);
  });
}

async function ask(question, def) {
  process.stdout.write(`${question} ${def ? '[Y/n]' : '[y/N]'} `);
  const answer = await keys((k) => (k.name === 'y' ? true : k.name === 'n' ? false : k.name === 'return' ? def : undefined));
  console.log(answer ? 'y' : 'n');
  return answer;
}

async function typed(question, word) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${question} Type "${word}" to continue: `, resolve));
  rl.close();
  return answer.trim() === word;
}

async function checklist(rows) {
  let cursor = rows.findIndex((r) => !r.fixed);
  let drawn = 0;
  const draw = () => {
    if (drawn) process.stdout.write(`\x1b[${drawn}A\x1b[J`);
    const lines = rows.map((r, i) =>
      `${i === cursor ? '›' : ' '} [${r.checked ? 'x' : ' '}] ${r.label}${r.note ? `  \x1b[2m${r.note}\x1b[0m` : ''}`);
    lines.push('\x1b[2m↑/↓ move · space toggle · enter apply · ctrl-c quit\x1b[0m');
    process.stdout.write(lines.join('\n') + '\n');
    drawn = lines.length;
  };
  draw();
  await keys((k) => {
    if (k.name === 'return') return true;
    const step = k.name === 'up' ? -1 : k.name === 'down' ? 1 : 0;
    if (step) do cursor = (cursor + step + rows.length) % rows.length; while (rows[cursor].fixed);
    if (k.name === 'space') rows[cursor].checked = !rows[cursor].checked;
    draw();
  });
  return rows;
}

// --- files ------------------------------------------------------------------------------------------------------
function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const remove = (file, label) => {
  if (!existsSync(file)) return;
  rmSync(file);
  done.push(`deleted ${label}`);
};

// strip: add the default-disabling keys. reset: clean slate, replace instead of merge.
async function applySettings(toggles, { strip, reset }) {
  const build = (s) => (reset ? resetSettings(s, toggles) : strip ? stripDefaults(mergeSettings(s, toggles)) : mergeSettings(s, toggles));
  const snippet = () => console.log(JSON.stringify(build({}), null, 2));
  if (existsSync(SETTINGS) && lstatSync(SETTINGS).isSymbolicLink()) {
    console.log(`\n${SETTINGS} is a symlink, not writing it. Merge these keys where it's managed:`);
    return snippet();
  }
  const raw = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : '{}';
  let before;
  try { before = JSON.parse(raw); } catch {
    failures.push(`${SETTINGS} is not valid JSON; merge these keys by hand (printed above)`);
    console.log(`\n${SETTINGS} is not valid JSON. Merge these keys by hand:`);
    return snippet();
  }
  const after = build(before);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (!changed.length) return;
  console.log(`\nChanges to ${SETTINGS}:`);
  for (const k of changed) {
    if (k in before) console.log(`\x1b[31m- ${k}: ${JSON.stringify(before[k])}\x1b[0m`);
    if (k in after) console.log(`\x1b[32m+ ${k}: ${JSON.stringify(after[k])}\x1b[0m`);
  }
  if (!(await ask('Write these changes?', true))) return done.push('settings.json: skipped by you');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  writeAtomic(SETTINGS, JSON.stringify(after, null, 2).replaceAll('\n', eol) + eol);
  done.push(`settings.json: updated ${changed.join(', ')}`);
}

async function applyCcstatusline(on) {
  if (!on) return remove(CCSL, CCSL);
  const shipped = readFileSync(join(PKG, 'installer', 'ccstatusline.json'), 'utf8');
  if (!existsSync(CCSL)) {
    writeAtomic(CCSL, shipped);
    return done.push(`wrote ${CCSL}`);
  }
  const current = readFileSync(CCSL, 'utf8');
  if (JSON.stringify(tryJson(CCSL)) === JSON.stringify(JSON.parse(shipped))) return;
  const newer = (tryJson(CCSL)?.version ?? 0) > JSON.parse(shipped).version;
  if (newer) console.log(`\n\x1b[33m${CCSL} has a newer config version than the shipped one; keeping it is safer.\x1b[0m`);
  if (await ask(`\n${CCSL} differs from the shipped config. Replace it?`, false)) {
    writeAtomic(CCSL, shipped);
    done.push(`replaced ${CCSL}`);
  } else if (current) done.push(`kept your ${CCSL}`);
}

async function applyDcg(was, on) {
  if (was === on) return;
  const action = on ? 'install' : 'uninstall';
  if (!(await ask(`\nRun dcg's official ${action}er? It ${on ? 'installs dcg and adds' : 'removes dcg and'} its Claude Code hook.`, true))) {
    return done.push(`dcg: ${action} skipped by you`);
  }
  const [bin, args] = dcgCommand(process.platform, action);
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (r.status !== 0) return failures.push(`dcg ${action} failed (${r.error?.code ?? `exit ${r.status}`})`);
  done.push(`dcg: ${action}ed`);
  if (on && !WIN && !onPath('dcg')) console.log('\n\x1b[33mdcg is not on PATH: add ~/.local/bin (NixOS: home.sessionPath).\x1b[0m');
}

// Windows: download cswap.exe from this version's release (checked against its .sha256), put its folder on PATH.
async function applyCswap(on) {
  const version = readJson(join(PKG, 'installer', 'cswap.json')).upstream;
  const dl = cswapDownload(process.platform, process.env, VERSION);
  if (!on || !dl) return;
  const have = existsSync(dl.exe) ? spawnSync(dl.exe, ['--version'], { encoding: 'utf8' }) : undefined;
  if (!(have?.status === 0 && cswapCurrent(have.stdout, version))) {
    if (!(await ask(`\nDownload cswap.exe ${version} (claude-swap, built by this repo's CI) to ${dl.dir}?`, true))) {
      return done.push('cswap: download skipped by you');
    }
    try {
      const get = async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r;
      };
      const [exe, sum] = await Promise.all([get(dl.url).then((r) => r.arrayBuffer()), get(dl.sha256Url).then((r) => r.text())]);
      const bytes = Buffer.from(exe);
      const want = sum.trim().split(/\s+/)[0].toLowerCase();
      const got = createHash('sha256').update(bytes).digest('hex');
      if (got !== want) return failures.push(`cswap: checksum mismatch (got ${got}, want ${want}), nothing written`);
      mkdirSync(dl.dir, { recursive: true });
      const tmp = `${dl.exe}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes);
      // A running cswap.exe (the plugin polls it) can be renamed but not replaced: move it aside first.
      const old = `${dl.exe}.old-${process.pid}`;
      if (existsSync(dl.exe)) renameSync(dl.exe, old);
      renameSync(tmp, dl.exe);
      try { rmSync(old, { force: true }); } catch { /* still running: left beside it */ }
      done.push(`cswap: installed ${version} to ${dl.exe}`);
    } catch (e) {
      return failures.push(`cswap download failed: ${e.message}`);
    }
  }
  if (!process.env.PATH?.toLowerCase().includes(dl.dir.toLowerCase())) process.env.PATH = `${process.env.PATH};${dl.dir}`;
  const ps = (cmd, env) => spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', env: { ...process.env, ...env } });
  const userPath = ps("[Environment]::GetEnvironmentVariable('Path', 'User')").stdout?.trim();
  const next = pathWith(userPath, dl.dir);
  if (!next) return;
  // The new PATH goes through the environment, never into the command text.
  const r = ps("[Environment]::SetEnvironmentVariable('Path', $env:DCS_PATH, 'User')", { DCS_PATH: next });
  if (r.status === 0) done.push(`cswap: added ${dl.dir} to your user PATH (new terminals see it)`);
  else failures.push(`cswap: couldn't add ${dl.dir} to PATH; add it by hand`);
}

// Copies every clean target that exists; any failure aborts the clean slate before something is deleted.
function backup(dir) {
  for (const t of [...CLEAN_TARGETS, 'settings.json']) {
    const src = join(CONFIG, t);
    if (existsSync(src)) cpSync(src, join(dir, t), { recursive: true, verbatimSymlinks: true });
  }
}

function clearTargets() {
  for (const t of CLEAN_TARGETS) {
    const p = join(CONFIG, t);
    if (!existsSync(p)) continue;
    // Managed elsewhere (e.g. home-manager): deleting through the link would hit the source.
    if (lstatSync(p).isSymbolicLink()) {
      done.push(`kept ${p}: symlink, remove it where it's managed`);
      continue;
    }
    rmSync(p, { recursive: true });
    done.push(`deleted ${p}`);
  }
}

// --- brv, tui-review's binary --------------------------------------------------------------------------------------
const TUI_REVIEW = `tui-review@${MARKETPLACE}`;
const BRV_DIR = join(CONFIG, 'bin');

// The version a brv binary reports, or undefined when there is none or it does not run.
function brvVersionAt(path) {
  if (!existsSync(path)) return undefined;
  const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
  return /^brv (\S+)/.exec(r.stdout ?? '')?.[1];
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (res.status === 404) throw new Error(`no release at ${url} yet`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// Downloads the release archive, checks it against its .sha256, and puts the binary at `bin` in one rename.
async function downloadBrv(asset, bin) {
  const [archive, sum] = await Promise.all([
    fetchOk(asset.url).then((r) => r.arrayBuffer()),
    fetchOk(asset.sha256).then((r) => r.text()),
  ]);
  const bytes = Buffer.from(archive);
  if (sha256Of(sum) !== createHash('sha256').update(bytes).digest('hex')) throw new Error(`${asset.file}: checksum mismatch`);
  const tmp = mkdtempSync(join(tmpdir(), 'brv-'));
  try {
    const file = join(tmp, asset.file);
    writeFileSync(file, bytes);
    // GNU tar on Linux, bsdtar on macOS and Windows 10+, which reads the zip too.
    const r = spawnSync('tar', ['-xf', file, '-C', tmp], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`could not unpack ${asset.file}: ${(r.stderr || r.error?.message || '').trim()}`);
    mkdirSync(BRV_DIR, { recursive: true });
    const staged = `${bin}.tmp-${process.pid}`;
    cpSync(join(tmp, asset.exe), staged);
    chmodSync(staged, 0o755);
    renameSync(staged, bin);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// tui-review needs brv: a brv on PATH is used as is; otherwise the release for this version goes to ~/.claude/bin
// and the plugin's brvPath points at it.
async function applyBrv() {
  const version = readJson(join(PKG, 'plugins', 'tui-review', '.claude-plugin', 'plugin.json')).version;
  const asset = brvAsset(process.platform, process.arch, version);
  const bin = join(BRV_DIR, asset?.exe ?? (WIN ? 'brv.exe' : 'brv'));
  const action = brvAction({ onPath: onPath('brv'), installed: brvVersionAt(bin), version, supported: asset !== undefined });
  const build = 'build it with `cargo build --release` in plugins/tui-review/brv and set its path with /plugin configure tui-review';
  if (action === 'skip') return done.push('brv: using the one on PATH');
  if (action === 'unsupported') return failures.push(`brv: no release build for ${process.platform}-${process.arch}; ${build}`);
  if (action === 'download') {
    console.log(`downloading brv ${version}…`);
    try {
      await downloadBrv(asset, bin);
    } catch (e) {
      return failures.push(`brv ${version}: ${e.message}; ${build}`);
    }
    done.push(`installed brv ${version} to ${bin}`);
  }
  const r = claudeWith(JSON.stringify({ brvPath: bin }), 'plugin', 'configure', TUI_REVIEW, '--values-stdin');
  if (r.ok) done.push(`tui-review: brvPath is ${bin}`);
  else failures.push(`tui-review: could not set brvPath (${r.err}); set it to ${bin} with /plugin configure tui-review`);
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
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  writeAtomic(SETTINGS, JSON.stringify(after, null, 2).replaceAll('\n', eol) + eol);
  done.push(`settings.json: pinned the ${MARKETPLACE} marketplace to v${VERSION}`);
  return raw;
}

const marketplaces = JSON.parse(claude('plugin', 'marketplace', 'list', '--json').out || '[]');
const unpinned = pinSettingsEntry();
// Adding again also moves an existing checkout to this installer's tag.
const market = claude('plugin', 'marketplace', 'add', marketplaceArg(VERSION));
if (!market.ok) {
  // A pinned entry the checkout doesn't match hides the marketplace from Claude Code.
  if (unpinned !== undefined) writeAtomic(SETTINGS, unpinned);
  console.error(`Adding the marketplace at v${VERSION} failed (does the release exist?):\n${market.err}`);
  process.exit(1);
}
// The bundle's core plugins and some opt-ins install from Anthropic's marketplace.
if (!marketplaces.some((m) => m.name === OFFICIAL)) step(`added marketplace ${OFFICIAL}`, 'plugin', 'marketplace', 'add', `anthropics/${OFFICIAL}`);

const manifest = readJson(join(PKG, '.claude-plugin', 'marketplace.json'));
const bundle = readJson(join(PKG, 'plugins', BUNDLE, '.claude-plugin', 'plugin.json'));
const opts = optIns(manifest, bundle);
const tokenPlugins = opts.filter((id) => needsToken(tryJson(join(PKG, 'plugins', nameOf(id), '.claude-plugin', 'plugin.json')) ?? {}));
const BUNDLE_ID = `${BUNDLE}@${MARKETPLACE}`;
const managed = [...bundleIds(bundle), ...opts];

const listed = JSON.parse(claude('plugin', 'list', '--json').out || '[]');
const installedIds = (Array.isArray(listed) ? listed : listed.installed ?? []).map((p) => p.id);
// By name, so a plugin that moved marketplaces stays selected; its old copy is removed as a duplicate.
const has = (id) => installedIds.some((i) => nameOf(i) === nameOf(id));
const settingsNow = tryJson(SETTINGS) ?? {};

console.log('\ndead-claude-skills installer\n');
const rows = await checklist([
  { key: BUNDLE_ID, label: BUNDLE, checked: true, fixed: true, note: `always; brings ${bundle.dependencies.map(nameOf).join(', ')}` },
  ...opts.map((id) => ({
    key: id, label: nameOf(id), checked: has(id),
    note: tokenPlugins.includes(id) ? 'token entered in Claude Code' : id.endsWith(`@${OFFICIAL}`) ? `from ${OFFICIAL}` : '',
  })),
  { key: 'ccstatusline', label: 'ccstatusline', checked: isOurStatusLine(settingsNow.statusLine), note: 'status line + its config' },
  WIN
    ? { key: 'sandbox', label: 'sandbox', checked: false, fixed: true, note: 'needs WSL2' }
    : { key: 'sandbox', label: 'sandbox', checked: isSandboxOn(settingsNow), note: 'Bash sandbox, no unsandboxed fallback' },
  { key: 'dcg', label: 'dcg', checked: hasDcgHook(settingsNow), note: 'destructive command guard, runs its own installer' },
  { key: 'strip-defaults', label: 'strip-defaults', checked: FLAGS.includes('--strip-defaults') || isStripped(settingsNow),
    note: `remove other marketplaces + plugins (keeps the ${OFFICIAL} ones used here), claude.ai connectors, synced skills/plugins, builtins` },
  { key: 'clean', label: 'clean', checked: FLAGS.includes('--clean'),
    note: `clean slate: back up, then reset settings.json and delete ${CLEAN_TARGETS.join(', ')}` },
]);
const TOGGLES = ['ccstatusline', 'sandbox', 'dcg', 'strip-defaults', 'clean'];
const on = (k) => rows.find((r) => r.key === k).checked;

let clean = on('clean');
let backupDir;
if (clean) {
  console.log(`\n\x1b[31mClean slate: ${SETTINGS} is replaced with only this installer's settings, and these are deleted:`);
  CLEAN_TARGETS.map((t) => join(CONFIG, t)).filter(existsSync).forEach((p) => console.log(`  ${p}`));
  console.log(`Every plugin and marketplace not from dead-claude-skills is removed too, except the ${OFFICIAL} plugins used here.\x1b[0m`);
  backupDir = `${CONFIG}.dead-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  console.log(`A backup goes to ${backupDir} first.`);
  clean = await typed('\nReally wipe your Claude Code config?', 'clean');
  if (!clean) done.push('clean slate: skipped by you');
  else {
    try { backup(backupDir); } catch (e) {
      console.error(`Backup failed, nothing was deleted: ${e.message}`);
      process.exit(1);
    }
    done.push(`backed up your config to ${backupDir}`);
  }
}
const strip = clean || on('strip-defaults');

const dupes = duplicates(installedIds, managed);
const foreign = strip ? [...new Set([...foreignPlugins(installedIds, managed), ...dupes])] : [];
if (foreign.length) {
  console.log(`\nRemoving plugins this setup doesn't use:\n  ${foreign.join('\n  ')}`);
  for (const id of foreign) step(`uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');
} else if (dupes.length) {
  console.log(`\nSame plugins installed from another marketplace (they'd load twice):\n  ${dupes.join('\n  ')}`);
  if (await ask('Uninstall them?', true)) for (const id of dupes) step(`uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');
}
// After their plugins are gone, so nothing is left pointing at a removed marketplace.
const foreignMarkets = strip ? foreignMarketplaces(marketplaces.map((m) => m.name)) : [];
for (const name of foreignMarkets) step(`removed marketplace ${name}`, 'plugin', 'marketplace', 'remove', name);

const selected = rows.filter((r) => r.checked && !TOGGLES.includes(r.key)).map((r) => r.key);
const plan = planPlugins(selected, installedIds.filter((id) => [BUNDLE_ID, ...opts].includes(id)), tokenPlugins);
// Opt-ins that were once bundle dependencies are still marked auto and would be pruned; installing clears that.
const installedJson = tryJson(join(CONFIG, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
plan.install.push(...selected.filter((id) => opts.includes(id) && installedJson[id]?.some((e) => e.auto)));
console.log('');
for (const id of plan.install) {
  console.log(`installing ${nameOf(id)}…`);
  step(`installed ${id}`, 'plugin', 'install', id, '--scope', 'user', '--json');
}
for (const id of plan.uninstall) {
  console.log(`uninstalling ${id}…`);
  step(`uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');
}
if (plan.uninstall.length || dupes.length || foreign.length) step('pruned unused dependencies', 'plugin', 'prune', '-y');
if (selected.includes(TUI_REVIEW)) await applyBrv();

const toggles = { statusLine: on('ccstatusline'), sandbox: on('sandbox'), dcg: on('dcg'), version: VERSION };
await applySettings(toggles, { strip, reset: clean });
const autoUpdate = tryJson(join(CONFIG, 'plugins', 'known_marketplaces.json'))?.[MARKETPLACE]?.autoUpdate;
await applyCcstatusline(on('ccstatusline'));
await applyDcg(hasDcgHook(settingsNow), on('dcg'));
await applyCswap(selected.some((id) => nameOf(id) === 'cswap'));
if (clean) clearTargets();
// The global instructions moved into a dead-skills SessionStart hook; the old file would duplicate them.
remove(RULES, RULES);

const wanted = [...selected.map(nameOf), ...TOGGLES.filter(on)];
const missing = missingBinaries(process.platform, wanted, onPath);

console.log('\n── Summary ──');
done.forEach((d) => console.log(`✓ ${d}`));
if (!done.length) console.log('✓ nothing to change');
console.log(`  marketplace autoUpdate (known_marketplaces.json): ${autoUpdate ?? 'not set'}`);
if (clean) console.log(`  restore the backup: cp -a ${backupDir}/. ${CONFIG}/`);
for (const id of plan.handoff) {
  console.log(`\n→ ${nameOf(id)}: run this in Claude Code, it asks for the token:\n  /plugin install ${id}`);
  (HANDOFF[nameOf(id)] ?? []).forEach((l) => console.log(`  ${l}`));
}
if (missing.length) {
  console.log('\nMissing on PATH (nothing was installed, copy what you need):');
  missing.forEach((m) => console.log(`  ${m.binary.padEnd(28)} ${m.command}`));
}
failures.forEach((f) => console.log(`\x1b[31m✗ ${f}\x1b[0m`));
console.log('\nRestart Claude Code (or run /reload-plugins) to load the changes.');
process.exit(failures.length ? 1 : 0);
