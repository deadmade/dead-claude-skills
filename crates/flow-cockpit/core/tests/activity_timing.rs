//! How long Activity takes on a real transcript, and how much the window receives. Ignored: it needs a transcript,
//! named by `FLOW_COCKPIT_TIMING` (its `<session>/subagents/` folder next to it is read too). The test copies both
//! into a folder beside it and appends to that copy only, so the file named stays as it was. Run in release, as the
//! app is:
//!
//!     FLOW_COCKPIT_TIMING=/path/to/copy/<session>.jsonl \
//!       cargo test --release -p flow-cockpit-core --test activity_timing -- --ignored --nocapture
//!
//! It prints numbers only, never transcript text.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use flow_cockpit_core::activity::{PAGE, TranscriptCache};

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap().flatten() {
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// The transcript and its folder, copied into `<parent>/timing-<pid>/`.
fn copy(source: &Path) -> (PathBuf, PathBuf) {
    let dir = source
        .parent()
        .unwrap()
        .join(format!("timing-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let main = dir.join(source.file_name().unwrap());
    fs::copy(source, &main).unwrap();
    let folder = source.with_extension("");
    if folder.is_dir() {
        copy_dir(&folder, &main.with_extension(""));
    }
    (dir, main)
}

#[test]
#[ignore = "needs FLOW_COCKPIT_TIMING; see the file's head"]
fn activity_timing() {
    let source = PathBuf::from(std::env::var("FLOW_COCKPIT_TIMING").expect("FLOW_COCKPIT_TIMING"));
    let (dir, main) = copy(&source);

    // What the window asks for when Activity opens: the newest page.
    let mut cache = TranscriptCache::default();
    let started = Instant::now();
    let cold = cache.page(&main, None, PAGE);
    let cold_ms = started.elapsed().as_millis();
    let cold_json = serde_json::to_vec(&cold).unwrap().len();

    // The live tick: one more line, as a running session writes it, then the call the window makes on `changed`.
    let mut file = OpenOptions::new().append(true).open(&main).unwrap();
    file.write_all(
        b"{\"type\":\"assistant\",\"timestamp\":\"2099-01-01T00:00:00.000Z\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Invented timing line.\"}]}}\n",
    )
    .unwrap();
    drop(file);
    let started = Instant::now();
    let tick = cache.page(&main, None, PAGE);
    let tick_us = started.elapsed().as_micros();
    let tick_json = serde_json::to_vec(&tick).unwrap().len();

    // "Show older turns", and one fold opened.
    let started = Instant::now();
    let older = cache.page(&main, Some(tick.start), PAGE);
    let older_us = started.elapsed().as_micros();
    let older_json = serde_json::to_vec(&older).unwrap().len();
    let call = tick
        .turns
        .iter()
        .flat_map(|t| &t.tools)
        .last()
        .map(|c| c.id.clone());
    let started = Instant::now();
    let input = call.and_then(|id| cache.tool_input(&main, &id));
    let input_us = started.elapsed().as_micros();
    let input_json = serde_json::to_vec(&input).unwrap().len();

    println!(
        "turns {} of {} | cold {cold_ms} ms, {cold_json} B JSON | tick {tick_us} us, {tick_json} B JSON | \
         older page {older_us} us, {older_json} B JSON | one input {input_us} us, {input_json} B JSON",
        tick.turns.len(),
        tick.total,
    );
    fs::remove_dir_all(dir).unwrap();
}
