//! Writes this run's own documents as the views will get them, for the flow run view's design reference:
//! `crates/flow-cockpit/design/{flow,plan,ledger,docs}.json`, and the same JSON embedded into `run-view.html` so the
//! page opens from a file path. Run with
//! `cargo test -p flow-cockpit-core --test dump_this_run -- --ignored`.

use std::fs;
use std::path::{Path, PathBuf};

use flow_cockpit_core::doc::{DeviationStatus, parse_flow, parse_ledger, parse_plan};
use serde_json::{Value, json};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn write_json(path: &Path, value: &Value) {
    let text = serde_json::to_string_pretty(value).expect("plain data serialises") + "\n";
    fs::write(path, text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
}

/// Replaces the body of `<script type="application/json" id="<id>">` in `html`. `<` is escaped so no text in the
/// data can close the script element.
fn embed(html: &str, id: &str, value: &Value) -> String {
    let open = format!(r#"<script type="application/json" id="{id}">"#);
    let start = html
        .find(&open)
        .unwrap_or_else(|| panic!("run-view.html has no {open}"))
        + open.len();
    let end = start
        + html[start..]
            .find("</script>")
            .unwrap_or_else(|| panic!("{open} is not closed"));
    let data = serde_json::to_string(value)
        .expect("plain data serialises")
        .replace('<', "\\u003c");
    format!("{}{data}{}", &html[..start], &html[end..])
}

#[test]
#[ignore = "writes the design reference; run by hand"]
fn dump_this_run() {
    let root = repo_root();
    let run = root.join("docs/features/flow-observability");
    let design = root.join("crates/flow-cockpit/design");
    fs::create_dir_all(&design).expect("design folder");

    let flow_md = read(&run.join("flow.md"));
    let plan_md = read(&run.join("plan.md"));
    let spec_md = read(&run.join("spec.md"));

    // The run is live: a gate may be open and a decision not picked yet, but the format's parts must be read.
    let flow = parse_flow(&flow_md);
    assert!(flow.now.is_some(), "flow.md has no now:");
    assert!(!flow.gates.is_empty(), "no gate lines read");
    assert!(!flow.decisions.is_empty(), "no decisions read");
    assert!(
        flow.deviations
            .iter()
            .all(|d| d.status != DeviationStatus::Unknown),
        "a deviation has no Status:"
    );
    let plan = parse_plan(&plan_md);

    write_json(&design.join("flow.json"), &json!(flow));
    write_json(&design.join("plan.json"), &json!(plan));
    // Keyed like `DocName`, the text `Index::doc` hands a view.
    write_json(
        &design.join("docs.json"),
        &json!({ "Flow": flow_md, "Spec": spec_md, "Plan": plan_md }),
    );
    // The build log is git-ignored: without it the committed ledger.json stays as it is.
    let ledger_md = root.join(".superpowers/sdd/plan/progress.md");
    match fs::read_to_string(&ledger_md) {
        Ok(text) => write_json(&design.join("ledger.json"), &json!(parse_ledger(&text))),
        Err(e) => eprintln!("{}: {e}; ledger.json left as it is", ledger_md.display()),
    }

    let page = design.join("run-view.html");
    let mut html = read(&page);
    for name in ["flow", "plan", "ledger", "docs"] {
        let value = fs::read_to_string(design.join(format!("{name}.json")))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or(Value::Null);
        html = embed(&html, &format!("{name}-json"), &value);
    }
    fs::write(&page, html).unwrap_or_else(|e| panic!("{}: {e}", page.display()));
}
