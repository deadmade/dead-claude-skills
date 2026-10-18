//! Plain-text output helpers: the shapes every tool's reply is built from. Pure, no I/O.

/// How much of a work item description or comment a view shows before pointing at the full call.
pub const DESC_MAX: usize = 4000;

/// The `YYYY-MM-DD` of an ISO timestamp, or `?` when there is none.
#[allow(dead_code)] // wi_view uses it from Task 7
pub fn date(iso: &str) -> String {
    if iso.is_empty() {
        "?".into()
    } else {
        iso.chars().take(10).collect()
    }
}

/// `text` cut to `max` characters, with a trailer naming the call that fetches the rest.
pub fn clip(text: &str, max: usize, rest: &str) -> String {
    match text.char_indices().nth(max) {
        None => text.to_string(),
        Some((at, _)) => {
            let n = text.chars().count() - max;
            format!("{}\n… {n} more characters: {rest}", &text[..at])
        }
    }
}

/// The first `limit` items, and whether the fetch held more.
pub fn cut<T>(mut items: Vec<T>, limit: usize) -> (Vec<T>, bool) {
    let more = items.len() > limit;
    items.truncate(limit);
    (items, more)
}

/// The trailer line that tells the model how to ask for the next page.
pub fn more(call: &str) -> String {
    format!("… more: {call}")
}

/// Azure DevOps rich text as plain text: line breaks and list items kept, other tags dropped.
pub fn html_to_text(html: &str) -> String {
    const ENTITIES: [(&str, char); 6] = [
        ("&amp;", '&'),
        ("&lt;", '<'),
        ("&gt;", '>'),
        ("&quot;", '"'),
        ("&#39;", '\''),
        ("&nbsp;", ' '),
    ];
    let mut out = String::with_capacity(html.len());
    let mut seen = vec![0; html.len()];
    let mut i = 0;
    while i < html.len() {
        let rest = &html[i..];
        if let Some(inner) = rest.strip_prefix('<') {
            // A tag starts with a letter, `/` or `!`; anything else (`1 < 2`) is text.
            let tagged =
                inner.starts_with(|c: char| c.is_ascii_alphabetic() || c == '/' || c == '!');
            if let Some(end) = tagged
                .then(|| tag_end(html.as_bytes(), i, &mut seen))
                .flatten()
            {
                let (closing, body) = inner
                    .strip_prefix('/')
                    .map_or((false, inner), |b| (true, b));
                let name = body
                    .split(|c: char| !c.is_ascii_alphanumeric())
                    .next()
                    .unwrap_or("");
                match (closing, name.to_ascii_lowercase().as_str()) {
                    (_, "br") | (true, "p" | "div" | "li") => out.push('\n'),
                    (false, "li") => {
                        // Keeps `text<li>` off the text's line.
                        if !out.is_empty() && !out.ends_with('\n') {
                            out.push('\n');
                        }
                        out.push_str("- ");
                    }
                    _ => {}
                }
                i = end + 1;
                continue;
            }
        }
        // Decoding is one pass over the input, so `&amp;nbsp;` yields `&nbsp;`, not a space.
        if let Some((name, ch)) = ENTITIES.iter().find(|(name, _)| rest.starts_with(name)) {
            out.push(*ch);
            i += name.len();
            continue;
        }
        let ch = rest.chars().next().unwrap_or_default();
        out.push(ch);
        i += ch.len_utf8();
    }
    let mut lines: Vec<&str> = Vec::new();
    for line in out.lines().map(str::trim) {
        if !line.is_empty() || lines.last().is_some_and(|l| !l.is_empty()) {
            lines.push(line);
        }
    }
    lines.join("\n").trim().to_string()
}

/// The index of the `>` that ends the tag opening at `from`, skipping any inside quotes. `None` when it never closes.
///
/// `seen` holds the quote states earlier scans passed each byte in. A scan that reaches a byte in the same state
/// ends as that one did, which failed (a tag that closes is skipped, never scanned again), so each byte is scanned
/// at most three times and `<a<a<a…` stays linear.
fn tag_end(html: &[u8], from: usize, seen: &mut [u8]) -> Option<usize> {
    let mut quote = 0;
    for (i, &b) in html.iter().enumerate().skip(from) {
        let bit = match quote {
            0 => 1,
            b'"' => 2,
            _ => 4,
        };
        if seen[i] & bit != 0 {
            return None;
        }
        seen[i] |= bit;
        match (quote, b) {
            (0, b'>') => return Some(i),
            (0, b'"' | b'\'') => quote = b,
            (q, _) if q == b => quote = 0,
            _ => {}
        }
    }
    None
}

/// A branch name without its `refs/heads/` prefix.
pub fn ref_name(r: &str) -> &str {
    r.strip_prefix("refs/heads/").unwrap_or(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_names_the_rest() {
        let out = clip(&"a".repeat(5000), DESC_MAX, "wi_view id=1 full=true");
        assert!(out.starts_with(&"a".repeat(4000)));
        assert!(out.ends_with("… 1000 more characters: wi_view id=1 full=true"));
        assert_eq!(clip("short", DESC_MAX, "x"), "short");
    }

    #[test]
    fn clip_is_char_safe() {
        let out = clip(&"ü".repeat(4001), DESC_MAX, "r");
        assert!(out.starts_with(&"ü".repeat(4000)));
        assert!(out.ends_with("… 1 more characters: r"));
    }

    #[test]
    fn html_to_text_keeps_lists() {
        let html = "<p>Do</p><ul><li>a &amp; b</li><li>c</li></ul>";
        assert_eq!(html_to_text(html), "Do\n- a & b\n- c");
    }

    #[test]
    fn html_to_text_breaks_and_entities() {
        let html = "x<br>y &lt;z&gt; &quot;q&quot; it&#39;s&nbsp;ok<br>d</div>\n\n\n<div> e </div>";
        assert_eq!(html_to_text(html), "x\ny <z> \"q\" it's ok\nd\n\ne");
    }

    #[test]
    fn html_to_text_unclosed_tag_stays_text() {
        assert_eq!(html_to_text("a <b and <i"), "a <b and <i");
        assert_eq!(html_to_text("<a title=\"x>y"), "<a title=\"x>y");
    }

    #[test]
    fn html_to_text_lone_lt_is_text() {
        assert_eq!(
            html_to_text("1 < 2 and 3 <4 <p>ok</p>"),
            "1 < 2 and 3 <4 ok"
        );
    }

    #[test]
    fn html_to_text_quoted_gt_stays_in_tag() {
        assert_eq!(
            html_to_text("<a href=\"x?a>b\" title='>'>link</a> end"),
            "link end"
        );
    }

    #[test]
    fn html_to_text_uppercase_tags() {
        assert_eq!(
            html_to_text("a<BR/>b<UL><LI>c</LI><LI>d</LI></UL>"),
            "a\nb\n- c\n- d"
        );
    }

    #[test]
    fn html_to_text_unclosed_tags_are_linear() {
        // Each `<` used to scan to the end for its `>`.
        for unit in ["<a", "<a\""] {
            let html = unit.repeat(100_000);
            let t = std::time::Instant::now();
            html_to_text(&html);
            assert!(t.elapsed().as_millis() < 500, "{unit}: {:?}", t.elapsed());
        }
        assert_eq!(html_to_text("<a<a<a"), "<a<a<a");
        // A tag after an unclosed quote still counts.
        assert_eq!(html_to_text("<b \"x <p>ok</p>"), "<b \"x ok");
    }

    #[test]
    fn html_to_text_decodes_once() {
        assert_eq!(html_to_text("&amp;nbsp; &amp;lt;"), "&nbsp; &lt;");
    }

    #[test]
    fn cut_reports_more() {
        let (kept, more) = cut((0..21).collect(), 20);
        assert_eq!((kept.len(), more), (20, true));
        let (kept, more) = cut((0..20).collect(), 20);
        assert_eq!((kept.len(), more), (20, false));
    }

    #[test]
    fn more_names_the_call() {
        assert_eq!(more("wi_list skip=20"), "… more: wi_list skip=20");
    }

    #[test]
    fn ref_name_strips_heads() {
        assert_eq!(ref_name("refs/heads/feature/x"), "feature/x");
        assert_eq!(ref_name("main"), "main");
    }

    #[test]
    fn date_short() {
        assert_eq!(date("2026-03-04T10:11:12.5Z"), "2026-03-04");
        assert_eq!(date(""), "?");
    }
}
