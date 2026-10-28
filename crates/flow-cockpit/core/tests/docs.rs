use std::fs;
use std::path::{Path, PathBuf};

use flow_cockpit_core::doc::{
    DeviationStatus, FlowDoc, TaskState, parse_audit, parse_flow, parse_ledger, parse_plan,
};

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/docs")
        .join(name);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// The gate section of `text` as a one-gate flow.md.
fn gate(line: &str) -> flow_cockpit_core::doc::Gate {
    let doc = parse_flow(&format!("## Gates\n\n{line}\n"));
    assert_eq!(doc.gates.len(), 1, "{line}");
    doc.gates.into_iter().next().unwrap()
}

#[test]
fn flow_reads_now_and_numbered_gates() {
    let doc = parse_flow(&fixture("feature.flow.md"));
    assert_eq!(doc.flow.as_deref(), Some("feature"));
    assert_eq!(doc.phase.as_deref(), Some("plan"));
    assert_eq!(
        doc.now.as_deref(),
        Some("Waiting for you to approve the plan (Gate 2).")
    );
    assert_eq!(doc.title.as_deref(), Some("Dark mode: flow"));
    let gates: Vec<_> = doc
        .gates
        .iter()
        .map(|g| (g.n, g.what.as_str(), g.approved.as_deref()))
        .collect();
    assert_eq!(
        gates,
        [
            (1, "spec approved", Some("2026-10-27")),
            (2, "plan approved", None)
        ]
    );
}

#[test]
fn gate_takes_only_the_date_and_keeps_the_raw_line() {
    let g = gate("- Gate 2, plan approved: 2026-10-28, execution: subagent-driven");
    assert_eq!(g.approved.as_deref(), Some("2026-10-28"));
    assert!(g.raw.contains(", execution: subagent-driven"));
    assert!(!g.reopened);
}

#[test]
fn gate_without_date_is_open() {
    assert_eq!(gate("- Gate 1, spec approved:").approved, None);
    assert_eq!(gate("- Gate 1, spec approved: <date>").approved, None);
    assert_eq!(
        gate("- Gate 2, plan approved: <date>, execution: subagent-driven | native").approved,
        None
    );
}

#[test]
fn gate_reopened_without_reapproval_is_open() {
    let g = gate(
        "- Gate 1, spec approved: 2026-10-13. Reopened 2026-10-14: the plan review changed goal 3.",
    );
    assert!(g.reopened);
    assert_eq!(g.approved, None);
}

#[test]
fn gate_reopened_then_reapproved() {
    let g = gate(
        "- Gate 1, spec approved: 2026-10-13 (\"go\"). Reopened 2026-10-14: the plan review changed goal 3.\n  \
         Re-approved 2026-10-15 (\"approve\").",
    );
    assert!(g.reopened);
    assert_eq!(g.approved.as_deref(), Some("2026-10-15"));
}

#[test]
fn decisions_read_picked() {
    let doc = parse_flow(&fixture("feature.flow.md"));
    assert_eq!(doc.decisions.len(), 2);
    assert_eq!(doc.decisions[0].title, "Where the theme is stored");
    assert_eq!(
        doc.decisions[0].picked.as_deref(),
        Some("in the user's settings file, not the browser")
    );
    assert!(doc.decisions[0].body.contains("Local storage was rejected"));
    assert!(!doc.decisions[0].body.contains("Picked:"));
}

#[test]
fn deviation_status_open_and_decided() {
    let doc = parse_flow(&fixture("feature.flow.md"));
    assert_eq!(doc.deviations.len(), 2);
    assert_eq!(doc.deviations[0].status, DeviationStatus::Open);
    assert_eq!(
        doc.deviations[1].status,
        DeviationStatus::Decided {
            date: Some("2026-10-27".into()),
            what: "edit the new path".into()
        }
    );
    assert!(doc.deviations[1].body.contains("no longer exists"));
}

#[test]
fn old_deviation_shapes_are_unknown_not_lost() {
    // Numbered items with a bold title.
    let doc = parse_flow(&fixture("cyberpunk-theme.flow.md"));
    assert!(doc.deviations.len() >= 2);
    assert!(
        doc.deviations
            .iter()
            .all(|d| d.status == DeviationStatus::Unknown)
    );
    assert_eq!(
        doc.deviations[0].title,
        "Task 2: a mod can't switch to a custom theme"
    );
    assert!(doc.deviations[0].body.contains("Decision"));
    // `**D1 – title.**` items.
    let doc = parse_flow(&fixture("flow-pane.flow.md"));
    assert!(doc.deviations.iter().any(|d| d.title.starts_with("D1 –")));
    // Whatever the parts miss is still in the raw section.
    let section = doc
        .sections
        .iter()
        .find(|s| s.heading == "Deviations")
        .unwrap();
    assert!(section.markdown.contains("stale open runs on main"));
}

#[test]
fn missing_frontmatter_is_none() {
    let doc = parse_flow("# Old run: flow\n\n## Gates\n\n- Gate 1, spec approved: 2026-10-17\n");
    assert_eq!((doc.flow, doc.phase, doc.now), (None, None, None));
    assert_eq!(doc.title.as_deref(), Some("Old run: flow"));
    assert_eq!(doc.gates.len(), 1);
}

#[test]
fn crlf_is_read() {
    let lf = fixture("feature.flow.md");
    let crlf = lf.replace('\n', "\r\n");
    assert_eq!(parse_flow(&crlf), parse_flow(&lf));
    assert_eq!(parse_flow(&crlf).phase.as_deref(), Some("plan"));
}

#[test]
fn plan_reads_does_and_depends() {
    let doc = parse_plan(&fixture("plan.md"));
    assert_eq!(doc.title.as_deref(), Some("Dark mode Implementation Plan"));
    let tasks: Vec<_> = doc
        .tasks
        .iter()
        .map(|t| (t.n, t.title.as_str(), t.depends_on.clone()))
        .collect();
    assert_eq!(
        tasks,
        [
            (1, "The theme store", Some(vec![])),
            (2, "The settings switch", Some(vec![1])),
            (3, "Docs", Some(vec![1, 2])),
            (4, "Old-style task", None),
        ]
    );
    assert_eq!(
        doc.tasks[0].does.as_deref(),
        Some("Keeps the chosen theme so it survives a restart.")
    );
    assert_eq!(doc.tasks[3].does, None);
    assert!(doc.tasks[0].markdown.contains("Create: `theme.ts`"));
    assert!(!doc.tasks[2].markdown.contains("Self-review"));
}

#[test]
fn ledger_joins_wrapped_lines() {
    let ledger = parse_ledger(&fixture("web-mcp.ledger.md"));
    assert_eq!(
        ledger.plan.as_deref(),
        Some("docs/features/web-mcp/plan.md")
    );
    let five = ledger.tasks.iter().find(|t| t.n == 5).unwrap();
    assert!(
        five.security
            .iter()
            .any(|l| l.contains("resolves the host once, then connects"))
    );
}

#[test]
fn ledger_counts_fix_rounds_and_security() {
    let ledger = parse_ledger(&fixture("web-mcp.ledger.md"));
    let by_n = |n: u32| ledger.tasks.iter().find(|t| t.n == n).unwrap();
    assert_eq!(by_n(5).fix_rounds, 2);
    assert_eq!(by_n(5).security.len(), 1);
    assert_eq!(by_n(5).state, TaskState::Done);
    assert_eq!(by_n(5).model.as_deref(), Some("opus"));
    assert_eq!(
        by_n(5).later,
        ["minor (deferred): the redirect limit is a literal"]
    );
    assert_eq!(by_n(4).state, TaskState::Done);
    assert_eq!(by_n(4).model.as_deref(), Some("sonnet"));
    assert_eq!(by_n(4).fix_rounds, 0);
    assert_eq!(by_n(6).state, TaskState::Review);
    assert_eq!(by_n(7).state, TaskState::Waiting);
    assert_eq!(ledger.rulings.len(), 2);
    assert!(ledger.rulings.iter().any(|r| r.contains("Task 8 waits")));
}

#[test]
fn audit_reads_picks_and_fixed() {
    let audit = parse_audit(&fixture("audit.md"));
    assert_eq!(
        audit.scope.as_deref(),
        Some("branch: feat-x ← main, 12 files")
    );
    assert_eq!(audit.findings.len(), 3);
    assert_eq!(audit.findings[0].severity, "high");
    assert_eq!(audit.findings[0].location, "a.ts:10");
    assert_eq!(audit.findings[1].text, "mocks the unit under test");
    assert_eq!(audit.picks, Some(vec![1, 2]));
    assert_eq!(audit.fixed, [1]);
    assert_eq!(audit.open, Some(true));
}

#[test]
fn audit_closes_when_every_pick_is_fixed() {
    let done = parse_audit("Picks: 1, 2\n\nFixed 2026-10-28: 1\nFixed 2026-10-28: 2\n");
    assert_eq!(done.open, Some(false));
    let none = parse_audit("Picks: none\n");
    assert_eq!((none.picks, none.open), (Some(vec![]), Some(false)));
}

#[test]
fn audit_without_picks_is_unknown() {
    let audit = parse_audit(&fixture("audit-no-picks.md"));
    assert_eq!(
        audit.scope.as_deref(),
        Some("branch: feat-y ← main, 3 files")
    );
    assert_eq!(audit.findings.len(), 1);
    assert_eq!((audit.picks, audit.open), (None, None));
}

#[test]
fn parses_every_flow_md_in_repo() {
    let features = repo_root().join("docs/features");
    let mut seen = 0;
    for entry in fs::read_dir(&features).unwrap() {
        let path = entry.unwrap().path().join("flow.md");
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let doc = parse_flow(&text);
        let head: Vec<&str> = text.lines().take(12).collect();
        let framed = head.first().is_some_and(|l| l.trim() == "---");
        if framed && head.iter().skip(1).any(|l| l.starts_with("phase:")) {
            assert!(doc.phase.is_some(), "{}: phase not read", path.display());
        }
        seen += 1;
    }
    assert!(
        seen >= 7,
        "only {seen} flow.md files found under {}",
        features.display()
    );
}

#[test]
fn old_flow_md_files_load() {
    for (name, gates) in [
        ("click-to-read", 2),
        ("cyberpunk-theme", 2),
        ("language-skills", 2),
        ("web-mcp", 2),
        ("web-mcp-search", 2),
        ("flow-pane", 2),
        ("agent-browser-pr-review-fixes", 0),
    ] {
        let doc = parse_flow(&fixture(&format!("{name}.flow.md")));
        assert!(doc.phase.is_some(), "{name}: phase");
        assert_eq!(doc.gates.len(), gates, "{name}: gates");
        assert!(!doc.sections.is_empty(), "{name}: sections");
    }
    // Reopened and wrapped lines.
    let doc = parse_flow(&fixture("language-skills.flow.md"));
    assert!(doc.gates[0].reopened);
    assert_eq!(doc.gates[1].approved.as_deref(), Some("2026-10-13"));
}

/// The part of a template inside its markdown code fence.
fn template_body(path: &str) -> String {
    let text = fs::read_to_string(repo_root().join(path)).unwrap();
    let start = text.find("```markdown\n").unwrap() + "```markdown\n".len();
    let end = text.rfind("\n```").unwrap();
    text[start..end].to_string()
}

fn headings(doc: &FlowDoc) -> Vec<&str> {
    doc.sections.iter().map(|s| s.heading.as_str()).collect()
}

#[test]
fn templates_parse_with_every_part() {
    for (path, flow, gates) in [
        (
            "plugins/flows/skills/feature-flow/references/flow-template.md",
            "feature",
            2,
        ),
        (
            "plugins/flows/skills/research-flow/references/research-template.md",
            "research",
            2,
        ),
        (
            "plugins/flows/references/build-template.md",
            "implement | fix | upgrade",
            0,
        ),
    ] {
        let doc = parse_flow(&template_body(path));
        assert_eq!(doc.flow.as_deref(), Some(flow), "{path}");
        assert!(
            doc.phase.is_some() && doc.now.is_some(),
            "{path}: phase and now"
        );
        assert_eq!(doc.gates.len(), gates, "{path}: gates");
        assert!(
            doc.gates.iter().all(|g| g.approved.is_none()),
            "{path}: gates open"
        );
        let h = headings(&doc);
        for part in [
            "Request",
            "Gates",
            "Options",
            "Tasks",
            "Rulings",
            "Deviations",
            "Run verdict",
        ] {
            assert!(h.contains(&part), "{path}: no ## {part}");
        }
        assert!(doc.title.is_some(), "{path}: title");
        // Comments are stripped: the example lines in them are not gates, decisions or deviations.
        assert!(
            doc.decisions.is_empty() && doc.deviations.is_empty(),
            "{path}"
        );
    }
}

#[test]
fn filled_templates_parse_with_every_part() {
    for name in ["feature", "research", "build"] {
        let doc = parse_flow(&fixture(&format!("{name}.flow.md")));
        assert!(
            doc.flow.is_some() && doc.phase.is_some() && doc.now.is_some(),
            "{name}"
        );
        assert_eq!(doc.gates.len(), 2, "{name}");
        assert!(
            !doc.decisions.is_empty() && doc.decisions.iter().all(|d| d.picked.is_some()),
            "{name}"
        );
    }
    let research = parse_flow(&fixture("research.flow.md"));
    assert_eq!(research.gates[1].approved.as_deref(), Some("2026-10-22"));
    assert!(research.gates[1].raw.contains("execution: subagent-driven"));
    assert_eq!(
        research.deviations[0].status,
        DeviationStatus::Decided {
            date: Some("2026-10-23".into()),
            what: "use the 200-query subset".into()
        }
    );
    assert_eq!(parse_flow(&fixture("build.flow.md")).sections.len(), 6);
}

#[test]
fn no_input_panics() {
    for text in [
        "",
        "---",
        "---\n",
        "---\nphase",
        "---\nphase: x",
        "\u{feff}---\nphase: x\n---\n",
        "<!--",
        "## Gates\n- Gate 999, x: 2026-10-1",
        "## Gates\n- Gate 1,\n- Gate",
        "## Deviations\n### \nStatus:",
        "## Options\n### x\nPicked:",
        "### Task 99999999999: x\n**Depends on:** Task",
        "| 1 | |",
        "Picks: 99999999999999\nFixed : ",
        "Task : x\nTask 5-99999999999: y\n",
        "ünïcode ✓ ## Gates\n- Gate 1, é: 2026-10-13ü",
    ] {
        let _ = (
            parse_flow(text),
            parse_plan(text),
            parse_audit(text),
            parse_ledger(text),
        );
    }
}
