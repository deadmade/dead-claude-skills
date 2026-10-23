//! Bing: `li.b_algo` rows in `#b_results`; ads are `li.b_ad` siblings and never match.

use base64::Engine as _;
use dom_query::Document;
use url::Url;

use super::{Block, Found, Parsed, Since, captcha_if, first_text, on_domain, row, verdict};

pub(super) const READY: &str = r#"!!(
  document.body &&
  (document.querySelector('#b_results > li.b_algo') ||
    document.querySelector('#b_results > li.b_no') ||
    location.pathname.startsWith('/challenge') ||
    document.querySelector('#b_captcha, iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"]'))
);"#;

pub(super) fn url(query: &str, since: Option<Since>) -> Url {
    let mut u = Url::parse_with_params(
        "https://www.bing.com/search",
        [("q", query), ("setlang", "en-US"), ("cc", "US")],
    )
    .expect("static URL");
    if let Some(s) = since {
        let filter = match s {
            Since::Day => "ez1".to_owned(),
            Since::Week => "ez2".to_owned(),
            Since::Month => "ez3".to_owned(),
            // A custom range, in days since the epoch.
            Since::Year => {
                let today = jiff::Timestamp::now().as_second().div_euclid(86_400);
                format!("ez5_{}_{today}", today - 365)
            }
        };
        u.query_pairs_mut()
            .append_pair("filters", &format!("ex1:\"{filter}\""));
    }
    u
}

/// Bing sometimes wraps a link as `bing.com/ck/a?u=a1<base64url of the target>`.
fn unwrap_redirect(href: &str) -> String {
    let target = Url::parse(href)
        .ok()
        .filter(|u| on_domain(u, "bing.com") && u.path() == "/ck/a")
        .and_then(|u| {
            u.query_pairs()
                .find(|(k, _)| k == "u")
                .map(|(_, v)| v.into_owned())
        })
        .and_then(|u| u.strip_prefix("a1").map(str::to_owned))
        .and_then(|b| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(b)
                .ok()
        })
        .and_then(|b| String::from_utf8(b).ok());
    target.unwrap_or_else(|| href.to_owned())
}

pub(super) fn parse(doc: &Document, page: &Url) -> Parsed {
    let found = doc
        .select("#b_results > li.b_algo")
        .iter()
        .filter_map(|li| {
            let a = li.select("h2 a").first();
            let snippet = first_text(&li, ".b_caption p, .b_lineclamp2, .b_algoSlug");
            row(
                page,
                &unwrap_redirect(&a.attr("href")?),
                super::text(&a),
                snippet,
            )
        })
        .filter(|f: &Found| !on_domain(&f.url, "bing.com"))
        .collect();
    let block = captcha_if(
        doc,
        "#b_captcha, iframe[src*=\"captcha\"], iframe[src*=\"challenges.cloudflare.com\"]",
    )
    .or_else(|| {
        page.path()
            .starts_with("/challenge")
            .then_some(Block::Captcha)
    });
    verdict(found, block, doc.select("#b_results > li.b_no").exists())
}

#[cfg(test)]
mod tests {
    use super::super::tests::{assert_results, url};
    use super::super::{Block, Engine, Parsed};

    const PAGE: &str = include_str!("../../tests/fixtures/engines/bing.html");
    const ADS: &str = include_str!("../../tests/fixtures/engines/bing-ads.html");
    const NONE: &str = include_str!("../../tests/fixtures/engines/bing-none.html");

    fn page() -> url::Url {
        url("https://www.bing.com/search?q=x")
    }

    #[test]
    fn bing_parses_fixture() {
        assert_results(Engine::Bing.parse(PAGE, &page()), Some("bing.com"));
    }

    #[test]
    fn bing_no_results_is_empty() {
        assert_eq!(Engine::Bing.parse(NONE, &page()), Parsed::Results(vec![]));
    }

    #[test]
    fn bing_skips_ads() {
        let doc = dom_query::Document::from(ADS);
        assert!(doc.select("li.b_ad").exists(), "the fixture has no ads");
        let ad_hrefs: Vec<_> = doc
            .select("li.b_ad a[href^=\"http\"]")
            .iter()
            .filter_map(|a| a.attr("href"))
            .collect();
        let found = assert_results(Engine::Bing.parse(ADS, &page()), Some("bing.com"));
        assert_eq!(found.len(), doc.select("#b_results > li.b_algo").length());
        assert!(
            found
                .iter()
                .all(|f| !ad_hrefs.iter().any(|h| **h == *f.url.as_str()))
        );
    }

    #[test]
    fn bing_unwraps_redirect_links() {
        let wrapped = "https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly90b2tpby5ycy94&ntb=1";
        assert_eq!(super::unwrap_redirect(wrapped), "https://tokio.rs/x");
        assert_eq!(
            super::unwrap_redirect("https://tokio.rs/y"),
            "https://tokio.rs/y"
        );
    }

    #[test]
    fn bing_challenge_is_a_captcha() {
        let html = "<html><body><div id=\"b_captcha\"></div></body></html>";
        assert_eq!(
            Engine::Bing.parse(html, &page()),
            Parsed::Blocked(Block::Captcha)
        );
    }
}
