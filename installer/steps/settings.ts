// settings.json: the merged keys, shown as a diff and written after a yes, and the marketplace pin.
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { MARKETPLACE, pinMarketplace } from '../core/release.ts';
import {
  type Settings,
  type Toggles,
  mergeSettings,
  resetSettings,
  settingsChange,
  settingsText,
  stripDefaults,
} from '../core/settings.ts';
import { SETTINGS, VERSION, ask, done, failures, green, red, tryJson } from '../context.ts';
import { writeAtomic } from '../system/files.ts';
import { note } from '../ui/ui.ts';

// strip: add the default-disabling keys. reset: clean slate, replace instead of merge.
export async function applySettings(
  toggles: Toggles & { dcg: boolean },
  { strip, reset }: { strip: boolean; reset: boolean },
) {
  const build = (s: Settings) =>
    reset ? resetSettings(s, toggles) : strip ? stripDefaults(mergeSettings(s, toggles)) : mergeSettings(s, toggles);
  const snippet = (title: string) => note(title, JSON.stringify(build({}), null, 2).split('\n'));
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
  const lines = (sign: string, k: string, v: unknown) =>
    `${k}: ${JSON.stringify(v, null, 2)}`.split('\n').map((l) => `${sign} ${l}`);
  const diff = changed.flatMap((k) => [
    ...(k in before ? lines('-', k, before[k]).map(red) : []),
    ...(k in after ? lines('+', k, after[k]).map(green) : []),
  ]);
  note('settings.json changes', [SETTINGS, '', ...diff]);
  if (!(await ask('Write these changes?', true))) return done.push('settings.json: skipped by you');
  writeAtomic(SETTINGS, change.text);
  done.push(`settings.json: updated ${changed.join(', ')}`);
}

// The settings entry Claude Code checks the add against; a symlinked or broken settings.json is left as it is.
// Returns the file as it was, or undefined when nothing was written.
export function pinSettingsEntry() {
  if (!existsSync(SETTINGS) || lstatSync(SETTINGS).isSymbolicLink()) return undefined;
  const raw = readFileSync(SETTINGS, 'utf8');
  const before = tryJson(SETTINGS);
  const after = before && pinMarketplace(before, VERSION);
  if (!after || after === before) return undefined;
  writeAtomic(SETTINGS, settingsText(raw, after));
  done.push(`settings.json: pinned the ${MARKETPLACE} marketplace to v${VERSION}`);
  return raw;
}
