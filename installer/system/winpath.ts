// The Windows user PATH: read it and append a folder, through PowerShell.
import { spawnSync } from 'node:child_process';
import { pathWith } from '../core/binaries.ts';
import { which } from './proc.ts';

// Stops at the first error (else -Command exits 0). UTF-8 out, so a folder like C:\Users\Schülein survives Windows
// PowerShell's OEM code page. Values go in through the environment, never into the command text.
const ps = (cmd: string, env: NodeJS.ProcessEnv) =>
  spawnSync(
    which('powershell') ?? 'powershell',
    [
      '-NoProfile',
      '-Command',
      `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; ${cmd}`,
    ],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  );

// Appends dir to the user PATH unless it's there: 'added', 'present', or which half failed. name: the variable, which
// only tests change. The value is read and written as stored, so %VAR% entries stay unexpanded and it stays
// REG_EXPAND_SZ; setting and clearing a dummy variable through .NET then tells Windows, so new terminals see it.
export function addUserPath(dir: string, name = 'Path'): 'added' | 'present' | 'read-failed' | 'write-failed' {
  const read = ps("(Get-Item HKCU:\\Environment).GetValue($env:DCS_NAME, '', 'DoNotExpandEnvironmentNames')", {
    DCS_NAME: name,
  });
  // Without the current PATH, writing would replace it with only this folder.
  if (read.status !== 0) return 'read-failed';
  const next = pathWith(read.stdout.replace(/\r?\n$/, ''), dir);
  if (!next) return 'present';
  const r = ps(
    'Set-ItemProperty HKCU:\\Environment -Name $env:DCS_NAME -Value $env:DCS_PATH -Type ExpandString; ' +
      "[Environment]::SetEnvironmentVariable('DCS_BROADCAST', '1', 'User'); " +
      "[Environment]::SetEnvironmentVariable('DCS_BROADCAST', $null, 'User')",
    { DCS_NAME: name, DCS_PATH: next },
  );
  return r.status === 0 ? 'added' : 'write-failed';
}
