// The clean slate's confirmation and backup; the delete itself runs last (clearTargets).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { OFFICIAL } from '../core/plugins.ts';
import { CLEAN_TARGETS } from '../core/settings.ts';
import { CONFIG, SETTINGS, done, must, red } from '../context.ts';
import { backup } from '../system/files.ts';
import { line, log, note } from '../ui/ui.ts';

// The backup folder once the user typed "clean" and the backup succeeded, or undefined when they backed out.
export async function confirmClean() {
  const backupDir = `${CONFIG}.dead-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  note('Clean slate', [
    ...[
      `${SETTINGS} is replaced with only this installer's settings, and these are deleted:`,
      ...CLEAN_TARGETS.map((t) => join(CONFIG, t))
        .filter(existsSync)
        .map((t) => `  ${t}`),
      `Every plugin and marketplace not from dead-claude-skills is removed too, except the ${OFFICIAL} plugins used here.`,
    ].map(red),
    `A backup goes to ${backupDir} first.`,
  ]);
  const word = must(await line('Really wipe your Claude Code config? Type "clean" to continue:'));
  if (word?.trim() !== 'clean') {
    done.push('clean slate: skipped by you');
    return undefined;
  }
  try {
    backup(CONFIG, backupDir);
  } catch (e) {
    log('error', `Backup failed, nothing was deleted: ${e.message}`);
    process.exit(1);
  }
  done.push(`backed up your config to ${backupDir}`);
  return backupDir;
}
