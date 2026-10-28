mod common;

use std::time::{Duration, Instant};

use common::{Fixture, Mcp, Resp, ado, clone_of, fixture, own_remote};
use serde_json::{Value, json};

const PROJ: &str = "b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455";
const INFO: &str = "/tfs/Coll/My%20Proj/_git/R/vsts/info";
/// A work item id is collection-wide: no project in its path.
const WI123: &str = "/tfs/Coll/_apis/wit/workitems/123";
const COMMENTS: &str =
    "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/wit/workItems/123/comments";
const WIQL: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/wit/wiql";
const BATCH: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/wit/workitemsbatch";

fn env(fx: &Fixture) -> Mcp {
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    let clone = clone_of(&own_remote(fx));
    ado(fx, &[("ADO_PROJECT_DIR", clone.to_str().unwrap())])
}

fn ok(mcp: &mut Mcp, tool: &str, args: Value) -> String {
    let (err, text) = mcp.call(tool, args);
    assert!(!err, "{text}");
    text
}

/// The decoded query of the requests to `path`.
fn queries(fx: &Fixture, path: &str) -> Vec<String> {
    requests(fx, path)
        .iter()
        .map(|r| {
            r.path
                .split_once('?')
                .map_or(String::new(), |(_, q)| q.to_owned())
                .replace("%24", "$")
        })
        .collect()
}

fn requests(fx: &Fixture, path: &str) -> Vec<common::Req> {
    fx.requests()
        .into_iter()
        .filter(|r| r.path.split('?').next() == Some(path))
        .collect()
}

fn bodies(fx: &Fixture, path: &str) -> Vec<Value> {
    requests(fx, path)
        .iter()
        .map(|r| serde_json::from_slice(&r.body).unwrap())
        .collect()
}

fn item(id: i32, kind: &str, state: &str, title: &str, assignee: Option<&str>) -> Value {
    let mut fields = json!({
        "System.Id": id,
        "System.WorkItemType": kind,
        "System.State": state,
        "System.Title": title,
    });
    if let Some(a) = assignee {
        fields["System.AssignedTo"] = json!({"displayName": a, "uniqueName": "CORP\\x"});
    }
    json!({"id": id, "fields": fields, "url": format!("http://dev.example/_apis/wit/workItems/{id}")})
}

fn three() -> Value {
    json!({"count": 3, "value": [
        item(123, "Bug", "Active", "Login fails behind the proxy", Some("Jane Roe")),
        item(124, "Task", "New", "Add a proxy test", None),
        item(125, "Task", "Closed", "Log the proxy", Some("Bob Builder")),
    ]})
}

#[test]
fn view_lines() {
    let fx = Fixture::start();
    fx.route(WI123, vec![fixture("wi.json")]);
    fx.route(COMMENTS, vec![fixture("wi-comments.json")]);
    let text = ok(&mut env(&fx), "wi_view", json!({"id": 123}));
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(
        lines[0], "#123 Bug Active  \"Login fails behind the proxy\"",
        "{text}"
    );
    assert_eq!(
        lines[1], "assigned: Jane Roe  area: My Proj\\Web  iteration: My Proj\\Sprint 12",
        "{text}"
    );
    assert!(lines.contains(&"parent: #100"), "{text}");
    assert!(lines.contains(&"children: #124, #125"), "{text}");
    assert!(lines.contains(&"PRs: !412"), "{text}");
    assert!(lines.contains(&"Related: #99, #101"), "{text}");
    assert!(lines.contains(&"commits: 2d9e7b10"), "{text}");
    assert!(
        text.contains("Open the login page behind the proxy.\nIt times out."),
        "{text}"
    );
    assert!(
        text.contains("acceptance criteria:\n- Login works behind the proxy\n- No retry loop"),
        "{text}"
    );
    assert!(
        text.contains("comments:\n  2026-03-06 Jane Roe: Seen it on staging too.\n  2026-03-05 Bob Builder: Proxy logs attached."),
        "{text}"
    );
    assert!(
        text.ends_with("\n  … 3 older comments: wi_view id=123 full=true"),
        "{text}"
    );
    for leak in ["<", "&nbsp;", "http", "vstfs", PROJ] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }
    let q = &queries(&fx, WI123)[0];
    assert!(q.contains("$expand=relations"), "{q}");
    let q = &queries(&fx, COMMENTS)[0];
    assert!(q.contains("$top=5") && q.contains("order=desc"), "{q}");
}

/// Every link of the item, after the head: work item links by the server's name, commits, branches, and the
/// hyperlinks and attachments counted, with no URL, GUID or attachment name.
#[test]
fn view_all_links() {
    let fx = Fixture::start();
    fx.route(WI123, vec![fixture("wi.json")]);
    fx.route(COMMENTS, vec![fixture("wi-comments.json")]);
    let text = ok(&mut env(&fx), "wi_view", json!({"id": 123}));
    let links: Vec<&str> = text.lines().skip(2).take_while(|l| !l.is_empty()).collect();
    assert_eq!(
        links,
        [
            "parent: #100",
            "children: #124, #125",
            "PRs: !412",
            "Related: #99, #101",
            "Duplicate Of: #98",
            "Tested By: #130",
            "commits: 2d9e7b10",
            "branches: feature/proxy-fix",
            "links: 1  attachments: 2",
        ],
        "{text}"
    );
    for leak in [
        "http",
        "vstfs",
        PROJ,
        "3f2c9a14",
        "098a279a",
        "proxy.log",
        "1c6f0e2d",
        "request.har",
        "%2F",
    ] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }
}

#[test]
fn view_unassigned_and_bare() {
    let fx = Fixture::start();
    fx.route(
        WI123,
        vec![Resp::json(&item(123, "Task", "New", "Bare", None))],
    );
    fx.route(
        COMMENTS,
        vec![Resp::json(
            &json!({"totalCount": 0, "count": 0, "comments": [], "url": "http://x"}),
        )],
    );
    let text = ok(&mut env(&fx), "wi_view", json!({"id": 123}));
    assert_eq!(
        text,
        "#123 Task New  \"Bare\"\nassigned: nobody  area: ?  iteration: ?"
    );
}

#[test]
fn view_clips_text_not_markup() {
    let fx = Fixture::start();
    let mut wi: Value = serde_json::from_slice(&fixture("wi.json").body).unwrap();
    // 3000 characters of text in 24000 of markup: under the cut once it is text.
    wi["fields"]["System.Description"] = json!("<b>x</b>".repeat(1000) + &"<i>y</i>".repeat(2000));
    wi["fields"]["Microsoft.VSTS.Common.AcceptanceCriteria"] =
        json!("<p>".to_owned() + &"z".repeat(5000));
    fx.route(WI123, vec![Resp::json(&wi)]);
    fx.route(COMMENTS, vec![fixture("wi-comments.json")]);
    let mut mcp = env(&fx);
    let text = ok(&mut mcp, "wi_view", json!({"id": 123}));
    assert!(
        text.contains(&("x".repeat(1000) + &"y".repeat(2000))),
        "{text}"
    );
    assert!(
        text.contains("… 1000 more characters: wi_view id=123 full=true"),
        "{text}"
    );
    let text = ok(&mut mcp, "wi_view", json!({"id": 123, "full": true}));
    assert!(text.contains(&"z".repeat(5000)), "{text}");
    assert!(!text.contains("more characters"), "{text}");
}

#[test]
fn view_not_found_and_comments_degrade() {
    let fx = Fixture::start();
    fx.route(
        "/tfs/Coll/_apis/wit/workitems/9",
        vec![Resp::new(404, "text/plain", "gone")],
    );
    fx.route(WI123, vec![fixture("wi.json")]);
    fx.route(COMMENTS, vec![Resp::new(404, "text/plain", "gone")]);
    let mut mcp = env(&fx);
    let (err, text) = mcp.call("wi_view", json!({"id": 9}));
    assert!(err);
    assert_eq!(text, "not found: work item #9");
    let text = ok(&mut mcp, "wi_view", json!({"id": 123}));
    assert!(text.contains("\ncomments: unavailable ("), "{text}");
    // Same project as the scope: no second try.
    assert_eq!(requests(&fx, COMMENTS).len(), 1);
}

#[test]
fn view_concurrent() {
    let fx = Fixture::start();
    // The first call answers at once and measures the rest (process, git, scope); the second waits 600 ms on each of
    // two calls: 1200 ms one after the other, about 600 together.
    let slow = Duration::from_millis(600);
    fx.route(
        WI123,
        vec![fixture("wi.json"), fixture("wi.json").delay(slow)],
    );
    fx.route(
        COMMENTS,
        vec![
            fixture("wi-comments.json"),
            fixture("wi-comments.json").delay(slow),
        ],
    );
    let mut mcp = env(&fx);
    let t = Instant::now();
    ok(&mut mcp, "wi_view", json!({"id": 123}));
    let base = t.elapsed();
    let t = Instant::now();
    ok(&mut mcp, "wi_view", json!({"id": 123}));
    let took = t.elapsed();
    assert!(
        took < base + Duration::from_millis(1000),
        "{took:?} against {base:?}"
    );
}

/// A comments answer `Notes` can't read: the item still shows, the comments say why, and nothing is retried.
#[test]
fn view_comments_unreadable() {
    let fx = Fixture::start();
    fx.route(WI123, vec![fixture("wi.json")]);
    fx.route(
        COMMENTS,
        vec![Resp::json(&json!({"totalCount": 1, "comments": {}}))],
    );
    let text = ok(&mut env(&fx), "wi_view", json!({"id": 123}));
    assert!(text.starts_with("#123 "), "{text}");
    assert!(
        text.contains(
            "

comments: unavailable (unexpected answer from the server: "
        ),
        "{text}"
    );
    assert_eq!(requests(&fx, COMMENTS).len(), 1);
}

/// `"comments": null` is no comments, as the crate's model read it.
#[test]
fn view_comments_null() {
    let fx = Fixture::start();
    fx.route(WI123, vec![fixture("wi.json")]);
    fx.route(
        COMMENTS,
        vec![Resp::json(&json!({"totalCount": 0, "comments": null}))],
    );
    let text = ok(&mut env(&fx), "wi_view", json!({"id": 123}));
    assert!(!text.contains("\ncomments"), "{text}");
}

/// An answer without a `comments` key isn't "no comments": it says it couldn't read them.
#[test]
fn view_comments_missing_key() {
    let fx = Fixture::start();
    fx.route(WI123, vec![fixture("wi.json")]);
    fx.route(COMMENTS, vec![Resp::json(&json!({"totalCount": 3}))]);
    let text = ok(&mut env(&fx), "wi_view", json!({"id": 123}));
    assert!(
        text.contains(
            "

comments: unavailable (unexpected answer from the server: "
        ),
        "{text}"
    );
}

/// Outside an Azure DevOps clone, with no project: the item is collection-wide and names its own project, which the
/// comments are read from.
#[test]
fn view_outside_clone_uses_the_items_project() {
    let fx = Fixture::start();
    fx.route(WI123, vec![fixture("wi.json")]);
    let home = "/tfs/Coll/My%20Proj/_apis/wit/workItems/123/comments";
    fx.route(home, vec![fixture("wi-comments.json")]);
    let text = ok(&mut ado(&fx, &[]), "wi_view", json!({"id": 123}));
    assert!(text.starts_with("#123 "), "{text}");
    assert!(
        text.contains(
            "
comments:
  2026-03-06 Jane Roe:"
        ),
        "{text}"
    );
    assert_eq!(requests(&fx, home).len(), 1);
    // An empty project is no project, as everywhere else.
    let text = ok(
        &mut ado(&fx, &[]),
        "wi_view",
        json!({"id": 123, "project": ""}),
    );
    assert!(text.starts_with("#123 "), "{text}");
}

#[test]
fn query_filters_build_wiql() {
    let fx = Fixture::start();
    fx.route(WIQL, vec![fixture("wiql.json")]);
    // `errorPolicy=omit` leaves a null where an item is gone.
    let mut batch = three();
    batch["value"][1] = Value::Null;
    fx.route(BATCH, vec![Resp::json(&batch)]);
    let text = ok(
        &mut env(&fx),
        "wi_query",
        json!({"assigned": "me", "state": "Active", "type": "Bug", "title": "O'Brien"}),
    );
    assert_eq!(
        text,
        "#123 Bug Active  \"Login fails behind the proxy\"  Jane Roe\n#125 Task Closed  \"Log the proxy\"  Bob Builder"
    );
    let wiql = bodies(&fx, WIQL)[0]["query"].as_str().unwrap().to_owned();
    assert_eq!(
        wiql,
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project \
         AND [System.AssignedTo] = @Me AND [System.State] = 'Active' \
         AND [System.WorkItemType] = 'Bug' AND [System.Title] CONTAINS 'O''Brien' \
         ORDER BY [System.ChangedDate] DESC"
    );
    assert!(queries(&fx, WIQL)[0].contains("$top=21"));
    let b = &bodies(&fx, BATCH)[0];
    assert_eq!(b["ids"], json!([123, 124, 125]));
    assert_eq!(b["errorPolicy"], "omit");
    assert_eq!(
        b["fields"],
        json!([
            "System.Id",
            "System.WorkItemType",
            "System.State",
            "System.Title",
            "System.AssignedTo"
        ])
    );
}

#[test]
fn query_assigned_by_name() {
    let fx = Fixture::start();
    fx.route(WIQL, vec![fixture("wiql.json")]);
    fx.route(BATCH, vec![Resp::json(&three())]);
    let text = ok(&mut env(&fx), "wi_query", json!({"assigned": "Jane O'Roe"}));
    assert!(
        text.contains("#124 Task New  \"Add a proxy test\"  nobody"),
        "{text}"
    );
    let wiql = bodies(&fx, WIQL)[0]["query"].as_str().unwrap().to_owned();
    assert!(
        wiql.ends_with(
            "AND [System.AssignedTo] = 'Jane O''Roe' ORDER BY [System.ChangedDate] DESC"
        ),
        "{wiql}"
    );
}

#[test]
fn query_raw_wiql_passthrough() {
    let fx = Fixture::start();
    fx.route(WIQL, vec![fixture("wiql.json")]);
    fx.route(BATCH, vec![Resp::json(&three())]);
    let raw = "SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS 'proxy' ORDER BY [System.Id]";
    let text = ok(
        &mut env(&fx),
        "wi_query",
        json!({"wiql": raw, "assigned": "me"}),
    );
    assert_eq!(text.lines().count(), 3, "{text}");
    assert_eq!(bodies(&fx, WIQL)[0]["query"], raw);
}

#[test]
fn query_more_line() {
    let fx = Fixture::start();
    fx.route(WIQL, vec![fixture("wiql.json")]);
    let mut two = three();
    two["value"].as_array_mut().unwrap().pop();
    fx.route(BATCH, vec![Resp::json(&two)]);
    let text = ok(
        &mut env(&fx),
        "wi_query",
        json!({"state": "Active", "limit": 2}),
    );
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 3, "{text}");
    assert_eq!(lines[2], "… more: wi_query state=Active limit=4");
    assert!(queries(&fx, WIQL)[0].contains("$top=3"));
    assert_eq!(bodies(&fx, BATCH)[0]["ids"], json!([123, 124]));
}

#[test]
fn query_batches_by_200() {
    let fx = Fixture::start();
    let refs: Vec<Value> = (1..=250).map(|id| json!({"id": id})).collect();
    fx.route(WIQL, vec![Resp::json(&json!({"workItems": refs}))]);
    fx.route(BATCH, vec![Resp::json(&json!({"value": []}))]);
    let text = ok(&mut env(&fx), "wi_query", json!({"limit": 300}));
    assert_eq!(text, "no work items");
    let sizes: Vec<usize> = bodies(&fx, BATCH)
        .iter()
        .map(|b| b["ids"].as_array().unwrap().len())
        .collect();
    assert_eq!(sizes, [200, 50]);
}

#[test]
fn query_none() {
    let fx = Fixture::start();
    fx.route(WIQL, vec![Resp::json(&json!({"workItems": []}))]);
    let text = ok(&mut env(&fx), "wi_query", json!({}));
    assert_eq!(text, "no work items");
    assert!(requests(&fx, BATCH).is_empty());
}

#[test]
fn query_keeps_the_wiql_order() {
    let fx = Fixture::start();
    fx.route(WIQL, vec![fixture("wiql.json")]);
    let mut shuffled = three();
    shuffled["value"].as_array_mut().unwrap().reverse();
    fx.route(BATCH, vec![Resp::json(&shuffled)]);
    let text = ok(&mut env(&fx), "wi_query", json!({}));
    let ids: Vec<&str> = text.lines().map(|l| l.split(' ').next().unwrap()).collect();
    assert_eq!(ids, ["#123", "#124", "#125"], "{text}");
}

#[test]
fn query_retries_a_stale_project() {
    let fx = Fixture::start();
    fx.route(
        WIQL,
        vec![Resp::new(404, "text/plain", "gone"), fixture("wiql.json")],
    );
    fx.route(BATCH, vec![Resp::json(&three())]);
    let text = ok(&mut env(&fx), "wi_query", json!({}));
    assert_eq!(text.lines().count(), 3, "{text}");
    assert_eq!(fx.hits(INFO), 2);
    assert_eq!(requests(&fx, WIQL).len(), 2);
}

#[test]
fn query_refuses_link_queries() {
    let fx = Fixture::start();
    fx.route(
        WIQL,
        vec![Resp::json(&json!({
            "queryResultType": "workItemLink",
            "workItemRelations": [{"rel": null, "source": null, "target": {"id": 123}}]
        }))],
    );
    let (err, text) = env(&fx).call(
        "wi_query",
        json!({"wiql": "SELECT [System.Id] FROM WorkItemLinks"}),
    );
    assert!(err);
    assert_eq!(text, "link queries are not supported; use FROM WorkItems");
    assert!(requests(&fx, BATCH).is_empty());
}

#[test]
fn view_comments_in_the_items_project() {
    let fx = Fixture::start();
    let mut wi: Value = serde_json::from_slice(&fixture("wi.json").body).unwrap();
    wi["fields"]["System.TeamProject"] = json!("Other Proj");
    fx.route(WI123, vec![Resp::json(&wi)]);
    fx.route(COMMENTS, vec![Resp::new(404, "text/plain", "gone")]);
    let other = "/tfs/Coll/Other%20Proj/_apis/wit/workItems/123/comments";
    fx.route(other, vec![fixture("wi-comments.json")]);
    let text = ok(&mut env(&fx), "wi_view", json!({"id": 123}));
    assert!(
        text.contains("\ncomments:\n  2026-03-06 Jane Roe:"),
        "{text}"
    );
    assert_eq!(requests(&fx, COMMENTS).len(), 1);
    assert_eq!(requests(&fx, other).len(), 1);
}

const CONN: &str = "/tfs/Coll/_apis/connectionData";
const STORY: &str =
    "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/wit/workitems/$User%20Story";
const IN_PROJ: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/wit/workitems/123";

fn op(path: &str, value: &Value) -> Value {
    json!({"op": "add", "path": path, "value": value})
}

#[test]
fn create_json_patch() {
    let fx = Fixture::start();
    fx.route(STORY, vec![fixture("wi.json")]);
    fx.route(CONN, vec![fixture("connection-data.json")]);
    let text = ok(
        &mut env(&fx),
        "wi_create",
        json!({"type": "User Story", "title": "Add retry", "description": "<p>Retry once.</p>",
            "assigned": "me", "parent": 100}),
    );
    assert_eq!(text, "created #123 User Story \"Add retry\"");
    let reqs = requests(&fx, STORY);
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].method, "POST");
    assert_eq!(
        reqs[0].header("content-type"),
        Some("application/json-patch+json")
    );
    let parent = json!({"rel": "System.LinkTypes.Hierarchy-Reverse",
        "url": fx.url("/tfs/Coll/_apis/wit/workItems/100")});
    assert_eq!(
        bodies(&fx, STORY)[0],
        json!([
            op("/fields/System.Title", &json!("Add retry")),
            op("/fields/System.Description", &json!("<p>Retry once.</p>")),
            op("/fields/System.AssignedTo", &json!("Alice Example")),
            op("/relations/-", &parent),
        ])
    );
}

#[test]
fn update_custom_field() {
    let fx = Fixture::start();
    fx.route(WI123, vec![fixture("wi.json")]);
    let text = ok(
        &mut env(&fx),
        "wi_update",
        json!({"id": 123, "state": "Resolved",
            "fields": {"Microsoft.VSTS.Common.Priority": 1, "Custom.Team_Name": "Web \"/fields/x\""}}),
    );
    assert_eq!(
        text,
        "updated #123: Custom.Team_Name, Microsoft.VSTS.Common.Priority, System.State"
    );
    // No project segment: the item may live in any project.
    assert!(requests(&fx, IN_PROJ).is_empty());
    let reqs = requests(&fx, WI123);
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].method, "PATCH");
    assert_eq!(
        reqs[0].header("content-type"),
        Some("application/json-patch+json")
    );
    assert_eq!(
        bodies(&fx, WI123)[0],
        json!([
            op("/fields/Custom.Team_Name", &json!("Web \"/fields/x\"")),
            op("/fields/Microsoft.VSTS.Common.Priority", &json!(1)),
            op("/fields/System.State", &json!("Resolved")),
        ])
    );
}

#[test]
fn update_refuses_bad_field_names() {
    let fx = Fixture::start();
    let mut mcp = env(&fx);
    for key in ["System.Title/-", "a b", "", "x~1", "Custom.Foo\"}"] {
        let (err, text) = mcp.call(
            "wi_update",
            json!({"id": 123, "title": "t", "fields": {key: "v"}}),
        );
        assert!(err, "{key}: {text}");
        assert_eq!(text, format!("bad field name: {key}"));
    }
    let (err, text) = mcp.call("wi_update", json!({"id": 123}));
    assert!(err, "{text}");
    assert_eq!(
        text,
        "nothing to update: give state, assigned, title or fields"
    );
    assert!(fx.requests().is_empty());
}

#[test]
fn create_needs_type_and_title() {
    let fx = Fixture::start();
    let mut mcp = env(&fx);
    for (args, want) in [
        (json!({"type": " ", "title": "t"}), "no type: pass type"),
        (json!({"type": "Bug", "title": ""}), "no title: pass title"),
    ] {
        let (err, text) = mcp.call("wi_create", args);
        assert!(err, "{text}");
        assert_eq!(text, want);
    }
    assert!(fx.requests().is_empty());
}

#[test]
fn comment_preview_version() {
    let fx = Fixture::start();
    fx.route(
        COMMENTS,
        vec![Resp::json(
            // The server leaves `url` out of a mention, which the crate's `CommentMention` (inside `Comment`) requires.
            &json!({"id": 9, "text": "Fixed in !412.", "url": "http://x",
                "mentions": [{"artifactId": "a", "artifactType": "Person", "commentId": 9, "targetId": "a"}]}),
        )],
    );
    let text = ok(
        &mut env(&fx),
        "wi_comment",
        json!({"id": 123, "text": "Fixed in !412."}),
    );
    assert_eq!(text, "commented on #123");
    let reqs = requests(&fx, COMMENTS);
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].method, "POST");
    assert_eq!(queries(&fx, COMMENTS)[0], "api-version=7.1-preview");
    assert_eq!(bodies(&fx, COMMENTS)[0], json!({"text": "Fixed in !412."}));
}

#[test]
fn wi_write_sent_once_on_404() {
    let fx = Fixture::start();
    fx.route(WI123, vec![Resp::new(404, "text/plain", "gone")]);
    fx.route(COMMENTS, vec![Resp::new(404, "text/plain", "gone")]);
    fx.route(STORY, vec![Resp::new(404, "text/plain", "gone")]);
    let mut mcp = env(&fx);
    for (tool, args, want) in [
        (
            "wi_update",
            json!({"id": 123, "title": "t"}),
            "not found: work item #123",
        ),
        (
            "wi_comment",
            json!({"id": 123, "text": "x"}),
            "not found: work item #123 (if #123 is in another project, pass project)",
        ),
        (
            "wi_create",
            json!({"type": "User Story", "title": "t"}),
            "not found: work item type User Story",
        ),
    ] {
        let (err, text) = mcp.call(tool, args);
        assert!(err, "{tool}: {text}");
        assert_eq!(text, want);
    }
    for path in [WI123, COMMENTS, STORY] {
        assert_eq!(requests(&fx, path).len(), 1, "{path}");
    }
}

#[test]
fn view_full_reads_200_comments() {
    let fx = Fixture::start();
    fx.route(WI123, vec![fixture("wi.json")]);
    fx.route(COMMENTS, vec![fixture("wi-comments.json")]);
    let text = ok(&mut env(&fx), "wi_view", json!({"id": 123, "full": true}));
    // The fixture says 8 and sends 5: nothing more to fetch, so no call is named.
    assert!(text.ends_with("\n  … 3 older comments"), "{text}");
    let q = &queries(&fx, COMMENTS)[0];
    assert!(q.contains("$top=200"), "{q}");
}

#[test]
fn view_dot_project_does_not_climb() {
    let fx = Fixture::start();
    let mut wi: Value = serde_json::from_slice(&fixture("wi.json").body).unwrap();
    // A server-supplied `..` must stay a segment, not climb out of the collection.
    wi["fields"]["System.TeamProject"] = json!("..");
    fx.route(WI123, vec![Resp::json(&wi)]);
    fx.route(COMMENTS, vec![Resp::new(404, "text/plain", "gone")]);
    let text = ok(&mut env(&fx), "wi_view", json!({"id": 123}));
    assert!(
        text.contains("\n\ncomments: unavailable (not found"),
        "{text}"
    );
    let paths: Vec<String> = fx.requests().into_iter().map(|r| r.path).collect();
    assert!(
        paths
            .iter()
            .any(|p| p.starts_with("/tfs/Coll/%252E%252E/_apis/wit/workItems/123/comments")),
        "{paths:?}"
    );
}
