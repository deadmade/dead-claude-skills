//! `ip`: open ports, hostnames, CPEs, tags and known vulnerabilities for an IP from Shodan `InternetDB`.

use std::net::IpAddr;
use std::time::Duration;

use rmcp::model::{CallToolResult, ContentBlock};
use serde_json::json;

use super::{Outcome, Part, deadline, render};
use crate::Ctx;
use crate::archive::is_private_ip;

const SOURCE: &str = "Shodan InternetDB";

/// Addresses no public source describes that `is_private_ip` lets through (it only guards fetch).
fn reserved(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            o[0] == 0 // 0.0.0.0/8
                || v.is_multicast()
                || o[0] >= 240 // 240.0.0.0/4 and broadcast
                || o[..3] == [192, 0, 2]
                || o[..3] == [198, 51, 100]
                || o[..3] == [203, 0, 113]
                || (o[0] == 198 && o[1] & 0xfe == 18) // benchmarking 198.18.0.0/15
        }
        IpAddr::V6(v) => {
            v.is_multicast()
                || (v.segments()[0] == 0x2001 && v.segments()[1] == 0x0db8)
                || v.to_ipv4_mapped()
                    .is_some_and(|v4| reserved(IpAddr::V4(v4)))
        }
    }
}

pub async fn run(ctx: &Ctx, target: &str) -> CallToolResult {
    let Ok(ip) = target.trim().parse::<IpAddr>() else {
        return CallToolResult::error(vec![ContentBlock::text(format!(
            "ip: {target} is not an IP address; for a name use dns"
        ))]);
    };
    if is_private_ip(ip) || reserved(ip) {
        return CallToolResult::error(vec![ContentBlock::text(format!(
            "ip: {ip} is a private or reserved address; no public source has information on it"
        ))]);
    }
    let mut o = Outcome::default();
    match ask(ctx, ip).await {
        Ok(p) => o.parts.push(p),
        Err(e) => o.failed.push(format!("{SOURCE}: {e}")),
    }
    render(ctx, "ip", &ip.to_string(), o).await
}

async fn ask(ctx: &Ctx, ip: IpAddr) -> Result<Part, String> {
    let mut url = ctx.cfg.lookup_urls.internetdb.clone();
    url.path_segments_mut()
        .map_err(|()| "base URL cannot take a path".to_owned())?
        .pop_if_empty()
        .push(&ip.to_string());
    let got = crate::api::send(
        ctx,
        &url,
        None,
        Some("application/json"),
        deadline(ctx, Duration::from_secs(8)),
        true,
    )
    .await?;
    let shown = match got.status {
        200..=299 => super::pretty(&got.body),
        // InternetDB answers 404 for an address it has never seen.
        404 => format!("InternetDB has no information on {ip}."),
        s => return Err(format!("HTTP {s}")),
    };
    Ok(Part {
        source: SOURCE,
        url,
        status: got.status,
        raw: got.body,
        shown,
        query: json!({"kind": "ip", "target": ip.to_string()}),
        context: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_ranges() {
        for a in [
            "0.1.2.3",
            "224.0.0.1",
            "255.255.255.255",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "198.18.0.1",
            "240.0.0.1",
            "2001:db8::1",
            "ff02::1",
        ] {
            assert!(reserved(a.parse().unwrap()), "{a}");
        }
        assert!(!reserved("8.8.8.8".parse().unwrap()));
    }
}
