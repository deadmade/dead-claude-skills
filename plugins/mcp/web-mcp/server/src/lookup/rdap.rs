//! `whois`: RDAP records from the registry that IANA's bootstrap files name (never rdap.org), not port-43 whois.

use std::fmt;
use std::net::IpAddr;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::OnceCell;
use url::Url;

use super::{Outcome, Part, deadline, dns};
use crate::Ctx;

const SOURCE: &str = "RDAP";
const BOOTSTRAP: &str = "IANA RDAP bootstrap";

/// Each service's entries with its base URL (ending in `/`).
pub struct Bootstrap(Vec<(Vec<String>, Url)>);

impl Bootstrap {
    /// The first https URL of each service, else its first http one (RFC 9224).
    pub fn parse(json: &str) -> Result<Self, String> {
        let v: Value = serde_json::from_str(json).map_err(|e| format!("not JSON ({e})"))?;
        let services = v["services"].as_array().ok_or("no \"services\" list")?;
        let strs = |s: &Value, i: usize| -> Vec<String> {
            s[i].as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default()
        };
        let mut out = Vec::new();
        for s in services {
            let urls: Vec<Url> = strs(s, 1)
                .iter()
                .filter_map(|u| Url::parse(u).ok())
                .collect();
            let pick = |scheme: &str| urls.iter().find(|u| u.scheme() == scheme);
            let Some(mut base) = pick("https").or_else(|| pick("http")).cloned() else {
                continue;
            };
            if !base.path().ends_with('/') {
                base.set_path(&format!("{}/", base.path()));
            }
            let entries = strs(s, 0).iter().map(|e| e.to_ascii_lowercase()).collect();
            out.push((entries, base));
        }
        Ok(Self(out))
    }

    /// The service whose entry scores highest for `score` (`None`: no match).
    fn best(&self, score: impl Fn(&str) -> Option<u64>) -> Option<&Url> {
        self.0
            .iter()
            .filter_map(|(es, u)| es.iter().filter_map(|e| score(e)).max().map(|s| (s, u)))
            .max_by_key(|(s, _)| *s)
            .map(|(_, u)| u)
    }

    /// The longest entry that is `name` or a parent of it (a TLD such as `com`).
    pub fn domain(&self, name: &str) -> Option<&Url> {
        let name = name.to_ascii_lowercase();
        self.best(|e| (name == e || name.ends_with(&format!(".{e}"))).then_some(e.len() as u64))
    }

    /// The longest CIDR prefix holding `ip`.
    pub fn ip(&self, ip: IpAddr) -> Option<&Url> {
        self.best(|e| {
            let (net, len) = e.split_once('/')?;
            let len: u32 = len.parse().ok()?;
            let hit = match (ip, net.parse::<IpAddr>().ok()?) {
                (IpAddr::V4(a), IpAddr::V4(n)) if len <= 32 => {
                    let mask = u32::MAX.checked_shl(32 - len).unwrap_or(0);
                    u32::from(a) & mask == u32::from(n) & mask
                }
                (IpAddr::V6(a), IpAddr::V6(n)) if len <= 128 => {
                    let mask = u128::MAX.checked_shl(128 - len).unwrap_or(0);
                    u128::from(a) & mask == u128::from(n) & mask
                }
                _ => false,
            };
            hit.then_some(u64::from(len))
        })
    }

    /// The narrowest range holding `n`; an entry is `2043` or `64512-65534`.
    pub fn asn(&self, n: u32) -> Option<&Url> {
        self.best(|e| {
            let (lo, hi) = e.split_once('-').unwrap_or((e, e));
            let (lo, hi): (u32, u32) = (lo.parse().ok()?, hi.parse().ok()?);
            (lo..=hi)
                .contains(&n)
                .then(|| u64::from(u32::MAX - (hi - lo)))
        })
    }
}

enum Target {
    Domain(String),
    Ip(IpAddr),
    Asn(u32),
}

impl Target {
    fn parse(raw: &str) -> Result<Self, String> {
        let t = raw.trim();
        if let Ok(ip) = t.parse::<IpAddr>() {
            return Ok(Self::Ip(ip.to_canonical()));
        }
        if let Some(n) = t
            .get(..2)
            .filter(|p| p.eq_ignore_ascii_case("as"))
            .and_then(|_| t[2..].parse().ok())
        {
            return Ok(Self::Asn(n));
        }
        dns::name(t).map(Self::Domain).map_err(|_| {
            format!("whois: {raw} is not a domain, an IP address or an AS number such as AS2043")
        })
    }
}

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Domain(d) => f.write_str(d),
            Self::Ip(ip) => write!(f, "{ip}"),
            Self::Asn(n) => write!(f, "AS{n}"),
        }
    }
}

/// `target` as it is asked: a lowercase punycode name, a normalised IP or `AS<n>`.
pub fn target(raw: &str) -> Result<String, String> {
    Target::parse(raw).map(|t| t.to_string())
}

/// Loads a bootstrap file on first use; that load is archived as a `context` part.
async fn bootstrap<'a>(
    ctx: &Ctx,
    cell: &'a OnceCell<Bootstrap>,
    file: &str,
    o: &mut Outcome,
) -> Result<&'a Bootstrap, String> {
    cell.get_or_try_init(|| async {
        let url = ctx
            .cfg
            .lookup_urls
            .rdap_bootstrap
            .join(file)
            .map_err(|e| e.to_string())?;
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
        let b = Bootstrap::parse(&got.body)?;
        o.parts.push(Part {
            source: BOOTSTRAP,
            url: got.url,
            status: got.status,
            raw: got.body,
            shown: String::new(),
            query: json!({"kind": "whois", "file": file}),
            context: true,
        });
        Ok(b)
    })
    .await
}

/// The RDAP record for `target` (as `target()` returns it), from the registry the bootstrap names.
pub async fn run(ctx: &Ctx, target: &str) -> Outcome {
    let mut o = Outcome::default();
    let t = match Target::parse(target) {
        Ok(t) => t,
        Err(e) => {
            o.failed.push(e);
            return o;
        }
    };
    let cache = &ctx.lookup;
    let (cell, file, path) = match &t {
        Target::Domain(d) => (&cache.dns, "dns.json", format!("domain/{d}")),
        Target::Ip(ip @ IpAddr::V4(_)) => (&cache.ipv4, "ipv4.json", format!("ip/{ip}")),
        Target::Ip(ip) => (&cache.ipv6, "ipv6.json", format!("ip/{ip}")),
        Target::Asn(n) => (&cache.asn, "asn.json", format!("autnum/{n}")),
    };
    let boot = match bootstrap(ctx, cell, file, &mut o).await {
        Ok(book) => book,
        Err(e) => {
            o.failed.push(format!("{BOOTSTRAP} {file}: {e}"));
            return o;
        }
    };
    let base = match &t {
        Target::Domain(d) => boot.domain(d),
        Target::Ip(ip) => boot.ip(*ip),
        Target::Asn(n) => boot.asn(*n),
    };
    let Some(base) = base else {
        let what = match &t {
            Target::Domain(d) => format!(".{}", d.rsplit('.').next().unwrap_or(d)),
            _ => t.to_string(),
        };
        o.failed.push(format!(
            "{SOURCE}: no RDAP server for {what} in IANA's bootstrap; port-43 whois isn't supported"
        ));
        return o;
    };
    let got = match base.join(&path) {
        Ok(url) => {
            crate::api::send(
                ctx,
                &url,
                None,
                Some("application/rdap+json"),
                deadline(ctx, Duration::from_secs(8)),
                true,
            )
            .await
        }
        Err(e) => Err(e.to_string()),
    };
    let got = match got {
        Ok(g) => g,
        Err(e) => {
            o.failed.push(format!("{SOURCE}: {e}"));
            return o;
        }
    };
    let pretty = serde_json::from_str::<Value>(&got.body)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok());
    let shown = match (got.status, pretty) {
        (200..=299, p) => p.unwrap_or_else(|| got.body.clone()),
        (404, p) => format!(
            "Not found: {t} has no RDAP record at {}.{}",
            got.url,
            p.map_or_else(String::new, |p| format!("\n\n{p}"))
        ),
        (status, _) => {
            o.failed.push(format!("{SOURCE}: HTTP {status}"));
            return o;
        }
    };
    o.parts.push(Part {
        source: SOURCE,
        url: got.url,
        status: got.status,
        raw: got.body,
        shown,
        query: json!({"kind": "whois", "target": t.to_string()}),
        context: false,
    });
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boot(entries: &[(&[&str], &[&str])]) -> Bootstrap {
        let services: Vec<Value> = entries.iter().map(|(e, u)| json!([e, u])).collect();
        Bootstrap::parse(&json!({"services": services}).to_string()).unwrap()
    }

    fn host(u: Option<&Url>) -> &str {
        u.and_then(Url::host_str).unwrap_or("none")
    }

    #[test]
    fn ipv4_cidr_longest_match() {
        let b = boot(&[
            (&["8.0.0.0/8"], &["https://wide.example/"]),
            (&["8.8.0.0/16", "1.0.0.0/8"], &["https://narrow.example/"]),
        ]);
        assert_eq!(host(b.ip("8.8.8.8".parse().unwrap())), "narrow.example");
        assert_eq!(host(b.ip("8.1.1.1".parse().unwrap())), "wide.example");
        assert_eq!(host(b.ip("9.9.9.9".parse().unwrap())), "none");
    }

    #[test]
    fn ipv6_cidr_match() {
        let b = boot(&[(&["2001:db8::/32"], &["https://v6.example/"])]);
        assert_eq!(host(b.ip("2001:db8::1".parse().unwrap())), "v6.example");
        assert_eq!(host(b.ip("2001:db9::1".parse().unwrap())), "none");
    }

    #[test]
    fn full_and_empty_masks() {
        let b = boot(&[
            (&["0.0.0.0/0"], &["https://any.example/"]),
            (&["1.2.3.4/32"], &["https://one.example/"]),
            (&["::/0"], &["https://any6.example/"]),
            (&["::1/128"], &["https://one6.example/"]),
        ]);
        assert_eq!(host(b.ip("1.2.3.4".parse().unwrap())), "one.example");
        assert_eq!(host(b.ip("1.2.3.5".parse().unwrap())), "any.example");
        assert_eq!(host(b.ip("::1".parse().unwrap())), "one6.example");
        assert_eq!(host(b.ip("::2".parse().unwrap())), "any6.example");
    }

    #[test]
    fn asn_range_match() {
        let b = boot(&[(&["64512-65534"], &["https://priv.example/"])]);
        assert_eq!(host(b.asn(64512)), "priv.example");
        assert_eq!(host(b.asn(65534)), "priv.example");
        assert_eq!(host(b.asn(65535)), "none");
    }

    #[test]
    fn asn_bare_number_matches() {
        let b = boot(&[(&["2043"], &["https://one.example/"])]);
        assert_eq!(host(b.asn(2043)), "one.example");
        assert_eq!(host(b.asn(2044)), "none");
    }

    #[test]
    fn tld_match_is_case_insensitive() {
        let b = boot(&[(&["COM"], &["https://com.example/"])]);
        assert_eq!(host(b.domain("Example.Com")), "com.example");
        assert_eq!(host(b.domain("example.de")), "none");
        assert_eq!(host(b.domain("notcom")), "none");
    }

    #[test]
    fn prefers_https_falls_back_to_http() {
        let b = boot(&[
            (
                &["a"],
                &["http://plain.example/x", "https://secure.example/x"],
            ),
            (&["b"], &["http://only.example/y"]),
        ]);
        assert_eq!(b.domain("a").unwrap().as_str(), "https://secure.example/x/");
        assert_eq!(b.domain("b").unwrap().as_str(), "http://only.example/y/");
    }

    #[test]
    fn targets_are_told_apart() {
        assert_eq!(target("as2043").unwrap(), "AS2043");
        assert_eq!(target("2001:DB8::1").unwrap(), "2001:db8::1");
        assert_eq!(target("Example.COM.").unwrap(), "example.com");
        assert_eq!(target("::ffff:8.8.8.8").unwrap(), "8.8.8.8");
        assert!(target("http://x/y").is_err());
    }
}
