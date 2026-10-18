mod common;

use std::time::Duration;

use base64::Engine as _;
use common::{Fixture, Resp, ado, fixture};
use serde_json::json;

/// `repo_list project=P` asks for the project first (through the crate), then for its repos.
const ROUTE: &str = "/tfs/Coll/_apis/projects/P";
const REPOS: &str = "/tfs/Coll/p1/_apis/git/repositories";
const PAT_LINE: &str = "Azure DevOps rejected the PAT (expired or wrong); set a new one with /plugin configure mcp-azure";

fn projects() -> Resp {
    Resp::json(&json!({"id": "p1", "name": "P", "state": "wellFormed",
        "revision": 7, "visibility": "private", "lastUpdateTime": "2025-11-04T10:12:33.47Z"}))
}

/// `repo_list`'s answer to `repos.json`, sorted by name.
const REPO_LINES: &str = "Empty  default: none\nR  default: main\nTools  default: develop";

/// Calls `repo_list project=P` against `fx` (with its repos routed) and returns `(isError, text)`.
fn repo_list(fx: &Fixture) -> (bool, String) {
    fx.route(REPOS, vec![fixture("repos.json")]);
    ado(fx, &[]).call("repo_list", json!({"project": "P"}))
}

/// Requests for the project.
fn project_hits(fx: &Fixture) -> usize {
    fx.requests()
        .iter()
        .filter(|r| r.path.starts_with(ROUTE))
        .count()
}

#[test]
fn sends_auth_version_and_suppress() {
    let fx = Fixture::start();
    // `pr_list` with project and repo: the repo, then its PRs with the crate's `$top`.
    fx.route(
        "/tfs/Coll/P/_apis/git/repositories/R",
        vec![fixture("repo.json")],
    );
    let prs = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/git/repositories/3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01/pullrequests";
    fx.route(prs, vec![fixture("pr-list.json")]);
    let (err, text) = ado(&fx, &[]).call("pr_list", json!({"project": "P", "repo": "R"}));
    assert!(!err, "{text}");
    assert!(text.starts_with('!'), "{text}");
    let reqs = fx.requests();
    assert_eq!(reqs.len(), 2);
    let basic = base64::engine::general_purpose::STANDARD.encode(":test-pat");
    for r in &reqs {
        assert_eq!(
            r.header("authorization"),
            Some(format!("Basic {basic}").as_str())
        );
        assert!(
            r.path
                .split(['?', '&'])
                .any(|p| p == "api-version=7.1-preview"),
            "{}",
            r.path
        );
        assert_eq!(r.header("x-tfs-fedauthredirect"), Some("Suppress"));
        assert!(r.header("user-agent").unwrap().starts_with("ado-mcp/"));
    }
    assert!(reqs[1].path.starts_with(prs), "{}", reqs[1].path);
    assert!(reqs[1].path.contains("top=21"), "{}", reqs[1].path);
}

#[test]
fn maps_401_without_secret() {
    let fx = Fixture::start();
    fx.route(
        ROUTE,
        vec![Resp::new(401, "text/plain", "Basic OnRlc3QtcGF0")],
    );
    let (err, text) = repo_list(&fx);
    assert!(err);
    assert_eq!(text, PAT_LINE);
    assert!(!text.contains("test-pat"));
    assert_eq!(fx.requests().len(), 1, "a 401 must not be retried");
}

#[test]
fn html_203_is_one_line() {
    let fx = Fixture::start();
    fx.route(
        ROUTE,
        vec![Resp::new(
            203,
            "text/html",
            "<html><body>Sign in</body></html>",
        )],
    );
    let (err, text) = repo_list(&fx);
    assert!(err);
    assert_eq!(text, PAT_LINE);
}

#[test]
fn maps_403_scope() {
    let fx = Fixture::start();
    fx.route(
        ROUTE,
        vec![Resp::new(403, "application/json", r#"{"message":"no"}"#)],
    );
    let (err, text) = repo_list(&fx);
    assert!(err);
    assert_eq!(
        text,
        "the PAT may not do this: it needs the Project and Team (Read) scope"
    );
}

#[test]
fn retry_after_once() {
    let fx = Fixture::start();
    fx.route(
        ROUTE,
        vec![
            Resp::new(429, "text/plain", "slow down").header("Retry-After", "1"),
            projects(),
        ],
    );
    let (err, text) = repo_list(&fx);
    assert!(!err, "{text}");
    assert_eq!(text, REPO_LINES);
    assert_eq!(project_hits(&fx), 2);
}

#[test]
fn second_429_gives_up() {
    let fx = Fixture::start();
    fx.route(
        ROUTE,
        vec![Resp::new(429, "text/plain", "slow").header("Retry-After", "0")],
    );
    let (err, text) = repo_list(&fx);
    assert!(err);
    assert_eq!(
        text,
        "the server is throttling requests; try again in a minute"
    );
    assert_eq!(fx.requests().len(), 2);
}

#[test]
fn server_error_line() {
    let fx = Fixture::start();
    fx.route(ROUTE, vec![Resp::new(503, "text/plain", "down")]);
    assert_eq!(
        repo_list(&fx),
        (true, "the server failed (503); try again".into())
    );
}

#[test]
fn refused_line_carries_the_message() {
    let fx = Fixture::start();
    fx.route(
        ROUTE,
        vec![Resp::new(
            400,
            "application/json",
            r#"{"message":"TF401027: You need the permission."}"#,
        )],
    );
    let (err, text) = repo_list(&fx);
    assert!(err);
    assert_eq!(
        text,
        "the server refused it: TF401027: You need the permission."
    );
}

#[test]
fn not_json_is_one_line() {
    let fx = Fixture::start();
    fx.route(ROUTE, vec![Resp::new(200, "text/html", "<html>hi</html>")]);
    assert_eq!(
        repo_list(&fx),
        (
            true,
            "unexpected answer from the server (200, text/html)".into()
        )
    );
}

#[test]
fn timeout_line() {
    let fx = Fixture::start();
    fx.route(ROUTE, vec![projects().delay(Duration::from_secs(3))]);
    let (err, text) =
        ado(&fx, &[("ADO_TIMEOUT_MS", "300")]).call("repo_list", json!({"project": "P"}));
    assert!(err);
    assert!(text.contains("didn't answer"), "{text}");
}

#[test]
fn unreachable_names_the_host() {
    // A port that was just free and has no listener now.
    let port = std::net::TcpListener::bind(("127.0.0.1", 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let org = format!("http://127.0.0.1:{port}/tfs/Coll/");
    let dir = common::tempdir();
    let mut mcp = common::Mcp::start_with(
        dir.clone(),
        &[
            ("ADO_ORG_URL", org.as_str()),
            ("ADO_PAT", "test-pat"),
            ("ADO_PROJECT_DIR", dir.to_str().unwrap()),
        ],
    );
    let (err, text) = mcp.call("repo_list", json!({"project": "P"}));
    assert!(err);
    assert!(text.starts_with("can't reach 127.0.0.1: "), "{text}");
    assert!(!text.contains("test-pat"));
}

#[test]
fn root_hosted_collection() {
    let fx = Fixture::start();
    fx.route("/Coll/_apis/projects/P", vec![projects()]);
    fx.route(
        "/Coll/p1/_apis/git/repositories",
        vec![fixture("repos.json")],
    );
    let org = fx.url("/Coll/");
    let dir = common::tempdir();
    let mut mcp = common::Mcp::start_with(
        dir.clone(),
        &[
            ("ADO_ORG_URL", org.as_str()),
            ("ADO_PAT", "test-pat"),
            ("ADO_PROJECT_DIR", dir.to_str().unwrap()),
        ],
    );
    let (err, text) = mcp.call("repo_list", json!({"project": "P"}));
    assert!(!err, "{text}");
    assert_eq!(text, REPO_LINES);
    let reqs = fx.requests();
    assert_eq!(reqs.len(), 2);
    for r in reqs {
        assert!(
            r.path.starts_with("/Coll/") && !r.path.contains("//"),
            "{}",
            r.path
        );
    }
}

#[test]
fn missing_field_names_it() {
    let fx = Fixture::start();
    fx.route(ROUTE, vec![Resp::json(&json!({"id": "p1", "name": "P"}))]);
    let (err, text) = repo_list(&fx);
    assert!(err, "{text}");
    assert!(
        text.starts_with("unexpected answer from the server") && text.contains("visibility"),
        "{text}"
    );
}

#[test]
fn no_resend_on_503() {
    let fx = Fixture::start();
    fx.route(ROUTE, vec![Resp::new(503, "text/plain", "down")]);
    let (err, _) = repo_list(&fx);
    assert!(err);
    assert_eq!(fx.requests().len(), 1);
}

#[test]
fn no_resend_on_dropped_connection() {
    let fx = Fixture::start();
    fx.route(ROUTE, vec![Resp::hang_up()]);
    let (err, text) = repo_list(&fx);
    assert!(err);
    assert!(text.starts_with("can't reach 127.0.0.1: "), "{text}");
    assert_eq!(fx.requests().len(), 1);
}
