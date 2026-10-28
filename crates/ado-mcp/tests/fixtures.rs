//! Every fixture deserializes into the crate model its route returns, so the stdio tests serve answers the crate can read.

use std::path::Path;

use azure_devops_rust_api::{build, git, ims, pipelines, policy, search, test, wiki, wit};
use serde::de::DeserializeOwned;

fn fits<T: DeserializeOwned>(body: &[u8]) -> Result<(), String> {
    serde_json::from_slice::<T>(body)
        .map(drop)
        .map_err(|e| e.to_string())
}

type Check = fn(&[u8]) -> Result<(), String>;

/// File → the model of the route it answers.
const TABLE: &[(&str, Check)] = &[
    ("builds-empty.json", fits::<build::models::BuildList>),
    ("builds-one.json", fits::<build::models::BuildList>),
    ("builds.json", fits::<build::models::BuildList>),
    (
        "definitions.json",
        fits::<build::models::BuildDefinitionReferenceList>,
    ),
    ("identities.json", fits::<ims::models::IdentityList>),
    (
        "iteration-changes-p1.json",
        fits::<git::models::GitPullRequestIterationChanges>,
    ),
    (
        "iteration-changes-p2.json",
        fits::<git::models::GitPullRequestIterationChanges>,
    ),
    (
        "iterations.json",
        fits::<git::models::GitPullRequestIterationList>,
    ),
    ("logs.json", fits::<build::models::BuildLogList>),
    ("pipeline-run.json", fits::<pipelines::models::Run>),
    (
        "policy-evaluations.json",
        fits::<policy::models::PolicyEvaluationRecordList>,
    ),
    ("pr-complete.json", fits::<git::models::GitPullRequest>),
    ("pr-list.json", fits::<git::models::GitPullRequestList>),
    (
        "pr-threads.json",
        fits::<git::models::GitPullRequestCommentThreadList>,
    ),
    ("pr-workitems.json", fits::<git::models::ResourceRefList>),
    ("pr.json", fits::<git::models::GitPullRequest>),
    ("repo.json", fits::<git::models::GitRepository>),
    ("repos.json", fits::<git::models::GitRepositoryList>),
    (
        "search-code.json",
        fits::<search::models::CodeSearchResponse>,
    ),
    (
        "search-repo-status.json",
        fits::<search::models::RepositoryStatusResponse>,
    ),
    (
        "search-wiki.json",
        fits::<search::models::WikiSearchResponse>,
    ),
    (
        "search-wi.json",
        fits::<search::models::WorkItemSearchResponse>,
    ),
    (
        "test-results.json",
        fits::<test::models::TestCaseResultList>,
    ),
    ("test-runs.json", fits::<test::models::TestRunList>),
    ("timeline.json", fits::<build::models::Timeline>),
    ("wi-batch.json", fits::<wit::models::WorkItemList>),
    ("wi.json", fits::<wit::models::WorkItem>),
    ("wiql.json", fits::<wit::models::WorkItemQueryResult>),
    ("wiki-page.json", fits::<wiki::models::WikiPage>),
    ("wiki-tree.json", fits::<wiki::models::WikiPage>),
    ("wikis-one.json", fits::<wiki::models::WikiV2List>),
    ("wikis.json", fits::<wiki::models::WikiV2List>),
];

/// Fixtures no crate model reads: the hand-written calls (`connectionData`, `/vsts/info`, `repo_file`'s items), an
/// error body, a log, which is plain text, and the comments, whose mentions lack the `url` the crate's
/// `CommentMention` (inside `CommentList`) requires.
const HAND_WRITTEN: &[&str] = &[
    "connection-data.json",
    "vsts-info.json",
    "item.json",
    "item-folder.json",
    "pr-409.json",
    "log.txt",
    "wi-comments.json",
];

#[test]
fn fixtures_fit_models() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut failures = Vec::new();
    for entry in std::fs::read_dir(&dir).unwrap() {
        let name = entry.unwrap().file_name().into_string().unwrap();
        if HAND_WRITTEN.contains(&name.as_str()) {
            continue;
        }
        let Some((_, check)) = TABLE.iter().find(|(f, _)| *f == name) else {
            failures.push(format!("{name}: not in the table"));
            continue;
        };
        if let Err(e) = check(&std::fs::read(dir.join(&name)).unwrap()) {
            failures.push(format!("{name}: {e}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
