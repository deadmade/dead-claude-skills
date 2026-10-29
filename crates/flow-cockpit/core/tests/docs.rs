use std::fs;
use std::path::{Path, PathBuf};

use flow_cockpit_core::doc::{
    DeviationStatus, FlowDoc, PhaseState, TaskState, parse_audit, parse_flow, parse_ledger,
    parse_plan,
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
        .map(|t| (t.id.as_str(), t.title.as_str(), t.depends_on.clone()))
        .collect();
    let ids = |xs: &[&str]| Some(xs.iter().map(|x| (*x).to_string()).collect::<Vec<_>>());
    assert_eq!(
        tasks,
        [
            ("1", "The theme store", ids(&[])),
            ("2", "The settings switch", ids(&["1"])),
            ("3", "Docs", ids(&["1", "2"])),
            ("4", "Old-style task", None),
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
    // Task 3's entry is wrapped under an indent; the sentence runs across the wrap.
    let three = ledger.tasks.iter().find(|t| t.id == "3").unwrap();
    assert_eq!(three.later.len(), 1);
    assert!(three.later[0].contains("Task 5 must cache PDFs too (spec Goal 3"));
}

#[test]
fn ledger_counts_fix_rounds_and_security() {
    let ledger = parse_ledger(&fixture("web-mcp.ledger.md"));
    let by_id = |id: &str| ledger.tasks.iter().find(|t| t.id == id).unwrap();
    let five = by_id("5");
    // `fix round 1/5` and `fix round 2/5` count; `fix round 1 implemented <sha>` does not.
    assert_eq!(five.fix_rounds, 2);
    assert!(
        five.story
            .iter()
            .any(|l| l.starts_with("fix round 1 implemented"))
    );
    // The two "security finding(s)" entries, and no other line.
    assert_eq!(five.security.len(), 2);
    assert!(
        five.security
            .iter()
            .all(|l| l.starts_with("security finding"))
    );
    assert_eq!(five.state, TaskState::Done);
    assert_eq!(five.model.as_deref(), Some("opus"));
    assert_eq!(five.later.len(), 6);
    assert_eq!(by_id("4").state, TaskState::Review);
    assert_eq!(by_id("4").fix_rounds, 0);
    assert!(ledger.rulings.len() >= 5);
    assert!(
        ledger
            .rulings
            .iter()
            .any(|r| r.raw.contains("`GetOpts` gains"))
    );
}

#[test]
fn review_clean_without_security_findings_is_not_a_security_entry() {
    let ledger = parse_ledger(
        "Task 2: complete (commits a..b, review clean, no security findings)\nTask 2: security note: x\n",
    );
    assert_eq!(ledger.tasks[0].security, ["security note: x"]);
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
    for (name, template) in [
        (
            "feature",
            "plugins/flows/skills/feature-flow/references/flow-template.md",
        ),
        (
            "research",
            "plugins/flows/skills/research-flow/references/research-template.md",
        ),
        ("build", "plugins/flows/references/build-template.md"),
    ] {
        let doc = parse_flow(&fixture(&format!("{name}.flow.md")));
        let template = parse_flow(&template_body(template));
        assert_eq!(headings(&doc), headings(&template), "{name}: sections");
        assert!(
            doc.flow.is_some() && doc.phase.is_some() && doc.now.is_some(),
            "{name}"
        );
        assert_eq!(doc.gates.len(), 2, "{name}: gates");
        assert!(
            !doc.decisions.is_empty() && doc.decisions.iter().all(|d| d.picked.is_some()),
            "{name}: decisions"
        );
        let statuses: Vec<_> = doc.deviations.iter().map(|d| &d.status).collect();
        assert!(
            statuses.contains(&&DeviationStatus::Open),
            "{name}: open deviation"
        );
        assert!(
            statuses
                .iter()
                .any(|s| matches!(s, DeviationStatus::Decided { date: Some(_), .. })),
            "{name}: decided deviation"
        );
        // The template comments left in the fixture are not content.
        assert!(
            doc.sections.iter().all(|s| !s.markdown.contains("<!--")),
            "{name}: comments"
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
}

#[test]
fn comment_marks_in_code_and_prose_are_text() {
    // The first line is docs/features/flow-observability/plan.md:186; a lone `<!--` must not eat the headings after it.
    let doc = parse_flow(
        "# T\n\n## Notes\n\nSplit on `## `; `<!-- -->` stripped. A lone `<!--` opens nothing.\n\n```\n<!-- in a fence -->\n```\n\n<!-- a real comment\nover two lines -->\n\n## Gates\n\n- Gate 1, spec approved: 2026-10-01\n",
    );
    assert_eq!(doc.gates.len(), 1);
    let notes = &doc.sections[0].markdown;
    assert!(notes.contains("`<!-- -->` stripped"));
    assert!(notes.contains("<!-- in a fence -->"));
    assert!(!notes.contains("a real comment"));
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
        "### Task 8é: x",
        "### Task 4294967296b: x",
        "### Task 8b",
        "### Task 8b\n**Depends on:** Task 8b2, Task é, Task 4294967296b",
        "Task 8b-8c: x\nTasks é: y\nTask 8é: z\n",
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

#[test]
fn plan_reads_lettered_tasks_in_order() {
    let doc = parse_plan(
        "# P\n\n## Tasks\n\n### Task 9: Nine\n\n### Task 8c: Eight c\n\n### Task 8: Eight\n\n\
         ### Task 8b: Eight b\n\n**Depends on:** Task 8, Task 5b\n\n### Task 10: Ten\n",
    );
    let ids: Vec<&str> = doc.tasks.iter().map(|t| t.id.as_str()).collect();
    // By number, the plain task before its lettered ones, letters in order.
    assert_eq!(ids, ["8", "8b", "8c", "9", "10"]);
    let eight_b = &doc.tasks[1];
    assert_eq!(eight_b.title, "Eight b");
    assert_eq!(
        eight_b.depends_on,
        Some(vec!["8".to_string(), "5b".to_string()])
    );
}

#[test]
fn odd_task_headings_stay_unread() {
    let doc = parse_plan(
        "## Tasks\n\n### Task 8bc: Two letters\n\n### Task 8B: Upper case\n\n### Task b8: Letter first\n\n\
         ### Task 3 transcript fixtures\n",
    );
    let read: Vec<(&str, &str)> = doc
        .tasks
        .iter()
        .map(|t| (t.id.as_str(), t.title.as_str()))
        .collect();
    assert_eq!(read, [("3", "transcript fixtures")]);
}

#[test]
fn ledger_reads_lettered_tasks() {
    let ledger = parse_ledger(
        "Task 9: dispatched (base a, implementer sonnet)\n\
         Task 8b: dispatched (base b, implementer opus)\n\
         Task 8b: fix round 1/5 (1 Important addressed)\n\
         Task 8: complete (c)\n\
         Tasks 3-5: complete (d)\n\
         Task 8c: dispatched (base e, implementer opus)\n\
         Task 9 follow-up: dispatched (base f, implementer sonnet)\n\
         Task 8bc: complete\n",
    );
    let ids: Vec<&str> = ledger.tasks.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["3", "4", "5", "8", "8b", "8c", "9"]);
    let eight_b = &ledger.tasks[4];
    assert_eq!(eight_b.state, TaskState::Review);
    assert_eq!(eight_b.fix_rounds, 1);
    assert_eq!(eight_b.model.as_deref(), Some("opus"));
    assert_eq!(ledger.tasks[5].state, TaskState::Building);
    assert_eq!(ledger.tasks[3].state, TaskState::Done);
}

#[test]
fn this_repos_plan_has_its_added_tasks() {
    let text = fs::read_to_string(repo_root().join("docs/features/flow-observability/plan.md"))
        .expect("this run's plan");
    let doc = parse_plan(&text);
    let ids: Vec<&str> = doc.tasks.iter().map(|t| t.id.as_str()).collect();
    // In id order: by number, then the plain task before its lettered ones. Later added tasks may join.
    let key = |id: &str| {
        let digits = id.trim_end_matches(|c: char| c.is_ascii_lowercase());
        (
            digits.parse::<u32>().unwrap(),
            id[digits.len()..].to_string(),
        )
    };
    assert!(
        ids.windows(2).all(|w| key(w[0]) < key(w[1])),
        "not in order: {ids:?}"
    );
    let known = [
        "1", "2", "3", "4", "5", "5b", "6", "7", "8", "8b", "8c", "8d", "8e", "8f", "8g", "9",
        "10", "11", "12", "13",
    ];
    let mut rest = ids.iter();
    assert!(
        known.iter().all(|k| rest.any(|id| id == k)),
        "the known tasks aren't all there in order: {ids:?}"
    );
    let eight_d = doc.tasks.iter().find(|t| t.id == "8d").unwrap();
    assert_eq!(eight_d.depends_on, Some(vec!["8f".to_string()]));
    // Every added task says which decision added it.
    for t in doc
        .tasks
        .iter()
        .filter(|t| t.id.ends_with(char::is_alphabetic))
    {
        assert!(
            t.markdown.contains("**Added:** ")
                && t.markdown.contains(", by the user's decision \""),
            "Task {} has no Added line",
            t.id
        );
    }
}

#[test]
fn rulings_and_notes_between_task_lines_stay_out_of_tasks() {
    let ledger = parse_ledger(
        "# SDD ledger — plan: docs/features/x/plan.md\n\n## Progress\n\
         Task 1: dispatched (base abc1234, implementer sonnet)\n\
         Task 1: implemented def5678 (the parser)\n\
         Ruling: the cache key ignores the fragment — it never reaches\n  \
         the server — costs nothing if wrong.\n\
         Note for the controller: Task 2 starts from def5678.\n\
         Task 2: dispatched (base def5678, implementer opus)\n",
    );
    assert_eq!(ledger.rulings.len(), 1);
    assert!(
        ledger.rulings[0]
            .raw
            .contains("never reaches the server — costs nothing")
    );
    let everywhere: Vec<&String> = ledger
        .tasks
        .iter()
        .flat_map(|t| t.story.iter().chain(&t.later).chain(&t.security))
        .collect();
    assert!(everywhere.iter().all(|l| !l.contains("cache key")));
    assert!(
        everywhere
            .iter()
            .all(|l| !l.contains("Note for the controller"))
    );
    assert!(ledger.rulings.iter().all(|r| !r.raw.contains("Note for")));
}

#[test]
fn rulings_split_into_parts() {
    let doc = parse_flow(
        "## Rulings\n\nCalls the build made.\n\n\
         - 2026-10-28, setup: Task 5 keeps every section while converting; the controller writes\n  \
         flow.md only between tasks — both write flow.md — costs a manual merge if a line lands mid-task.\n\
         - 2026-10-29, task 2: a plain call — because it is simple\n",
    );
    assert_eq!(doc.rulings.len(), 2);
    let first = &doc.rulings[0];
    assert_eq!(first.date.as_deref(), Some("2026-10-28"));
    assert_eq!(first.scope.as_deref(), Some("setup"));
    assert_eq!(
        first.call,
        "Task 5 keeps every section while converting; the controller writes flow.md only between tasks"
    );
    assert_eq!(first.why.as_deref(), Some("both write flow.md"));
    assert_eq!(
        first.cost.as_deref(),
        Some("a manual merge if a line lands mid-task.")
    );
    assert!(
        first.raw.starts_with("2026-10-28, setup: Task 5")
            && first.raw.contains("writes flow.md only")
    );
    let second = &doc.rulings[1];
    assert_eq!(second.why.as_deref(), Some("because it is simple"));
    assert_eq!(second.cost, None);
}

#[test]
fn ledger_rulings_are_typed() {
    let ledger = parse_ledger(
        "Task 1: dispatched (base abc1234, implementer sonnet)\n\
         Ruling: the cache key ignores the fragment — it never reaches\n  \
         the server — costs nothing if wrong.\n",
    );
    assert_eq!(ledger.rulings.len(), 1);
    let r = &ledger.rulings[0];
    assert_eq!(r.date, None);
    assert_eq!(r.scope, None);
    assert_eq!(r.call, "the cache key ignores the fragment");
    assert_eq!(r.why.as_deref(), Some("it never reaches the server"));
    assert_eq!(r.cost.as_deref(), Some("nothing if wrong."));
}

#[test]
fn unsplittable_ruling_keeps_raw() {
    let doc = parse_flow(
        "## Rulings\n\n- <date>, <scope>: <call> — <why> — costs <cost>\n- just a note, no parts\n- 2026-10-30 no comma shape\n",
    );
    assert_eq!(doc.rulings.len(), 3);
    let note = &doc.rulings[1];
    assert_eq!(note.call, "just a note, no parts");
    assert_eq!(
        (&note.date, &note.scope, &note.why, &note.cost),
        (&None, &None, &None, &None)
    );
    assert_eq!(note.raw, "just a note, no parts");
    assert_eq!(doc.rulings[2].call, "2026-10-30 no comma shape");
    assert_eq!(doc.rulings[2].date, None);
    assert_eq!(parse_flow("## Rulings\n").rulings, []);
}

fn flow_at(flow: &str, phase: &str) -> FlowDoc {
    parse_flow(&format!("---\nflow: {flow}\nphase: {phase}\n---\n\n# T\n"))
}

#[test]
fn phases_follow_the_conductor() {
    let doc = flow_at("feature", "execute");
    let keys: Vec<&str> = doc.phases.iter().map(|p| p.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            "ground",
            "brainstorm",
            "grill",
            "plan",
            "evaluate",
            "execute",
            "finish"
        ]
    );
    let states: Vec<PhaseState> = doc.phases.iter().map(|p| p.state).collect();
    assert_eq!(
        states,
        [
            PhaseState::Done,
            PhaseState::Done,
            PhaseState::Done,
            PhaseState::Done,
            PhaseState::Done,
            PhaseState::Now,
            PhaseState::Later
        ]
    );
    let gates: Vec<(&str, Option<u8>)> = doc
        .phases
        .iter()
        .filter(|p| p.gate_after.is_some())
        .map(|p| (p.key.as_str(), p.gate_after))
        .collect();
    assert_eq!(gates, [("grill", Some(1)), ("evaluate", Some(2))]);
    assert_eq!(doc.phases[5].name, "Build");
    assert_eq!(doc.phases[6].name, "Verify and finish");
    assert_eq!(doc.phases[0].name, "Ground");
    assert!(
        flow_at("feature", "done")
            .phases
            .iter()
            .all(|p| p.state == PhaseState::Done)
    );
    assert_eq!(flow_at("fix", "cause").phases[2].gate_after, Some(1));
}

#[test]
fn unknown_conductor_has_no_phases() {
    assert_eq!(flow_at("mystery", "execute").phases, []);
    assert_eq!(flow_at("feature", "not-a-phase").phases, []);
    assert_eq!(parse_flow("# no frontmatter\n").phases, []);
}

#[test]
fn deferred_items_lose_their_tag() {
    let ledger = parse_ledger(
        "Task 3: minor (deferred): Task 5 must cache PDFs too\n\
         Task 3: parked: the retry budget\n\
         Task 3: minor: a typo in the help text\n",
    );
    assert_eq!(
        ledger.tasks[0].later,
        [
            "Task 5 must cache PDFs too",
            "the retry budget",
            "a typo in the help text"
        ]
    );
}
