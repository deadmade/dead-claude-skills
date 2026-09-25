#!/usr/bin/env node
// Interactive installer for the dead-claude-skills marketplace. Decisions live in core.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import {
  BUNDLE, MARKETPLACE, dcgCommand, duplicates, hasDcgHook, isOurStatusLine, isSandboxOn, mergeSettings,
  missingBinaries, needsToken, optIns, planPlugins, safeArg,
} from './core.mjs';

const PKG = join(import.meta.dirname, '..');
const CONFIG = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const SETTINGS = join(CONFIG, 'settings.json');
const RULES = join(CONFIG, 'rules', 'dead-claude-skills.md');
const CCSL = join(homedir(), '.config', 'ccstatusline', 'settings.json');
const WIN = process.platform === 'win32';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const tryJson = (p) => { try { return readJson(p); } catch { return undefined; } };
const failures = [];
const done = [];

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this in a terminal: npx github:deadmade/dead-claude-skills');
  process.exit(1);
}

// --- claude CLI -------------------------------------------------------------------------------------------------
function claude(...args) {
  args.forEach(safeArg);
  // Windows: one string through the shell so both claude.cmd and claude.exe resolve; args are safeArg-checked.
  const r = WIN
    ? spawnSync(['claude', ...args].join(' '), { shell: true, encoding: 'utf8' })
    : spawnSync('claude', args, { encoding: 'utf8' });
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

async function applySettings(toggles) {
  const snippet = () => console.log(JSON.stringify(mergeSettings({}, toggles), null, 2));
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
  const after = mergeSettings(before, toggles);
  const changed = ['permissions', 'extraKnownMarketplaces', 'statusLine', 'sandbox']
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

const marketplaces = JSON.parse(claude('plugin', 'marketplace', 'list', '--json').out || '[]');
const hasMarket = marketplaces.some((m) => m.name === MARKETPLACE);
const market = hasMarket
  ? claude('plugin', 'marketplace', 'update', MARKETPLACE)
  : claude('plugin', 'marketplace', 'add', 'deadmade/dead-claude-skills');
if (!market.ok) {
  console.error(`Marketplace ${hasMarket ? 'update' : 'add'} failed:\n${market.err}`);
  process.exit(1);
}

const manifest = readJson(join(PKG, '.claude-plugin', 'marketplace.json'));
const bundle = readJson(join(PKG, 'plugins', BUNDLE, '.claude-plugin', 'plugin.json'));
const opts = optIns(manifest, bundle);
const tokenPlugins = opts.filter((n) => needsToken(tryJson(join(PKG, 'plugins', n, '.claude-plugin', 'plugin.json')) ?? {}));

const listed = JSON.parse(claude('plugin', 'list', '--json').out || '[]');
const installedIds = (Array.isArray(listed) ? listed : listed.installed ?? []).map((p) => p.id);
const ours = installedIds.filter((id) => id.endsWith(`@${MARKETPLACE}`));
const has = (n) => ours.includes(`${n}@${MARKETPLACE}`);
const settingsNow = tryJson(SETTINGS) ?? {};

console.log('\ndead-claude-skills installer\n');
const rows = await checklist([
  { key: BUNDLE, label: BUNDLE, checked: true, fixed: true, note: `always; brings ${bundle.dependencies.join(', ')}` },
  ...opts.map((n) => ({ key: n, label: n, checked: has(n), note: tokenPlugins.includes(n) ? 'token entered in Claude Code' : '' })),
  { key: 'ccstatusline', label: 'ccstatusline', checked: isOurStatusLine(settingsNow.statusLine), note: 'status line + its config' },
  WIN
    ? { key: 'sandbox', label: 'sandbox', checked: false, fixed: true, note: 'needs WSL2' }
    : { key: 'sandbox', label: 'sandbox', checked: isSandboxOn(settingsNow), note: 'Bash sandbox, no unsandboxed fallback' },
  { key: 'dcg', label: 'dcg', checked: hasDcgHook(settingsNow), note: 'destructive command guard, runs its own installer' },
]);
const TOGGLES = ['ccstatusline', 'sandbox', 'dcg'];
const on = (k) => rows.find((r) => r.key === k).checked;

const dupes = duplicates(installedIds, manifest.plugins.map((p) => p.name));
if (dupes.length) {
  console.log(`\nSame plugins installed from another marketplace (they'd load twice):\n  ${dupes.join('\n  ')}`);
  if (await ask('Uninstall them?', true)) for (const id of dupes) step(`uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');
}

const selected = rows.filter((r) => r.checked && !TOGGLES.includes(r.key)).map((r) => r.key);
const plan = planPlugins(selected, ours.filter((id) => [BUNDLE, ...opts].includes(id.split('@')[0])), tokenPlugins);
// Opt-ins that were once bundle dependencies are still marked auto and would be pruned; installing clears that.
const installedJson = tryJson(join(CONFIG, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
plan.install.push(...selected.filter((n) => opts.includes(n) && installedJson[`${n}@${MARKETPLACE}`]?.some((e) => e.auto)));
console.log('');
for (const n of plan.install) {
  console.log(`installing ${n}…`);
  step(`installed ${n}`, 'plugin', 'install', `${n}@${MARKETPLACE}`, '--scope', 'user', '--json');
}
for (const id of plan.uninstall) {
  console.log(`uninstalling ${id}…`);
  step(`uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');
}
if (plan.uninstall.length || dupes.length) step('pruned unused dependencies', 'plugin', 'prune', '-y');

await applySettings({ statusLine: on('ccstatusline'), sandbox: on('sandbox') });
const autoUpdate = tryJson(join(CONFIG, 'plugins', 'known_marketplaces.json'))?.[MARKETPLACE]?.autoUpdate;
await applyCcstatusline(on('ccstatusline'));
await applyDcg(hasDcgHook(settingsNow), on('dcg'));
// The global instructions moved into a dead-skills SessionStart hook; the old file would duplicate them.
remove(RULES, RULES);

const wanted = [...selected, ...TOGGLES.filter(on)];
const missing = missingBinaries(process.platform, wanted, onPath);

console.log('\n── Summary ──');
done.forEach((d) => console.log(`✓ ${d}`));
if (!done.length) console.log('✓ nothing to change');
console.log(`  marketplace autoUpdate (known_marketplaces.json): ${autoUpdate ?? 'not set'}`);
for (const n of plan.handoff) {
  console.log(`\n→ ${n}: run this in Claude Code, it asks for the token:\n  /plugin install ${n}@${MARKETPLACE}`);
  (HANDOFF[n] ?? []).forEach((l) => console.log(`  ${l}`));
}
if (missing.length) {
  console.log('\nMissing on PATH (nothing was installed, copy what you need):');
  missing.forEach((m) => console.log(`  ${m.binary.padEnd(28)} ${m.command}`));
}
failures.forEach((f) => console.log(`\x1b[31m✗ ${f}\x1b[0m`));
console.log('\nRestart Claude Code (or run /reload-plugins) to load the changes.');
process.exit(failures.length ? 1 : 0);
