import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';

// Night City lines for a finished turn and for Claude waiting on you; deliberately not night-city's own words.
export const DONE = [
  'Come look at your Agent',
  "Gig's done, choom",
  'Eddies are in your account',
  'Run complete. ICE is clean',
  'Your fixer left a message',
  "Job's wrapped. Jack back in",
  'Braindance is ready to play',
  "Delta's done. Back to you",
];
export const WAITING = [
  'Songbird requests your help',
  'Incoming call on your Agent',
  "Your fixer's on the holo",
  'Need your eyes on this, choom',
  'Netrunner awaits your authorization',
  "The daemon won't move without you",
];

const MAX = 120;

// Continuations, headless runs (-p and the SDKs report sdk-*) and a teammate's end of turn stay quiet; a subagent
// blocked on a permission or a question still notifies, since it blocks the user too.
export const shouldNotify = (input, env) =>
  !input.stop_hook_active &&
  !(input.hook_event_name === 'Stop' && input.agent_id !== undefined) &&
  !env.CLAUDE_CODE_ENTRYPOINT?.startsWith('sdk');

// Line 1: our pane's #{pane_active}#{window_active}; then #{client_flags} for each client on the session.
export function tmuxFocused(output) {
  const [active, ...clients] = output.split('\n');
  return active === '11' && clients.some((flags) => flags.split(',').includes('focused'));
}

// First non-empty line, cut by code points so an emoji is never split.
function firstLine(text) {
  const line = (text ?? '').split('\n').find((l) => l.trim()) ?? '';
  const chars = [...line.trim()];
  return chars.length > MAX ? chars.slice(0, MAX - 1).join('') + '…' : chars.join('');
}

export function message(input, { pick }) {
  const done = input.hook_event_name === 'Stop';
  const status = pick(done ? DONE : WAITING);
  const detail = firstLine(
    done
      ? input.last_assistant_message
      : input.hook_event_name === 'PreToolUse'
        ? input.tool_input?.questions?.[0]?.question
        : input.message,
  );
  return { title: basename(input.cwd ?? process.cwd()), status, detail };
}

export const TMUX_ARGV = (pane) => [
  'tmux',
  'display-message',
  '-p',
  '-t',
  pane,
  '#{pane_active}#{window_active}',
  ';',
  'list-clients',
  '-t',
  pane,
  '-F',
  '#{client_flags}',
];

// freedesktop servers render a subset of HTML in the body.
const markup = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Fixed script: the text arrives in env vars only. Stays quiet when Windows Terminal is the foreground app.
const TOAST = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Notify -Name User32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
'@
$fgPid = 0
[void][Notify.User32]::GetWindowThreadProcessId([Notify.User32]::GetForegroundWindow(), [ref]$fgPid)
if ((Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName -eq 'WindowsTerminal') { exit 0 }
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$icon = [Security.SecurityElement]::Escape(([Uri]$env:NOTIFY_ICON).AbsoluteUri)
$title = [Security.SecurityElement]::Escape($env:NOTIFY_TITLE)
$body = [Security.SecurityElement]::Escape($env:NOTIFY_BODY)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><image placement='appLogoOverride' src='$icon'/><text>$title</text><text>$body</text></binding></visual></toast>")
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;

const OSASCRIPT = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run';

// Onibi, night-city's mascot and the icon, signs the popups where the server shows an app name.
const SENDER = 'Onibi';

// Commands to try in order; the next one runs only when the previous binary is missing.
export function notifiers(platform, { title, status, detail }, icon) {
  const body = detail ? `${status}\n${detail}` : status;
  if (platform === 'linux') {
    // Our status in bold; Claude's text escaped so it shows literally.
    const b = detail ? `<b>${markup(status)}</b>\n${markup(detail)}` : `<b>${markup(status)}</b>`;
    const dbus = ['org.freedesktop.Notifications', '/org/freedesktop/Notifications', 'org.freedesktop.Notifications'];
    return [
      {
        argv: [
          'busctl',
          '--user',
          'call',
          // '--' so busctl doesn't read the expire timeout -1 as an option.
          '--',
          ...dbus,
          'Notify',
          'susssasa{sv}i',
          SENDER,
          '0',
          icon,
          title,
          b,
          '0',
          '0',
          '-1',
        ],
      },
      { argv: ['notify-send', '-a', SENDER, '-i', icon, '--', title, b] },
    ];
  }
  if (platform === 'win32') {
    return [
      {
        argv: ['powershell', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', TOAST],
        env: { ...process.env, NOTIFY_TITLE: title, NOTIFY_BODY: body, NOTIFY_ICON: icon },
      },
    ];
  }
  // '--' here and in notify-send: a project folder named like an option stays the title.
  if (platform === 'darwin') return [{ argv: ['osascript', '-e', OSASCRIPT, '--', title, body] }];
  return [];
}

// Resolves with stdout; rejects with the spawn error (code ENOENT when the binary is missing) or a non-zero exit.
function run(argv, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}`))));
  });
}

const ICON = join(import.meta.dirname, '..', 'icon.png');

export async function main({ stdin, env, platform }) {
  try {
    const input = JSON.parse(stdin);
    if (!shouldNotify(input, env)) return;
    if (platform !== 'win32' && env.TMUX_PANE) {
      // A failing tmux counts as not focused: better a popup too many than a missed one.
      const focused = await run(TMUX_ARGV(env.TMUX_PANE), env).then(tmuxFocused, () => false);
      if (focused) return;
    }
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const msg = message(input, { pick });
    for (const { argv, env: childEnv } of notifiers(platform, msg, ICON)) {
      try {
        await run(argv, childEnv ?? env);
        return;
      } catch (e) {
        if (e.code !== 'ENOENT') return;
      }
    }
  } catch {}
}
