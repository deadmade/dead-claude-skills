// ccstatusline's config: the shipped Night City one, swapped in for older shipped ones, asked before a customized one.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isShipped } from '../core/settings.ts';
import { ask, asset, done, remove, tryJson } from '../context.ts';
import { writeAtomic } from '../system/files.ts';
import { log } from '../ui/ui.ts';

const CCSL = join(homedir(), '.config', 'ccstatusline', 'settings.json');

// Off only deletes the config when this installer's status line was on: the toggle also reads off for a ccstatusline
// set up some other way, whose config isn't ours to delete.
export async function applyCcstatusline(was: boolean, on: boolean) {
  if (!on) return was ? remove(CCSL, CCSL) : undefined;
  const shipped = asset('ccstatusline-night-city.json');
  if (!existsSync(CCSL)) {
    writeAtomic(CCSL, shipped);
    return done.push(`wrote ${CCSL}`);
  }
  const current = readFileSync(CCSL, 'utf8');
  if (isShipped(current, [shipped])) return;
  const newer = (tryJson(CCSL)?.version ?? 0) > JSON.parse(shipped).version;
  if (newer) log('warn', `${CCSL} has a newer config version than the shipped one; keeping it is safer.`);
  // The stock config earlier versions wrote is ours, not a customization: swap it without asking.
  const ours = isShipped(current, [asset('ccstatusline.json'), shipped]);
  if (ours || (await ask(`${CCSL} differs from the shipped config. Replace it?`, false))) {
    writeAtomic(CCSL, shipped);
    done.push(`replaced ${CCSL}`);
  } else if (current) done.push(`kept your ${CCSL}`);
}
