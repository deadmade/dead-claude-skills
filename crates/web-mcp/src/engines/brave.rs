//! Brave: `.snippet[data-type="web"]` rows. It loosens a query nobody matches instead of answering with an empty
//! page, so there is no no-results marker: rows, a captcha, or `Unrecognised`.

use dom_query::Document;
use url::Url;

use super::{Found, Parsed, Since, captcha_if, first_text, row, verdict};

pub(super) const READY: &str = r#"!!(
  document.body &&
  (document.querySelector('.snippet[data-type="web"]') ||
    /No results found|Not many great matches/.test(
      (document.querySelector('#results, main') || {}).innerText || '',
    ) ||
    document.querySelector('#captcha, form[action*="captcha"]'))
);"#;

pub(super) fn url(query: &str, since: Option<Since>) -> Url {
    let mut u = Url::parse_with_params(
        "https://search.brave.com/search",
        [("q", query), ("source", "web"), ("lang", "en")],
    )
    .expect("static URL");
    if let Some(s) = since {
        let tf = match s {
            Since::Day => "pd",
            Since::Week => "pw",
            Since::Month => "pm",
            Since::Year => "py",
        };
        u.query_pairs_mut().append_pair("tf", tf);
    }
    u
}

pub(super) fn parse(doc: &Document, page: &Url) -> Parsed {
    let found = doc
        .select(".snippet[data-type=\"web\"]")
        .iter()
        .filter_map(|snippet| {
            let a = snippet.select("a[href]").first();
            let title = first_text(&snippet, ".title");
            row(
                page,
                &a.attr("href")?,
                title,
                first_text(&snippet, ".generic-snippet .content"),
            )
        })
        .filter(|f: &Found| f.url.host() != page.host())
        .collect();
    // No title check: Brave puts the query in the title (R14).
    let block = captcha_if(doc, "#captcha, form[action*=\"captcha\"]");
    verdict(found, block, false)
}

#[cfg(test)]
mod tests {
    use super::super::tests::{assert_results, url};
    use super::super::{Block, Engine, Parsed};

    const PAGE: &str = include_str!("../../tests/fixtures/engines/brave.html");

    fn page() -> url::Url {
        url("https://search.brave.com/search?q=x")
    }

    #[test]
    fn brave_parses_fixture() {
        let found = assert_results(Engine::Brave.parse(PAGE, &page()), Some("search.brave.com"));
        assert_eq!(found.len(), 20);
    }

    #[test]
    fn brave_without_rows_is_unrecognised() {
        let html = "<html><body><main>Loading</main></body></html>";
        assert_eq!(Engine::Brave.parse(html, &page()), Parsed::Unrecognised);
    }

    #[test]
    fn brave_ignores_captcha_in_the_title() {
        let html =
            "<html><head><title>captcha solver - Brave Search</title></head><body></body></html>";
        assert_eq!(Engine::Brave.parse(html, &page()), Parsed::Unrecognised);
    }

    #[test]
    fn brave_captcha_is_a_block() {
        let html = "<html><body><div id=\"captcha\"></div></body></html>";
        assert_eq!(
            Engine::Brave.parse(html, &page()),
            Parsed::Blocked(Block::Captcha)
        );
    }
}
