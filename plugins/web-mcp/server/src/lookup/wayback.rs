//! `wayback`: a URL's snapshots from the Internet Archive's CDX index, or one capture read like a fetched page.

use std::sync::Arc;
use std::time::Duration;

use rmcp::model::{CallToolResult, ContentBlock};
use serde_json::json;
use url::Url;

use super::{Outcome, Part, deadline};
use crate::Ctx;
use crate::fetch::{self, GetOpts};

const SOURCE: &str = "Wayback CDX";

fn error(e: String) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(e)])
}

pub async fn run(ctx: &Arc<Ctx>, target: &str, at: Option<&str>) -> CallToolResult {
    let target = target.trim();
    let Some(at) = at else {
        let o = list(ctx, target).await;
        return super::render(ctx, "wayback", target, o).await;
    };
    if at.is_empty() || at.len() > 14 || !at.bytes().all(|b| b.is_ascii_digit()) {
        return error("at must be 1 to 14 digits: a timestamp such as 20240102030405, or a prefix such as 2024".into());
    }
    let target = if target.contains("://") {
        target.to_owned()
    } else {
        format!("http://{target}")
    };
    let url = format!("{}web/{at}id_/{target}", ctx.cfg.lookup_urls.wayback);
    let url = match Url::parse(&url) {
        Ok(u) => u,
        Err(e) => return error(format!("{target}: not a URL ({e})")),
    };
    // A capture never changes, so it is cached and indexed like any page; no browser re-render of a raw capture.
    let opts = GetOpts {
        browser_fallback: false,
        images: false,
        allow_private: false,
    };
    let f = match fetch::get(ctx, &url, deadline(ctx, Duration::from_secs(30)), opts).await {
        Ok(f) => f,
        Err(e) => return error(format!("Failed: Wayback Machine: {e}")),
    };
    let mut r = fetch::render(ctx, &f, false).await;
    let full = f.archived.path.to_string_lossy().replace('\\', "/");
    if let Some(b) = r.content.first_mut()
        && let Some(t) = b.as_text()
    {
        let note = format!("[Cut at 30,000 characters; the full page is at .web/{full}]");
        *b = ContentBlock::text(super::cut(&t.text, &note));
    }
    r
}

/// The newest 50 snapshots of `target`, one per distinct content, newest first.
pub async fn list(ctx: &Ctx, target: &str) -> Outcome {
    let mut o = Outcome::default();
    match ask(ctx, target).await {
        Ok(p) => o.parts.push(p),
        Err(e) => o.failed.push(format!("{SOURCE}: {e}")),
    }
    o
}

async fn ask(ctx: &Ctx, target: &str) -> Result<Part, String> {
    let mut url = ctx.cfg.lookup_urls.cdx.clone();
    url.query_pairs_mut()
        .append_pair("url", target)
        .append_pair("output", "json")
        .append_pair("fl", "timestamp,original,mimetype,statuscode,digest")
        .append_pair("collapse", "digest")
        // A negative limit is the last N rows, oldest first (CDX README).
        .append_pair("limit", "-50");
    let got = crate::api::send(
        ctx,
        &url,
        None,
        Some("application/json"),
        deadline(ctx, Duration::from_secs(8)),
        true,
    )
    .await?;
    if !(200..300).contains(&got.status) {
        return Err(format!("HTTP {}", got.status));
    }
    // CDX answers an empty body when nothing matches.
    let rows: Vec<Vec<String>> = if got.body.trim().is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(&got.body).map_err(|e| format!("not a JSON list of rows ({e})"))?
    };
    // The first row is the header.
    let shown = rows
        .iter()
        .skip(1)
        .rev()
        .filter(|r| r.len() >= 4)
        .map(|r| format!("{} {} {} {}", r[0], r[3], r[2], r[1]))
        .collect::<Vec<_>>()
        .join("\n");
    let shown = if shown.is_empty() {
        format!("No snapshots found for {target}.")
    } else {
        shown
    };
    Ok(Part {
        source: SOURCE,
        url,
        status: got.status,
        raw: got.body,
        shown,
        query: json!({"kind": "wayback", "target": target}),
        context: false,
    })
}
