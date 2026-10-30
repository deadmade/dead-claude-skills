// Which plugins exist, which are ours, and what installing a selection means.
import { join } from 'node:path';
import { MARKETPLACE, newer } from './release.ts';

// .claude-plugin/marketplace.json and a plugin's .claude-plugin/plugin.json, as far as the installer reads them.
export interface MarketplacePlugin {
  name: string;
  description: string;
  source: string | { ref?: string; [key: string]: unknown };
}
export interface Marketplace {
  plugins: MarketplacePlugin[];
}
// What the pure decisions read of a marketplace entry.
export type PluginEntry = Pick<MarketplacePlugin, 'name' | 'source'>;
export interface PluginJson {
  version?: string;
  dependencies?: string[];
  userConfig?: Record<string, { sensitive?: boolean }>;
}
// A row of `claude plugin list --json`.
export interface PluginRow {
  id: string;
  version?: string;
  enabled?: boolean;
}

export const BUNDLE = 'dead-skills';
// Anthropic's own plugins come straight from their marketplace: ours may not reuse their names.
export const OFFICIAL = 'claude-plugins-official';
const OFFICIAL_OPT_INS = [
  'skill-creator',
  'hookify',
  'rust-analyzer-lsp',
  'csharp-lsp',
  'typescript-lsp',
  'pyright-lsp',
];

export const nameOf = (id: string) => id.split('@')[0];

// Repo-relative manifest path of a marketplace plugin with a local (string) source; null for url sources and unknown names.
export function manifestPath(manifest: { plugins: PluginEntry[] }, id: string) {
  const source = manifest.plugins.find((p) => p.name === nameOf(id))?.source;
  return typeof source === 'string' ? `${source.replace(/^\.\//, '')}/.claude-plugin/plugin.json` : null;
}

export const marketOf = (id: string) => id.split('@')[1];
// Bare dependency names resolve against our marketplace, like Claude Code does.
export const idOf = (dep: string) => (dep.includes('@') ? dep : `${dep}@${MARKETPLACE}`);

export const bundleIds = (bundle: { dependencies: string[] }) => [idOf(BUNDLE), ...bundle.dependencies.map(idOf)];

export const optIns = (marketplace: { plugins: PluginEntry[] }, bundle: { dependencies: string[] }) => [
  ...marketplace.plugins.map((p) => idOf(p.name)).filter((id) => !bundleIds(bundle).includes(id)),
  ...OFFICIAL_OPT_INS.map((n) => `${n}@${OFFICIAL}`),
];

export const needsToken = (pluginJson: PluginJson) =>
  Object.values(pluginJson.userConfig ?? {}).some((c) => c.sensitive === true);

// All plugin ids. installedIds: installed bundle and opt-ins only.
export function planPlugins(selected: string[], installedIds: string[], tokenPlugins: string[]) {
  const missing = selected.filter((id) => !installedIds.includes(id));
  return {
    install: missing.filter((id) => !tokenPlugins.includes(id)),
    handoff: missing.filter((id) => tokenPlugins.includes(id)),
    uninstall: installedIds.filter((id) => !selected.includes(id)),
  };
}

// selected plus the opt-ins among their dependencies, transitively. depsOf(id): a plugin's dependency ids, if any.
export function withDependencies(selected: string[], depsOf: (id: string) => string[] | undefined, opts: string[]) {
  const out = [...selected];
  for (let i = 0; i < out.length; i++)
    for (const d of depsOf(out[i]) ?? []) if (opts.includes(d) && !out.includes(d)) out.push(d);
  return out;
}

// A plugin we manage, installed from a marketplace we don't take it from (it'd load twice).
export const duplicates = (installedIds: string[], managedIds: string[]) =>
  installedIds.filter((id) => !managedIds.includes(id) && managedIds.some((m) => nameOf(m) === nameOf(id)));

// Everything not from our marketplace, except the official plugins we use.
export const foreignPlugins = (installedIds: string[], managedIds: string[]) =>
  installedIds.filter((id) => marketOf(id) !== MARKETPLACE && !managedIds.includes(id));

// Ours but gone from the marketplace (dev-feature): nothing can update them, so every run removes them.
export const retiredPlugins = (installedIds: string[], managedIds: string[]) =>
  installedIds.filter((id) => marketOf(id) === MARKETPLACE && !managedIds.includes(id));

// The packs flows carries (pack names) that are still installed as plugins of ours, once per id. rows: `claude plugin
// list --json`.
export const stillInstalled = (rows: PluginRow[], packs: string[]) => [
  ...new Set(rows.map((r) => r.id).filter((id) => marketOf(id) === MARKETPLACE && packs.includes(nameOf(id)))),
];

// Where Claude Code installed plugin `id`, from its installed_plugins.json; undefined when it isn't installed.
// The user-scope install wins, else the first.
export function pluginInstallPath(installed: any, id: string): string | undefined {
  const entries: any[] = installed?.plugins?.[id] ?? [];
  return (entries.find((e) => e?.scope === 'user') ?? entries[0])?.installPath;
}

// The uv arguments and environment that build headroom-trim's server (root: the plugin's install path, data: its data
// folder): `sync` and the tiktoken vocabulary fetch (no headroom import, so no telemetry). env is added to the process's.
export function trimServerCommands(root: string, data: string) {
  const server = join(root, 'server');
  return {
    sync: ['sync', '--locked', '--project', server],
    tiktoken: [
      'run',
      '--locked',
      '--project',
      server,
      'python',
      '-c',
      "import tiktoken; tiktoken.get_encoding('o200k_base')",
    ],
    env: { UV_PROJECT_ENVIRONMENT: join(data, 'venv'), TIKTOKEN_CACHE_DIR: join(data, 'tiktoken') },
  };
}

// The folder Claude Code keeps for a plugin's data (CLAUDE_PLUGIN_DATA): the id with @ replaced by -.
export const pluginDataDir = (config: string, id: string) => join(config, 'plugins', 'data', id.replace('@', '-'));

// The port of a plugin's PostToolUse http hook (hooks/hooks.json), or undefined when there is none.
export function hookPort(hooksJson: any): number | undefined {
  const hooks: any[] = (hooksJson?.hooks?.PostToolUse ?? []).flatMap((g: any) => g?.hooks ?? []);
  const url = hooks.find((h) => h?.type === 'http')?.url;
  const port = /^http:\/\/127\.0\.0\.1:(\d+)\//.exec(url ?? '')?.[1];
  return port ? Number(port) : undefined;
}

export const foreignMarketplaces = (names: string[]) => names.filter((n) => n !== MARKETPLACE && n !== OFFICIAL);

// { name: version } this release ships: a local plugin's plugin.json version (via localVersion(source)), or a url
// plugin's pinned vX.Y.Z ref. Plugins without either (unpinned url sources) are left out.
export function shippedVersions(plugins: PluginEntry[], localVersion: (source: string) => string | undefined) {
  return Object.fromEntries(
    plugins.flatMap(({ name, source }) => {
      const v = typeof source === 'string' ? localVersion(source) : /^v(\d+\.\d+\.\d+)$/.exec(source?.ref ?? '')?.[1];
      return v ? [[name, v]] : [];
    }),
  );
}

// Our installed plugins whose version differs from the one this release ships, once per id. rows: `claude plugin
// list --json`; shipped: shippedVersions(). A newer install isn't downgraded.
export function outdated(rows: PluginRow[], shipped: Record<string, string>) {
  const seen = new Set<string>();
  return rows.flatMap(({ id, version }) => {
    const to = shipped[nameOf(id)];
    if (marketOf(id) !== MARKETPLACE || !to || seen.has(id)) return [];
    seen.add(id);
    return version === to || newer(version, to) ? [] : [{ id, from: version, to }];
  });
}
