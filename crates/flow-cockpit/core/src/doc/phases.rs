//! The conductors' phase lists: which phases each flow.md-writing conductor has, in order, the `phase:` key each writes,
//! and the gate that follows it. Taken from each conductor's SKILL.md phase table (`phase_lists_match_skill_tables`
//! fails when one drifts). `/integrate` and the audits write no flow.md of their own and have no list.

use std::cmp::Ordering;

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Phase {
    pub key: String,
    pub name: String,
    pub state: PhaseState,
    /// The number of the gate that follows this phase, in the conductor's own list.
    pub gate_after: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub enum PhaseState {
    Done,
    Now,
    Later,
}

/// `(key, gate that follows)`, in order.
type List = &'static [(&'static str, Option<u8>)];

/// feature-flow/SKILL.md.
const FEATURE: List = &[
    ("ground", None),
    ("brainstorm", None),
    ("grill", Some(1)),
    ("plan", None),
    ("evaluate", Some(2)),
    ("execute", None),
    ("finish", None),
];
/// research-flow/SKILL.md.
const RESEARCH: List = &[
    ("ground", None),
    ("brainstorm", None),
    ("grill", Some(1)),
    ("plan", None),
    ("evaluate", Some(2)),
    ("execute", None),
    ("validate", None),
    ("finish", None),
];
/// implement/SKILL.md.
const IMPLEMENT: List = &[
    ("read", None),
    ("plan", Some(1)),
    ("execute", None),
    ("finish", None),
];
/// fix-flow/SKILL.md.
const FIX: List = &[
    ("reproduce", None),
    ("ground", None),
    ("cause", Some(1)),
    ("fix", None),
    ("finish", None),
];
/// upgrade/SKILL.md.
const UPGRADE: List = &[
    ("research", None),
    ("impact", Some(1)),
    ("bump", None),
    ("finish", None),
];

/// The list for a `flow:` value, `None` for a conductor that is not known.
fn list(flow: &str) -> Option<List> {
    match flow.trim().to_ascii_lowercase().as_str() {
        "feature" => Some(FEATURE),
        "research" => Some(RESEARCH),
        "implement" => Some(IMPLEMENT),
        "fix" => Some(FIX),
        "upgrade" => Some(UPGRADE),
        _ => None,
    }
}

/// How a phase reads on screen: the build and the closing phase are named for what they do.
fn name(key: &str) -> String {
    match key {
        "execute" => "Build".to_string(),
        "finish" => "Verify and finish".to_string(),
        _ => {
            let mut chars = key.chars();
            chars
                .next()
                .map(|c| c.to_uppercase().chain(chars).collect())
                .unwrap_or_default()
        }
    }
}

/// The phases of `flow` with their state at `phase:`; `done` passes them all. Empty when the conductor or the phase is
/// unknown or missing: nothing is guessed.
pub(crate) fn phases(flow: Option<&str>, phase: Option<&str>) -> Vec<Phase> {
    let (Some(list), Some(phase)) = (flow.and_then(list), phase) else {
        return Vec::new();
    };
    let phase = phase.trim().to_ascii_lowercase();
    let at = if phase == "done" {
        list.len()
    } else if let Some(i) = list.iter().position(|(key, _)| *key == phase) {
        i
    } else {
        return Vec::new();
    };
    list.iter()
        .enumerate()
        .map(|(i, (key, gate_after))| Phase {
            key: (*key).to_string(),
            name: name(key),
            state: match i.cmp(&at) {
                Ordering::Less => PhaseState::Done,
                Ordering::Equal => PhaseState::Now,
                Ordering::Greater => PhaseState::Later,
            },
            gate_after: *gate_after,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// The phase table of a conductor's SKILL.md: `(key, gate)` for each `| <n> <Name> | ... |` row, the gate being the
    /// number in a `**Gate**` / `**Gate <n>**` mark in the last cell (a bare `**Gate**` is gate 1).
    fn table(skill: &str) -> Vec<(String, Option<u8>)> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../plugins/flows/skills")
            .join(skill)
            .join("SKILL.md");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            .replace("\r\n", "\n");
        text.lines()
            .filter_map(|line| {
                let cells: Vec<&str> = line
                    .trim()
                    .strip_prefix('|')?
                    .strip_suffix('|')?
                    .split('|')
                    .collect();
                let (n, name) = cells.first()?.trim().split_once(' ')?;
                n.parse::<u32>().ok()?;
                let last = cells.last()?;
                let gate = last.find("**Gate").map(|at| {
                    last[at + "**Gate".len()..]
                        .trim_start()
                        .split(|c: char| !c.is_ascii_digit())
                        .next()
                        .and_then(|d| d.parse().ok())
                        .unwrap_or(1)
                });
                Some((name.trim().to_ascii_lowercase(), gate))
            })
            .collect()
    }

    #[test]
    fn phase_lists_match_skill_tables() {
        for (skill, flow) in [
            ("feature-flow", "feature"),
            ("research-flow", "research"),
            ("implement", "implement"),
            ("fix-flow", "fix"),
            ("upgrade", "upgrade"),
        ] {
            let ours: Vec<(String, Option<u8>)> = list(flow)
                .unwrap()
                .iter()
                .map(|(k, g)| ((*k).to_string(), *g))
                .collect();
            let theirs = table(skill);
            assert!(!theirs.is_empty(), "{skill}: no phase table read");
            assert_eq!(ours, theirs, "{skill}/SKILL.md phase table drifted");
        }
    }
}
