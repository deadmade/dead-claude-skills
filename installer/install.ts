#!/usr/bin/env node
// Interactive installer for the dead-claude-skills marketplace: the flow. Decisions live in core/, the OS in system/,
// each thing it applies in steps/.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { missingBinaries } from './core/binaries.ts';
import { HINTS, TOGGLES, categorize, unavailable } from './core/options.ts';
import {
  type Marketplace,
  type PluginJson,
  type PluginRow,
  BUNDLE,
  OFFICIAL,
  bundleIds,
  duplicates,
  foreignMarketplaces,
  foreignPlugins,
  idOf,
  manifestPath,
  nameOf,
  needsToken,
  optIns,
  outdated,
  planPlugins,
  retiredPlugins,
  shippedVersions,
  withDependencies,
} from './core/plugins.ts';
import { LATEST_INSTALLER, MARKETPLACE, installerUrl, newerInstaller, npxArgs } from './core/release.ts';
import {
  hasDcgHook,
  isOurStatusLine,
  isStripped,
  isWebBuiltinsOff,
  restoreHint,
  webBuiltinsDecision,
} from './core/settings.ts';
import {
  CONFIG,
  FLAGS,
  PKG,
  SETTINGS,
  VERSION,
  done,
  failures,
  green,
  readJson,
  red,
  remove,
  tryJson,
} from './context.ts';
import { configureAgentBrowser, installAgentBrowser } from './steps/agent-browser.ts';
import { TUI_REVIEW, WEB_MCP, applyBin } from './steps/binaries.ts';
import { applyCcstatusline } from './steps/ccstatusline.ts';
import { confirmClean } from './steps/clean.ts';
import { applyDcg } from './steps/dcg.ts';
import { addMarketplaces, applyPlugins, listed, removeForeign } from './steps/plugins.ts';
import { applySettings } from './steps/settings.ts';
import { clearTargets } from './system/files.ts';
import { trustSystemCerts } from './system/net.ts';
import { claude, onPath, startSync, which } from './system/proc.ts';
import { confirm, log, note, progress, screen } from './ui/ui.ts';
import { type Data, changeList, initial, move, paint, render } from './ui/view.ts';

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(`Run this in a terminal: npx ${npxArgs(LATEST_INSTALLER).slice(1).join(' ')}`);
  process.exit(1);
}

const certs = trustSystemCerts();
if (certs) log('warn', certs);

// npx caches by URL, so the README's latest/ link runs whichever installer it fetched first. Offline: run this one.
const latest = await fetch(LATEST_INSTALLER, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) })
  .then((res) => res.headers.get('location'))
  .catch(() => undefined);
const next = newerInstaller(latest, VERSION);
const npx = next && which('npx');
if (npx) {
  console.log(`Installer v${next} is out, running it instead of v${VERSION}.`);
  // The system certificates for npm's download too (behind HTTPS inspection it fails without them).
  const env = { ...process.env, NODE_USE_SYSTEM_CA: '1' };
  process.exit(startSync(npx, [...npxArgs(installerUrl(next)), ...FLAGS], { stdio: 'inherit', env }).status ?? 1);
}

const RULES = join(CONFIG, 'rules', 'dead-claude-skills.md');
const HANDOFF: Record<string, string[]> = {
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

log('info', `${paint(['bold', 'magenta'], 'dead-claude-skills')} v${VERSION}`);

const marketplaces: { name: string }[] = listed(
  'marketplaces',
  await claude(undefined, 'plugin', 'marketplace', 'list', '--json'),
);
await addMarketplaces(marketplaces);
const plugins: PluginRow[] | { installed?: PluginRow[] } = listed(
  'installed plugins',
  await progress('Reading installed plugins', () => claude(undefined, 'plugin', 'list', '--json')),
);
const rows = Array.isArray(plugins) ? plugins : (plugins.installed ?? []);

const manifest: Marketplace = readJson(join(PKG, '.claude-plugin', 'marketplace.json'));
const bundle: PluginJson & { dependencies: string[] } = readJson(join(PKG, manifestPath(manifest, BUNDLE)!));
const opts = optIns(manifest, bundle);
const tokenPlugins = opts.filter((id) => {
  const path = manifestPath(manifest, id);
  return needsToken((path && tryJson(join(PKG, path))) || {});
});
const BUNDLE_ID = `${BUNDLE}@${MARKETPLACE}`;
const FLOWS = `flows@${MARKETPLACE}`;
// Each opt-in's dependencies that are opt-ins too; bundle plugins are installed anyway.
const depsOf = (id: string): string[] => {
  const path = manifestPath(manifest, id);
  return ((path && tryJson<PluginJson>(join(PKG, path))?.dependencies) || []).map(idOf).filter((d) => opts.includes(d));
};
const deps = Object.fromEntries(opts.map((id) => [id, depsOf(id)] as const).filter(([, d]) => d.length));
const managed = [...bundleIds(bundle), ...opts];

const installedIds = rows.map((pl) => pl.id);
// By name, so a plugin that moved marketplaces stays selected; its old copy is removed as a duplicate.
const has = (id: string) => installedIds.some((i) => nameOf(i) === nameOf(id));
const settingsNow = tryJson(SETTINGS) ?? {};

// What each option is right now, and what the pages start from.
const current: Record<string, boolean> = {
  ...Object.fromEntries(opts.map((id) => [id, has(id)])),
  ccstatusline: isOurStatusLine(settingsNow.statusLine),
  dcg: hasDcgHook(settingsNow),
  'strip-defaults': isStripped(settingsNow),
  clean: false,
  'web-builtins-off': isWebBuiltinsOff(settingsNow),
};
const chosen: Record<string, boolean> = {
  ...current,
  'strip-defaults': FLAGS.includes('--strip-defaults') || current['strip-defaults'],
  clean: FLAGS.includes('--clean'),
  // flows replaced feature-flow and carries self-review and the packs: a machine that had feature-flow or self-review
  // keeps them.
  [FLOWS]: current[FLOWS] || has(`feature-flow@${MARKETPLACE}`) || has(`self-review@${MARKETPLACE}`),
  // On by default where offered, until web-mcp is installed; then it keeps the user's choice. It does nothing unless
  // web-mcp is selected and its browser window can open.
  'web-builtins-off': has(WEB_MCP)
    ? current['web-builtins-off']
    : unavailable('web-builtins-off', process.platform, process.arch, VERSION) === undefined,
};

// Options that can't work here stay off the pages, unless they're on already: hiding never removes anything.
const hidden = [...opts, ...TOGGLES]
  .map((key) => ({ key, why: unavailable(key, process.platform, process.arch, VERSION) }))
  .filter((h) => h.why && !current[h.key]);
const pages = categorize([...opts, ...TOGGLES].filter((k) => !hidden.some((h) => h.key === k)));

const describe = Object.fromEntries(manifest.plugins.map((pl) => [pl.name, pl.description.split(/(?<=\.)\s/)[0]]));
function option(key: string) {
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
const retired = retiredPlugins(installedIds, managed);
const rowOf = (key: string) => rows.find((r) => nameOf(r.id) === nameOf(key));
const data: Data = {
  version: VERSION,
  platform: `${process.platform}-${process.arch}`,
  pages,
  current,
  versions: Object.fromEntries(
    opts.flatMap((k) => {
      const v = rowOf(k)?.version;
      return v ? [[k, v]] : [];
    }),
  ),
  disabled: Object.fromEntries(opts.flatMap((k) => (rowOf(k)?.enabled === false ? [[k, true]] : []))),
  tokens: tokenPlugins,
  deps,
  describe: option,
  updates: outdated(rows, shipped),
  core: `${BUNDLE} + ${bundle.dependencies.length}, always installed`,
  hidden,
  retired,
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
const on = (k: string) => chosen[k];

const backupDir = on('clean') ? await confirmClean() : undefined;
const clean = backupDir !== undefined;
const strip = clean || on('strip-defaults');

const removed = await removeForeign({ strip, installedIds, managed, marketplaces });

const selected = withDependencies([BUNDLE_ID, ...opts.filter(on)], (id) => deps[id], opts);
const plan = planPlugins(
  selected,
  installedIds.filter((id) => [BUNDLE_ID, ...opts].includes(id)),
  tokenPlugins,
);
// Opt-ins that were once bundle dependencies are still marked auto and would be pruned; installing clears that.
const installedJson: Record<string, { auto?: boolean }[]> =
  tryJson(join(CONFIG, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
plan.install.push(...selected.filter((id) => opts.includes(id) && installedJson[id]?.some((e) => e.auto)));
// The packs flows carries, one folder each beside its .claude-plugin/: none may stay installed as a plugin.
const packs = readdirSync(join(PKG, manifestPath(manifest, FLOWS)!, '..', '..', 'packs'));
await applyPlugins({
  install: plan.install,
  remove: plan.uninstall,
  retired,
  updates: changeList(state, data).update,
  removedBefore: removed.dupes.length > 0 || removed.foreign.length > 0,
  packs,
});
if (selected.includes(TUI_REVIEW)) await applyBin('tui-review', TUI_REVIEW);
if (selected.includes(WEB_MCP)) await applyBin('web-mcp', WEB_MCP);

// The built-in web tools are denied only once web-mcp's browser window can open.
const browser = selected.includes(WEB_MCP) ? await installAgentBrowser() : { works: false };
const webBuiltinsOff = webBuiltinsDecision({
  toggle: selected.includes(WEB_MCP) && on('web-builtins-off'),
  was: current['web-builtins-off'],
  installed: has(WEB_MCP),
  healthy: browser.works,
});

const toggles = {
  statusLine: on('ccstatusline'),
  dcg: on('dcg'),
  webBuiltinsOff,
};
await applySettings(toggles, { strip, reset: clean });
const autoUpdate = tryJson(join(CONFIG, 'plugins', 'known_marketplaces.json'))?.[MARKETPLACE]?.autoUpdate;
await applyCcstatusline(current.ccstatusline, on('ccstatusline'));
await applyDcg(current.dcg, on('dcg'));
if (browser.path) await configureAgentBrowser(browser.path);
if (clean) done.push(...clearTargets(CONFIG));
// The global instructions moved into a dead-skills SessionStart hook; the old file would duplicate them.
remove(RULES, RULES);

const wanted = [...selected.map(nameOf), ...TOGGLES.filter(on)];
const missing = missingBinaries(process.platform, wanted, onPath);

note('Summary', [
  ...(done.length ? done.map((d) => green(`✓ ${d}`)) : [green('✓ nothing to change')]),
  ...failures.map((f) => red(`✗ ${f}`)),
  `marketplace autoUpdate (known_marketplaces.json): ${autoUpdate ?? 'not set'}`,
  ...(clean ? [`restore the backup: ${restoreHint(process.platform, backupDir!, CONFIG)}`] : []),
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
