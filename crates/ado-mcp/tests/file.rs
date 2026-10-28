mod common;

use common::{Fixture, Mcp, Resp, ado, clone_of, fixture, own_remote};
use serde_json::{Value, json};

const PROJ: &str = "b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455";
const REPO_ID: &str = "3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01";
const INFO: &str = "/tfs/Coll/My%20Proj/_git/R/vsts/info";
const REPO: &str = "/tfs/Coll/My%20Proj/_apis/git/repositories/R";
/// By the ids of `repo.json`.
const ITEMS: &str = "/tfs/Coll/b5d2a1e7-6c40-4f8b-8a3d-2e9c7f10a455/_apis/git/repositories/3f2c9a14-1b7e-4c55-9d1a-6a1f0c2b7e01/items";

/// Inside a clone, so the tests also show that `project` and `repo` win over it.
fn env(fx: &Fixture) -> Mcp {
    fx.route(INFO, vec![fixture("vsts-info.json")]);
    let clone = clone_of(&own_remote(fx));
    ado(fx, &[("ADO_PROJECT_DIR", clone.to_str().unwrap())])
}

/// `repo_file` in `My Proj`/`R` with `extra` on top, answered by `item`.
fn read(fx: &Fixture, item: Resp, extra: Value) -> (bool, String) {
    fx.route(REPO, vec![fixture("repo.json")]);
    fx.route(ITEMS, vec![item]);
    let mut args = json!({"project": "My Proj", "repo": "R"});
    if let Value::Object(extra) = extra {
        args.as_object_mut().unwrap().extend(extra);
    }
    env(fx).call("repo_file", args)
}

/// The decoded query pairs of each items request.
fn queries(fx: &Fixture) -> Vec<Vec<(String, String)>> {
    fx.requests()
        .into_iter()
        .filter(|r| r.path.split('?').next() == Some(ITEMS))
        .map(|r| {
            let q = r.path.split_once('?').map_or("", |(_, q)| q);
            url::form_urlencoded::parse(q.as_bytes())
                .into_owned()
                .collect()
        })
        .collect()
}

fn values<'a>(q: &'a [(String, String)], k: &str) -> Vec<&'a str> {
    q.iter()
        .filter(|(n, _)| n == k)
        .map(|(_, v)| v.as_str())
        .collect()
}

/// Review Focus 3: `My Proj` is resolved to ids for the path.
#[test]
fn reads_lines() {
    let fx = Fixture::start();
    let (err, text) = read(
        &fx,
        fixture("item.json"),
        json!({"path": "/src/Program.cs"}),
    );
    assert!(!err, "{text}");
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "    1  using System;", "{text}");
    assert_eq!(lines[1], "    2  ", "{text}");
    assert_eq!(
        lines[6], "    7      static void Main() => Console.WriteLine(\"hi\");",
        "{text}"
    );
    assert_eq!(lines.len(), 8, "{text}");
    for leak in ["http", PROJ, REPO_ID, "vstfs", "more"] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }
    let q = &queries(&fx)[0];
    assert_eq!(values(q, "path"), ["/src/Program.cs"], "{q:?}");
    assert_eq!(values(q, "includeContent"), ["true"], "{q:?}");
    assert_eq!(values(q, "includeContentMetadata"), ["true"], "{q:?}");
    assert_eq!(values(q, "$format"), ["json"], "{q:?}");
    assert_eq!(values(q, "api-version"), ["7.1-preview"], "{q:?}");
    assert!(
        q.iter().all(|(k, _)| !k.starts_with("versionDescriptor")),
        "{q:?}"
    );
}

#[test]
fn branch_passed() {
    let fx = Fixture::start();
    let (err, text) = read(
        &fx,
        fixture("item.json"),
        json!({"path": "/src/Program.cs", "branch": "feature/x"}),
    );
    assert!(!err, "{text}");
    let q = &queries(&fx)[0];
    assert_eq!(
        values(q, "versionDescriptor.version"),
        ["feature/x"],
        "{q:?}"
    );
    assert_eq!(
        values(q, "versionDescriptor.versionType"),
        ["branch"],
        "{q:?}"
    );
}

/// Review Focus 6: the path arrives as exactly one `path` value, escaped once.
#[test]
fn odd_path() {
    let fx = Fixture::start();
    let path = "/src/C#/a+b&c d.cs";
    let (err, text) = read(&fx, fixture("item.json"), json!({"path": path}));
    assert!(!err, "{text}");
    let q = &queries(&fx)[0];
    assert_eq!(values(q, "path"), [path], "{q:?}");
    assert_eq!(values(q, "includeContent"), ["true"], "{q:?}");
}

#[test]
fn folder() {
    let fx = Fixture::start();
    let (err, text) = read(&fx, fixture("item-folder.json"), json!({"path": "/src"}));
    assert!(err, "{text}");
    assert_eq!(text, "/src is a folder");
}

#[test]
fn binary() {
    let fx = Fixture::start();
    let item = json!({
        "objectId": "9c1f", "gitObjectType": "blob", "path": "/logo.png",
        "contentMetadata": {"encoding": 0, "contentType": "image/png", "fileName": "logo.png",
                            "extension": "png", "isBinary": true, "isImage": true},
        "content": "iVBORw0KGgo="
    });
    let (err, text) = read(&fx, Resp::json(&item), json!({"path": "/logo.png"}));
    assert!(err, "{text}");
    assert_eq!(text, "/logo.png is a binary file");
}

#[test]
fn missing() {
    let fx = Fixture::start();
    let gone = Resp::new(
        404,
        "application/json",
        json!({"message": format!("TF401174: The item '/nope.cs' could not be found in the repository '{REPO_ID}'")})
            .to_string(),
    );
    let (err, text) = read(&fx, gone, json!({"path": "/nope.cs"}));
    assert!(err, "{text}");
    assert_eq!(text, "not found: /nope.cs");
}

/// A project alone names no repo: nothing is sent.
#[test]
fn needs_repo() {
    let fx = Fixture::start();
    let (err, text) = env(&fx).call("repo_file", json!({"project": "My Proj", "path": "/a.cs"}));
    assert!(err, "{text}");
    assert_eq!(text, "pass repo (repo_list names them)");
    assert!(fx.requests().is_empty());
}

/// Review Focus 5: one line longer than the reply cap is cut, and the reply still ends with the next call.
#[test]
fn long_line_more() {
    let fx = Fixture::start();
    let content = format!("{}\nconsole.log(1);\n", "x".repeat(50_000));
    let item = json!({"path": "/dist/app.min.js", "content": content,
                      "contentMetadata": {"isBinary": false}});
    let (err, text) = read(
        &fx,
        Resp::json(&item),
        json!({"path": "/dist/app.min.js", "branch": "main"}),
    );
    assert!(!err, "{text}");
    assert!(text.starts_with("    1  xxx"), "{}", &text[..50]);
    assert!(!text.contains("output cut"), "cut by the reply cap");
    assert!(
        text.ends_with(
            "\n… more: repo_file path=/dist/app.min.js start=2 project=\"My Proj\" repo=R branch=main"
        ),
        "{}",
        &text[text.len() - 200..]
    );
}

#[test]
fn start_pages_on() {
    let fx = Fixture::start();
    let (err, text) = read(
        &fx,
        fixture("item.json"),
        json!({"path": "/src/Program.cs", "start": 7}),
    );
    assert!(!err, "{text}");
    assert_eq!(
        text,
        "    7      static void Main() => Console.WriteLine(\"hi\");\n    8  }"
    );
}

#[test]
fn start_past_the_end() {
    let fx = Fixture::start();
    let (err, text) = read(
        &fx,
        fixture("item.json"),
        json!({"path": "/src/Program.cs", "start": 20}),
    );
    assert!(!err, "{text}");
    assert_eq!(text, "no lines from 20; /src/Program.cs has 8 lines");
}
