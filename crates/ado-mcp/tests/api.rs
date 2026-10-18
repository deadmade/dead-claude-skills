mod common;

use std::time::Duration;

use base64::Engine as _;
use common::{Fixture, Resp, ado};
use serde_json::json;

const ROUTE: &str = "/tfs/Coll/_apis/projects";
const PAT_LINE: &str = "Azure DevOps rejected the PAT (expired or wrong); set a new one with /plugin configure mcp-azure";

fn projects() -> Resp {
    Resp::json(
        &json!({"count": 1, "value": [{"id": "p1", "name": "P", "state": "wellFormed",
        "revision": 7, "visibility": "private", "lastUpdateTime": "2025-11-04T10:12:33.47Z"}]}),
    )
}

/// Calls `ping` against `fx` and returns `(isError, text)`.
fn ping(fx: &Fixture) -> (bool, String) {
    ado(fx, &[]).call("ping", json!({}))
}

#[test]
fn sends_auth_version_and_suppress() {
    let fx = Fixture::start();
    fx.route(ROUTE, vec![projects()]);
    let (err, text) = ping(&fx);
    assert!(!err, "{text}");
    assert_eq!(text, "projects: 1");
    let reqs = fx.requests();
    let r = &reqs[0];
    let basic = base64::engine::general_purpose::STANDARD.encode(":test-pat");
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
    assert!(r.path.contains("top=1"), "{}", r.path);
    assert_eq!(r.header("x-tfs-fedauthredirect"), Some("Suppress"));
    assert!(r.header("user-agent").unwrap().starts_with("ado-mcp/"));
}

#[test]
fn maps_401_without_secret() {
    let fx = Fixture::start();
    fx.route(
        ROUTE,
        vec![Resp::new(401, "text/plain", "Basic OnRlc3QtcGF0")],
    );
    let (err, text) = ping(&fx);
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
    let (err, text) = ping(&fx);
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
    let (err, text) = ping(&fx);
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
    let (err, text) = ping(&fx);
    assert!(!err, "{text}");
    assert_eq!(fx.requests().len(), 2);
}

#[test]
fn second_429_gives_up() {
    let fx = Fixture::start();
    fx.route(
        ROUTE,
        vec![Resp::new(429, "text/plain", "slow").header("Retry-After", "0")],
    );
    let (err, text) = ping(&fx);
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
        ping(&fx),
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
    let (err, text) = ping(&fx);
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
        ping(&fx),
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
    let (err, text) = ado(&fx, &[("ADO_TIMEOUT_MS", "300")]).call("ping", json!({}));
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
    let (err, text) = mcp.call("ping", json!({}));
    assert!(err);
    assert!(text.starts_with("can't reach 127.0.0.1: "), "{text}");
    assert!(!text.contains("test-pat"));
}

#[test]
fn root_hosted_collection() {
    let fx = Fixture::start();
    fx.route("/Coll/_apis/projects", vec![projects()]);
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
    let (err, text) = mcp.call("ping", json!({}));
    assert!(!err, "{text}");
    let path = &fx.requests()[0].path;
    assert!(path.starts_with("/Coll/") && !path.contains("//"), "{path}");
}

#[test]
fn missing_field_names_it() {
    let fx = Fixture::start();
    fx.route(
        ROUTE,
        vec![Resp::json(&json!({"count": 1, "value": [{"name": "P"}]}))],
    );
    let (err, text) = ping(&fx);
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
    let (err, _) = ping(&fx);
    assert!(err);
    assert_eq!(fx.requests().len(), 1);
}
