//! Plain-text output helpers: the shapes every tool's reply is built from. Pure, no I/O.

use std::fmt::Write as _;

/// How much of a work item description or comment a view shows before pointing at the full call.
pub const DESC_MAX: usize = 4000;

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

/// ` k=v` for each argument given, quoted when it holds a space: the filters and scope a call repeats.
pub fn args(pairs: &[(&str, Option<&str>)]) -> String {
    let mut out = String::new();
    for (k, v) in pairs {
        match v.map(str::trim).filter(|v| !v.is_empty()) {
            Some(v) if v.contains(' ') => {
                let _ = write!(out, " {k}=\"{v}\"");
            }
            Some(v) => {
                let _ = write!(out, " {k}={v}");
            }
            None => {}
        }
    }
    out
}

/// Characters per reply (Rulings R8, R11): past it, the reply is cut.
pub const REPLY_MAX: usize = 40_000;

/// A reply as Claude gets it: without terminal control, and at most `REPLY_MAX` characters before the cut line. The
/// cut falls at the last line end before the limit, so no call is left half-cut; within one long line, at a char.
pub fn finish(text: &str) -> String {
    let mut text = strip_ansi(text);
    if let Some((at, _)) = text.char_indices().nth(REPLY_MAX) {
        let at = text[..at].rfind('\n').unwrap_or(at);
        text.truncate(at);
        text.push_str("\n… output cut at 40,000 characters; narrow the call where it can be (limit, id, step)");
    }
    text
}

/// The trailer line that tells the model how to ask for the next page.
pub fn more(call: &str) -> String {
    format!("… more: {call}")
}

/// The limit a more line offers for a `u16` limit: twice `limit`, at most `u16::MAX` so the next call can take it.
pub fn doubled(limit: usize) -> usize {
    limit.saturating_mul(2).min(usize::from(u16::MAX))
}

/// Azure DevOps rich text as plain text: line breaks and list items kept, other tags dropped.
pub fn html_to_text(html: &str) -> String {
    const ENTITIES: [(&str, char); 5] = [
        ("&amp;", '&'),
        ("&lt;", '<'),
        ("&gt;", '>'),
        ("&quot;", '"'),
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
        if let Some((ch, len)) = numeric_entity(rest) {
            out.push(ch);
            i += len;
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

/// The character and length of a numeric entity at the start of `s` (`&#128522;`, `&#x1F60A;`; the server writes
/// emoji this way). `None` when it isn't one or names no character, so it stays text.
fn numeric_entity(s: &str) -> Option<(char, usize)> {
    let body = s.strip_prefix("&#")?;
    let (digits, radix, skip) = match body.strip_prefix(['x', 'X']) {
        Some(hex) => (hex, 16, 3),
        None => (body, 10, 2),
    };
    // Seven hex or decimal digits cover every code point; a longer run isn't scanned.
    let end = digits
        .bytes()
        .take(8)
        .position(|b| !b.is_ascii_alphanumeric())?;
    if digits.as_bytes()[end] != b';' {
        return None;
    }
    let code = u32::from_str_radix(&digits[..end], radix).ok()?;
    let ch = char::from_u32(code).filter(|&c| c != '\0')?;
    Some((ch, skip + end + 1))
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

type Chars<'a> = std::iter::Peekable<std::str::Chars<'a>>;

/// Skips the rest of an OSC, DCS, APC or PM string, up to BEL, ST or `ESC \`. Returns true when another escape
/// ended it: that `ESC` is consumed and starts a sequence of its own.
fn skip_string(chars: &mut Chars) -> bool {
    while let Some(c) = chars.next() {
        match c {
            '\x07' | '\u{9c}' => return false,
            '\x1b' if chars.peek() == Some(&'\\') => {
                chars.next();
                return false;
            }
            '\x1b' => return true,
            _ => {}
        }
    }
    false
}

/// Skips the rest of a CSI sequence: parameter and intermediate bytes, then a final byte in `@`..=`~`.
fn skip_csi(chars: &mut Chars) {
    for c in chars.by_ref() {
        if ('@'..='~').contains(&c) {
            return;
        }
    }
}

/// The text without terminal control: CSI, and OSC, DCS, APC and PM strings (7- and 8-bit; an OSC 8 hyperlink
/// would leak its URL), any other escape with the character after it, and every other control character but `\n`
/// and `\t`. Linear: an escape inside a string is handled in this loop, not by recursing.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    let mut esc = false;
    loop {
        let c = if std::mem::take(&mut esc) {
            '\x1b'
        } else if let Some(c) = chars.next() {
            c
        } else {
            break;
        };
        match c {
            '\x1b' => match chars.next() {
                Some('[') => skip_csi(&mut chars),
                Some(']' | 'P' | '_' | '^') => esc = skip_string(&mut chars),
                _ => {}
            },
            '\u{9b}' => skip_csi(&mut chars),
            '\u{90}' | '\u{9d}' | '\u{9e}' | '\u{9f}' => esc = skip_string(&mut chars),
            '\t' | '\n' => out.push(c),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// `refs/heads/{branch}`, unless it already is a ref.
pub fn full_ref(branch: &str) -> String {
    if branch.starts_with("refs/") {
        branch.to_owned()
    } else {
        format!("refs/heads/{branch}")
    }
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
        let quoted = "<a".repeat(100_000) + "'>";
        for html in ["<a".repeat(100_000), "<a\"".repeat(100_000), quoted] {
            let t = std::time::Instant::now();
            html_to_text(&html);
            assert!(t.elapsed().as_millis() < 500, "{:?}", t.elapsed());
        }
        assert_eq!(html_to_text("<a<a<a"), "<a<a<a");
        // A tag after an unclosed quote still counts.
        assert_eq!(html_to_text("<b \"x <p>ok</p>"), "<b \"x ok");
    }

    #[test]
    fn html_to_text_decodes_once() {
        assert_eq!(html_to_text("&amp;nbsp; &amp;lt;"), "&nbsp; &lt;");
        assert_eq!(html_to_text("&amp;#39;"), "&#39;");
    }

    #[test]
    fn html_to_text_numeric_entities() {
        assert_eq!(
            html_to_text("gerne &#128522; &#x1F60A; &#X41;&#233;"),
            "gerne 😊 😊 Aé"
        );
        // Not a character, unterminated or too long: left as text.
        for s in [
            "&#;",
            "&#x;",
            "&#55296;",
            "&#1114112;",
            "&#0;",
            "&#65",
            "&#65 x",
            "&#12a;",
            "&#000000065;",
        ] {
            assert_eq!(html_to_text(s), s);
        }
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
        assert_eq!(more("wi_query limit=40"), "… more: wi_query limit=40");
    }

    #[test]
    fn doubled_fits_a_u16() {
        assert_eq!(doubled(20), 40);
        assert_eq!(doubled(32_767), 65_534);
        assert_eq!(doubled(40_000), 65_535);
        assert_eq!(doubled(65_535), 65_535);
    }

    #[test]
    fn args_quote_and_skip() {
        let out = args(&[
            ("project", Some("My Proj")),
            ("repo", None),
            ("state", Some(" ")),
            ("all", Some("true")),
        ]);
        assert_eq!(out, " project=\"My Proj\" all=true");
    }

    #[test]
    fn finish_strips_and_caps() {
        assert_eq!(
            finish("a\x1b]8;;https://x.example/\x07b\x1b]8;;\x07\x07\n\tc\x1b[31md"),
            "ab\n\tcd"
        );
        let out = finish(&"ü".repeat(REPLY_MAX + 1));
        assert!(out.starts_with(&"ü".repeat(REPLY_MAX)));
        assert!(
            out.ends_with(
                "ü\n… output cut at 40,000 characters; narrow the call where it can be (limit, id, step)"
            )
        );
        assert_eq!(finish(&"a".repeat(REPLY_MAX)), "a".repeat(REPLY_MAX));
    }

    #[test]
    fn finish_drops_a_half_cut_line() {
        let text = "a".repeat(REPLY_MAX - 10) + "\n… more: pr_list status=all limit=40";
        assert_eq!(
            finish(&text),
            "a".repeat(REPLY_MAX - 10)
                + "\n… output cut at 40,000 characters; narrow the call where it can be (limit, id, step)"
        );
    }

    #[test]
    fn ref_name_strips_heads() {
        assert_eq!(ref_name("refs/heads/feature/x"), "feature/x");
        assert_eq!(ref_name("main"), "main");
    }
}
