---
phase: done
---

# Turn-done notifications: flow

## Request

"Could we please implement a notification handling so when a turn is done I get a notifaction cross platform"

## Artifacts

- Spec: [2026-10-15-turn-notifications-design.md](../../superpowers/specs/2026-10-15-turn-notifications-design.md)
- Plan: [2026-10-15-turn-notifications.md](../../superpowers/plans/2026-10-15-turn-notifications.md)
- ADRs: none
- CONTEXT.md: none

## Gates

- Gate 1, spec approved: 2026-10-15 (approved in plan mode, spec then copied here unchanged)
- Gate 2, plan approved: 2026-10-15, execution: native

## Skipped

- Grill ran inline during brainstorming (plan mode); no separate grilling/domain-modeling pass.

## Brainstorm answers

- Moment: other window, same machine, multi-monitor. Triggers: done + waiting. Platforms: Linux (Hyprland,
  Ghostty, tmux 3.6a, noctalia), Windows native. Skip when looking at it. Content: project + first line. Theme: own
  icon + new night-city wording ("come look at your Agent", "Songbird requests your help"). Install: opt-in.

## Grounding

- No notification code yet. Mod API `turn.complete` (`plugins/night-city/hooks/register.tsx:52`), `$.ui.notify`
  only via `preferredNotifChannel`. Plain hooks.json precedent: `plugins/dead-skills/hooks/hooks.json` (`node -e`).
- Installer: `mergeSettings` `installer/core.mjs:113-148`, `unavailable()` :422, `CATEGORIES` :333.
- User machine: tmux.conf `focus-events off`, no `allow-passthrough`; `notify-send` absent; `busctl` present.

- Task 0 (2026-10-15, CC as installed): `CLAUDE_CODE_ENTRYPOINT` is `cli` interactive, `sdk-cli` under `-p`.
  Stop input: `hook_event_name`, `cwd`, `stop_hook_active`, `last_assistant_message`, no `agent_id` on the main
  agent; subagents (incl. internal ones, `agent_type: ""`) fire only SubagentStop. Notification input: `message`,
  `notification_type`; seen `permission_prompt` ("Claude needs your permission"), `idle_prompt`,
  `push_notification`. AskUserQuestion raises **no** Notification. Matcher: `permission_prompt|elicitation_dialog`.
  The user's own timer tests showed the built-in channel skipping every time ("terminal is active") with tmux
  `focus-events off`.

## Prior art

- Built-in `preferredNotifChannel`: Ghostty/kitty/iTerm2 only, focus-aware, needs tmux passthrough
  (https://code.claude.com/docs/en/settings-reference#preferrednotifchannel, https://code.claude.com/docs/en/terminal-config).
- Hooks: Stop not on interrupt, `stop_hook_active`, don't hook SubagentStop, Notification matchers, `async`
  (https://code.claude.com/docs/en/hooks).
- Windows Terminal: tools use a PowerShell toast keyed on `WT_SESSION`, not OSC 9
  (https://cdn.jsdelivr.net/npm/pi-notify@1.3.0/README.md).
- OS notifier per platform: code-notify, Aider (https://aider.chat/docs/usage/notifications.html).

## Options

- A built-in + config (rejected: no Windows Terminal channel; user saw nothing on Windows either).
- Hybrid built-in on Linux + Windows plugin (rejected by user).
- **Chosen: one plugin everywhere.** Linux delivery switched from escape sequences to D-Bus so tmux passthrough
  isn't needed (my call, follows from "unique" icon requirement).

## Builder check → user decisions

- Toggle outside installer: installer-only + README (user, 2026-10-15).
- Headless runs: skip (user, 2026-10-15).

## Grill

Run inline during brainstorming (theme, triggers, focus, install path, headless). My calls: plugin name `notify`,
PNG icon, D-Bus via `busctl` on Linux. No ADR (nothing hard to reverse); no CONTEXT.md terms worth recording.

## Plan review

### Round 1 (2026-10-15): correctness, fit, simpler reviewers

Merged to 12 fixes + 3 choices; nothing dropped. User: apply all fixes; tmux "any client focused"; missing
notifier → README note only; uninstall leaving `preferredNotifChannel` off → document it.

Changed in the plan: Windows toast inline via `-Command` (execution policy blocks `-File`), full env merged for
PowerShell, icon as URI, WinRT type loads spelled out; system-page entry moved to Task 1 (installer test needs every
plugin on a page); thin `notify.mjs` entry + `lib.mjs` (no entry guard); escaping only on Linux; truncation by code
points before escaping; skip on `agent_id`; `agent_needs_input` only if Task 0 shows no twin; payload check moved to
new Task 0; tmux error = not focused; `list-clients` for any focused client; pre-commit globs in `flake.nix`; word
lists in `lib.mjs`; `notifiers` returns a fallback list; PNG only. The shape changed (Task 0, `lib.mjs`); I checked
the edit myself rather than a second review round, since each change is local to one task.

## Deviations

- Task 0: AskUserQuestion raises no Notification event (user confirmed it fired nothing). Options: hook
  `PreToolUse` with matcher `AskUserQuestion` (rec.), or drop questions from the triggers. User chose the hook
  (2026-10-15). Plan: `message` handles `PreToolUse` (status = waiting line, detail = first question's text);
  hooks.json adds `PreToolUse`/`AskUserQuestion`, async.

- After the Linux smoke test (user, 2026-10-15): icon is Onibi (night-city's mascot from main) as a brightened face
  crop written by `scripts/draw-mascot.mjs`; popup reworked to "Onibi as sender": title = project folder, bold
  status + Claude's line, app name "Onibi" on Linux. Spec goal 3's `Claude Code · <project>` title is replaced by the
  project alone. Title kept as the bare folder name (user: "fine as is"). Security review: `--` added before
  positional args of notify-send and osascript.

## Walkthrough

| spec goal                                      | plan task         | file:line                                          | test                                                                             |
| ---------------------------------------------- | ----------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1 popup on turn end, permission, question      | T1, T2, deviation | `plugins/notify/hooks/hooks.json`, `lib.mjs:56`    | `plain stop message`, `plain waiting message`, `question message`                |
| 2 quiet when looking (tmux / Windows Terminal) | T1, T2            | `lib.mjs:36`, `lib.mjs:171`, TOAST in `lib.mjs`    | `tmux focus needs…`, `tmux is asked for…`; Windows: manual (T4)                  |
| 3 title + status + first line, truncated       | T1                | `lib.mjs:56`                                       | `plain stop message`, `empty answer…`, `truncation keeps whole characters`       |
| 4 own icon                                     | T2                | `plugins/notify/icon.png`, `lib.mjs:165`           | manual (smoke test, T4)                                                          |
| 5 night-city wording, new lines                | T1                | `lib.mjs:7`, `lib.mjs:41`                          | `night-city is on only…`, `night-city wording`                                   |
| 6 one plugin, built-in off via installer       | T1, T3            | `installer/core.mjs:131`, `installer/core.mjs:390` | `notify turns the built-in notification off…`, `opt-ins from the real manifests` |
| anti-goals: subagents, continuations, headless | T1 + final fix    | `lib.mjs:30`                                       | `skips continuations…`, `a subagent waiting… still notifies`                     |
| text never executed                            | T2                | `lib.mjs:114`                                      | `linux tries busctl…`, `windows passes text by env…`, `mac passes raw text…`     |
| never blocks/fails the turn                    | T2                | `lib.mjs:167`, hooks `async`                       | `main exits quietly on bad input`                                                |

Linux smoke test: popup shown on the user's desktop (2026-10-15). Code with no goal: none. Open: Windows check (T4) needs the user's machine; the sandbox blocks
D-Bus and tmux sockets here.

Final review (fresh reviewer, opus): 1 Critical (busctl read `-1` as an option, so no Linux popup) and 1 Important
(agent_id silenced subagent waits) fixed test-first; 3 minors deferred (see ledger).
