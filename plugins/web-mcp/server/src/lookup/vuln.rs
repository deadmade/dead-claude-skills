//! `vuln`: a vulnerability record from OSV, with EPSS and CISA KEV for a CVE and NVD when OSV lacks it,
//! or the known vulnerabilities of one package version from OSV.

use std::fmt::Write as _;
use std::time::Duration;

use serde_json::{Value, json};

use super::{Outcome, Part, deadline};
use crate::Ctx;
use crate::api::Answer;

const ECOSYSTEMS: [&str; 10] = [
    "npm",
    "PyPI",
    "crates.io",
    "Go",
    "Maven",
    "NuGet",
    "RubyGems",
    "Packagist",
    "Pub",
    "Hex",
];
const KEV: &str = "CISA KEV";
const KEV_FEED: &str = "CISA KEV feed";
const PAGES: usize = 10;

/// An OSV id such as `CVE-2021-44228`, `GHSA-jfh8-c2jp-5v3q` or `RUSTSEC-2021-0001`, in any case.
pub fn is_id(s: &str) -> bool {
    let Some((prefix, rest)) = s.split_once('-') else {
        return false;
    };
    !prefix.is_empty()
        && prefix.chars().all(|c| c.is_ascii_alphabetic())
        && rest.chars().any(|c| c.is_ascii_digit())
        && rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == ':')
}

/// OSV ids are case-sensitive: only the prefix is uppercase (GHSA suffixes are lowercase).
pub fn normalise_id(s: &str) -> String {
    match s.split_once('-') {
        Some((p, rest)) => format!("{}-{rest}", p.to_ascii_uppercase()),
        None => s.to_owned(),
    }
}

/// `name@version`, split at the last `@` that doesn't open a scoped npm name.
pub fn split_package(s: &str) -> Option<(&str, &str)> {
    let i = s.rfind('@').filter(|&i| i > 0)?;
    let (name, version) = (&s[..i], &s[i + 1..]);
    (!version.is_empty()).then_some((name, version))
}

/// An OSV `/v1/query` body for one package version and, after the first page, its page token.
pub fn query_body(name: &str, version: &str, ecosystem: &str, token: Option<&str>) -> Value {
    let mut b = json!({"package": {"name": name, "ecosystem": ecosystem}, "version": version});
    if let Some(t) = token {
        b["page_token"] = json!(t);
    }
    b
}

/// An id's record (with EPSS and KEV for a CVE), or the vulnerabilities of `name@version` in `ecosystem`.
pub async fn run(ctx: &Ctx, target: &str, ecosystem: Option<&str>) -> Outcome {
    let t = target.trim();
    if is_id(t) {
        return record(ctx, &normalise_id(t)).await;
    }
    let mut o = Outcome::default();
    let Some((name, version)) = split_package(t) else {
        o.failed.push(format!(
            "vuln: {t} is neither a vulnerability id such as CVE-2021-44228 nor a package as name@version"
        ));
        return o;
    };
    let Some(eco) = ecosystem.map(str::trim).filter(|e| !e.is_empty()) else {
        o.failed.push(format!(
            "vuln: a package needs an ecosystem, such as {}",
            ECOSYSTEMS.join(", ")
        ));
        return o;
    };
    // OSV's ecosystem names are case-sensitive; an unknown `pypi` would find nothing.
    let eco = ECOSYSTEMS
        .into_iter()
        .find(|e| e.eq_ignore_ascii_case(eco))
        .unwrap_or(eco);
    package(ctx, name, version, eco).await
}

async fn get(ctx: &Ctx, url: &url::Url, secs: u64) -> Result<Answer, String> {
    crate::api::send(
        ctx,
        url,
        None,
        Some("application/json"),
        deadline(ctx, Duration::from_secs(secs)),
        true,
    )
    .await
}

fn pretty(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok())
        .unwrap_or_else(|| body.to_owned())
}

fn part(source: &'static str, got: Answer, shown: String, id: &str) -> Part {
    Part {
        source,
        url: got.url,
        status: got.status,
        raw: got.body,
        shown,
        query: json!({"kind": "vuln", "target": id}),
        context: false,
    }
}

/// OSV, EPSS and KEV in parallel; NVD only after OSV's 404.
async fn record(ctx: &Ctx, id: &str) -> Outcome {
    let cve = id.starts_with("CVE-");
    let (mut o, e, k) = tokio::join!(
        osv(ctx, id, cve),
        async {
            if cve {
                epss(ctx, id).await
            } else {
                Outcome::default()
            }
        },
        async {
            if cve {
                kev(ctx, id).await
            } else {
                Outcome::default()
            }
        },
    );
    for x in [e, k] {
        o.parts.extend(x.parts);
        o.failed.extend(x.failed);
    }
    o
}

async fn osv(ctx: &Ctx, id: &str, cve: bool) -> Outcome {
    let mut o = Outcome::default();
    // `is_id` allows no `/`, `?` or `#`, so the id stays one path segment.
    let got = match ctx.cfg.lookup_urls.osv.join(&format!("vulns/{id}")) {
        Ok(url) => get(ctx, &url, 8).await,
        Err(e) => Err(e.to_string()),
    };
    match got {
        Err(e) => o.failed.push(format!("OSV: {e}")),
        Ok(got) if (200..300).contains(&got.status) => {
            let shown = pretty(&got.body);
            o.parts.push(part("OSV", got, shown, id));
        }
        Ok(got) if got.status == 404 && cve => {
            o.parts.push(part(
                "OSV",
                got,
                format!("Unknown to OSV: {id}; asked NVD."),
                id,
            ));
            nvd(ctx, id, &mut o).await;
        }
        Ok(got) if got.status == 404 => {
            o.parts
                .push(part("OSV", got, format!("Unknown to OSV: {id}."), id));
        }
        Ok(got) => o.failed.push(format!("OSV: HTTP {}", got.status)),
    }
    o
}

async fn nvd(ctx: &Ctx, id: &str, o: &mut Outcome) {
    let mut url = ctx.cfg.lookup_urls.nvd.clone();
    url.query_pairs_mut().append_pair("cveId", id);
    match get(ctx, &url, 8).await {
        Err(e) => o.failed.push(format!("NVD: {e}")),
        Ok(got) if (200..300).contains(&got.status) => {
            let v: Value = serde_json::from_str(&got.body).unwrap_or_default();
            let shown = if v["totalResults"] == 0 {
                format!("Unknown to OSV and NVD: {id}.")
            } else {
                pretty(&got.body)
            };
            o.parts.push(part("NVD", got, shown, id));
        }
        Ok(got) => o.failed.push(format!("NVD: HTTP {}", got.status)),
    }
}

async fn epss(ctx: &Ctx, id: &str) -> Outcome {
    let mut o = Outcome::default();
    let mut url = ctx.cfg.lookup_urls.epss.clone();
    url.query_pairs_mut().append_pair("cve", id);
    match get(ctx, &url, 8).await {
        Err(e) => o.failed.push(format!("EPSS: {e}")),
        Ok(got) if (200..300).contains(&got.status) => {
            let v: Value = serde_json::from_str(&got.body).unwrap_or_default();
            let s = |d: &Value, k: &str| d[k].as_str().unwrap_or("?").to_owned();
            let shown = match v["data"].get(0) {
                Some(d) => format!(
                    "{id}: EPSS {} (percentile {}) on {}",
                    s(d, "epss"),
                    s(d, "percentile"),
                    s(d, "date")
                ),
                None => format!("No EPSS score for {id}."),
            };
            o.parts.push(part("EPSS", got, shown, id));
        }
        Ok(got) => o.failed.push(format!("EPSS: HTTP {}", got.status)),
    }
    o
}

/// The KEV entry for `id`. The feed (~1.8 MB) is fetched once per run and archived as a `context` part.
async fn kev(ctx: &Ctx, id: &str) -> Outcome {
    let mut o = Outcome::default();
    let url = &ctx.cfg.lookup_urls.kev;
    let feed = ctx
        .lookup
        .kev
        .get_or_try_init(|| async {
            let got = get(ctx, url, 20).await?;
            if !(200..300).contains(&got.status) {
                return Err(format!("HTTP {}", got.status));
            }
            let v: Value =
                serde_json::from_str(&got.body).map_err(|e| format!("not JSON ({e})"))?;
            o.parts.push(Part {
                source: KEV_FEED,
                url: got.url,
                status: got.status,
                raw: got.body,
                shown: String::new(),
                query: json!({"kind": "vuln", "file": "known_exploited_vulnerabilities.json"}),
                context: true,
            });
            Ok(v)
        })
        .await;
    let feed = match feed {
        Ok(f) => f,
        Err(e) => {
            o.failed.push(format!("{KEV_FEED}: {e}"));
            return o;
        }
    };
    let hit = feed["vulnerabilities"]
        .as_array()
        .and_then(|a| a.iter().find(|e| e["cveID"] == id));
    let (raw, shown) = if let Some(e) = hit {
        (
            e.to_string(),
            serde_json::to_string_pretty(e).unwrap_or_default(),
        )
    } else {
        let s = format!("{id} is not in CISA's Known Exploited Vulnerabilities catalog.");
        (s.clone(), s)
    };
    o.parts.push(Part {
        source: KEV,
        url: url.clone(),
        status: 200,
        raw,
        shown,
        query: json!({"kind": "vuln", "target": id}),
        context: false,
    });
    o
}

/// Every page of OSV's answer for one package version. Each page is archived and cited; the last one
/// shows the whole list.
async fn package(ctx: &Ctx, name: &str, version: &str, eco: &str) -> Outcome {
    let mut o = Outcome::default();
    let url = match ctx.cfg.lookup_urls.osv.join("query") {
        Ok(u) => u,
        Err(e) => {
            o.failed.push(format!("OSV: {e}"));
            return o;
        }
    };
    let target = format!("{name}@{version}");
    let mut vulns = Vec::new();
    let mut token: Option<String> = None;
    // shortcut: stops after 10 pages; raise if real packages exceed it
    for page in 1..=PAGES {
        let body = query_body(name, version, eco, token.as_deref());
        let got = match crate::api::send(
            ctx,
            &url,
            Some(&body),
            Some("application/json"),
            deadline(ctx, Duration::from_secs(8)),
            true,
        )
        .await
        {
            Ok(g) if (200..300).contains(&g.status) => g,
            Ok(g) => {
                o.failed.push(format!("OSV: HTTP {}", g.status));
                break;
            }
            Err(e) => {
                o.failed.push(format!("OSV: {e}"));
                break;
            }
        };
        let v: Value = match serde_json::from_str(&got.body) {
            Ok(v) => v,
            Err(e) => {
                o.failed.push(format!("OSV: not JSON ({e})"));
                break;
            }
        };
        vulns.extend(v["vulns"].as_array().cloned().unwrap_or_default());
        token = v["next_page_token"]
            .as_str()
            .filter(|t| !t.is_empty())
            .map(str::to_owned);
        o.parts.push(Part {
            source: "OSV",
            url: got.url,
            status: got.status,
            raw: got.body,
            shown: String::new(),
            query: json!({"kind": "vuln", "target": target, "ecosystem": eco, "body": body}),
            context: true,
        });
        if token.is_none() {
            break;
        }
        if page == PAGES {
            o.failed.push(format!(
                "OSV: stopped after {PAGES} pages; the list is incomplete"
            ));
        }
    }
    if let Some(last) = o.parts.last_mut() {
        last.context = false;
        last.shown = listing(&target, eco, &vulns);
    }
    o
}

/// One line per vulnerability: its id, aliases and summary.
fn listing(target: &str, eco: &str, vulns: &[Value]) -> String {
    if vulns.is_empty() {
        return format!("No known vulnerabilities for {target} ({eco}).");
    }
    let mut out = format!(
        "{} known vulnerabilities for {target} ({eco}); the full records are in the archive.",
        vulns.len()
    );
    for v in vulns {
        out.push('\n');
        out.push_str(v["id"].as_str().unwrap_or("?"));
        let aliases: Vec<_> = v["aliases"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        if !aliases.is_empty() {
            let _ = write!(out, " ({})", aliases.join(", "));
        }
        if let Some(s) = v["summary"].as_str() {
            let _ = write!(out, " · {s}");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_package_at_last_at() {
        assert_eq!(
            split_package("@types/node@20.1.0"),
            Some(("@types/node", "20.1.0"))
        );
        assert_eq!(split_package("serde@1.0.0"), Some(("serde", "1.0.0")));
        assert_eq!(split_package("@types/node"), None);
        assert_eq!(split_package("serde@"), None);
        assert_eq!(split_package("serde"), None);
    }

    #[test]
    fn ids() {
        for s in [
            "CVE-2021-44228",
            "cve-2021-44228",
            "GHSA-jfh8-c2jp-5v3q",
            "RUSTSEC-2021-0001",
            "PYSEC-2021-1",
            "GO-2022-0001",
        ] {
            assert!(is_id(s), "{s}");
        }
        for s in [
            "serde@1.0.0",
            "left-pad",
            "serde",
            "CVE-",
            "-2021",
            "a b-1",
            "x/y-1",
        ] {
            assert!(!is_id(s), "{s}");
        }
    }

    #[test]
    fn normalise_uppercases_prefix_only() {
        assert_eq!(normalise_id("cve-2021-44228"), "CVE-2021-44228");
        assert_eq!(normalise_id("ghsa-jfh8-c2jp-5v3q"), "GHSA-jfh8-c2jp-5v3q");
    }

    #[test]
    fn query_body_carries_token() {
        assert_eq!(
            query_body("serde", "1.0.0", "crates.io", None),
            json!({"package": {"name": "serde", "ecosystem": "crates.io"}, "version": "1.0.0"})
        );
        assert_eq!(
            query_body("serde", "1.0.0", "crates.io", Some("tok"))["page_token"],
            "tok"
        );
    }
}
