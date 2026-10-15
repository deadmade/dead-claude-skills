# Turn-done notifications: design (`notify` plugin)

## Intent

The user works on a multi-monitor setup and switches to another window while Claude runs. They miss when a turn
ends or when Claude is blocked on them. They want a desktop popup, on Linux (Hyprland + Ghostty + tmux, noctalia
draws notifications) and Windows native (Windows Terminal). Today neither works: Claude Code's built-in channel is
eaten by tmux on Linux and has no Windows Terminal channel at all.

## Goals

1. A desktop notification when the main agent finishes a turn (`Stop`) **and** when Claude waits for the user
   (`Notification`, permission prompt / question).
2. Skipped when the user is looking at that session:
   - in tmux: the session's pane is the active pane of the active window and the tmux client has focus
     (`#{client_flags}` contains `focused`; needs `focus-events on`, without it we always notify);
   - Windows: Windows Terminal is the foreground app (coarse, any tab counts);
   - anywhere else: always notify.
3. Title `Claude Code · <project folder>`; body: a status line + the first line of Claude's last answer
   (`last_assistant_message`) on Stop, or the notification's own message on waits. Truncated to fit.
4. Own icon (a new neon glyph PNG shipped in the plugin) on both OSes.
5. Night-city wording when the night-city plugin is enabled: **new** line lists, not night-city's existing
   `TURN_WORDS`/`SPINNER_WORDS`. Done lines in the vein of "Come look at your Agent"; waiting lines like "Songbird
   requests your help". Plain wording ("Done" / "Needs your input") otherwise.
6. One plugin, one behaviour on every platform; Claude Code's built-in notification turned off while it is
   installed, so there are no doubles.

## Non-goals

- Painting the popup (colours/fonts belong to noctalia / Windows).
- Click-to-focus, action buttons, sound, Windows hero banner.
- Notifications on a phone or over SSH to a remote desktop.
- macOS is best effort (osascript, no icon), not tested by the user.
- WSL.

## Anti-goals

- Two popups for one event (ours + built-in, or Stop + idle).
- Popups for subagents or while a Stop hook continuation runs (`stop_hook_active`).
- Slowing the turn: hooks run `async`.
- Editing the user's tmux.conf or other dotfiles from the installer.
- Popups for non-interactive runs (`claude -p`, SDK, CI, `claude plugin test`): skipped. Builder verifies the signal
  on the installed Claude Code (e.g. `CLAUDE_CODE_ENTRYPOINT`) and tests it.

## Supported install path

The installer is the supported way on and off, because it also toggles `preferredNotifChannel`. Installing via
`/plugin` works but the README tells the user to set `preferredNotifChannel: "notifications_disabled"` by hand (and
remove it on uninstall). No runtime check in the hook.

## Decided shape

- New opt-in plugin `plugins/notify/` with a plain `hooks/hooks.json`: `Stop` and `Notification` (matcher for the
  permission/question types) → `node "${CLAUDE_PLUGIN_ROOT}/hooks/notify.mjs"`, `async: true`. No mod (the mod API's
  `$.ui.notify` only reaches the same terminal channels).
- `notify.mjs` reads the hook JSON from stdin, decides (event, focus, wording), and delivers:
  - Linux: `busctl --user call org.freedesktop.Notifications … Notify` with the icon path (no tmux passthrough
    needed); fallback `notify-send` if busctl is missing; else give up silently.
  - Windows: one `powershell -NoProfile` run that checks the foreground window's process
    (`WindowsTerminal`) and, if not, shows a WinRT toast with the icon, under PowerShell's AppId.
  - macOS: `osascript display notification`.
- Pure decisions (message text, focus parse, word pick, which delivery argv) are exported and unit-tested;
  `npm test` picks the test up.
- Night-city detection: night-city enabled in the user's `settings.json` `enabledPlugins` (respecting
  `CLAUDE_CONFIG_DIR`).
- Installer: notify on the `system` page (next to night-city). Selected → `preferredNotifChannel:
  "notifications_disabled"`; deselected → remove it only if it is that value. Pattern of `nightCity` in
  `mergeSettings` (`installer/core.mjs:113-148`) with a test.
- Marketplace entry + plugin.json at the shared version; README; THIRD_PARTY untouched (all own content);
  CLAUDE.md layout line.

## Left to the builder

- Exact Notification matcher names (verify on the installed Claude Code: `permission_prompt`,
  `elicitation_dialog`, whether AskUserQuestion raises one).
- Icon drawing and size; word lists (6–10 lines each, original phrasing).
- tmux with several clients attached: which client counts.
- Truncation lengths.

## Outside the repo (user's job)

- `~/.config/tmux/tmux.conf` (home-manager) has `focus-events off`; set it `on` for the focus check.
