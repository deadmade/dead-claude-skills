// The terminal's own background: Claude Code leaves empty cells to the terminal, which no theme token reaches, so this
// sends OSC 11 (set the background) and OSC 111 (reset it) to the terminal Claude runs in. A mod can't write to the
// terminal itself, so a child process finds it and writes there.
import type { EngineInterface as $ } from 'claude-code';

// The theme's `background` token, so the empty cells match the painted ones.
export const SET = ']11;#0A0612';
export const RESET = ']111';

// The child has no tty of its own: walk up to the first ancestor with one (Claude's) and write there.
export const SH = `p=$PPID
while [ "$p" -gt 1 ]; do
  t=$(ps -o tty= -p "$p" | tr -d ' ')
  case "$t" in ''|'?'|'??') p=$(ps -o ppid= -p "$p" | tr -d ' ') ;; *) printf '\\033%s\\007' "$1" > "/dev/$t"; exit 0 ;; esac
done
exit 1`;

// Windows: no /dev/pts; CONOUT$ is the console the child shares with Claude, even with stdout piped. Opened through
// CreateFileW because .NET's FileStream won't open device names.
export const PS = `$sig = '[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr p, uint c, uint f, IntPtr t);'
$k = Add-Type -MemberDefinition $sig -Name K -Namespace NightBg -PassThru
$h = $k::CreateFileW('CONOUT$', 0x40000000, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
if ($h -eq [IntPtr](-1)) { exit 1 }
$fs = New-Object IO.FileStream((New-Object Microsoft.Win32.SafeHandles.SafeFileHandle($h, $true)), [IO.FileAccess]::Write)
$b = [Text.Encoding]::ASCII.GetBytes([string][char]27 + $env:NIGHT_CITY_OSC + [char]7)
$fs.Write($b, 0, $b.Length); $fs.Close()`;

// The plugin theme's stored value is `custom:night-city:night-city` (undocumented, read from the binary).
export const isNightCity = (theme: unknown) => typeof theme === 'string' && theme.endsWith(':night-city');

// Mods have no platform API: try the POSIX route, fall back to PowerShell when sh is missing or finds no tty.
// shortcut: a crash or kill skips the reset and the terminal keeps the color until `printf '\033]111\007'`; Windows
// Terminal may ignore OSC 111 (untested), then send the original color back with OSC 11 instead.
export async function paint($: $, osc: string): Promise<boolean> {
  try {
    if ((await $.process.run(['sh', '-c', SH, 'sh', osc])).exitCode === 0) return true;
  } catch {}
  try {
    const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      stdin: PS,
      env: { NIGHT_CITY_OSC: osc },
    });
    if (r.exitCode === 0) return true;
    $.ui.log(`night-city: background not set: ${r.stderr.trim().slice(0, 200)}`, { to: 'debug' });
  } catch (err) {
    $.ui.log(`night-city: background not set: ${err}`, { to: 'debug' });
  }
  return false;
}
