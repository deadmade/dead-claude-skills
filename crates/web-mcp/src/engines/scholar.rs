//! Google Scholar: `.gs_r.gs_or` rows. A `[CITATION]` row has no title link and is dropped; a result's own link
//! may sit on Scholar's host and is kept.

use dom_query::Document;
use url::Url;

use super::{Parsed, Since, captcha_if, first_text, row, text, verdict};

pub(super) const READY: &str = r"!!(
  document.body &&
  (document.querySelector('#gs_res_ccl_mid .gs_r.gs_or .gs_ri') ||
    /did not match any articles/.test((document.querySelector('#gs_res_ccl_top') || {}).innerText || '') ||
    location.pathname.startsWith('/sorry') ||
    document.querySelector('#gs_captcha_ccl, #captcha-form, #recaptcha'))
);";

pub(super) fn url(query: &str, since: Option<Since>) -> Url {
    let mut u = Url::parse_with_params(
        "https://scholar.google.com/scholar",
        [("q", query), ("hl", "en")],
    )
    .expect("static URL");
    if since == Some(Since::Year) {
        let year = jiff::Timestamp::now()
            .to_zoned(jiff::tz::TimeZone::UTC)
            .year();
        u.query_pairs_mut()
            .append_pair("as_ylo", &(year - 1).to_string());
    }
    u
}

pub(super) fn parse(doc: &Document, page: &Url) -> Parsed {
    let found = doc
        .select("#gs_res_ccl_mid .gs_r.gs_or")
        .iter()
        .filter_map(|r| {
            let a = r.select("h3.gs_rt a[href]").first();
            row(page, &a.attr("href")?, text(&a), first_text(&r, ".gs_rs"))
        })
        .collect();
    let block = captcha_if(doc, "#gs_captcha_ccl, #captcha-form, #recaptcha").or_else(|| {
        page.path()
            .starts_with("/sorry")
            .then_some(super::Block::Captcha)
    });
    let none = text(&doc.select("#gs_res_ccl_top")).contains("did not match any articles");
    verdict(found, block, none)
}

#[cfg(test)]
mod tests {
    use super::super::tests::{assert_results, url};
    use super::super::{Engine, Parsed};

    const PAGE: &str = include_str!("../../tests/fixtures/engines/scholar.html");
    const NONE: &str = include_str!("../../tests/fixtures/engines/scholar-none.html");

    fn page() -> url::Url {
        url("https://scholar.google.com/scholar?q=x")
    }

    #[test]
    fn scholar_parses_fixture() {
        let found = assert_results(Engine::Scholar.parse(PAGE, &page()), None);
        assert_eq!(found.len(), 10);
    }

    #[test]
    fn scholar_no_results_is_empty() {
        assert_eq!(
            Engine::Scholar.parse(NONE, &page()),
            Parsed::Results(vec![])
        );
    }

    #[test]
    fn scholar_drops_citation_rows_without_a_link() {
        let html = r#"<div id="gs_res_ccl_mid">
            <div class="gs_r gs_or"><div class="gs_ri"><h3 class="gs_rt"><span>[CITATION]</span> A thesis</h3></div></div>
            <div class="gs_r gs_or"><div class="gs_ri"><h3 class="gs_rt"><a href="https://a.org/p">A paper</a></h3><div class="gs_rs">About it</div></div></div>
            </div>"#;
        let Parsed::Results(found) = Engine::Scholar.parse(html, &page()) else {
            panic!("no rows");
        };
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "A paper");
    }
}
