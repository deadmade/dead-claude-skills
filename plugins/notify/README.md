# notify

A desktop notification when Claude finishes a turn or waits for you, so you can work in another window (or on another
monitor) and come back when it's your move. Opt-in.

It fires on:

- a finished turn of the main agent (`Stop`): "Done" and the first line of Claude's answer;
- a permission prompt or an MCP elicitation (`Notification`): "Needs your input" and Claude Code's message;
- a question from Claude (`PreToolUse` on `AskUserQuestion`, which raises no notification of its own): "Needs your
  input" and the question.

The icon is Onibi, night-city's pixel-art netrunner (`icon.png`, a 4x copy written by `scripts/draw-mascot.mjs`; never
edit it by hand). The title is `Claude Code · <project folder>`. With the night-city plugin enabled, the status line is a Night City
line instead ("Come look at your Agent", "Songbird requests your help").

It stays quiet:

- in tmux, when the session's pane is the active pane of the active window and a client showing that session has
  focus. This needs `set -g focus-events on` in your tmux config; without it tmux never knows about focus and every
  event pops up;
- on Windows, when Windows Terminal is the foreground app (any tab counts);
- for subagents, Stop-hook continuations and headless runs (`claude -p`, the Agent SDK, CI).

Outside tmux on Linux and macOS it always notifies.

## Delivery

| Platform | How                                                                               | Needs                                                                  |
| -------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Linux    | `busctl --user` to `org.freedesktop.Notifications`, falling back to `notify-send` | systemd's `busctl` or libnotify's `notify-send`; a notification daemon |
| Windows  | a WinRT toast from Windows PowerShell, under PowerShell's app id                  | Windows PowerShell 5.1 (built in); notifications on for it in Settings |
| macOS    | `osascript` `display notification` (best effort, untested, no icon)               | nothing extra                                                          |

Talking to the notification daemon directly means tmux needs no `allow-passthrough`. The hook runs in the background
(`async`), so a slow PowerShell start doesn't hold up the turn. Claude's text reaches the notifier as an argument or
an environment variable, never as script source.

## Install

Use the installer: picking notify also sets `"preferredNotifChannel": "notifications_disabled"` in
`~/.claude/settings.json`, so Claude Code's own notification doesn't double up, and deselecting it removes that again.

    /plugin install notify@dead-claude-skills

works too, but then set `preferredNotifChannel` yourself, and remove it if you uninstall notify that way, or you get
no notifications at all.
