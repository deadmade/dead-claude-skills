---
flow: feature
phase: execute
now: /verify: checks green on be44ffd; /self-review running (8 passes).
---

# Flow observability: flow

## Request

> Hey, so im currently thinking a lot about ai harnesses. I tried herd but not really my thing. Collegues at work build
> this project: /home/deadmade/projects/Nexus but it tries to solve an issue I dont really have using the conducters
> because splitting up work even on larger tasks works perfectly using the conductors. The Problem im having is more
> centerd around how i can properly see flows and also open flows. Questions from agents, and also watching what
> subagents are doing. Using just claude code with the mods just does not really cut it for me but I havent really found
> a solution for it that works well. What my thinking was to utilize the basic idea of nexus and adapt it to how my flows
> work but im not sure how since I also dont really want to have a website I just host locally and also want to see what
> my agents are doing properly. Also im not sure if the task based system of nexus maks a lot of sense at the moment.
> Could you help me analyze this problem properly and decide on how to resolve it?

## Artifacts

- Spec: [spec.md](spec.md) (builder check and grill rounds 1-2 folded in, 2026-10-28)
- Plan: [plan.md](plan.md) (12 tasks, self-reviewed 2026-10-28)
- ADRs: [0005](../../adr/0005-flow-cockpit-outside-claude-code.md)
- Glossary: `GLOSSARY.md` § Flow cockpit (Flow cockpit, Flow run, Audit, Claude session, Loose session, Capture)

## Gates

- Gate 1, spec approved: 2026-10-28, "yes, approved". Reopened 2026-10-28: plan review round 1 changed the capture
  events, the status rules, the audit `Picks:`/`Fixed` lines, the Windows delivery and added slices (spec items
  marked **(review 1)**); round 2 added the `Waiting for you` prefix and the Windows hiding in slice 1
  (**(review 2)**). Re-approved 2026-10-28, "Approve the spec".
- Gate 2, plan approved: 2026-10-28, execution: subagent-driven, "Approve, subagent-driven"

## Skipped

- 2026-10-28: started as `/research-flow`; moved to `/feature-flow` after the user ruled out a measurable target
  ("for this task we cant have numbers so skip that!", then "yes" to switching). The Evidence section stays as
  background; Hypothesis and Results are dropped.

## Grounding

This repo (explorer, 2026-10-28):

- Flow state: `docs/features/<slug>/flow.md`, frontmatter `flow:`/`phase:` (older files lack `flow:`), free-text Gate
  lines, varying Deviations formats (`plugins/flows/references/flow-rules.md` State). Open now: flow-observability,
  per-plugin-versions (evaluate), skill-composition (validate), web-mcp (execute), web-mcp-search (execute).
- Per-task build state lives only in the SDD ledger `.superpowers/sdd/<plan>/progress.md` (per working tree,
  git-ignored), not in flow.md, until the Rulings copy at the end.
- The flows band (flow-pane run, PR #46) showed one run per AbovePrompt line (`slug · phase · gates · deviations · +N
open`, research numbers on a second line, resume hotkey), polling `docs/features/*/flow.md` every 5 s across
  worktrees. Removed in c2032c1 on 2026-10-20: "thats too much in my opinion. Lets disable our bands for now and use
  the ponytail band" (`docs/features/ponytail-v5/flow.md`). Only one AbovePrompt band wins.
- Questions today: only a desktop notification (`plugins/default/hooks/hooks.json`: Stop, Notification
  `permission_prompt|elicitation_dialog`, PreToolUse `AskUserQuestion`; `lib.mjs` takes the first question's text).
- Mod API (generated typings, tui-review `.claude-plugin/types/claude-code/index.d.ts`): `$.agent.list()` gives this
  session's agents with `status` (`pending|running|waiting|idle|completed|failed|killed`) and `parentId`, dropped soon
  after they end; `$.session` reads a subagent's transcript by `agentId`; `tool.call`/`turn.complete` carry `agentId`;
  `ui.render` on `AskUserQuestion` is hookable; panes via `$.ui.open`. Nothing for other sessions.

Nexus (explorer, 2026-10-28):

- Observation is 7 command hooks (SessionStart, UserPromptSubmit, Notification, Stop, SubagentStart/Stop,
  SessionEnd) → `POST /api/hook` on a local Fastify server → in-memory `SessionStore` state machine
  (idle/running/waiting/ended, stale after 30 min) → SSE → React web UI. `packages/core/src/sessions/SessionStore.ts`.
- Subagents: type, running/ended and runtime only; no tool calls, no transcript.
- Questions are board-DB records raised by `harness board question add`, decided only by humans in the web UI; they
  reach a session only through `additionalContext` on the next UserPromptSubmit, and only via tickets. No
  AskUserQuestion or permission handling.
- Session tracking, waiting toasts and the sessions list are keyed on session id and work without tickets; context
  injection, questions, comments, grouping and the dispatcher are keyed on tickets.

Claude Code itself (claude-code-guide, code.claude.com/docs, 2026-10-28; desktop app unverified):

- `claude agents`: states Needs input/Working/Idle/Completed/Failed/Stopped, peek panel shows the question, permission
  prompts need attach; only background sessions (foreground ones after `/bg`); subagents not rows.
  `claude agents --json` gives `state` and `waitingFor` (agent-view). `~/.claude/jobs/` is not a stable interface.
- Subagents: panel below the prompt + Enter for a fork's transcript, Ctrl+O transcript viewer, `/tasks`; on disk
  `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl` (schema undocumented). Pre/PostToolUse
  fire for subagent calls with `agent_id`; SubagentStop has `agent_transcript_path`.
- Answering from outside: PermissionRequest hook decides allow/deny; PreToolUse on AskUserQuestion can return
  `updatedInput.answers` (documented for `-p`, interactive implied). Injecting into an interactive session: channels
  (research preview, claude.ai/Console auth) or the cross-session inbox socket (goes to Claude, not the keyboard);
  tmux send-keys undocumented. Remote Control mirrors subagent progress to claude.ai/mobile, per session.
- OTel: `tool_result` only on completion, `subagent_completed`; traces beta, 5 s batches. Mods: `$.agent.list()` this
  session only, `$.session.send({sessionId})`, no enumeration of other sessions.

## Prior art

Agent report, 2026-10-28 (sources fetched in that run):

- **A. tmux/PTY wrapper TUI**: [allenan/herd](https://github.com/allenan/herd#how-it-works-1),
  [Claude Squad](https://github.com/smtg-ai/claude-squad#how-it-works),
  [CCManager](https://github.com/kbwo/ccmanager#why-ccmanager-over-claude-squad),
  [Agent Deck](https://github.com/asheshgoplani/agent-deck#status-detection). Sessions must start inside the tool;
  status partly from pane reading ("slower and occasionally wrong", Agent Deck); no subagent view; answer by attaching.
- **B. Hooks → event store → viewer**:
  [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability#-architecture)
  (12 hook events incl. SubagentStart/Stop, PermissionRequest → Bun + SQLite → WebSocket → Vue). Only one with a live
  per-subagent tool timeline; read-only; web UI.
- **C. First-party supervisor**: [`claude agents` agent view](https://code.claude.com/docs/en/agent-view) (research
  preview): rows grouped Needs input / Working / Completed, Haiku summary per row, answer AskUserQuestion in a peek
  panel, permission prompts need attach; `claude agents --json` (`state`, `waitingFor`); only backgrounded sessions;
  subagents are not rows; no notion of flow.md runs.
- **D. Work-item board**: [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) ("sunsetting"), Agent Deck's Fleet
  board (web mode).
- Docs: hooks carry `session_id`, `transcript_path`, subagent events `agent_id`/`agent_type`; SubagentStop carries
  `agent_transcript_path`; Notification types incl. `agent_needs_input`; `PermissionRequest` fires immediately and can
  decide; a PreToolUse hook can answer AskUserQuestion via `updatedInput.answers`; HTTP hooks; `permission_prompt`
  fires after ~6 s, `idle_prompt` ~60 s ([hooks](https://code.claude.com/docs/en/hooks#notification)). Transcripts
  `~/.claude/projects/<project>/<session-id>.jsonl`, format changes between versions
  ([sessions](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)).
- No tool tracks flow.md phases. "herd" is ambiguous (allenan/herd TUI vs poddubnyoleg/herd browser multiplexer).

## Evidence

Literature agent, 2026-10-28 (web-mcp papers search, DOIs via Crossref; abstracts only, no full texts). E10 re-fetched
by the main session ([arXiv:2609.33113](https://arxiv.org/abs/2609.33113)).

| #   | claim                                                                                                   | source                                               | type              | setting                                  | result                                                                                 | transfers here?                                        | strength |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------- |
| E1  | Multi-agent supervision hinges on situation awareness (SA) and calibrated trust                         | 10.1109/THMS.2013.2293535, Chen & Barnes, 2014       | survey            | multi-robot/UxV HRI                      | qualitative                                                                            | partly: same 1:N structure                             | High     |
| E2  | Agent transparency improves SA and performance without adding workload                                  | 10.1177/00187208221077804, van de Merwe et al., 2022 | systematic review | 17 experiments, safety-critical          | beneficial trend; depends on integration into the main display                         | partly                                                 | High     |
| E3  | Operator capacity is limited by wait time from lost SA, not interaction time                            | hdl 1721.1/90280, Cummings & Mitchell, 2008          | theory + sim      | independent UAVs                         | wait times cut predicted fan-out up to 67%                                             | yes: "who is blocked on what" is that wait             | Low      |
| E4  | A predictive overload display backfired; management-by-exception best                                   | hdl 1721.1/46751, Cummings et al., 2005              | experiment        | 1 operator, 4 UAVs                       | predictive level worst                                                                 | partly: against forecast-heavy views                   | Low      |
| E5  | More transparency: better performance and calibration, slower responses                                 | 10.1109/THMS.2020.2978041, Stowers et al., 2020      | experiment        | heterogeneous UxV                        | no workload rise; response time up                                                     | partly                                                 | Med      |
| E6  | Transparency had no effect for a monitor-only role                                                      | 10.1109/THMS.2019.2925717, Wright et al., 2020       | experiment        | observer of simulated squad              | null                                                                                   | partly: a passive glance view may not gain from detail | Med      |
| E7  | Interruptions at (coarse) subtask boundaries cost least                                                 | hdl 2142/11088, Iqbal et al., 2005                   | experiment        | lab desktop tasks                        | cost reduced at boundaries                                                             | yes: non-blocking events can wait for a breakpoint     | Low      |
| E8  | Batched notifications beat immediate and none                                                           | 10.1016/j.chb.2019.07.016, Fitz et al., 2019         | field RCT         | n=237 phone users                        | more attention/control, less stress; none raised anxiety                               | partly: progress yes, blocking questions no            | Med      |
| E9  | Alerts during heavy dual-task load are disregarded; right after a task they aren't                      | 10.1287/isre.2016.0644, Jenkins et al., 2016         | experiment        | security warnings                        | timing removes the effect                                                              | partly                                                 | Med      |
| E10 | Planning view + run log + ambient dashboard raised throughput and concurrent agents for parallel coding | arXiv 2609.33113, ParallelPilot, 2026                | preprint          | N=16 within-subjects, short coding tasks | +63% throughput, +1 agent at peak, less tracking/context switching; no gain in control | yes, closest; short tasks not hour-long flows          | Low      |

- **Agrees:** lost SA limits fan-out (E1, E3, E4); an at-a-glance status/intent view helps at little cost (E2, E10);
  non-urgent events cost less deferred or batched (E7, E8, E9).
- **Conflicts:** transparency slows responses (E5) vs no effect when only monitoring (E6) vs overload from more
  predictive detail (E4). Reading: blocking questions and state prominent, subagent detail one keystroke away (E10's
  own recommendation: "pair high-level awareness with low-cost paths back to the implementation evidence").
- **Gaps:** no study compares task boards with run-centric views; nothing on nested sub-agents or hour-long resumable
  runs; no terminal-UI evidence; agent tracing work (arXiv 2411.05285) is taxonomy without user studies.
- **Proposed effect:** blocked-wait latency from hook logs (blocking event → next input in that session), median and
  p90 per day, plus waits over 10 min; aim ≥30% lower than a 1–2 week baseline (E3, E10). Guardrail: focus switches
  into a session that end without input should not rise (E4, E7, E8).

Checked in this session (2026-10-28):

- Subagent transcripts on disk (`~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl`, plus a
  `.meta.json` with `agentType`, `description`, `model`, `finished`) hold tool calls with inputs and results, but
  every `thinking` block's text is empty (literature agent: 10 thinking blocks, all length 0; the main session's too).
  "What it thinks" can't be read back from disk; only the text it writes and its tool inputs.
- Agent teams ([docs](https://code.claude.com/docs/en/agent-teams#choose-a-display-mode)): experimental
  (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); `teammateMode: "tmux"`/`"auto"` puts each teammate, a full Claude Code
  session, in its own tmux split pane; click a pane to talk to it; permission prompts go to the lead. A named Agent
  call becomes a teammate. Not supported natively in Windows Terminal or Ghostty (tmux inside Ghostty is fine);
  in-process mode works everywhere (agent panel, Enter opens a teammate). Limits: in-process teammates not restored on
  `/resume`, one team per session, no nested teams, higher token cost. Shared task list has dependencies and a
  blocked state.

## Brainstorm answers

- 2026-10-28: current setup covers "maybe like 10% of the goal"; "quit annoying".
- 2026-10-28: "i often dont do parallel work. I ususaly do one or at most two sessions in parallel and I like to
  actually see what the agents does. What it edits what it thinks and I think about the problems as well and give
  input where needed. With the current setup I often have no idea on which task the agent is. Does it have any
  problems etc. Also did I forget to finish a flow etc."
- 2026-10-28: "im not sure if its really optimal what im doing but software factories just feel wrong idk. What im
  missing is just good visualisation of the markdown files. Mermaid diagrams or uml or whatever would be awesome.
  Espeically with sdd I dont really see what the agent is doing or at least not really well"
- 2026-10-28 (visual companion, picked A "flow map"): "For A I probably would need a better visualization how are
  they connected maybe they can run in parallel. Also what problems where found would be interesting. What i was
  initionally thinking and abolsutly no idea if its possible to essentialy have these claude 1 conducter window |
  subagent one | subagent two grid or something"
- 2026-10-28: "the agent should know that im able to properly see them but I dont want the agent to force to write
  them since not every task requires it! Also important is that similar to pi the app is easily changable and
  customizable from agents!" pi: extensions are TypeScript modules auto-discovered in `~/.pi/agent/extensions/` or
  `.pi/extensions/`, hot-reloaded with `/reload`, "pi can create extensions. Ask it to build one for your use case."
  ([pi extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), text
  read via the mirror https://github.com/pi0/pi-mono/blob/main/packages/coding-agent/docs/extensions.md).
- 2026-10-28: A means "the different conductor runs and then when we switch to sdd to see the different tasks that
  should be done reviews etc" (runs-v3 mockup: "A looks awesome").
- 2026-10-28: "teammates sound interesting but do they work onj windows? and A looks awesome but I dont think
  integrating it in claude code is possible"; then "I want ot also improve the visulization of the flows, specs etc
  with for example mermaid diagrams etc. I just dont see this working good in claude code allone."

## Options

### Surface and shape

Picked: Claude Code stays in the user's terminal, and a separate desktop window (Tauri) draws what the sessions and
their subagents do, from captured events, flow.md, the SDD ledgers and transcripts; watching only, no interacting
with Claude.

Offered 2026-10-28, with evidence: E2, E10 back an at-a-glance state view with detail one step away; E4, E5 warn
against always-on detail; E6 says showing more pays off for people working with the agents, not people who only
watch. Nothing in the literature compares surfaces.

- Diagrams in the docs only, viewed in existing Markdown renderers (S). Kept as a slice, not the whole answer.
- Own desktop window, Tauri (L).
- Terminal viewer in its own pane (L): rejected by the user, diagrams don't work well in a terminal.
- Desktop cockpit hosting Claude Code in embedded PTYs (L+): replaced; running Claude Code inside the app is the risky
  part.
- Terminal cockpit hosting Claude Code (like CCManager): rejected, text-only diagrams and a terminal in a terminal.
- Agent teams in tmux panes: Linux only (no Windows Terminal split panes); separate question, not picked.
- **Picked (user's proposal, recommended):** Claude Code stays in the user's terminal; hooks and a mod capture what the
  session and its subagents do into per-session event files; a separate desktop window (Tauri) follows those files
  plus flow.md, the SDD ledgers and transcripts, and draws runs, phases, the task graph and review loops, live agent
  activity, and the docs with Mermaid. **Scope (user, 2026-10-28):** "lets first just focus on the visulisation and
  capturing what claude code and the subagents to do just visulize everything that happens with the flows and keep
  the actually interacting with claude out of it for now". No answering questions, no starting flows, no typing.

### Language

Picked: Rust core, TypeScript views (user, 2026-10-28).

Rust extensions considered: a 15-line serde cdylib built in 6.4 s clean, 0.75 s release / 0.32 s debug incremental on
this machine (24 cores), so compile time isn't the objection; drawing in the webview, no stable plugin ABI, a
toolchain on every machine and a longer agent loop are.

### Spike

Picked: a throwaway clickable prototype from real data, agreed 2026-10-28.

"Lets create a prototype for that. So my inial idea was to have a drop down
to select the projects im working on. And a list of flows that currently run or have run with filter and sort. I can
see on which steps they are, are they waiting, what kind of flow was it etc. When I click of them I get the detailed
view with task list chat out put etc". Built as a clickable page in the brainstorm companion from real data (a
scratchpad extraction script), not Tauri; nothing of it is kept without going through the plan.

What the spike showed (2026-10-28):

- Reading everything from disk is cheap: 19 flows, 638 sessions (750 MB of transcripts), build logs and subagent
  files in about 1.4 s, using one `grep` pass to link sessions to flows.
- A project is more than one folder: sessions ran in `~/dead-claude-skills`, the flows now live in
  `~/projects/dead-claude-skills`, plus worktrees under `.claude/worktrees/`. The prototype folds them by folder name.
- Linking a session to a flow works when the session edited or wrote that flow's flow.md; a mere mention links nearly
  every session to every flow.
- "Waiting on you" from "the last message ends with a question" flagged web-mcp, idle 5 days, with 16 of 18 tasks done:
  a forgotten run, not a live question. Live state needs the capture; disk alone gives history.
- No plan declares task dependencies, so the graph can only show plan order. No existing spec or plan has a Mermaid
  block.
- The brainstorm companion reloads or blanks a full-document page; the prototype is served on its own port instead.
- User, 2026-10-28: "the shape feels right but most of it have really hard edges. Its really important that its easy
  and nice to read". Readability is a goal of its own, not polish.
- Restyle (hallmark, app scope, fast mode): Night City's own palette from `plugins/default/themes/night-city.json`
  instead of saturated ad-hoc colours, IBM Plex Sans 16px body, tone-stepped surfaces instead of 1px borders, rounded
  rows and panels, prose capped at 72–75ch, tool calls as one quiet line that opens to the diff or command, Mermaid
  themed dark to match, inline code rendered in log lines. `sloplint --scope app`: clean. The blank pages seen while
  testing were the headless test browser dropping every tab about 10 s after it opened (an untouched list page too),
  not the page or Mermaid.
- User, 2026-10-28: "table good, but the individual runs are still quit messy and really hard to read or not able to
  read at all". Run view rebuilt around reading: the Build tab opens with a two-sentence summary ("16 of 18 tasks
  done. Next up: …"), one line per task with a plain state ("Done after 2 fix rounds"), and a task opens to "What
  happened" as numbered sentences, then Security, Decisions (decision, why, if wrong) and Left for later. The plan-order
  diagram is gone (a straight line says nothing). The Conversation tab groups the transcript into turns, newest first:
  your prompt, the work folded into one line ("Changed 6 files, ran 16 commands"), earlier notes folded, Claude's
  answer; older turns clamp to six lines. Wrapped build-log lines are now joined by the extractor.
- User, 2026-10-28: "task view is shit, i see there are 10 task but what do they do I cant see at a glance. Decisions
  are really hard to read. COnversations is just a long list of text. Its so hard to read. Docs same issue again and
  overview not sure about that". Diagnosis: the source text is written for agents (a plan task is a title plus a dense
  interface spec, no plain "what it does" line; ledger lines and rulings are compressed technical prose; transcripts
  are long by nature). Restyling can't make that glanceable; it needs a distilling step, written by the flows or by a
  model in the app.
- For the real app: rendered Markdown from transcripts and build logs is untrusted (web pages end up in them), so it
  needs a sanitiser before it reaches the DOM; the prototype doesn't have one.

### Readable documents or model summaries

Picked: better source documents, which the viewer draws as UI by their structure; Haiku summaries not picked.

- User, 2026-10-28, on "flows write it" vs "Haiku summarises": "instead of just rendering markdown could we just
  enhance whats written. I will change the flow.md and shit a bit better etc". Direction: better source documents
  (the user reworks them), and a viewer that recognises their structure and draws it as UI instead of rendering
  Markdown as is. Haiku summaries not picked.

### Which documents get the readable format

Picked: flow.md and the plan; the build log stays as it is for now.

- 2026-10-28, which documents get the readable format: offered flow.md only / flow.md + plan / + build log
  (recommended flow.md + plan). User: "2". The plan's part (one plain line per task, dependencies) goes in through a
  conductor override of `writing-plans`; the build log stays as it is for now.

### Mod or no mod

Picked: no mod. The capture and transcripts cover agent state, questions and permission prompts; a mod is revisited
only if a gap shows (plan review round 1, 2026-10-28).

### Flow run view

Picked: the mockup in `crates/flow-cockpit/design/run-view.html` after three reworks, approved 2026-10-28 ("its
fucking awesome!!! lets goo"): an app window on one grid; Build is a phase track and one-line task rail beside the
selected task, with folds styled as rows; Decisions and Docs are master and detail; installed fonts; the Night City
palette unchanged.

Mockup round 1 (2026-10-28, `crates/flow-cockpit/design/run-view.html`): the user likes the theme and the colouring,
and hates the alignment: "it 100% looks like ai and kinda lazy", "also half the screen is empty" (a centred capped
column at ~1880 px). Fonts: installed ones, no bundled or downloaded font. Reworking it as an app window that fills
the width on one grid, with fewer boxes; not picked yet.

Mockup round 2 (2026-10-28): "definetly a good step up but now its just bam 3 or 4 walls of text. Its overwhelming a
bit but definetly the right direction"; the user asked Claude to analyse it. Reworking for one focal point per
screen: the selected task on Build, phases as one line, one-line task rows, decisions as expandable lists, no task
rail on Decisions and Docs.

Mockup round 3 (2026-10-28): "Rest awesome except the decissions tab". The user moved the chapters to the right on
Docs, with the documents on the left. Two changes asked: the clickable inline links in Build ("the build log, 1
entry") don't fit the scheme; Decisions should be decisions and deviations on the left with the text in the middle.

### Slice 2

Picked: go for slice 2 (Tasks 10 to 13), user, 2026-10-29, after using slice 1's window ("I like what you build").
At the checkpoint the Nix-built window died on the user's NVIDIA card under Wayland ("Error 71 (Protocol error)");
`WEBKIT_DISABLE_DMABUF_RENDERER=1` fixed it, and the app now sets it itself (Rulings, Task 9 follow-up).

## Plan review

**Round 1 (2026-10-28).** Reviewers: Correctness (fable), Fit (opus, blast-radius), Simpler (sonnet, ponytail-review).
37 findings, about 30 after merging; none dropped (each traced to a file:line or a fetched doc). Decisions by the user:

- Slicing: nothing visible before task 10 of 12 → **two slices** (slice 1 used daily before slice 2). Picked.
- Capture duplicated transcripts, and "Stop after a question" never fires interactively → **capture only what
  transcripts lack**; waiting = an unfinished AskUserQuestion or a permission prompt with no later event; working =
  transcript grew in 2 minutes. Picked. Spec edit, Gate 1 reopened.
- Windows: the installer keeps only the exe from a zip, the app isn't on PATH → **built-in views embedded**,
  `--print-view`, the app at `%USERPROFILE%\.claude\bin\flow-cockpit.exe` with its path printed, no shortcut. Picked.
- Technical fixes, all applied as recommended ("Apply all"): workspace grows with the tasks; ts-rs bindings exported
  to `crates/flow-cockpit/bindings/` with a drift test ignoring line endings; vendored libs and bindings excluded from
  treefmt and kept LF; numbered gate lines in implement/fix-flow/upgrade and no `<date>` placeholders; checkTemplates
  covers gates, `Depends on:` and implement/upgrade; audit `Picks:`/`Fixed` lines (spec edit); views loaded as
  source over IPC from a `blob:` URL instead of a custom scheme (no path escapes, no CORS); no inline style or script
  in the shell; a 2 s poll instead of notify; link scan cached and after first paint; worktrees found without
  sessions; CI core jobs `-p flow-cockpit-core`, Nix install action pinned; Windows icon and no console window;
  `wrapGAppsHook3`, workspace version in the flake, timing tests skipped in the Nix build; Nix hint pinned to the
  release; installer reuses `applyBin` with a Linux hint; DOMPurify tested under jsdom (devDependency); parallel
  append test at the largest line; capture folder 0700; partial lines tolerated in transcripts; SubagentStop without
  start ignored; Task 1 (mod probe) dropped, "no mod" recorded; the mockup kept as the run view's reference.

**Round 2 (2026-10-28).** One reviewer (opus) on the rewrite: every round-1 decision was in place; 15 findings in what
the rewrite introduced, none changing a decision. User: "Apply all". Changed: the runtime, blocks, vendored libraries
and tokens move to `app/shell/` as JS with JSDoc types checked by `tsc --checkJs` (blob-imported views can't import
files; views get everything through `ctx`, a value `import` is an error); the views tests run only in
`flow-cockpit.yml` after `npm ci`; bindings exported by one ignored test per crate for every crossing type, compared
by `bindings_are_current`; `--print-types` for views outside the repo; Tauri capability file, `identifier`, `app/gen/`
ignored; `Index::build` without links plus `scan_links` and `rebuild_project`; the poll covers the capture folder and
folders created later; missing Files entries (Cargo.toml/lock, the `.ico`, dump tests, fixtures); `include_dir!` from
`$CARGO_MANIFEST_DIR`; Windows `--version` readable through a pipe; audit and session summaries defined and tested;
`now:` starts with "Waiting for you" at every stop (spec edit); the plugin hidden on Windows in slice 1 and offered
again in Task 13 with the missing installer files; capture drops `last_message`; the flow-rules line reference fixed.

## Tasks

Task 1: base 7bfc93e, untracked at start: none; head 1803f42, files check clean; review approved, 3 minors deferred
Task 2: base 1803f42, untracked at start: none; head 595cbca, files check clean; review: 1 fix round (4 Important addressed), 7 minors deferred
Task 3: base 595cbca, untracked at start: none; head 83976f1, files check clean; review: 1 fix round (2 Important addressed), 4 minors deferred
Task 4: base 83976f1, untracked at start: none; head b1f0975, files check clean (ignored included); review: 1 fix round (1 Critical, 2 Important, 3 decided addressed), 7 minors deferred
Task 5: base b1f0975, untracked at start: none; head c7c89b8; mockup approved after 3 reworks
Task 5b: base c7c89b8, untracked at start: none (added by the user's decision 2026-10-29); head 5bd5303, files check clean; review approved, 3 minors deferred
Task 6: base 5bd5303, untracked at start: none; head efa6b6b, files check clean; review: 1 fix round (1 Important, 3 ruled in, addressed), 8 minors deferred
Task 7: base efa6b6b, untracked at start: none; head 9d41dc2, files check clean; review: 1 fix round (1 Important, 3 ruled in, addressed), 6 minors deferred
Task 8: base 9d41dc2, untracked at start: none; head 6ecde9a, files check clean; review: 2 fix rounds (3 Important, 2 core project-root bugs, 1 re-review Important addressed), 10 minors deferred
Task 9: base 6ecde9a, untracked at start: none; head b51defa, files check clean; review: 2 fix rounds (2 Important, 7 minors ruled in, addressed), 3 minors deferred; slice checkpoint passed; follow-up 04231a0 (DMA-BUF renderer off on Linux)
Task 10: base 04231a0, untracked at start: none; head ab99d63, files check clean; review: 2 fix rounds (2 Important, 1 files deviation ruled in, 10 minors addressed), 1 minor deferred; interactive check of questions and notifications passed (user)
Task 8b: base ab99d63, untracked at start: none; head 94af2d7, files check clean; review: 1 fix round (1 Important, 5 minors ruled in, addressed)
Task 8c: base 94af2d7, untracked at start: none; head cedef5f, files check clean; review approved (7 minors fixed in 1 round), 1 minor deferred
Task 8f: base cedef5f, untracked at start: none; head 850fa13, files check clean; review approved, 7 minors deferred (user: no further Activity changes now); cold open 571-587 -> 235-242 ms, live tick 321-325 -> 2.6-2.7 ms
Task 8d: base 850fa13, untracked at start: 4 reformatted files the user left (rules.md note), result; head 937d31f, files check clean; review: 2 fix rounds (1 Important replaced by the user's top-to-bottom graph, own column and bigger nodes; 5+1 minors addressed), 1 minor deferred
Task 8g: base 937d31f, untracked at start: the same 4 files, result; head fc36af7, files check clean; review: 2 fix rounds (1 Important, 5+3 minors addressed); clicks during start-up 319/192 ms -> 2-52 ms
Task 8e: base fc36af7, untracked at start: the same 4 files, result; head d4c85a8, files check clean; review approved, 6 minors fixed in 1 round; user added F5/Ctrl+R and Build/Decisions as steps (aad1965)
Task 11: base d4c85a8, untracked at start: the same 4 files, result; head 9b4196e, files check clean; review: 2 fix rounds (2 Important decided by the user, 3+4 minors addressed); allowed prompts read Waiting until the tool ends (accepted)
Task 12: base 9b4196e, untracked at start: the same 4 files, result, docs/features/cockpit-harness/; head 66434de, files check clean; review: 2 fix rounds (1 Critical: trust narrowed to one repository, see Rulings; 2 Important, 11 minors addressed, 1 deferred)
Task 13: base 66434de, untracked at start: the same 4 files, result, docs/features/cockpit-harness/; head 13e4d43, files check clean; review: 2 fix rounds (3 Important, 7 minors addressed, 1 deferred); nothing run on Windows yet (windows-gnu check and clippy pass)

## Rulings

- 2026-10-28, setup: Task 5 keeps every existing flow.md section while converting; the controller writes flow.md only
  between tasks — both write flow.md — costs a manual merge if a line lands mid-task.
- 2026-10-28, setup: the brief clause and Global Constraints go verbatim into the build workspace's `rules.md`, which
  every implementer and reviewer prompt names first — one copy of the same text — costs a subagent that skips it.
- 2026-10-28, setup: Task 9 Step 5 runs as `claude -p --plugin-dir` — no interactive session from the controller —
  costs not seeing the live reload by eye until the slice checkpoint.
- 2026-10-28, Task 2: ts-rs 12 writes type-only `.ts` bindings, taken as the "generated `.d.ts`" since
  `--print-types` joins them into one declaration file — costs a rename there if tsc objects.
- 2026-10-28, Task 2: the copied real fixtures in `core/tests/fixtures/` are excluded from treefmt — a reformatted copy
  no longer tests the real shape — costs those fixtures staying unformatted.
- 2026-10-28, Task 3: a user entry opens a turn only when it isn't `isMeta` and its text (a string or an array's text
  blocks) doesn't start with `<` — the literal rule made real meta entries into prompts and dropped image prompts —
  costs a fix round.
- 2026-10-28, Task 4: status precedence is Done, Waiting, Working, Stale, Idle — the spec lists Waiting first and a run
  waiting on the user stays theirs to act on — costs a wait of 4 days never reading Stale.
- 2026-10-28, Task 4: `Config::parse`/`load`, `Default` on `LinkCache` and `LinkCache::bytes_read()` are implied by the
  brief, not deviations — none crosses to the views — costs three public items the plan didn't name.
- 2026-10-28, Task 4: a per-line head cap and `rebuild_project` recomputing roots first join the fix round — both made
  a session vanish, against "any Claude session's activity can be found" — costs a larger fix round; folders that match
  no root wait for Task 6, which calls `build` when a new folder appears in `~/.claude/projects`.
- 2026-10-29, Task 6: `ts-rs`, `jiff` and `serde` in the app crate are implied by the brief (`ViewInfo` derives `TS`;
  `Index` takes a `jiff::Timestamp`) — costs three dependencies the Files line didn't name.
- 2026-10-29, Task 6: the `changed` payload derives `TS`, `--print-types` prints only the bindings until Task 7 adds
  `api.d.ts`, and `AttachConsole` is a direct kernel32 extern rather than `windows-sys` — the implementer's calls —
  costs a few lines of unsafe FFI.
- 2026-10-29, Task 6: the Claude projects folder honours `$CLAUDE_CONFIG_DIR` and the config folder `$XDG_CONFIG_HOME`
  — how Claude Code and XDG already work — costs Tasks 10 and 12 and the views skill using the same rule.
- 2026-10-29, Task 6: the window stays `incognito` — views keep no browser storage between runs, in line with the app
  writing nothing — costs view state lasting one run only.
- 2026-10-29, Task 6: the Windows clippy cast, rejecting a dynamic `import()` in a view, and a poll thread that
  survives a panicking tick join the fix round — the first would fail Windows CI, the second is the letter of "only
  `import type`", the third leaves the window stale — costs a larger fix round.
- 2026-10-29, Task 7: `api.d.ts` defines `Route`, `Step` (after the bindings' `Phase` and `Gate`) and `CardOpts` (a
  string is always text) as the implementer proposed — the plan names them without shapes — costs nothing.
- 2026-10-29, Task 7: a render timeout, the design's fold row for the diff block and a note for an unknown tab join
  the fix round — a never-settling view froze the window silently — costs a larger fix round; Mermaid stays loaded
  eagerly, since lazy loading would change the plan's `index.html`.
- 2026-10-29, Task 8: the docs view is a `run-tab` titled "Docs", not the `doc` slot — the approved design shows Docs as
  a tab of the run, and the run view hosts the tabs — costs the `doc` route having no built-in view.
- 2026-10-29, Task 8: `app/shell/tokens.css` joins Task 8's files — the house stylesheet lives there since Task 7 and
  the list and activity rows need styling — costs one more shared file.
- 2026-10-29, Task 8: the implementer's calls stand (Build/Decisions selection kept per run, run tabs laid out with
  `display: contents`, the list opens on the first project, Activity reads only the selected session) — they keep
  state across redraws and avoid parsing whole transcripts — costs nothing.
- 2026-10-29, Task 8: "Calls the build made" lists flow.md's rulings only, as the approved design does — the ledger's
  rulings are the same calls worded for the log and get copied into flow.md, so merging them double-counted — costs a
  ledger ruling not yet copied being missing from the list until it is.
- 2026-10-29, Task 8: the edits to Task 4's fixture home and `core/tests/index.rs` stand — `index.rs` was named in the
  picks-and-fixed decision and the views' fixtures are dumped from that home — costs Task 4's fixtures carrying
  view-only cases.
- 2026-10-29, Task 8: each root belongs to exactly one project, its git remote's when one resolves and its folder
  name's otherwise, and projects that still share a name show a short path tail in the list — the spec folds checkouts
  "by git remote, by folder name without one", and a root listed under two projects broke that — costs the core index
  and its tests joining Task 8's fix round.
- 2026-10-29, Task 8: a project keeps a root only when that root's checkout is one of the project's own — roots then
  follow the rule sessions already follow, so a worktree of one repo inside another's `.claude/worktrees/` lands in one
  project only — costs one cached path walk per root.
- 2026-10-29, Task 8: such a worktree belongs to the repo whose folder holds it, its documents too — that is where its
  sessions already go, and giving it to its own repo would move sessions — costs a rare run listed under the wrong
  project.
- 2026-10-29, Task 9 follow-up: on Linux the app sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before the window opens,
  unless it is already set — at the slice checkpoint the window died on the user's NVIDIA card under Wayland ("Error
  71 (Protocol error)") and that variable fixed it — costs WebKitGTK's faster DMA-BUF path on every Linux machine
  (setting it to 0 brings it back).
- 2026-10-29, Task 10: a cut `questions` stays an array (only question and header kept, each question cut by
  characters, trailing entries dropped) and the capture line gains `questions_cut: true` — the brief left how to cut
  open, and a cut that left broken JSON would hide the open question from Task 11 — costs one optional field.
- 2026-10-29, Task 10: the plugin's description, its marketplace entry and the root README name the capture hooks —
  an opt-in user must know the plugin installs hooks, and descriptions stay true to the code — costs three more files
  in the task.
- 2026-10-29, Task 8d: the Build tab's task graph runs top to bottom, Task 1 at the top and the last task at the
  bottom, with no scrollbar of its own (the user's ask once the plan grew to 20 tasks; it replaces the approved
  mockup's left-to-right graph). It has its own full-height column on the right, from the top of the content beside
  the "now" block and the task card, and shrinks only when taller than the window (the user's pick, since Mermaid's
  row gap is fixed and this plan is 15 rows deep) — costs smaller circles on long plans (about 80% at 930 px high).
  Later the same day the user asked for it bigger: it never shrinks below 0.85, and past that the page scrolls.
- 2026-10-29, Task 8g: the selected task's ring is drawn onto the finished graph, not into its source — one drawing
  then serves every task, so it can be drawn ahead and a click moves the ring at once — costs a small step after
  drawing.
- 2026-10-29, Task 11: a permission wait also clears when its transcript (the session's, or the subagent's) was
  written after the wait began — only AskUserQuestion's tool events are captured, so after an answered permission
  prompt the next captured event may be the turn's end — costs one time comparison per wait. Built with a 2 s grace
  (Claude Code finishes the entry that raised the prompt about 37 ms after the hook), so an allowed tool that ends
  within 2 s with nothing more written stays Waiting until the turn ends.
- 2026-10-29, Task 11: the implementer's calls stand: session start and end clear every wait; a permission wait clears
  only on its own agent's events; a notification never clears a wait; `live` takes the transcripts' write times and
  `Waiting` is a tagged question-or-permission value — each keeps one wait from being cleared by unrelated activity —
  costs nothing.
- 2026-10-29, Task 11 (the user's calls on the review): a wait whose session wrote nothing for 24 hours stops counting
  and the run drops to Stale, so a crashed or abandoned session can't show "Needs you" for a month; and an allowed
  permission prompt shows Waiting until its tool finishes, accepted as a known limitation, since nothing is written
  when a prompt is allowed — costs an open question left over 24 h untouched no longer counting.
- 2026-10-29, Task 11: past the 24 h, a session's Activity tab also stops saying "Waiting on you" and says the
  question or prompt was left open, with its date — the user's rule is that such a wait no longer needs them — costs
  one wording branch.
- 2026-10-29, Task 12: a repository's extensions live in `<checkout>/.flow-cockpit/extensions/<name>/`, the shape the
  user picked for extensions (the spec's `.flow-cockpit/views/` predates that), and apply only on that project's
  pages, after the defaults and the user's own; `disabled` covers them; trust by any checkout's path, the main
  checkout's folder winning — a repository's code should only touch its own project — costs a view set per project.
- 2026-10-29, Task 12: trust narrowed after review: a trusted path trusts one repository, that checkout and the
  worktrees git links to it both ways, and only those load; other folders the cockpit groups into the same project
  (same folder name or same remote) never do — the grouping let trusting one folder run an unrelated folder's code —
  costs a git-link check per checkout. Taking trust away from a shown repository view reloads the window, keeping the
  page, since its code can't be stopped otherwise.
- 2026-10-29, Task 12: editing a repository view that has loaded reloads the whole window — the runtime can't tell an
  edit from another checkout taking over the view without a binding change — costs every view's state on such an edit.
- 2026-10-29, Task 13: on Windows the app gets its own folder, `%USERPROFILE%\.claude\bin\flow-cockpit\`, with its
  default extensions beside the exe, replaced whole on update — `.claude\bin` is shared, and a loose `extensions\`
  there would be a generic name — costs one folder per app.
- 2026-10-29, final review: the window may only show the app's own pages (`tauri://localhost`,
  `http(s)://tauri.localhost`), and Markdown drops image maps and cancels clicks on anything with an `href` —
  untrusted text could otherwise send the window to a remote page — costs a refused navigation logging its URL to
  stderr.
- 2026-10-29, final review: the capture hooks write only the fields the window reads (`v`, `ts`, `event`, `agent`,
  `tool_use_id`, `questions`, `questions_cut`, `permission_tool`); the spec says the capture holds only what
  transcripts lack — costs nothing; older capture files still parse.
- 2026-10-30, the user decided: elkjs (EPL-2.0), bundled inside the vendored `mermaid.min.js`, stays and is noted in
  THIRD_PARTY.md; `crates/flow-cockpit/design/`, the prototype snapshot nothing loads, is deleted.

## Deviations

### Task 3 transcript fixtures are hand-written, not trimmed real ones

The plan asked for trimmed real transcripts. Copying them into the public repo was blocked, so the implementer reads
real transcripts only for their JSON shapes and field names and writes the fixture lines with invented text.

Status: decided 2026-10-28: hand-written in the real shape

### Subagent text replies have no place in the activity model

The plan's `Text` carries no agent, so Task 3 dropped every subagent reply, final reports included; only their tool
calls showed.

Status: decided 2026-10-28: `Text` gains `agent: Option<String>`, and subagent replies land in the turn open at their
time

### Status never decays without a file change

Status was derived only when a project's files changed, so a run whose Claude session stopped stayed Working.

Status: decided 2026-10-28: `Index::refresh(now)` re-derives every status from cached facts without reading the disk;
Task 6's poll calls it each tick

### The approved mockup reads document format in the view

The page parses flow.md's Rulings, keeps each conductor's phase list and gate positions, and strips the
`minor (deferred):` tag itself, against "the document format is resolved in the core".

Status: decided 2026-10-29: a new Task 5b before Task 6 gives the core typed `Ruling`s (flow.md and build log),
`FlowDoc.phases` from the conductors' phase tables (checked against each SKILL.md), and untagged deferred items; the
mockup switches to those fields

### Two crates share one bindings folder

The core's export wiped the whole `bindings/` folder and its check failed on any file it didn't write, so the app's
`ViewInfo` would break it.

Status: decided 2026-10-29: each crate owns its files; the core writes and checks only its own, and the app's check
covers the whole folder; `core/src/bindings.rs` joins Task 6's files

### The webview writes its own data folder

Tauri always creates the webview's data folder (`~/.local/share/dev.deadmade.flow-cockpit/`, `%LOCALAPPDATA%` on
Windows), incognito or not; it can be moved, not stopped. "The app writes nothing" didn't hold.

Status: decided 2026-10-29: accepted; the rule reads "our code writes nothing; the webview engine keeps its own small
folder"

### A broken copy of a built-in view can't fall back

`view_source(id)` always returns the global copy when one exists, and the built-ins live only inside the binary, so
the window couldn't draw the built-in under a broken copy's error.

Status: decided 2026-10-29: `view_source(id, builtin: Option<bool>)`; with `true` it returns the built-in; the runtime
uses it, views don't see it; `commands.rs` and `views.rs` join Task 7's files

### Views don't know their route, and run tabs have no place

The plan's `ViewContext` had no route, so a view couldn't tell which run or doc it draws; and the approved run view
draws the whole window, tab bar included, with no place for `run-tab` views.

Status: decided 2026-10-29: `ViewContext` gains a read-only `route` and `tabs` (the loaded run-tab views); the run view
puts them in its tab bar, and a selected tab's view is drawn into the run view's `data-slot="run-tab"` element

### Loose sessions can't be opened

The spec lists loose sessions "so any Claude session's activity can be found", but no route led to a session that
belongs to no run.

Status: decided 2026-10-29: `Route` gains `{ to: 'session', project, id }`, documented in `api.d.ts`; the activity view
draws it; `runtime.js`, `api.d.ts` and `runtime.test.mjs` join Task 8's files

### Audit rows lack picks and fixed counts

The spec's list shows each audit's picks and how many were fixed; `AuditSummary` carried only open, closed or unknown.

Status: decided 2026-10-29: `AuditSummary` gains `picks: Option<u32>` and `fixed: u32` from the parsed report

### The list mixes projects, filters and runs

After using slice 1 the user asked for projects and runs to be apart, and for a switch between flow runs and loose
sessions. Task 8's list puts projects, status and conductor filters and the sort in one left rail beside the rows.

Status: decided 2026-10-29: the left rail keeps only Projects; the runs side gets a switch, Flow runs or Loose
sessions (audits stay under Flow runs), a filter bar (status, conductor, sort, search) and a table with column
headings. Built as Task 8b, after Task 10 and before Task 11.

### No way back, and a reload loses the page

The user asked for back and forward through the pages, and for a reload to keep the page. The runtime keeps the route
in memory only, so a reload opens the list and there is no history.

Status: decided 2026-10-29: the route lives in the window's address (its hash), so the mouse's back and forward side
buttons move through the pages and a reload (F5 or Ctrl+R) keeps the page; no top-bar buttons or keys. A fresh start
opens the list, and nothing is written to disk. Built as Task 8e, after the extensions (Task 8c) and lettered task ids (Task 8d).

Decided 2026-10-29, after Task 8e's first build: WebKitGTK binds no reload key on Linux, so the app binds F5 and
Ctrl+R to reload (keeping the page); Build and Decisions become back/forward steps in the address like Docs and
Activity, so a reload keeps Decisions.

### Built-in views are compiled into the app

Changing a default view needs a rebuild, a default can only be replaced, not switched off, and the views skill lives
in a Claude Code plugin although the views belong to the app. The user wants the defaults shipped like extensions that
anyone can disable, owned by the app so it runs on its own, not by a Claude Code plugin.

Status: decided 2026-10-29: the app gets its own extensions. An extension is a folder with one or more view files and
an optional `style.css`, no manifest; the folder name is its id. The defaults (list, run, docs, activity) ship with
the app (Nix: `share/flow-cockpit/extensions`; later the Windows installer's folder); the user's go in
`~/.config/flow-cockpit/extensions/`, and one with a default's name replaces it. All are loaded from disk and reloaded
live. `disabled = ["<name>"]` in `config.toml`, read live, switches one off; the window stays read-only. The Claude
Code plugin keeps only the views skill and the capture hooks. Built as Task 8c, after Task 8b.

### Tasks added during a build don't show

The Build tab lists only plan.md's tasks, and the core reads task numbers as plain numbers, so tasks added by a
decision (5b, 8b, 8c, 8d, 8e) are invisible and the task card points at the wrong task while one of them is built.

Status: decided 2026-10-29: plan.md gets each added task under its lettered number, with a line naming the decision
that added it; the core reads ids like `8b` and orders them after 8; the flows' rules say how an added task is
numbered. Built as Task 8d, before back and forward (now Task 8e).

### Activity freezes on a large running session

The user: Activity is slow or freezes. Every 2 s while a session runs it re-reads the whole transcript (34 MB for this
build's session, about 113 MB with its 88 subagents), sends every turn with every tool input to the window and redraws
all of it.

Status: decided 2026-10-29: the core reads only what was appended since the last read, outside the index lock; the
window gets the newest 20 turns with a "Show older turns" button, and a tool call's input is fetched only when its
fold opens. Measured on this session's transcript before and after. Built as Task 8f, right after the extensions' fix
round, before Tasks 8d and 8e.

### Diagrams flash when a page first opens

The user asked for the Mermaid diagrams to be drawn ahead so a page doesn't flash when it first opens. Today a diagram
shows its source text until Mermaid has drawn it, then jumps to the drawing; only a redraw of a diagram already drawn
is instant.

Status: decided 2026-10-29: the window draws diagrams ahead, in idle time: on start the task graphs and document
diagrams of the shown project's unfinished runs, and on opening a run the rest of that run's documents. A diagram not
drawn yet shows a quiet placeholder of the right size instead of its source; the source shows only when drawing fails.
Drawings are kept in memory only (nothing written to disk). Built as Task 8g, after Task 8e.

### Replaced views aren't marked

The spec says the app marks views that replace a default. The walkthrough found that the window uses the flag only for
a broken replacement: it draws the default view below that replacement's error. A replacement that works isn't marked
anywhere.

Status: decided 2026-10-30: accepted as is. A user replaces a default on purpose, by naming their folder after it, and
the views skill and `--print-paths` say what is loaded.

## Follow-ups

- **Headless browsers break on this machine** (seen 2026-10-28 in Task 5; the user asked to fix it later):
  - The Chrome that agent-browser installs (Chrome for Testing) doesn't start here: it lacks libglib on NixOS. That
    leaves hallmark's `sloplint --render` without a browser; the implementer pointed puppeteer-core at Helium by hand.
  - Headless Helium reloads any page that links the Google Fonts stylesheet ("Execution context was destroyed"),
    traced to that one `<link>`.
  - web-mcp's `browser` on the same page showed the first screenshot, then the tab was on `about:blank` after a
    scroll and `document.body` was null; likely the same cause.
- **Windows checklist:** nothing has run on Windows yet (the windows-gnu check and clippy pass). On a Windows machine:
  - the installer sets the app up;
  - the app opens;
  - a view loads in WebView2 and a Mermaid diagram draws;
  - the mouse side buttons and F5/Ctrl+R act as on Linux;
  - an update while the app is open says to close it;
  - a profile path with an apostrophe breaks the views skill's quoted `app=` line;
  - the window doesn't stay blank: the navigation guard refuses `about:blank`, in case WebView2 opens it at start.

  The full list is in the Task 13 report.

- **Activity edge cases** (Task 8f M1-M7, paused at the user's request). Start with M1: a transcript rewritten in place
  at the same or a larger size isn't re-read. On Windows that is always the case, since its file id reads 0.
- **flow.md reading:**
  - A date inside a Reopened reason counts as re-approval, so the stepper shows a reopened gate as passed.
  - Template placeholders (`now: <…>`) read as values.
  - A ledger line about security that doesn't start with "security" lands in the wrong list.
  - `old_flow_md_files_load` doesn't pin two values.
- **Gate wording in `/implement` and `/upgrade`:** "Record both as … gate lines" can lead an agent to write a phantom
  gate line.
- **Activity prompts:**
  - A prompt whose first block is a reminder vanishes from Activity.
  - "[Request interrupted by user]" entries are worth a test built from a captured shape.
- **Core tidy-ups:**
  - The encode/slug near-duplicate.
  - `Index::doc` re-implements `read_text`.
  - No negative cache for other projects' sessions.
  - Tail-scan edge cases (truncate and regrow, early stops).
  - A pending folder that rebuilds each tick.
  - A worktree git recorded through a symlink is dropped.
- **A typo in `config.toml` shows only on stderr;** the window should say so.
- **Mermaid (5.5 MB) loads eagerly** and delays the first draw.
- **Empty Notification events:** the capture still records them with no fields, and the core ignores them. Dropping
  their `hooks.json` entry is cheap.
- **List and run view details:**
  - The list shows the phase key where the run view says "Build".
  - A gone run's tab draws outside the grid.
  - Picks and fixed counts.
  - The Docs stepper drops unnamed gates.
  - `extensions/tests/fixtures` isn't excluded from treefmt.
  - A reload resets the picked task.
- **The app's three timing tests run in no CI job.** The plan kept them out on purpose, since they are flaky on shared
  runners.

## Walkthrough

Paths relative to repo root. `C` = `crates/flow-cockpit`. Tests: Rust as `file::test`, TS/JS by title
(`views.test.ts` = `C/extensions/tests/views.test.ts`, `runtime.test.mjs` = `C/app/shell/runtime.test.mjs`).

| #   | Spec goal                                                                                                | Plan task           | file:line                                                                                                                                                                                                                                                                                                 | Test                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | List: projects folded by remote/name, worktrees, hide                                                    | 4                   | C/core/src/index/projects.rs:103 (identity_of); C/core/src/index/config.rs:24 (hidden)                                                                                                                                                                                                                    | C/core/tests/index.rs::folds_checkouts_by_remote, ::hidden_project_is_left_out                                                                                                                                     |
| 2   | List: flow runs with phase, gates, open deviations, task progress                                        | 4, 8, 8b            | C/core/src/index/entries.rs:349 (progress); C/extensions/list/list.ts:93, :102                                                                                                                                                                                                                            | C/core/tests/index.rs::flow_run_reads_its_documents                                                                                                                                                                |
| 3   | List: filter, sort, search; unfinished stand out                                                         | 8, 8b               | C/extensions/list/list.ts:440 (sort), :100-103 (marks)                                                                                                                                                                                                                                                    | views.test.ts "list_filters_and_sorts"                                                                                                                                                                             |
| 4   | List: audits with scope, picks, fixed, open state                                                        | 4, Dev "Audit rows" | C/core/src/index/entries.rs:311 (audit_summary); C/extensions/list/list.ts:229                                                                                                                                                                                                                            | index.rs::finds_audits_with_picks_state; views.test.ts "audit_shows_unknown_without_picks"                                                                                                                         |
| 5   | List: loose sessions, last 7 days, own group                                                             | 4, 8b               | C/core/src/index/entries.rs:24 (LOOSE_SECS), :440                                                                                                                                                                                                                                                         | index.rs::loose_sessions_only_last_7_days; views.test.ts "list_switch_shows_counts_and_switches_the_table"                                                                                                         |
| 6   | Session linked to run (edited its flow.md)                                                               | 4                   | C/core/src/index/links.rs:106 (edited_slugs), :123                                                                                                                                                                                                                                                        | index.rs::session_links_by_editing_flow_md, ::mention_does_not_link                                                                                                                                                |
| 7   | Run: now sentence, stepper of phases and gates                                                           | 2, 5, 5b, 8         | C/core/src/doc/phases.rs:74; C/extensions/docs/docs.ts:52; C/app/shell/blocks/stepper.js:41; C/extensions/run/run.ts:402-413                                                                                                                                                                              | docs.rs::phases_follow_the_conductor; views.test.ts "run_shows_now_or_phase"; runtime.test.mjs "stepper_marks_done_current_and_gates"                                                                              |
| 8   | Run: decisions, open deviations                                                                          | 2, 8                | C/core/src/doc/flow.rs:219 (decisions), :240 (deviations); C/extensions/run/run.ts:440                                                                                                                                                                                                                    | docs.rs::decisions_read_picked, ::deviation_status_open_and_decided; views.test.ts "run_decisions_list_and_detail"                                                                                                 |
| 9   | Run: task cards (Does, state, fix rounds, findings)                                                      | 2, 5b, 8            | C/core/src/doc/plan.rs:44; C/core/src/doc/ledger.rs:141; C/extensions/run/run.ts:338                                                                                                                                                                                                                      | docs.rs::ledger_counts_fix_rounds_and_security; views.test.ts "run_task_cards_use_does_and_graph_only_when_all_depends_written"                                                                                    |
| 10  | Run: dependency graph when plan names deps                                                               | 5, 8, 8g            | C/app/shell/blocks/mermaid.js:261, :289; C/extensions/run/run.ts:255                                                                                                                                                                                                                                      | runtime.test.mjs "task_graph_is_the_plans_tasks_top_to_bottom_with_no_ring"; views.test.ts "run_graph_nodes_select_their_task"                                                                                     |
| 11  | Typed rulings, phases, deferred items in the core (Dev 5b)                                               | 5b                  | C/core/src/doc/flow.rs:288; C/core/src/doc/ledger.rs:186                                                                                                                                                                                                                                                  | docs.rs::rulings_split_into_parts, ::deferred_items_lose_their_tag                                                                                                                                                 |
| 12  | Docs through one enhancer, rest Markdown                                                                 | 8                   | C/extensions/docs/docs.ts:207                                                                                                                                                                                                                                                                             | views.test.ts "docs_enhances_known_parts"                                                                                                                                                                          |
| 13  | Mermaid blocks as diagrams, source kept on failure                                                       | 7                   | C/app/shell/blocks/markdown.js:31; C/app/shell/blocks/mermaid.js:123                                                                                                                                                                                                                                      | runtime.test.mjs "mermaid_fences_become_diagram_nodes", "mermaid_failure_keeps_the_source_with_the_reason"                                                                                                         |
| 14  | Diagrams drawn ahead, placeholder not source (Dev 8g)                                                    | 8g                  | C/app/shell/blocks/mermaid.js:158 (ahead); C/app/shell/runtime.js:626                                                                                                                                                                                                                                     | runtime.test.mjs "a_diagram_not_drawn_yet_shows_a_quiet_placeholder", "opening_a_run_draws_the_rest_of_its_documents_ahead"                                                                                        |
| 15  | Activity: tool calls with input (edits as diffs), replies, subagents                                     | 3, 8                | C/core/src/activity/mod.rs:139 (detail); C/extensions/activity/activity.ts:74, :80                                                                                                                                                                                                                        | activity.rs::edit_detail_has_old_and_new, ::subagent_tools_carry_agent, ::subagent_replies_carry_agent; views.test.ts "activity_groups_turns_newest_first"                                                         |
| 16  | Activity: questions and permission prompts; raw conversation on click                                    | 3, 11               | C/core/src/activity/mod.rs:92 (Waiting); C/extensions/activity/activity.ts:185                                                                                                                                                                                                                            | views.test.ts "activity_says_what_the_session_waits_for"                                                                                                                                                           |
| 17  | Activity fast on big session: incremental read, 20-turn pages, input on fold (Dev 8f)                    | 8f                  | C/core/src/activity/transcript.rs:73-101, :216 (page), :221 (tool_input); C/extensions/activity/activity.ts:218                                                                                                                                                                                           | activity.rs::incremental_read_equals_full_read, ::turns_leave_tool_input_out_and_fetch_it_by_id; views.test.ts "activity_draws_the_newest_20_turns_and_loads_older_ones_on_click"                                  |
| 18  | Loose sessions can be opened (Dev: session route)                                                        | 8                   | C/app/shell/api.d.ts (Route `session`); C/extensions/activity/activity.ts:164                                                                                                                                                                                                                             | runtime.test.mjs "session_route_draws_the_session_view_not_the_run_view"                                                                                                                                           |
| 19  | Templates carry now:, Gates, Picked/Status, Does/Depends, Picks/Fixed, numbered gate lines, diagram line | 1                   | plugins/flows/skills/feature-flow/references/flow-template.md:14; plugins/flows/references/flow-rules.md:18,22,231; plugins/flows/skills/feature-flow/SKILL.md:110; plugins/flows/skills/implement/SKILL.md:44,52; plugins/flows/skills/fix-flow/SKILL.md:49; plugins/flows/skills/upgrade/SKILL.md:39,41 | scripts/flows-uses.test.mjs "checkTemplates on the real repo returns []"                                                                                                                                           |
| 20  | check-repo fails when a part goes missing                                                                | 1                   | scripts/flows-uses.mjs:130; scripts/check-repo.mjs:68                                                                                                                                                                                                                                                     | scripts/flows-uses.test.mjs (checkTemplates fixture tests, from :194)                                                                                                                                              |
| 21  | Parsers load real templates and older flow.md files                                                      | 2                   | C/core/src/doc/flow.rs:83                                                                                                                                                                                                                                                                                 | docs.rs::templates_parse_with_every_part, ::old_flow_md_files_load, ::parses_every_flow_md_in_repo                                                                                                                 |
| 22  | `Waiting for you` at every stop (review 2)                                                               | 1                   | plugins/flows/references/flow-rules.md:18; C/core/src/index/status.rs:46                                                                                                                                                                                                                                  | scripts/flows-uses.test.mjs real-repo test; status.rs::status_rules                                                                                                                                                |
| 23  | Added tasks by lettered id (Dev 8d)                                                                      | 8d                  | C/core/src/doc/mod.rs:112 (parse_prefix); C/core/src/doc/plan.rs:60                                                                                                                                                                                                                                       | docs.rs::plan_reads_lettered_tasks_in_order, ::this_repos_plan_has_its_added_tasks; index.rs::lettered_task_is_counted_and_building                                                                                |
| 24  | Views are TS files in watched folders, hot reload, types stripped                                        | 6, 7, 8c            | C/app/src/views.rs:261, :323; C/app/src/poll.rs:388; C/app/src/strip.rs:22                                                                                                                                                                                                                                | views.rs::defaults_load_from_disk_and_follow_edits; poll.rs::extension_folder_changes_emit_views_changed; runtime.test.mjs "reload_replaces_view_on_change"; views.test.ts "views_import_types_only"               |
| 25  | Built-ins are extensions: replace by name, `disabled` in config (Dev 8c)                                 | 8c                  | C/app/src/views.rs:261, :129; C/core/src/index/config.rs:25                                                                                                                                                                                                                                               | views.rs::user_extension_replaces_a_default_by_name, ::disabled_removes_an_extensions_views; poll.rs::config_change_rereads_disabled_and_hidden                                                                    |
| 26  | `--print-types`, `--print-paths`                                                                         | 6, 9                | C/app/src/main.rs:52-53, :191                                                                                                                                                                                                                                                                             | main.rs::print_types_holds_every_binding_without_imports, ::print_paths_names_each_folder                                                                                                                          |
| 27  | Views skill teaches Claude to write/change views                                                         | 9                   | plugins/opt-in/flow-cockpit/skills/views/SKILL.md:2                                                                                                                                                                                                                                                       | none                                                                                                                                                                                                               |
| 28  | Shared blocks: sanitised Markdown, diff, stepper, card                                                   | 7                   | C/app/shell/blocks/markdown.js:11, :15; blocks/diff.js:94; blocks/card.js:4                                                                                                                                                                                                                               | runtime.test.mjs "markdown_strips_script_and_handlers", "diff_marks_lines_and_folds_unchanged_runs", "card_string_body_is_text"                                                                                    |
| 29  | Back/forward, reload keeps page, F5/Ctrl+R (Dev 8e)                                                      | 8e                  | C/app/shell/runtime.js:702, :710, :733-737, :744                                                                                                                                                                                                                                                          | runtime.test.mjs "navigate_writes_the_hash_and_one_history_entry", "f5_and_ctrl_r_reload_the_window_once_from_anywhere", "a_reload_on_decisions_opens_decisions"                                                   |
| 30  | ViewContext route and tabs; broken built-in falls back (Dev)                                             | 7, 8                | C/app/src/commands.rs:184 (view_source builtin); C/app/shell/runtime.js                                                                                                                                                                                                                                   | runtime.test.mjs "views_get_their_route_tabs_and_blocks_through_ctx", "broken_view_falls_back"                                                                                                                     |
| 31  | Linux: Nix package with default extensions                                                               | 9                   | flake.nix:118, :129-148                                                                                                                                                                                                                                                                                   | installer/core/binaries.test.ts "the flake has the flow-cockpit package the linux hint runs"                                                                                                                       |
| 32  | Windows x64 release, installer step, pinned Linux hint                                                   | 13                  | installer/core/binaries.ts:57-64; installer/install.ts:256; .github/workflows/build-flow-cockpit.yml                                                                                                                                                                                                      | binaries.test.ts "binAsset gives the Windows zip for flow-cockpit", "flow-cockpit has a pinned linux hint"; options.test.ts "flow-cockpit is offered on win32 and linux"                                           |
| 33  | Status Done/Waiting/Working(2 min)/Stale(3 d)/Idle, re-derived without file change (Dev)                 | 4, 6                | C/core/src/index/status.rs:38; C/core/src/index/mod.rs:132                                                                                                                                                                                                                                                | status.rs::status_rules; index.rs::refresh_moves_statuses_and_cutoffs_with_the_clock                                                                                                                               |
| 34  | Waiting from capture (open question, permission prompt); without capture only now:                       | 10, 11              | C/core/src/activity/capture.rs:212                                                                                                                                                                                                                                                                        | activity.rs::open_question_waits, ::answered_question_clears, ::any_later_event_clears_permission; index.rs::status_waiting_from_capture; poll.rs::question_in_a_linked_session_makes_its_run_wait_within_one_tick |
| 35  | Capture hooks: one JSON line per event, user-only perms, only what transcripts lack                      | 10                  | plugins/opt-in/flow-cockpit/hooks/lib.mjs:8-15, :108-117; hooks/hooks.json:4-42                                                                                                                                                                                                                           | hooks/lib.test.mjs "main writes one line per event to <session>.jsonl, files 0600, and prints nothing", "toLine maps PreToolUse AskUserQuestion with tool_use_id"                                                  |
| 36  | PermissionRequest observed only, hooks print nothing                                                     | 10                  | plugins/opt-in/flow-cockpit/hooks/lib.mjs:81                                                                                                                                                                                                                                                              | hooks/lib.test.mjs "a PermissionRequest prints nothing", "toLine maps PermissionRequest without deciding"                                                                                                          |
| 37  | Per-repository views only for trusted repos                                                              | 12                  | C/app/src/views.rs:221; C/app/src/trust.rs:39-61                                                                                                                                                                                                                                                          | views.rs::trusted_repo_view_replaces_global; poll.rs::untrusted_repo_views_ignored, ::a_copied_origin_never_loads; trust.rs::a_trusted_checkout_or_its_worktree_trusts_both                                        |
| 38  | Strict CSP, untrusted text sanitised, read-only                                                          | 6, 7                | C/app/tauri.conf.json:20; C/app/shell/blocks/markdown.js:15                                                                                                                                                                                                                                               | runtime.test.mjs "markdown_strips_script_and_handlers"; main.rs::navigation_stays_on_the_apps_own_origin                                                                                                           |
| 39  | Two crates share bindings; each owns its files (Dev)                                                     | 6                   | C/app/src/bindings.rs:68; C/core/src/bindings.rs                                                                                                                                                                                                                                                          | C/app/src/bindings.rs::bindings_are_current                                                                                                                                                                        |
| 40  | Webview data folder accepted (Dev)                                                                       | 6                   | CLAUDE.md:114 (wording only)                                                                                                                                                                                                                                                                              | none (doc decision)                                                                                                                                                                                                |

Mismatches (head be44ffd):

- `flow-cockpit --print-view <id>` (spec part 3, review 1) doesn't exist: the deviation "Built-in views are compiled
  into the app" replaced it with on-disk default extensions, but spec.md still describes the old shape.
- "The app marks replaced views" (spec part 3): `ViewInfo.replaced` is computed but the window uses it only for a
  broken replacement's error card; a working replacement isn't marked. Goes to the user at /verify.
- The views skill (row 27) and the hooks' `async: true` have no test; row 40 is a wording decision.
- Code beyond the spec's words, each covered by a ruling or a user decision: the navigation guard and Markdown's
  image-map stripping, the 24 h rule and the permission-wait flush, the transcript cache cap, the poll's panic guard,
  the DMA-BUF switch, the Mermaid per-draw deadline.

## Run verdict
