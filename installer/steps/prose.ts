// flows' prose environment for /copyedit: uv syncs the locked project into <CONFIG>/flows-prose/, or the folder goes.
import { existsSync } from 'node:fs';
import { proseDecision, proseDir, proseMarker, prosePython, proseSync, proseUnticked } from '../core/prose.ts';
import { ASSETS, CONFIG, done, failures } from '../context.ts';
import { removeDir, writeAtomic } from '../system/files.ts';
import { errCode, exitReason, startSync, which } from '../system/proc.ts';
import { log } from '../ui/ui.ts';

const SMOKE = "import spacy; spacy.load('en_core_web_trf')";

// toggle: the prose toggle after the screens; flows: flows is selected; expected: the toggle's default with that flows.
export async function applyProse({ toggle, flows, expected }: { toggle: boolean; flows: boolean; expected: boolean }) {
  const dir = proseDir(CONFIG);
  const python = prosePython(CONFIG, process.platform);
  // Any folder counts here, so off also cleans one a failed first sync left without Python.
  const decision = proseDecision({ toggle, flows, installed: existsSync(dir) });
  if (decision === 'sync') sync(dir, python);
  if (decision === 'remove') {
    const code = removeDir(dir);
    if (code) failures.push(`prose: couldn't delete ${dir} (${code}), delete that folder by hand`);
    else done.push(`prose: deleted ${dir}`);
  }
  if (decision === 'needs-flows') done.push('prose: needs flows, nothing set up');
  // Off by default from the next run on, until the user ticks it again.
  if (proseUnticked({ expected, toggle })) {
    const marker = proseMarker(CONFIG);
    try {
      writeAtomic(marker, '');
    } catch (e) {
      failures.push(`prose: couldn't write ${marker}: ${errCode(e) ?? e.message}`);
    }
  }
}

function sync(dir: string, python: string) {
  // Ticking the toggle takes back the opt-out, whether or not the sync works.
  const marker = proseMarker(CONFIG);
  const code = removeDir(marker);
  if (code) failures.push(`prose: couldn't delete ${marker} (${code}), the next run starts with prose off`);
  // No uv: a note, not a failure (the summary's "Missing on PATH" names the command).
  const uv = which('uv');
  if (!uv) return done.push("prose: needs uv on PATH; /copyedit runs without spaCy's measures until then");
  log('info', `Setting up /copyedit's spaCy environment in ${dir} (about 1.7 GB the first time)`);
  const { args, env } = proseSync(ASSETS, CONFIG);
  const r = startSync(uv, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) return failures.push(`prose: uv sync failed (${exitReason(r)})`);
  const smoke = startSync(python, ['-c', SMOKE], { stdio: 'inherit' });
  if (smoke.status !== 0) return failures.push(`prose: spaCy can't load en_core_web_trf (${exitReason(smoke)})`);
  done.push(`prose: spaCy and en_core_web_trf ready in ${dir}`);
}
