//! `certs`: certificates for a domain and its subdomains from crt.sh's Certificate Transparency search.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::time::Duration;

use serde_json::{Value, json};

use super::{Outcome, Part, deadline};
use crate::Ctx;

const SOURCE: &str = "crt.sh";

/// Certificates for `domain` and its subdomains that haven't expired. crt.sh is slow: 25 s per attempt.
pub async fn run(ctx: &Ctx, domain: &str) -> Outcome {
    let mut o = Outcome::default();
    match ask(ctx, domain).await {
        Ok(p) => o.parts.push(p),
        Err(e) => o.failed.push(format!("{SOURCE}: {e}")),
    }
    o
}

async fn ask(ctx: &Ctx, domain: &str) -> Result<Part, String> {
    let mut url = ctx.cfg.lookup_urls.crtsh.clone();
    url.query_pairs_mut()
        .append_pair("q", &format!("%.{domain}"))
        .append_pair("output", "json")
        .append_pair("exclude", "expired");
    let got = crate::api::send(
        ctx,
        &url,
        None,
        Some("application/json"),
        deadline(ctx, Duration::from_secs(25)),
        true,
    )
    .await?;
    if !(200..300).contains(&got.status) {
        return Err(format!("HTTP {}", got.status));
    }
    // crt.sh answers an empty body when nothing matches.
    let rows: Vec<Value> = if got.body.trim().is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(&got.body).map_err(|e| format!("not a JSON list ({e})"))?
    };
    let shown = if rows.is_empty() {
        format!("No certificates found for {domain} and its subdomains.")
    } else {
        condense(&rows)
    };
    Ok(Part {
        source: SOURCE,
        url,
        status: got.status,
        raw: got.body,
        shown,
        query: json!({"kind": "certs", "target": domain}),
        context: false,
    })
}

/// The distinct names over all rows, sorted, each with its issuer and first and last validity.
pub fn condense(rows: &[Value]) -> String {
    // name -> (issuer of the row ending last, first not_before, last not_after)
    let mut names: BTreeMap<String, (&str, &str, &str)> = BTreeMap::new();
    for r in rows {
        let issuer = r["issuer_name"].as_str().unwrap_or("?");
        let from = r["not_before"].as_str().unwrap_or("?");
        let to = r["not_after"].as_str().unwrap_or("?");
        for n in r["name_value"].as_str().unwrap_or_default().lines() {
            let e = names
                .entry(n.trim().to_lowercase())
                .or_insert((issuer, from, to));
            if to > e.2 {
                e.0 = issuer;
                e.2 = to;
            }
            if from < e.1 {
                e.1 = from;
            }
        }
    }
    let mut out = format!("{} certificates, {} names", rows.len(), names.len());
    for (n, (issuer, from, to)) in &names {
        let _ = write!(out, "\n{n} · {issuer} · {from} → {to}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn condense_dedupes_names() {
        let rows = [
            json!({"name_value": "a.example.com\nwww.example.com", "issuer_name": "I1",
                   "not_before": "2026-02-01", "not_after": "2026-05-01"}),
            json!({"name_value": "A.example.com", "issuer_name": "I1",
                   "not_before": "2026-01-01", "not_after": "2026-04-01"}),
        ];
        assert_eq!(
            condense(&rows),
            "2 certificates, 2 names\n\
             a.example.com · I1 · 2026-01-01 → 2026-05-01\n\
             www.example.com · I1 · 2026-02-01 → 2026-05-01"
        );
    }
}
