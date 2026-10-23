//! Google: a result is an `a` holding an `h3`, inside `#rso`/`#search`. No result page was captured (the line was
//! rate-limited, findings.md), so the row selectors come from the markup maintained scrapers use today and are
//! unverified; the block and consent markers are checked against fixtures.

use dom_query::Document;
use url::Url;

use super::{Block, Found, Parsed, Since, captcha_if, first_text, on_domain, row, text, verdict};

pub(super) const READY: &str = r#"!!(
  document.body &&
  (document.querySelector('#rso a h3, #search a h3') ||
    /did not match any documents/.test(
      (document.querySelector('#topstuff, #botstuff, #rcnt') || {}).innerText || '',
    ) ||
    location.pathname.startsWith('/sorry') ||
    document.querySelector('#captcha-form, form[action="index"] #recaptcha'))
);"#;

pub(super) fn url(query: &str, since: Option<Since>) -> Url {
    let mut u = Url::parse_with_params(
        "https://www.google.com/search",
        [("q", query), ("hl", "en"), ("gl", "us"), ("num", "10")],
    )
    .expect("static URL");
    if let Some(s) = since {
        let qdr = match s {
            Since::Day => "qdr:d",
            Since::Week => "qdr:w",
            Since::Month => "qdr:m",
            Since::Year => "qdr:y",
        };
        u.query_pairs_mut().append_pair("tbs", qdr);
    }
    u
}

/// Google's `/url?q=<target>&sa=U` becomes the target; anything else stays.
fn unwrap_redirect(page: &Url, href: &str) -> String {
    let target = page
        .join(href)
        .ok()
        .filter(|u| on_domain(u, "google.com") && u.path() == "/url")
        .and_then(|u| {
            u.query_pairs()
                .find(|(k, _)| k == "q" || k == "url")
                .map(|(_, v)| v.into_owned())
        });
    target.unwrap_or_else(|| href.to_owned())
}

pub(super) fn parse(doc: &Document, page: &Url) -> Parsed {
    let found = doc
        .select("#rso .MjjYud, #rso .g, #search .MjjYud, #search .g")
        .iter()
        .filter_map(|block| {
            let a = block.select("a:has(h3)").first();
            let snippet = first_text(&block, ".VwiC3b, [data-sncf]");
            row(
                page,
                &unwrap_redirect(page, &a.attr("href")?),
                text(&a.select("h3").first()),
                snippet,
            )
        })
        .filter(|f: &Found| !on_domain(&f.url, "google.com"))
        .collect();
    let block = if page.host_str() == Some("consent.google.com")
        || doc.select("form[action*=\"consent.google.com\"]").exists()
    {
        Some(Block::Consent)
    } else {
        captcha_if(doc, "#captcha-form")
            .or_else(|| page.path().starts_with("/sorry").then_some(Block::Captcha))
    };
    let none =
        text(&doc.select("#topstuff, #botstuff, #rcnt")).contains("did not match any documents");
    verdict(found, block, none)
}

#[cfg(test)]
mod tests {
    use super::super::tests::{assert_results, url};
    use super::super::{Block, Engine, Parsed};

    const CAPTCHA: &str = include_str!("../../tests/fixtures/engines/google-captcha.html");
    const CONSENT: &str = include_str!("../../tests/fixtures/engines/google-consent.html");

    fn page() -> url::Url {
        url("https://www.google.com/search?q=x")
    }

    /// The pages of R8, read at run time because they aren't in the repository yet.
    fn fixture(name: &str) -> String {
        let path = format!(
            "{}/tests/fixtures/engines/{name}",
            env!("CARGO_MANIFEST_DIR")
        );
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    #[ignore = "needs a result page captured off the VPN without a burst (R8)"]
    fn google_parses_fixture() {
        assert_results(
            Engine::Google.parse(&fixture("google.html"), &page()),
            Some("google.com"),
        );
    }

    #[test]
    #[ignore = "needs a result page captured off the VPN without a burst (R8)"]
    fn google_no_results_is_empty() {
        assert_eq!(
            Engine::Google.parse(&fixture("google-none.html"), &page()),
            Parsed::Results(vec![])
        );
    }

    #[test]
    fn google_unwraps_redirect_links() {
        let html = r#"<div id="rso"><div class="g"><a href="/url?q=https://tokio.rs/x&amp;sa=U"><h3>Tokio</h3></a>
            <div class="VwiC3b">An runtime</div></div></div>"#;
        let Parsed::Results(found) = Engine::Google.parse(html, &page()) else {
            panic!("no rows");
        };
        assert_eq!(found[0].url.as_str(), "https://tokio.rs/x");
        assert_eq!(found[0].title, "Tokio");
        assert_eq!(found[0].snippet, "An runtime");
    }

    #[test]
    fn google_sorry_page_is_a_captcha() {
        let sorry = url("https://www.google.com/sorry/index?continue=x");
        assert_eq!(
            Engine::Google.parse(CAPTCHA, &sorry),
            Parsed::Blocked(Block::Captcha)
        );
        assert_eq!(
            Engine::Google.parse(CAPTCHA, &page()),
            Parsed::Blocked(Block::Captcha)
        );
    }

    #[test]
    fn google_consent_page_is_a_consent_block() {
        let consent = url("https://consent.google.com/m?continue=x");
        assert_eq!(
            Engine::Google.parse(CONSENT, &consent),
            Parsed::Blocked(Block::Consent)
        );
        assert_eq!(
            Engine::Google.parse(CONSENT, &page()),
            Parsed::Blocked(Block::Consent)
        );
    }
}
