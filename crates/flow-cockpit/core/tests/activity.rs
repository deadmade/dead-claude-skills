use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use flow_cockpit_core::activity::{Activity, PAGE, ToolCall, ToolDetail, TranscriptCache};

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
