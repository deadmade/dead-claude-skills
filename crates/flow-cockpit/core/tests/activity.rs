use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use flow_cockpit_core::activity::{
    Activity, CaptureCache, CaptureEvent, PAGE, SessionLive, ToolCall, ToolDetail, TranscriptCache,
    Waiting, live, read_capture,
};
use jiff::Timestamp;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcripts")
        .join(name)
}

/// Every turn of the transcript, read by a fresh cache.
fn full(path: &Path) -> Activity {
    TranscriptCache::default().page(path, None, usize::MAX)
}

fn session() -> Activity {
    full(&fixture("session.jsonl"))
}

fn input(id: &str) -> Option<ToolDetail> {
    TranscriptCache::default().tool_input(&fixture("session.jsonl"), id)
}

/// A folder of its own in the temp dir, removed when dropped (also on a failed assert).
struct Temp(PathBuf);

impl Temp {
    fn new(tag: &str) -> Temp {
        let dir = std::env::temp_dir().join(format!(
            "flow-cockpit-activity-{}-{tag}",
            std::process::id()
        ));
        fs::remove_dir_all(&dir).ok();
        fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).ok();
    }
}

fn append(path: &Path, bytes: &[u8]) {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .unwrap()
        .write_all(bytes)
        .unwrap();
}

/// An invented prompt and its reply, as the two lines a transcript holds for them.
fn exchange(n: usize) -> String {
    let at = format!("2026-02-01T10:{:02}:{:02}.000Z", n / 60, n % 60);
    format!(
        "{{\"type\":\"user\",\"timestamp\":\"{at}\",\"message\":{{\"role\":\"user\",\"content\":\"Prompt {n}\"}}}}\n\
         {{\"type\":\"assistant\",\"timestamp\":\"{at}\",\"message\":{{\"content\":[{{\"type\":\"text\",\"text\":\"Reply {n}\"}}]}}}}\n"
    )
}

fn prompts(a: &Activity) -> Vec<String> {
    a.turns
        .iter()
        .map(|t| {
            t.prompt
                .as_ref()
                .map(|p| p.text.clone())
                .unwrap_or_default()
        })
        .collect()
}

fn tool<'a>(a: &'a Activity, id: &str) -> &'a ToolCall {
    a.turns
        .iter()
        .flat_map(|t| &t.tools)
        .find(|t| t.id == id)
        .unwrap_or_else(|| panic!("no tool call {id}"))
}

#[test]
fn ignores_partial_last_line() {
    let a = full(&fixture("partial.jsonl"));
    assert_eq!(a.turns.len(), 1);
    assert_eq!(a.turns[0].replies.len(), 1);
    assert_eq!(a.turns[0].tools.len(), 0);
}

#[test]
fn missing_file_reads_as_empty() {
    let a = full(&fixture("nope.jsonl"));
    assert!(a.turns.is_empty() && a.agents.is_empty());
}

#[test]
fn skips_unknown_entries() {
    let a = session();
    assert_eq!(a.turns.len(), 3);
    assert_eq!(a.live.waiting, None);
}

#[test]
fn turns_group_by_prompt() {
    let a = session();
    let first = &a.turns[0];
    assert_eq!(
        first.prompt.as_ref().map(|p| p.text.as_str()),
        Some("Add a retry to the fetch helper.")
    );
    assert_eq!(first.replies.len(), 2);
    assert_eq!(first.replies[0].text, "I'll look at the helper first.");
    assert_eq!(a.turns[1].replies[0].text, "Running them.");
    assert_eq!(a.turns[1].tools.len(), 2);
}

#[test]
fn reminders_do_not_open_turns() {
    let a = session();
    assert!(
        a.turns
            .iter()
            .all(|t| { t.prompt.as_ref().is_none_or(|p| !p.text.starts_with('<')) })
    );
}

#[test]
fn thinking_blocks_are_skipped() {
    let a = session();
    assert!(
        a.turns
            .iter()
            .flat_map(|t| &t.replies)
            .all(|r| !r.text.is_empty())
    );
    assert_eq!(a.turns[0].replies.len(), 2);
}

#[test]
fn tool_results_mark_failures() {
    let a = session();
    assert!(!tool(&a, "toolu_edit1").failed);
    assert!(tool(&a, "toolu_bash1").failed);
    assert!(!tool(&a, "toolu_other1").failed);
    assert!(tool(&a, "toolu_sub2").failed);
}

#[test]
fn subagent_tools_carry_agent() {
    let a = session();
    assert_eq!(
        tool(&a, "toolu_sub1").agent.as_deref(),
        Some("a1b2c3d4e5f60718")
    );
    assert_eq!(tool(&a, "toolu_bash1").agent, None);
    // The subagent ran during the first turn.
    assert!(a.turns[0].tools.iter().any(|t| t.id == "toolu_sub1"));
    let info = &a.agents[0];
    assert_eq!(info.id, "a1b2c3d4e5f60718");
    assert_eq!(info.description.as_deref(), Some("Check the callers"));
    assert_eq!(info.kind.as_deref(), Some("general-purpose"));
    assert_eq!(info.model.as_deref(), Some("sonnet"));
    assert_eq!(info.started.as_deref(), Some("2026-01-05T10:00:12.000Z"));
    assert_eq!(info.ended.as_deref(), Some("2026-01-05T10:00:18.000Z"));
}

#[test]
fn meta_entries_do_not_open_turns() {
    let a = session();
    assert!(a.turns.iter().all(|t| {
        t.prompt
            .as_ref()
            .is_none_or(|p| !p.text.starts_with("Invented injected"))
    }));
}

#[test]
fn array_prompts_open_turns() {
    let a = session();
    assert_eq!(
        a.turns[2].prompt.as_ref().map(|p| p.text.as_str()),
        Some("Also look at this screenshot.")
    );
}

#[test]
fn subagent_replies_carry_agent() {
    let a = session();
    let reply = a.turns[0]
        .replies
        .iter()
        .find(|r| r.text == "Only fetch.js calls it.")
        .expect("subagent reply in the first turn");
    assert_eq!(reply.agent.as_deref(), Some("a1b2c3d4e5f60718"));
    assert_eq!(a.turns[0].replies[0].agent, None);
}

#[test]
fn edit_detail_has_old_and_new() {
    let a = session();
    let edit = tool(&a, "toolu_edit1");
    assert_eq!(edit.tool, "Edit");
    assert_eq!(edit.summary, "/home/user/proj/src/fetch.js");
    assert_eq!(
        input("toolu_edit1"),
        Some(ToolDetail::Edit {
            file: "/home/user/proj/src/fetch.js".into(),
            old: "return get(url);".into(),
            new: "return retry(() => get(url));".into(),
        })
    );
}

#[test]
fn other_tool_details() {
    let a = session();
    assert_eq!(
        input("toolu_bash1"),
        Some(ToolDetail::Command {
            command: "node --test src/".into(),
            description: Some("Run the unit tests".into()),
        })
    );
    assert_eq!(tool(&a, "toolu_bash1").summary, "Run the unit tests");
    assert!(matches!(
        input("toolu_write1"),
        Some(ToolDetail::Write { file, content }) if file == "/home/user/proj/notes.txt" && content == "invented notes\n"
    ));
    assert!(
        matches!(input("toolu_other1"), Some(ToolDetail::Other { json }) if json.contains("retry"))
    );
}

/// Turns carry each call's name, summary and id; its input comes one call at a time.
#[test]
fn turns_leave_tool_input_out_and_fetch_it_by_id() {
    let json = serde_json::to_string(&session()).unwrap();
    assert!(
        !json.contains("return get(url);"),
        "an edit's text is in the turns"
    );
    assert!(!json.contains("\"detail\""));
    // A subagent's call is found in its own transcript.
    assert!(matches!(
        input("toolu_sub1"),
        Some(ToolDetail::Command { .. })
    ));
    assert_eq!(input("toolu_nope"), None);
    let missing = TranscriptCache::default().tool_input(&fixture("nope.jsonl"), "toolu_edit1");
    assert_eq!(missing, None);
}

/// The fixture written in pieces, each read by the same cache: lines cut in two, the main transcript and the
/// subagent's growing in turn. The end equals a fresh full read, and each byte was read about once.
#[test]
fn incremental_read_equals_full_read() {
    let t = Temp::new("incremental");
    let main = t.0.join("s.jsonl");
    let subs = t.0.join("s/subagents");
    fs::create_dir_all(&subs).unwrap();
    let agent = "agent-a1b2c3d4e5f60718";
    let source_sub = fixture("session/subagents").join(format!("{agent}.jsonl"));
    fs::copy(
        source_sub.with_extension("meta.json"),
        subs.join(format!("{agent}.meta.json")),
    )
    .unwrap();
    let main_bytes = fs::read(fixture("session.jsonl")).unwrap();
    let sub_bytes = fs::read(&source_sub).unwrap();
    let mut cache = TranscriptCache::default();
    let mut reads = 0;
    // 997 and 331 bytes: pieces end inside lines.
    let (mut main_pieces, mut sub_pieces) = (main_bytes.chunks(997), sub_bytes.chunks(331));
    loop {
        let (to_main, to_sub) = (main_pieces.next(), sub_pieces.next());
        if to_main.is_none() && to_sub.is_none() {
            break;
        }
        if let Some(piece) = to_main {
            append(&main, piece);
        }
        if let Some(piece) = to_sub {
            append(&subs.join(format!("{agent}.jsonl")), piece);
        }
        cache.page(&main, None, usize::MAX);
        reads += 1;
    }
    assert!(reads > 5, "the fixture is read in enough pieces");
    assert_eq!(cache.page(&main, None, usize::MAX), full(&main));
    assert_eq!(full(&main), session(), "the copy reads as the fixture");
    assert_eq!(cache.tool_input(&main, "toolu_edit1"), input("toolu_edit1"));
    let size = (main_bytes.len() + sub_bytes.len()) as u64;
    assert!(
        cache.bytes_read() < size * 3 / 2,
        "read {} bytes of {size}: grown files are read again from the start",
        cache.bytes_read()
    );
}

/// A file that shrank, or was replaced by another, is read again from its start.
#[test]
fn shrunk_or_replaced_file_reads_again() {
    let t = Temp::new("replaced");
    let main = t.0.join("s.jsonl");
    fs::write(&main, exchange(1) + &exchange(2)).unwrap();
    let mut cache = TranscriptCache::default();
    assert_eq!(
        prompts(&cache.page(&main, None, PAGE)),
        ["Prompt 1", "Prompt 2"]
    );
    fs::write(&main, exchange(3)).unwrap();
    assert_eq!(prompts(&cache.page(&main, None, PAGE)), ["Prompt 3"]);
    // A new file moved over the old one, longer than what was read: not an append. Only the file's id tells.
    #[cfg(unix)]
    {
        let next = t.0.join("next.jsonl");
        fs::write(&next, exchange(4) + &exchange(5) + &exchange(6)).unwrap();
        fs::rename(&next, &main).unwrap();
        assert_eq!(
            prompts(&cache.page(&main, None, PAGE)),
            ["Prompt 4", "Prompt 5", "Prompt 6"]
        );
    }
}

/// The newest `limit` turns before a turn index; indexes count from the oldest turn, so a new turn moves none.
#[test]
fn pages_count_from_the_oldest_turn() {
    let t = Temp::new("pages");
    let main = t.0.join("s.jsonl");
    fs::write(&main, (0..45).map(exchange).collect::<String>()).unwrap();
    let mut cache = TranscriptCache::default();
    let newest = cache.page(&main, None, PAGE);
    assert_eq!(
        (newest.start, newest.total, newest.turns.len()),
        (25, 45, 20)
    );
    assert_eq!(prompts(&newest)[0], "Prompt 25");
    assert_eq!(prompts(&newest)[19], "Prompt 44");
    assert_eq!(newest.turns[19].replies[0].text, "Reply 44");
    let older = cache.page(&main, Some(25), PAGE);
    assert_eq!((older.start, older.total, older.turns.len()), (5, 45, 20));
    assert_eq!(prompts(&older)[0], "Prompt 5");
    let oldest = cache.page(&main, Some(5), PAGE);
    assert_eq!((oldest.start, oldest.turns.len()), (0, 5));
    assert_eq!(
        cache.page(&main, Some(100), PAGE).start,
        25,
        "before past the end is the end"
    );

    append(&main, exchange(45).as_bytes());
    let newest = cache.page(&main, None, PAGE);
    assert_eq!((newest.start, newest.total), (26, 46));
    assert_eq!(prompts(&newest)[19], "Prompt 45");
    assert_eq!(prompts(&cache.page(&main, Some(25), PAGE))[0], "Prompt 5");
}

// Capture: what the session waits for, from the hooks' capture file. Every text here is invented.

fn capture_fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/capture")
        .join(name)
}

fn capture(name: &str) -> Vec<CaptureEvent> {
    read_capture(&capture_fixture(name))
}

/// What the events wait for, with no transcript written since.
fn waiting(events: &[CaptureEvent]) -> Option<Waiting> {
    live(events, |_| None).waiting
}

/// One capture line of the hook's shape at 09:00:`sec`, with `extra` fields (each starting with a comma).
fn line(sec: u32, event: &str, extra: &str) -> String {
    format!(
        "{{\"v\":1,\"ts\":\"2026-03-02T09:00:{sec:02}.000Z\",\"session\":\"s-q\",\"cwd\":\"/work/alpha\",\"event\":\"{event}\"{extra}}}\n"
    )
}

/// The fixture's lines followed by `more`, read back from a file in `t`.
fn with(t: &Temp, fixture: &str, more: &[String]) -> Vec<CaptureEvent> {
    let path = t.0.join("capture.jsonl");
    let text = fs::read_to_string(capture_fixture(fixture)).unwrap();
    fs::write(&path, text + &more.concat()).unwrap();
    read_capture(&path)
}

fn at(sec: u32) -> Timestamp {
    format!("2026-03-02T09:00:{sec:02}.000Z").parse().unwrap()
}

fn set_mtime(path: &Path, sec: u32) {
    OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(at(sec).into())
        .unwrap();
}

#[expect(
    clippy::unnecessary_wraps,
    reason = "compared with `Live::waiting` as it is"
)]
fn question(text: &str, cut: bool) -> Option<Waiting> {
    Some(Waiting::Question {
        text: text.to_string(),
        cut,
    })
}

#[expect(
    clippy::unnecessary_wraps,
    reason = "compared with `Live::waiting` as it is"
)]
fn permission(tool: &str) -> Option<Waiting> {
    Some(Waiting::Permission {
        tool: tool.to_string(),
    })
}

const COLOUR: &str = "Which colour should the save button be?";

#[test]
fn open_question_waits() {
    let events = capture("open-question.jsonl");
    assert_eq!(waiting(&events), question(COLOUR, false));
    // Claude writes the question to the transcript itself: a later transcript write leaves it open.
    assert_eq!(
        live(&events, |_| Some(at(59))).waiting,
        question(COLOUR, false)
    );
}

#[test]
fn question_text_falls_back_to_its_header_and_keeps_the_cut() {
    let t = Temp::new("capture-header");
    let events = with(
        &t,
        "permission.jsonl",
        &[line(
            9,
            "PreToolUse",
            r#","tool_use_id":"toolu_q2","questions":[{"question":"","header":"Pick a name"},{"question":"Second?"}],"questions_cut":true"#,
        )],
    );
    assert_eq!(waiting(&events), question("Pick a name", true));
}

#[test]
fn answered_question_clears() {
    let t = Temp::new("capture-answered");
    assert_eq!(waiting(&capture("answered-question.jsonl")), None);
    let failed = with(
        &t,
        "open-question.jsonl",
        &[line(
            9,
            "PostToolUseFailure",
            r#","tool_use_id":"toolu_q1""#,
        )],
    );
    assert_eq!(waiting(&failed), None, "a failed call ends the question");
    let prompted = with(
        &t,
        "open-question.jsonl",
        &[line(9, "UserPromptSubmit", "")],
    );
    assert_eq!(waiting(&prompted), None, "a new prompt ends the question");
    let other = with(
        &t,
        "open-question.jsonl",
        &[line(9, "PostToolUse", r#","tool_use_id":"toolu_other""#)],
    );
    assert_eq!(
        waiting(&other),
        question(COLOUR, false),
        "another call's result"
    );
}

#[test]
fn permission_prompt_waits() {
    assert_eq!(waiting(&capture("permission.jsonl")), permission("Bash"));
    assert_eq!(
        waiting(&capture("subagent-permission.jsonl")),
        permission("Bash")
    );
}

#[test]
fn any_later_event_clears_permission() {
    let t = Temp::new("capture-later");
    // A denial too: the next thing the session does ends the prompt.
    for later in [
        line(9, "PreToolUse", r#","tool_use_id":"toolu_n""#),
        line(9, "Stop", ""),
    ] {
        let events = with(&t, "permission.jsonl", std::slice::from_ref(&later));
        assert_eq!(waiting(&events), None, "after {later}");
    }
    let next = with(
        &t,
        "permission.jsonl",
        &[line(9, "PermissionRequest", r#","permission_tool":"Edit""#)],
    );
    assert_eq!(
        waiting(&next),
        permission("Edit"),
        "the next prompt replaces it"
    );
    let asked = with(
        &t,
        "permission.jsonl",
        &[line(
            9,
            "PreToolUse",
            r#","tool_use_id":"toolu_q3","questions":[{"question":"Keep going?"}]"#,
        )],
    );
    assert_eq!(waiting(&asked), question("Keep going?", false));
    // A notification says the prompt is up; it is not the session moving on.
    let notified = with(
        &t,
        "permission.jsonl",
        &[line(
            5,
            "Notification",
            r#","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash""#,
        )],
    );
    assert_eq!(waiting(&notified), permission("Bash"));
    // A subagent's prompt ends with that subagent's next event, not another one's.
    let other = with(
        &t,
        "subagent-permission.jsonl",
        &[line(
            9,
            "SubagentStart",
            r#","agent":"a2","agent_type":"Plan""#,
        )],
    );
    assert_eq!(waiting(&other), permission("Bash"));
    let stopped = with(
        &t,
        "subagent-permission.jsonl",
        &[line(
            9,
            "SubagentStop",
            r#","agent":"a1","agent_type":"Explore""#,
        )],
    );
    assert_eq!(waiting(&stopped), None);
}

#[test]
fn permission_wait_clears_when_its_transcript_moves_on() {
    let main = capture("permission.jsonl");
    assert_eq!(live(&main, |_| Some(at(3))).waiting, permission("Bash"));
    // Claude Code finishes writing the entry that raised the prompt a few milliseconds after the hook took its time
    // (37 ms in a real session): a write within 2 s of the prompt is that entry, not the session moving on.
    let flushed = at(4)
        .checked_add(jiff::SignedDuration::from_millis(37))
        .unwrap();
    assert_eq!(live(&main, |_| Some(flushed)).waiting, permission("Bash"));
    assert_eq!(live(&main, |_| Some(at(6))).waiting, permission("Bash"));
    assert_eq!(live(&main, |_| Some(at(7))).waiting, None);
    // A subagent's prompt goes by the subagent's own transcript.
    let sub = capture("subagent-permission.jsonl");
    let written = |a: Option<&str>| Some(if a == Some("a1") { at(3) } else { at(30) });
    assert_eq!(live(&sub, written).waiting, permission("Bash"));
    assert_eq!(live(&sub, |_| Some(at(7))).waiting, None);

    // The cache reads `<session>/subagents/agent-<id>.jsonl` next to the session's transcript.
    let t = Temp::new("capture-moves-on");
    let transcript = t.0.join("s-q.jsonl");
    let agent = t.0.join("s-q/subagents/agent-a1.jsonl");
    fs::create_dir_all(agent.parent().unwrap()).unwrap();
    fs::write(&transcript, "").unwrap();
    fs::write(&agent, "").unwrap();
    let file = t.0.join("capture.jsonl");
    fs::copy(capture_fixture("subagent-permission.jsonl"), &file).unwrap();
    set_mtime(&transcript, 30);
    set_mtime(&agent, 3);
    let mut cache = CaptureCache::default();
    assert_eq!(
        cache.live(&file, &transcript).live.waiting,
        permission("Bash")
    );
    set_mtime(&agent, 7);
    assert_eq!(cache.live(&file, &transcript).live.waiting, None);
}

#[test]
fn a_late_line_older_than_what_followed_opens_nothing() {
    let t = Temp::new("capture-order");
    // Each hook is its own process: a prompt decided at once can have its Stop written before the prompt's own line.
    let stopped_first = with(
        &t,
        "open-question.jsonl",
        &[
            line(9, "Stop", ""),
            line(8, "PermissionRequest", r#","permission_tool":"Bash""#),
        ],
    );
    assert_eq!(
        waiting(&stopped_first),
        question(COLOUR, false),
        "the prompt is older than the Stop"
    );
    let answered_first = with(
        &t,
        "permission.jsonl",
        &[
            line(9, "PostToolUse", r#","tool_use_id":"toolu_q9""#),
            line(
                8,
                "PreToolUse",
                r#","tool_use_id":"toolu_q9","questions":[{"question":"Late?"}]"#,
            ),
        ],
    );
    assert_eq!(waiting(&answered_first), None);
    // Another agent's newer event doesn't hold back this agent's prompt.
    let other = with(
        &t,
        "subagent-permission.jsonl",
        &[
            line(9, "SubagentStart", r#","agent":"a2","agent_type":"Plan""#),
            line(8, "PermissionRequest", r#","permission_tool":"Edit""#),
        ],
    );
    assert_eq!(waiting(&other), permission("Edit"));
    // Nor does a late line close a newer wait: the question's answer lands after the prompt that followed it.
    let prompt_first = with(
        &t,
        "open-question.jsonl",
        &[
            line(9, "PermissionRequest", r#","permission_tool":"Bash""#),
            line(8, "PostToolUse", r#","tool_use_id":"toolu_q1""#),
        ],
    );
    assert_eq!(waiting(&prompt_first), permission("Bash"));
    let prompted_late = with(
        &t,
        "permission.jsonl",
        &[
            line(9, "PermissionRequest", r#","permission_tool":"Edit""#),
            line(7, "UserPromptSubmit", ""),
        ],
    );
    assert_eq!(waiting(&prompted_late), permission("Edit"));
}

#[test]
fn nothing_waiting_has_no_last_write() {
    // `written` is read only for a wait that is shown: nothing else needs it.
    let t = Temp::new("capture-no-wait");
    let transcript = t.0.join("s-q.jsonl");
    fs::write(&transcript, "").unwrap();
    let file = t.0.join("capture.jsonl");
    fs::copy(capture_fixture("answered-question.jsonl"), &file).unwrap();
    assert_eq!(
        CaptureCache::default().live(&file, &transcript),
        SessionLive::default()
    );
}

#[test]
fn a_wait_quiet_for_a_day_was_left_open() {
    let t = Temp::new("capture-left-open");
    let file = t.0.join("capture.jsonl");
    fs::copy(capture_fixture("open-question.jsonl"), &file).unwrap();
    set_mtime(&file, 6);
    let session = CaptureCache::default().live(&file, &t.0.join("s-q.jsonl"));
    let later = |hours: i64| {
        at(6)
            .checked_add(jiff::SignedDuration::from_hours(hours))
            .unwrap()
    };
    let fresh = session.live_at(later(23));
    assert_eq!(fresh.waiting, question(COLOUR, false));
    assert_eq!(fresh.since.as_deref(), Some("2026-03-02T09:00:05Z"));
    assert!(!fresh.left_open);
    let old = session.live_at(later(25));
    assert_eq!(old.waiting, question(COLOUR, false));
    assert!(
        old.left_open,
        "no file of the session was written for 25 hours"
    );
}

#[test]
fn session_last_wrote_at_its_newest_file() {
    // The capture file, the session's transcript and the waiting subagent's transcript all count.
    let t = Temp::new("capture-written");
    let transcript = t.0.join("s-q.jsonl");
    let agent = t.0.join("s-q/subagents/agent-a1.jsonl");
    fs::create_dir_all(agent.parent().unwrap()).unwrap();
    fs::write(&transcript, "").unwrap();
    fs::write(&agent, "").unwrap();
    let file = t.0.join("capture.jsonl");
    fs::copy(capture_fixture("subagent-permission.jsonl"), &file).unwrap();
    set_mtime(&file, 4);
    set_mtime(&transcript, 1);
    set_mtime(&agent, 5);
    let mut cache = CaptureCache::default();
    assert_eq!(cache.live(&file, &transcript).written, Some(at(5)));
    set_mtime(&transcript, 6);
    assert_eq!(cache.live(&file, &transcript).written, Some(at(6)));
    set_mtime(&file, 7);
    assert_eq!(cache.live(&file, &transcript).written, Some(at(7)));
}

#[test]
fn stop_without_start_is_ignored() {
    let events = capture("unmatched.jsonl");
    assert_eq!(events.len(), 4);
    assert_eq!(waiting(&events), None);
}

#[test]
fn capture_skips_lines_it_does_not_know() {
    let t = Temp::new("capture-unknown");
    let events = with(
        &t,
        "permission.jsonl",
        &[
            "not json\n".to_string(),
            line(9, "Stop", "").replace("\"v\":1", "\"v\":2"),
            line(9, "Stop", "").replace("2026-03-02T09:00:09.000Z", "soon"),
        ],
    );
    assert_eq!(events.len(), 3);
    assert_eq!(waiting(&events), permission("Bash"));
}

#[test]
fn capture_ignores_partial_last_line() {
    let t = Temp::new("capture-partial");
    let file = t.0.join("capture.jsonl");
    let answer = line(9, "PostToolUse", r#","tool_use_id":"toolu_q1""#);
    let (head, rest) = answer.split_at(40);
    let asked = fs::read_to_string(capture_fixture("open-question.jsonl")).unwrap();
    fs::write(&file, asked + head).unwrap();
    assert_eq!(read_capture(&file).len(), 3);
    let transcript = t.0.join("s-q.jsonl");
    let mut cache = CaptureCache::default();
    assert_eq!(
        cache.live(&file, &transcript).live.waiting,
        question(COLOUR, false)
    );
    // The line completes: the cache reads on from where it stopped.
    append(&file, rest.as_bytes());
    assert_eq!(cache.live(&file, &transcript).live.waiting, None);
    // A file that shrank is read again from its start; a missing one waits for nothing.
    fs::copy(capture_fixture("permission.jsonl"), &file).unwrap();
    assert_eq!(
        cache.live(&file, &transcript).live.waiting,
        permission("Bash")
    );
    fs::remove_file(&file).unwrap();
    assert_eq!(cache.live(&file, &transcript).live.waiting, None);
}
