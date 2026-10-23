// Marketplaces and plugins, all through the claude CLI.
import {
  OFFICIAL,
  duplicates,
  foreignMarketplaces,
  foreignPlugins,
  nameOf,
  stillInstalled,
  type PluginRow,
} from '../core/plugins.ts';
import { MARKETPLACE, marketplaceArg } from '../core/release.ts';
import { SETTINGS, VERSION, ask, failures } from '../context.ts';
import { writeAtomic } from '../system/files.ts';
import { claude, run } from '../system/proc.ts';
import { log, progress } from '../ui/ui.ts';
import { pinSettingsEntry } from './settings.ts';

// A failed list would read as "nothing installed": stop instead of planning from it.
export function listed(what: string, r: { ok: boolean; out?: string; err?: string }) {
  try {
    if (r.ok) return JSON.parse(r.out || '[]');
  } catch {
    /* falls through to the error */
  }
  log('error', `Can't read the ${what} (claude plugin … list --json): ${r.err || r.out}`);
  process.exit(1);
}

// Ours at this installer's tag, and Anthropic's when it's missing. Exits when ours can't be added.
export async function addMarketplaces(marketplaces: { name: string }[]) {
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
}

const uninstall = (id: string) => run(`Uninstalling ${id}`, `uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');

// Plugins and marketplaces this setup doesn't use: all of them with strip, otherwise only duplicates, after a yes.
// Returns what was meant to go, so the caller knows to prune.
export async function removeForeign({
  strip,
  installedIds,
  managed,
  marketplaces,
}: {
  strip: boolean;
  installedIds: string[];
  managed: string[];
  marketplaces: { name: string }[];
}) {
  const dupes = duplicates(installedIds, managed);
  const foreign = strip ? [...new Set([...foreignPlugins(installedIds, managed), ...dupes])] : [];
  if (foreign.length) {
    log('info', `Removing plugins this setup doesn't use:\n${foreign.join('\n')}`);
    for (const id of foreign) await uninstall(id);
  } else if (dupes.length) {
    log('warn', `Same plugins installed from another marketplace (they'd load twice):\n${dupes.join('\n')}`);
    if (await ask('Uninstall them?', true)) {
      for (const id of dupes) await uninstall(id);
    }
  }
  // After their plugins are gone, so nothing is left pointing at a removed marketplace.
  const foreignMarkets = strip ? foreignMarketplaces(marketplaces.map((m) => m.name)) : [];
  for (const name of foreignMarkets)
    await run(`Removing marketplace ${name}`, `removed marketplace ${name}`, 'plugin', 'marketplace', 'remove', name);
  return { dupes, foreign };
}

// Installs, uninstalls, retires and updates, then prunes dependencies nothing needs when anything went. Records a
// failure for any of packs (names) still installed afterwards.
export async function applyPlugins({
  install,
  remove,
  retired,
  updates,
  removedBefore,
  packs,
}: {
  install: string[];
  remove: string[];
  retired: string[];
  updates: { id: string; from?: string; to: string }[];
  removedBefore: boolean;
  packs: string[];
}) {
  for (const id of install)
    await run(`Installing ${nameOf(id)}`, `installed ${id}`, 'plugin', 'install', id, '--scope', 'user', '--json');
  for (const id of remove)
    await run(`Uninstalling ${nameOf(id)}`, `uninstalled ${id}`, 'plugin', 'uninstall', id, '--json');
  for (const id of retired)
    await run(`Uninstalling ${nameOf(id)}`, `uninstalled ${id} (retired)`, 'plugin', 'uninstall', id, '--json');
  for (const u of updates) {
    await run(
      `Updating ${nameOf(u.id)} ${u.from} → ${u.to}`,
      `updated ${u.id} ${u.from} → ${u.to}`,
      'plugin',
      'update',
      u.id,
      '--json',
    );
  }
  if (remove.length || retired.length || removedBefore)
    await run('Pruning unused dependencies', 'pruned unused dependencies', 'plugin', 'prune', '-y');
  // Retiring runs before the updates, and an old dead-skills or flows still lists the packs as dependencies.
  const after = await progress('Checking no pack is still installed', () =>
    claude(undefined, 'plugin', 'list', '--json'),
  );
  let rows: PluginRow[] | undefined;
  try {
    const json = after.ok ? JSON.parse(after.out || '[]') : undefined;
    rows = json && (Array.isArray(json) ? json : (json.installed ?? []));
  } catch {
    /* rows stays undefined: reported below */
  }
  const left = rows && stillInstalled(rows, packs);
  if (!left) failures.push(`checking no pack is still installed: ${after.err}`);
  else if (left.length)
    failures.push(`still installed, though flows carries them now (claude plugin uninstall each): ${left.join(', ')}`);
}
