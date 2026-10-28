---
flow: feature
phase: execute
now: The flow run view mockup is approved; the build goes on with Task 6, the app shell.
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
Task 5: base b1f0975, untracked at start: none; mockup approved after 3 reworks

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

## Follow-ups

- **Headless browsers break on this machine** (seen 2026-10-28 in Task 5; the user asked to fix it later):
  - The Chrome that agent-browser installs (Chrome for Testing) doesn't start here: it lacks libglib on NixOS. That
    leaves hallmark's `sloplint --render` without a browser; the implementer pointed puppeteer-core at Helium by hand.
  - Headless Helium reloads any page that links the Google Fonts stylesheet ("Execution context was destroyed"),
    traced to that one `<link>`.
  - web-mcp's `browser` on the same page showed the first screenshot, then the tab was on `about:blank` after a
    scroll and `document.body` was null; likely the same cause.

## Walkthrough

| spec goal | plan task | file:line | test |
| --------- | --------- | --------- | ---- |

## Run verdict
