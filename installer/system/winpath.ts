// The Windows user PATH: read it and append a folder, through PowerShell.
import { spawnSync } from 'node:child_process';
import { pathWith } from '../core/binaries.ts';

const ps = (cmd: string, env?: NodeJS.ProcessEnv) =>
  spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', env: { ...process.env, ...env } });

// Appends dir to the user PATH unless it's there: 'added', 'present', or which half failed.
export function addUserPath(dir: string): 'added' | 'present' | 'read-failed' | 'write-failed' {
  const read = ps("[Environment]::GetEnvironmentVariable('Path', 'User')");
  // Without the current PATH, writing would replace it with only this folder.
  if (read.status !== 0) return 'read-failed';
  const next = pathWith(read.stdout.trim(), dir);
  if (!next) return 'present';
  // The new PATH goes through the environment, never into the command text.
  const r = ps("[Environment]::SetEnvironmentVariable('Path', $env:DCS_PATH, 'User')", { DCS_PATH: next });
  return r.status === 0 ? 'added' : 'write-failed';
}
