use std::path::{Path, PathBuf};

use flow_cockpit_core::activity::{Activity, ToolCall, ToolDetail, activity, read_transcript};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcripts")
        .join(name)
}

fn session() -> Activity {
    activity(&read_transcript(&fixture("session.jsonl")))
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
    let a = activity(&read_transcript(&fixture("partial.jsonl")));
    assert_eq!(a.turns.len(), 1);
    assert_eq!(a.turns[0].replies.len(), 1);
    assert_eq!(a.turns[0].tools.len(), 0);
}

#[test]
fn missing_file_reads_as_empty() {
    let a = activity(&read_transcript(&fixture("nope.jsonl")));
    assert!(a.turns.is_empty() && a.agents.is_empty());
}

#[test]
fn skips_unknown_entries() {
    let a = session();
    assert_eq!(a.turns.len(), 2);
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
    assert_eq!(first.replies.len(), 1);
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
    assert_eq!(a.turns[0].replies.len(), 1);
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
fn edit_detail_has_old_and_new() {
    let a = session();
    let edit = tool(&a, "toolu_edit1");
    assert_eq!(edit.tool, "Edit");
    assert_eq!(edit.summary, "/home/user/proj/src/fetch.js");
    assert_eq!(
        edit.detail,
        ToolDetail::Edit {
            file: "/home/user/proj/src/fetch.js".into(),
            old: "return get(url);".into(),
            new: "return retry(() => get(url));".into(),
        }
    );
}

#[test]
fn other_tool_details() {
    let a = session();
    assert_eq!(
        tool(&a, "toolu_bash1").detail,
        ToolDetail::Command {
            command: "node --test src/".into(),
            description: Some("Run the unit tests".into()),
        }
    );
    assert_eq!(tool(&a, "toolu_bash1").summary, "Run the unit tests");
    assert!(matches!(
        &tool(&a, "toolu_write1").detail,
        ToolDetail::Write { file, content } if file == "/home/user/proj/notes.txt" && content == "invented notes\n"
    ));
    assert!(
        matches!(&tool(&a, "toolu_other1").detail, ToolDetail::Other { json } if json.contains("retry"))
    );
}
