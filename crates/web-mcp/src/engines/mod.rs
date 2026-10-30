//! The six engines `search` reads: their query URLs and what their result pages parse into.
//!
//! Each engine's file holds its URL, its `wait --fn` expression and its parser, written from the pages captured in
//! `tests/fixtures/engines/` (`docs/features/web-mcp-search/findings.md` has the table and what no capture covers).

mod bing;
mod brave;
mod duckduckgo;
mod google;
mod scholar;
mod semanticscholar;

use std::collections::HashSet;

use dom_query::Selection;
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use url::Url;

/// How far back a search reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Since {
    Day,
    Week,
    Month,
    Year,
}

impl Since {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
            Self::Year => "year",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Engine {
    Google,
    Bing,
    DuckDuckGo,
    Brave,
    Scholar,
    SemanticScholar,
}

/// One result row; its position in the page is its rank.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub url: Url,
    pub title: String,
    pub snippet: String,
}

/// Why a page holds no results.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Block {
    Captcha,
    Consent,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Parsed {
    /// Empty is the engine's own no-results page.
    Results(Vec<Found>),
    Blocked(Block),
    /// Neither rows, nor a no-results page, nor a block: the markup changed, or the page isn't loaded.
    Unrecognised,
}

impl Engine {
    pub const ALL: [Engine; 6] = [
        Self::Google,
        Self::Bing,
        Self::DuckDuckGo,
        Self::Brave,
        Self::Scholar,
        Self::SemanticScholar,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Bing => "bing",
            Self::DuckDuckGo => "duckduckgo",
            Self::Brave => "brave",
            Self::Scholar => "scholar",
            Self::SemanticScholar => "semanticscholar",
        }
    }

    pub fn from_name(name: &str) -> Option<Engine> {
        Self::ALL
            .into_iter()
            .find(|e| e.name().eq_ignore_ascii_case(name))
    }

    pub fn papers(self) -> bool {
        matches!(self, Self::Scholar | Self::SemanticScholar)
    }

    /// The `agent-browser wait --fn` expression that is true once the page shows results, no results or a block.
    pub fn ready_js(self) -> &'static str {
        match self {
            Self::Google => google::READY,
            Self::Bing => bing::READY,
            Self::DuckDuckGo => duckduckgo::READY,
            Self::Brave => brave::READY,
            Self::Scholar => scholar::READY,
            Self::SemanticScholar => semanticscholar::READY,
        }
    }

    /// The English result page for `query`, narrowed to `since` where the engine can.
    pub fn url(self, query: &str, since: Option<Since>) -> Url {
        match self {
            Self::Google => google::url(query, since),
            Self::Bing => bing::url(query, since),
            Self::DuckDuckGo => duckduckgo::url(query, since),
            Self::Brave => brave::url(query, since),
            Self::Scholar => scholar::url(query, since),
            Self::SemanticScholar => semanticscholar::url(query),
        }
    }

    pub fn supports_since(self, s: Since) -> bool {
        match self {
            Self::Scholar => s == Since::Year,
            Self::SemanticScholar => false,
            _ => true,
        }
    }

    /// Reads the rendered page (`page` is where the browser ended up, which resolves relative links).
    pub fn parse(self, html: &str, page: &Url) -> Parsed {
        let doc = dom_query::Document::from(html);
        match self {
            Self::Google => google::parse(&doc, page),
            Self::Bing => bing::parse(&doc, page),
            Self::DuckDuckGo => duckduckgo::parse(&doc, page),
            Self::Brave => brave::parse(&doc, page),
            Self::Scholar => scholar::parse(&doc, page),
            Self::SemanticScholar => semanticscholar::parse(&doc, page),
        }
    }
}

/// The text of a selection with its whitespace (non-breaking spaces and line breaks included) collapsed.
fn text(sel: &Selection) -> String {
    sel.text().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The text of the first match of `sels` inside `row`; empty when nothing matches.
fn first_text(row: &Selection, sels: &str) -> String {
    text(&row.select(sels).first())
}

/// A result row, or `None` when its link isn't http(s) or its title is empty.
fn row(page: &Url, href: &str, title: String, snippet: String) -> Option<Found> {
    let url = page.join(href.trim()).ok()?;
    (matches!(url.scheme(), "http" | "https") && !title.is_empty()).then_some(Found {
        url,
        title,
        snippet,
    })
}

/// Whether `url` is on `domain` or a subdomain of it.
fn on_domain(url: &Url, domain: &str) -> bool {
    url.host_str()
        .is_some_and(|h| h == domain || h.ends_with(&format!(".{domain}")))
}

/// The page's verdict: rows win (repeated URLs dropped, the first kept), then a block, then the engine's own
/// no-results page.
fn verdict(found: Vec<Found>, block: Option<Block>, none: bool) -> Parsed {
    let mut seen = HashSet::new();
    let found: Vec<_> = found
        .into_iter()
        .filter(|f| seen.insert(f.url.clone()))
        .collect();
    if !found.is_empty() {
        Parsed::Results(found)
    } else if let Some(b) = block {
        Parsed::Blocked(b)
    } else if none {
        Parsed::Results(Vec::new())
    } else {
        Parsed::Unrecognised
    }
}

/// `Captcha` when `sels` matches anything.
fn captcha_if(doc: &dom_query::Document, sels: &str) -> Option<Block> {
    doc.select(sels).exists().then_some(Block::Captcha)
}

#[cfg(test)]
mod tests {
    use super::Since::{Week, Year};
    use super::*;

    pub(super) fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    /// The rows of a page that must parse: at least five, the first complete and (for web engines) off the search host `own`.
    pub(super) fn assert_results(parsed: Parsed, own: Option<&str>) -> Vec<Found> {
        let Parsed::Results(found) = parsed else {
            panic!("not results: {parsed:?}");
        };
        assert!(found.len() >= 5, "only {} rows", found.len());
        let first = &found[0];
        assert!(matches!(first.url.scheme(), "http" | "https"), "{first:?}");
        assert!(
            !first.title.is_empty() && !first.snippet.is_empty(),
            "{first:?}"
        );
        if let Some(own) = own {
            assert!(
                found.iter().all(|f| f.url.host_str() != Some(own)),
                "{found:?}"
            );
        }
        found
    }

    fn param(u: &Url, key: &str) -> Option<String> {
        u.query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
    }

    #[test]
    fn empty_body_is_unrecognised() {
        for e in Engine::ALL {
            let parsed = e.parse("<html><body></body></html>", &e.url("x", None));
            assert_eq!(parsed, Parsed::Unrecognised, "{}", e.name());
        }
    }

    #[test]
    fn urls_keep_site_and_quotes() {
        let q = "\"select!\" site:docs.rs ü";
        for e in Engine::ALL {
            assert_eq!(
                param(&e.url(q, None), "q").as_deref(),
                Some(q),
                "{}",
                e.name()
            );
        }
    }

    #[test]
    fn urls_are_english() {
        let has = |e: Engine, pairs: &[(&str, &str)]| {
            let u = e.url("x", None);
            for (k, v) in pairs {
                assert_eq!(param(&u, k).as_deref(), Some(*v), "{u}");
            }
        };
        has(Engine::Google, &[("hl", "en"), ("gl", "us"), ("num", "10")]);
        has(Engine::Bing, &[("setlang", "en-US"), ("cc", "US")]);
        has(Engine::DuckDuckGo, &[("kl", "us-en"), ("ia", "web")]);
        has(Engine::Brave, &[("source", "web"), ("lang", "en")]);
        has(Engine::Scholar, &[("hl", "en")]);
        has(Engine::SemanticScholar, &[("sort", "relevance")]);
    }

    #[test]
    fn since_maps_per_engine() {
        let week = |e: Engine, k: &str| param(&e.url("x", Some(Week)), k);
        assert_eq!(week(Engine::Google, "tbs").as_deref(), Some("qdr:w"));
        assert_eq!(week(Engine::DuckDuckGo, "df").as_deref(), Some("w"));
        assert_eq!(week(Engine::Brave, "tf").as_deref(), Some("pw"));
        assert_eq!(
            week(Engine::Bing, "filters").as_deref(),
            Some("ex1:\"ez2\"")
        );
        assert!(!Engine::Scholar.supports_since(Week));
        assert!(Engine::Scholar.supports_since(Year));
        assert!(Engine::Bing.supports_since(Year));
        assert!(!Engine::SemanticScholar.supports_since(Year));
    }

    #[test]
    fn bing_year_is_a_day_range() {
        let f = param(&Engine::Bing.url("x", Some(Year)), "filters").unwrap();
        let range = f
            .strip_prefix("ex1:\"ez5_")
            .and_then(|r| r.strip_suffix('"'))
            .unwrap();
        let (from, to) = range.split_once('_').unwrap();
        assert_eq!(
            to.parse::<i64>().unwrap() - from.parse::<i64>().unwrap(),
            365
        );
    }

    #[test]
    fn scholar_year_starts_last_year() {
        let ylo = param(&Engine::Scholar.url("x", Some(Year)), "as_ylo").unwrap();
        let this_year = jiff::Timestamp::now()
            .to_zoned(jiff::tz::TimeZone::UTC)
            .year();
        assert_eq!(ylo, (this_year - 1).to_string());
    }

    #[test]
    fn repeated_urls_yield_one_row() {
        let html = r#"<div id="gs_res_ccl_mid">
            <div class="gs_r gs_or"><h3 class="gs_rt"><a href="https://a.org/p">One</a></h3></div>
            <div class="gs_r gs_or"><h3 class="gs_rt"><a href="https://a.org/p">Again</a></h3></div></div>"#;
        let Parsed::Results(found) = Engine::Scholar.parse(html, &Engine::Scholar.url("x", None))
        else {
            panic!("no rows");
        };
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "One");
    }

    #[test]
    fn names_round_trip() {
        for e in Engine::ALL {
            assert_eq!(Engine::from_name(e.name()), Some(e));
            assert_eq!(Engine::from_name(&e.name().to_uppercase()), Some(e));
        }
        assert_eq!(Engine::from_name("GitHub"), None);
    }

    #[test]
    fn every_engine_waits_on_an_expression() {
        for e in Engine::ALL {
            assert!(e.ready_js().starts_with("!!(") && e.ready_js().ends_with(");"));
        }
    }

    #[test]
    fn only_scholars_are_papers() {
        let papers: Vec<_> = Engine::ALL.into_iter().filter(|e| e.papers()).collect();
        assert_eq!(papers, [Engine::Scholar, Engine::SemanticScholar]);
    }
}
