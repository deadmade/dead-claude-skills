// flows' prose environment for /copyedit: uv syncs the locked project into <CONFIG>/flows-prose/, or the folder goes.
import { existsSync, rmSync } from 'node:fs';
import { proseDecision, proseDir, proseMarker, prosePython, proseSync } from '../core/prose.ts';
import { ASSETS, CONFIG, done, failures } from '../context.ts';
import { removeDir, writeAtomic } from '../system/files.ts';
import { errCode, startSync, which } from '../system/proc.ts';
import { log } from '../ui/ui.ts';

const SMOKE = "import spacy; spacy.load('en_core_web_trf')";

// toggle: the prose toggle after the screens; flows: flows is selected; unticked: the user turned the toggle off.
export async function applyProse({ toggle, flows, unticked }: { toggle: boolean; flows: boolean; unticked: boolean }) {
  const dir = proseDir(CONFIG);
  const python = prosePython(CONFIG, process.platform);
  const decision = proseDecision({ toggle, flows, installed: existsSync(python) });
  if (decision === 'sync') sync(dir, python);
  if (decision === 'remove') {
    const code = removeDir(dir);
    if (code) failures.push(`prose: couldn't delete ${dir} (${code}), delete that folder by hand`);
    else done.push(`prose: deleted ${dir}`);
  }
  if (decision === 'needs-flows') done.push('prose: needs flows, nothing set up');
  // Off for good: the next run starts with the toggle off.
  if (unticked) writeAtomic(proseMarker(CONFIG), '');
}

function sync(dir: string, python: string) {
  // No uv: the summary's "Missing on PATH" note names it.
  const uv = which('uv');
  if (!uv) return;
  log('info', `Setting up /copyedit's spaCy environment in ${dir} (about 1.7 GB the first time)`);
  const { args, env } = proseSync(ASSETS, CONFIG);
  const r = startSync(uv, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) return failures.push(`prose: uv sync failed (${errCode(r.error) ?? `exit ${r.status}`})`);
  const smoke = startSync(python, ['-c', SMOKE], { stdio: 'inherit' });
  if (smoke.status !== 0)
    return failures.push(`prose: spaCy can't load en_core_web_trf (${errCode(smoke.error) ?? `exit ${smoke.status}`})`);
  rmSync(proseMarker(CONFIG), { force: true });
  done.push(`prose: spaCy and en_core_web_trf ready in ${dir}`);
}
