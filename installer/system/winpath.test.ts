// The user PATH round trip against the real registry, on a test variable. Windows CI only: it writes HKCU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { addUserPath } from './winpath.ts';

const NAME = 'DCS_TEST_PATH';
const ps = (cmd: string, env: NodeJS.ProcessEnv = {}) =>
  spawnSync('powershell', ['-NoProfile', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${cmd}`], {
    encoding: 'utf8',
    env: { ...process.env, N: NAME, ...env },
  });
// The variable's registry type and its value as stored, %VAR% unexpanded.
const stored = () =>
  ps(
    "$k = Get-Item HKCU:\\Environment; $k.GetValueKind($env:N); $k.GetValue($env:N, '', 'DoNotExpandEnvironmentNames')",
  )
    .stdout.trim()
    .split(/\r?\n/);
const REGISTRY = {
  skip: !(process.platform === 'win32' && process.env.CI) && 'writes the user registry: Windows CI only',
};

test('addUserPath keeps %VAR% entries, non-ASCII folders and the expandable type', REGISTRY, () => {
  const before = '%USERPROFILE%\\x;C:\\Schülein';
  ps('Set-ItemProperty HKCU:\\Environment -Name $env:N -Value $env:V -Type ExpandString', { V: before });
  try {
    assert.equal(addUserPath('C:\\dcs-test', NAME), 'added');
    assert.deepEqual(stored(), ['ExpandString', `${before};C:\\dcs-test`]);
  } finally {
    ps('Remove-ItemProperty HKCU:\\Environment -Name $env:N');
  }
});

test('addUserPath leaves a PATH that already has the folder alone', REGISTRY, () => {
  ps('Set-ItemProperty HKCU:\\Environment -Name $env:N -Value $env:V -Type ExpandString', {
    V: 'C:\\a;C:\\dcs-test\\',
  });
  try {
    assert.equal(addUserPath('c:\\DCS-test', NAME), 'present');
  } finally {
    ps('Remove-ItemProperty HKCU:\\Environment -Name $env:N');
  }
});
