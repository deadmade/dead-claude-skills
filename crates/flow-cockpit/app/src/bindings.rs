//! The TypeScript types for the views: the core's and the app's own, all in `crates/flow-cockpit/bindings/`.
//! The core's `export_bindings` (ignored) writes the core's files, this crate's writes the core's and its own; this
//! crate's `bindings_are_current` checks the whole folder, so a file no type produces any more is caught here.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use flow_cockpit_core::activity::Activity;
use flow_cockpit_core::doc::{AuditDoc, FlowDoc, Ledger, PlanDoc};
use flow_cockpit_core::index::{DocName, Entry, FlowRun, Project};
use ts_rs::{Config, TS};

use crate::poll::Changed;
use crate::views::{Extensions, ViewInfo};

/// The app's own crossing types.
fn export_app_to(dir: &Path) -> Result<(), ts_rs::ExportError> {
    let cfg = Config::new().with_out_dir(dir);
    ViewInfo::export_all(&cfg)?;
    Extensions::export_all(&cfg)?;
    Changed::export_all(&cfg)?;
    Ok(())
}

/// The core's root types, as its `bindings.rs` lists them.
fn export_core_to(dir: &Path) -> Result<(), ts_rs::ExportError> {
    let cfg = Config::new().with_out_dir(dir);
    FlowDoc::export_all(&cfg)?;
    PlanDoc::export_all(&cfg)?;
    AuditDoc::export_all(&cfg)?;
    Ledger::export_all(&cfg)?;
    Activity::export_all(&cfg)?;
    Project::export_all(&cfg)?;
    Entry::export_all(&cfg)?;
    FlowRun::export_all(&cfg)?;
    DocName::export_all(&cfg)?;
    Ok(())
}

fn committed_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../bindings")
}

/// File name to content, line endings as LF.
fn read_dir(dir: &Path) -> io::Result<Vec<(String, String)>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let content = fs::read_to_string(entry.path())?.replace("\r\n", "\n");
        files.push((entry.file_name().to_string_lossy().into_owned(), content));
    }
    files.sort();
    Ok(files)
}

#[test]
#[ignore = "writes crates/flow-cockpit/bindings/; run: cargo test -p flow-cockpit export_bindings -- --ignored"]
fn export_bindings() {
    let dir = committed_dir();
    fs::create_dir_all(&dir).unwrap();
    export_core_to(&dir).unwrap();
    export_app_to(&dir).unwrap();
}

#[test]
fn bindings_are_current() {
    let temp =
        std::env::temp_dir().join(format!("flow-cockpit-app-bindings-{}", std::process::id()));
    fs::remove_dir_all(&temp).ok();
    fs::create_dir_all(&temp).unwrap();
    export_core_to(&temp).unwrap();
    export_app_to(&temp).unwrap();
    let generated = read_dir(&temp).unwrap();
    fs::remove_dir_all(&temp).ok();
    let committed = read_dir(&committed_dir()).expect("bindings/ is missing: run export_bindings");
    assert_eq!(
        committed, generated,
        "bindings/ is stale: cargo test -p flow-cockpit export_bindings -- --ignored, and delete the files no type produces"
    );
}
