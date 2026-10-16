use dom_smoothie::Readability;
use url::Url;

#[derive(Clone)]
pub struct Page {
    pub title: String,
    pub markdown: String,
    pub images: Vec<Url>,
}

/// Main content of an HTML document as markdown. Never fails: a page readability
/// rejects (or htmd cannot convert) comes back empty, which `near_empty` flags.
pub fn extract_html(html: &str, base: &Url) -> Page {
    let empty = Page {
        title: String::new(),
        markdown: String::new(),
        images: Vec::new(),
    };
    let Ok(mut readability) = Readability::new(html, Some(base.as_str()), None) else {
        return empty;
    };
    let Ok(article) = readability.parse() else {
        return empty;
    };
    Page {
        title: article.title.clone(),
        markdown: htmd::convert(&article.content)
            .unwrap_or_default()
            .trim()
            .to_owned(),
        images: image_urls(&article.content, base),
    }
}

/// `<img src>` of the article HTML, resolved against `base`; `data:` URLs skipped.
fn image_urls(content: &str, base: &Url) -> Vec<Url> {
    let doc = dom_query::Document::from(content);
    doc.select("img[src]")
        .iter()
        .filter_map(|img| base.join(img.attr("src")?.trim()).ok())
        .filter(|u| u.scheme() != "data")
        .collect()
}

pub fn extract_pdf(bytes: &[u8]) -> anyhow::Result<String> {
    let doc = pdf_oxide::PdfDocument::from_bytes(bytes.to_vec())?;
    let mut text = String::new();
    for page in 0..doc.page_count()? {
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(doc.extract_text(page)?.trim());
    }
    Ok(text)
}

/// Pages with less text than this are probably client-rendered shells.
#[allow(dead_code)] // used by the browser fallback (Task 10)
pub fn near_empty(page: &Page) -> bool {
    page.markdown.chars().count() < 200
}

#[cfg(test)]
mod tests {
    use super::*;
    use url::Url;

    fn base() -> Url {
        Url::parse("https://example.com/blog/post").unwrap()
    }

    #[test]
    fn article_keeps_body_drops_nav() {
        let page = extract_html(include_str!("../tests/fixtures/article.html"), &base());
        assert!(
            page.title.starts_with("Why Teams Adopt Rust"),
            "{}",
            page.title
        );
        assert!(page.markdown.contains("borrow checker"));
        assert!(page.markdown.contains("Compile times are real"));
        assert!(!page.markdown.contains("Subscribe"));
        assert!(!page.markdown.contains("Privacy"));
        assert!(!near_empty(&page));
    }

    #[test]
    fn images_only_from_main_content() {
        let page = extract_html(include_str!("../tests/fixtures/article.html"), &base());
        let got: Vec<&str> = page.images.iter().map(Url::as_str).collect();
        assert_eq!(
            got,
            [
                "https://example.com/img/borrow-checker.png",
                "https://cdn.example.org/charts/adoption.jpg"
            ]
        );
    }

    #[test]
    fn app_shell_is_near_empty() {
        let page = extract_html(include_str!("../tests/fixtures/app-shell.html"), &base());
        assert!(near_empty(&page));
    }

    #[test]
    fn pdf_text_extracted() {
        let text = extract_pdf(include_bytes!("../tests/fixtures/doc.pdf")).unwrap();
        assert!(
            text.contains("The quick brown fox jumps over the lazy dog."),
            "{text}"
        );
    }
}
