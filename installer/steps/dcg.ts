// dcg, the destructive command guard: its own installer or uninstaller, run when the toggle changes.
import { dcgCommand } from '../core/options.ts';
import { WIN, ask, done, failures } from '../context.ts';
import { errCode, onPath, startSync, which } from '../system/proc.ts';
import { log } from '../ui/ui.ts';

export async function applyDcg(was: boolean, on: boolean) {
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
  const file = which(bin);
  if (!file) return failures.push(`dcg ${action} needs ${bin}, which is not on PATH`);
  const r = startSync(file, args, { stdio: 'inherit' });
  if (r.status !== 0) return failures.push(`dcg ${action} failed (${errCode(r.error) ?? `exit ${r.status}`})`);
  done.push(`dcg: ${action}ed`);
  if (on && !WIN && !onPath('dcg')) log('warn', 'dcg is not on PATH: add ~/.local/bin (NixOS: home.sessionPath).');
}
