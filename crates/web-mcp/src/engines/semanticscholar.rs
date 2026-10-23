//! Semantic Scholar: `/paper/<id>` rows. Every request met its "Human Verification" challenge, so no result page was
//! captured (findings.md): the row selectors come from the site's current markup and are unverified, the challenge
//! markers (both stages) are checked against fixtures.

use dom_query::Document;
use url::Url;

use super::{Parsed, captcha_if, first_text, row, text, verdict};

pub(super) const READY: &str = r#"!!(
  document.body &&
  (document.querySelector('[data-test-id="search-result"], .cl-paper-row') ||
    /No results|could not find any|couldn.t find any/i.test(
      (document.querySelector('[data-test-id="search-results"], main') || {}).innerText || '',
    ) ||
    document.querySelector('#captcha-container, #challenge-container') ||
    document.title === 'Human Verification')
);"#;

pub(super) fn url(query: &str) -> Url {
    Url::parse_with_params(
        "https://www.semanticscholar.org/search",
        [("q", query), ("sort", "relevance")],
    )
    .expect("static URL")
}

pub(super) fn parse(doc: &Document, page: &Url) -> Parsed {
    let found = doc
        .select("[data-test-id=\"search-result\"], .cl-paper-row")
        .iter()
        .filter_map(|r| {
            let a = r.select("a[href^=\"/paper/\"]").first();
            let snippet = first_text(&r, ".cl-paper-abstract, [data-test-id=\"abstract-text\"]");
            row(page, &a.attr("href")?, text(&a), snippet)
        })
        .collect();
    let block = captcha_if(doc, "#captcha-container, #challenge-container").or_else(|| {
        (text(&doc.select("title")) == "Human Verification").then_some(super::Block::Captcha)
    });
    let none = {
        let t = text(&doc.select("[data-test-id=\"search-results\"], main")).to_lowercase();
        t.contains("no results")
            || t.contains("could not find any")
            || t.contains("couldn't find any")
    };
    verdict(found, block, none)
}

#[cfg(test)]
mod tests {
    use super::super::tests::{assert_results, url};
    use super::super::{Block, Engine, Parsed};

    const CAPTCHA: &str = include_str!("../../tests/fixtures/engines/semanticscholar-captcha.html");
    const NOSCRIPT: &str =
        include_str!("../../tests/fixtures/engines/semanticscholar-captcha-noscript.html");

    fn page() -> url::Url {
        url("https://www.semanticscholar.org/search?q=x")
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
    fn semanticscholar_parses_fixture() {
        assert_results(
            Engine::SemanticScholar.parse(&fixture("semanticscholar.html"), &page()),
            None,
        );
    }

    #[test]
    #[ignore = "needs a result page captured off the VPN without a burst (R8)"]
    fn semanticscholar_no_results_is_empty() {
        assert_eq!(
            Engine::SemanticScholar.parse(&fixture("semanticscholar-none.html"), &page()),
            Parsed::Results(vec![])
        );
    }

    #[test]
    fn semanticscholar_keeps_paper_pages() {
        let html = r#"<div data-test-id="search-result"><a href="/paper/abc123">A paper</a>
            <div class="cl-paper-abstract">About it</div></div>
            <div data-test-id="search-result"><a href="/author/9">Someone</a></div>"#;
        let Parsed::Results(found) = Engine::SemanticScholar.parse(html, &page()) else {
            panic!("no rows");
        };
        assert_eq!(found.len(), 1);
        assert_eq!(
            found[0].url.as_str(),
            "https://www.semanticscholar.org/paper/abc123"
        );
        assert_eq!(found[0].snippet, "About it");
    }

    #[test]
    fn semanticscholar_both_challenge_stages_are_captchas() {
        for html in [CAPTCHA, NOSCRIPT] {
            assert_eq!(
                Engine::SemanticScholar.parse(html, &page()),
                Parsed::Blocked(Block::Captcha)
            );
        }
    }
}
