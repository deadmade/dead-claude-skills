//! `dns`: records from Cloudflare's DNS-over-HTTPS JSON API, never from the name's own servers.

use std::time::Duration;

use serde_json::{Value, json};
use url::Host;

use super::{Outcome, Part, deadline};
use crate::Ctx;

const SOURCE: &str = "Cloudflare DoH";
const TYPES: [&str; 6] = ["A", "AAAA", "CNAME", "MX", "NS", "TXT"];

/// `target` as a DNS name: lowercase, no trailing dot, punycode. IPs, URLs and other non-names are errors.
pub fn name(target: &str) -> Result<String, String> {
    let t = target.trim();
    match Host::parse(t.strip_suffix('.').unwrap_or(t)) {
        Ok(Host::Domain(d)) if !d.is_empty() => Ok(d),
        Ok(_) => Err(format!(
            "dns: {target} is an IP address; dns takes a name such as example.com"
        )),
        Err(e) => Err(format!(
            "dns: {target} is not a DNS name ({e}); dns takes a name such as example.com"
        )),
    }
}

/// The `record` type, or the six common ones, each asked in parallel.
pub async fn run(ctx: &Ctx, name: &str, record: Option<&str>) -> Outcome {
    let types: Vec<String> = match record {
        Some(r) => vec![r.trim().to_uppercase()],
        None => TYPES.map(str::to_owned).to_vec(),
    };
    let asks = types.iter().map(|t| ask(ctx, name, t));
    let mut o = Outcome::default();
    for got in futures::future::join_all(asks).await {
        match got {
            Ok(p) => o.parts.push(p),
            Err(e) => o.failed.push(e),
        }
    }
    o
}

async fn ask(ctx: &Ctx, name: &str, t: &str) -> Result<Part, String> {
    let mut url = ctx.cfg.lookup_urls.doh.clone();
    url.query_pairs_mut()
        .append_pair("name", name)
        .append_pair("type", t);
    let fail = |e: String| format!("{SOURCE} {t}: {e}");
    let got = crate::api::send(
        ctx,
        &url,
        None,
        Some("application/dns-json"),
        deadline(ctx, Duration::from_secs(8)),
        true,
    )
    .await
    .map_err(fail)?;
    if !(200..300).contains(&got.status) {
        return Err(fail(format!("HTTP {}", got.status)));
    }
    let v: Value = serde_json::from_str(&got.body).map_err(|e| fail(format!("not JSON ({e})")))?;
    let pretty = serde_json::to_string_pretty(&v).unwrap_or_else(|_| got.body.clone());
    let shown = match note(name, &v) {
        Some(n) => format!("Type: {t}\n{n}\n\n{pretty}"),
        None => format!("Type: {t}\n\n{pretty}"),
    };
    Ok(Part {
        source: SOURCE,
        url,
        status: got.status,
        raw: got.body,
        shown,
        query: json!({"kind": "dns", "target": name, "record": t}),
        context: false,
    })
}

/// What a non-zero DNS `Status` (RCODE) means, so an error isn't read as an empty answer.
fn note(name: &str, v: &Value) -> Option<String> {
    let comment = match &v["Comment"] {
        Value::Null => String::new(),
        Value::String(s) => format!(" {s}"),
        Value::Array(a) => a
            .iter()
            .map(|c| c.as_str().map_or_else(|| c.to_string(), str::to_owned))
            .fold(String::new(), |acc, c| format!("{acc} {c}")),
        c => format!(" {c}"),
    };
    match v["Status"].as_u64() {
        Some(0) => None,
        Some(3) => Some(format!("NXDOMAIN: {name} does not exist.{comment}")),
        Some(2) => Some(format!(
            "SERVFAIL: the resolver could not answer for {name}.{comment}"
        )),
        Some(n) => Some(format!("DNS status {n} for {name}.{comment}")),
        None => Some(format!("No DNS status in the reply for {name}.{comment}")),
    }
}
