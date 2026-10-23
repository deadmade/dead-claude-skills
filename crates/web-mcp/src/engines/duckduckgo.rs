//! `DuckDuckGo`: `article[data-testid="result"]` rows; its ad redirects live on its own host and are dropped with it.

use dom_query::Document;
use url::Url;

use super::{Found, Parsed, Since, captcha_if, first_text, row, text, verdict};

pub(super) const READY: &str = r#"!!(
  document.body &&
  (document.querySelector('article[data-testid="result"]') ||
    [...document.querySelectorAll('[data-testid="mainline"]')].some((m) =>
      /No results found for/.test(m.textContent),
    ) ||
    document.querySelector('a[href^="mailto:error-lite"], .anomaly-modal__title'))
);"#;

pub(super) fn url(query: &str, since: Option<Since>) -> Url {
    let mut u = Url::parse_with_params(
        "https://duckduckgo.com/",
        [("q", query), ("kl", "us-en"), ("ia", "web")],
    )
    .expect("static URL");
    if let Some(s) = since {
        let df = match s {
            Since::Day => "d",
            Since::Week => "w",
            Since::Month => "m",
            Since::Year => "y",
        };
        u.query_pairs_mut().append_pair("df", df);
    }
    u
}

pub(super) fn parse(doc: &Document, page: &Url) -> Parsed {
    let found = doc
        .select("article[data-testid=\"result\"]")
        .iter()
        .filter_map(|article| {
            let a = article.select("h2 a").first();
            let snippet = first_text(&article, "[data-result=\"snippet\"]");
            row(page, &a.attr("href")?, text(&a), snippet)
        })
        .filter(|f: &Found| f.url.host() != page.host())
        .collect();
    let block = captcha_if(doc, "a[href^=\"mailto:error-lite\"], .anomaly-modal__title");
    let none = doc
        .select("[data-testid=\"mainline\"]")
        .iter()
        .any(|m| m.text().contains("No results found for"));
    verdict(found, block, none)
}

#[cfg(test)]
mod tests {
    use super::super::tests::{assert_results, url};
    use super::super::{Block, Engine, Parsed};

    const PAGE: &str = include_str!("../../tests/fixtures/engines/duckduckgo.html");
    const NONE: &str = include_str!("../../tests/fixtures/engines/duckduckgo-none.html");
    const CAPTCHA: &str = include_str!("../../tests/fixtures/engines/duckduckgo-captcha.html");
    const LITE: &str = include_str!("../../tests/fixtures/engines/duckduckgo-captcha-lite.html");

    fn page() -> url::Url {
        url("https://duckduckgo.com/?q=x")
    }

    #[test]
    fn duckduckgo_parses_fixture() {
        assert_results(
            Engine::DuckDuckGo.parse(PAGE, &page()),
            Some("duckduckgo.com"),
        );
    }

    #[test]
    fn duckduckgo_no_results_is_empty() {
        assert_eq!(
            Engine::DuckDuckGo.parse(NONE, &page()),
            Parsed::Results(vec![])
        );
    }

    #[test]
    fn duckduckgo_captchas_are_blocks() {
        for html in [CAPTCHA, LITE] {
            assert_eq!(
                Engine::DuckDuckGo.parse(html, &page()),
                Parsed::Blocked(Block::Captcha)
            );
        }
    }
}
