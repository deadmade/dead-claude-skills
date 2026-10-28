//! The TypeScript types for the views, generated from the Rust types (no `#[ts(export)]`).
//! `export_bindings` (ignored) writes them to `crates/flow-cockpit/bindings/`; `bindings_are_current`
//! fails when the committed files differ from what the types now produce.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use ts_rs::{Config, TS};

use crate::activity::Activity;
use crate::doc::{AuditDoc, FlowDoc, Ledger, PlanDoc};
use crate::index::{DocName, Entry, FlowRun, Project};

/// Every type that crosses to the views. Types reached from these (gates, findings, ...) are exported with them.
fn export_all_to(dir: &Path) -> Result<(), ts_rs::ExportError> {
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
#[ignore = "writes crates/flow-cockpit/bindings/; run: cargo test -p flow-cockpit-core export_bindings -- --ignored"]
fn export_bindings() {
    let dir = committed_dir();
    fs::remove_dir_all(&dir).ok();
    fs::create_dir_all(&dir).unwrap();
    export_all_to(&dir).unwrap();
}

#[test]
fn bindings_are_current() {
    let temp = std::env::temp_dir().join(format!("flow-cockpit-bindings-{}", std::process::id()));
    fs::remove_dir_all(&temp).ok();
    fs::create_dir_all(&temp).unwrap();
    export_all_to(&temp).unwrap();
    let generated = read_dir(&temp).unwrap();
    fs::remove_dir_all(&temp).ok();
    let committed = read_dir(&committed_dir()).expect("bindings/ is missing: run export_bindings");
    assert_eq!(
        committed, generated,
        "bindings/ is stale: cargo test -p flow-cockpit-core export_bindings -- --ignored"
    );
}
