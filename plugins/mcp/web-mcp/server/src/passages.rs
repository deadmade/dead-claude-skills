//! Markdown cut into passages of 256–512 tokens (estimated as chars / 4) for the BM25 index.

use std::collections::VecDeque;

/// Whole paragraphs merged until 256–512 tokens; a paragraph too big for that is split at sentence
/// ends, and a sentence over 512 tokens at 512 tokens. Only the last passage may be shorter.
pub fn split(markdown: &str) -> Vec<String> {
    // Units still to place, each with the glue that joins it to what comes before.
    let mut queue: VecDeque<(String, &str)> = paragraphs(markdown).map(|p| (p, "\n\n")).collect();
    let (mut out, mut cur, mut n) = (Vec::new(), String::new(), 0);
    while let Some((unit, glue)) = queue.pop_front() {
        let len = unit.chars().count();
        let joined = if n == 0 { len } else { n + glue.len() + len };
        if joined <= MAX {
            if n > 0 {
                cur.push_str(glue);
            }
            cur.push_str(&unit);
            n = joined;
        } else if n >= MIN {
            out.push(std::mem::take(&mut cur));
            n = 0;
            queue.push_front((unit, glue));
        } else {
            // Too big to join and `cur` too short to close: break the unit up.
            let parts = sentences(&unit);
            if parts.len() > 1 {
                for (i, p) in parts.into_iter().enumerate().rev() {
                    queue.push_front((p, if i == 0 { glue } else { " " }));
                }
            } else {
                // No sentence end: fill `cur`, then cut the rest into MAX-sized pieces in one pass.
                let mut pieces = Vec::new();
                let (mut rest, mut size) = (
                    unit.as_str(),
                    if n == 0 { MAX } else { MAX - n - glue.len() },
                );
                while !rest.is_empty() {
                    let cut = rest.char_indices().nth(size).map_or(rest.len(), |(i, _)| i);
                    pieces.push(rest[..cut].to_owned());
                    rest = &rest[cut..];
                    size = MAX;
                }
                for (i, p) in pieces.into_iter().enumerate().rev() {
                    queue.push_front((p, if i == 0 { glue } else { "" }));
                }
            }
        }
    }
    if n > 0 {
        out.push(cur);
    }
    out
}

/// Bounds in chars: 256 and 512 tokens.
const MIN: usize = 256 * 4;
const MAX: usize = 512 * 4;

/// Blocks separated by blank lines.
fn paragraphs(md: &str) -> impl Iterator<Item = String> {
    let mut blocks = vec![String::new()];
    for line in md.lines() {
        let last = blocks.last_mut().expect("never empty");
        if line.trim().is_empty() {
            if !last.is_empty() {
                blocks.push(String::new());
            }
        } else {
            if !last.is_empty() {
                last.push('\n');
            }
            last.push_str(line.trim_end());
        }
    }
    blocks.into_iter().filter(|b| !b.is_empty())
}

/// Split after `.`, `!` or `?` followed by whitespace.
fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((_, c)) = chars.next() {
        if matches!(c, '.' | '!' | '?')
            && let Some(&(next, w)) = chars.peek()
            && w.is_whitespace()
        {
            out.push(text[start..next].trim().to_owned());
            start = next;
        }
    }
    out.push(text[start..].trim().to_owned());
    out.retain(|s| !s.is_empty());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn tokens(s: &str) -> usize {
        s.chars().count() / 4
    }

    #[test]
    fn split_respects_256_to_512() {
        // Paragraphs of 20 to 290 tokens, so some fit whole and some have to be broken up.
        let paras: Vec<String> = (0..60)
            .map(|i| {
                let words = 16 + (i * 37) % 220;
                (0..words)
                    .map(|w| if w % 9 == 8 { "end. " } else { "word " })
                    .collect::<String>()
                    .trim()
                    .to_owned()
            })
            .collect();
        let md = paras.join("\n\n");
        let out = split(&md);
        assert!(out.len() > 5);
        let (last, rest) = out.split_last().unwrap();
        for p in rest {
            assert!((256..=512).contains(&tokens(p)), "{} tokens", tokens(p));
        }
        assert!(tokens(last) <= 512);
        // Nothing lost: the same words in the same order.
        let words = |s: &str| s.split_whitespace().map(str::to_owned).collect::<Vec<_>>();
        assert_eq!(words(&out.join(" ")), words(&md));
    }

    #[test]
    fn split_is_linear_on_huge_unbroken_text() {
        // 8 MB with no sentence end, and 8 MB of one "sentence" whose dots aren't followed by spaces.
        let bound = Duration::from_secs(if cfg!(debug_assertions) { 10 } else { 1 });
        for md in ["x".repeat(8 << 20), "a.b".repeat((8 << 20) / 3)] {
            let start = Instant::now();
            let out = split(&md);
            assert!(start.elapsed() < bound, "{:?}", start.elapsed());
            let (last, rest) = out.split_last().unwrap();
            assert!(rest.iter().all(|p| (256..=512).contains(&tokens(p))));
            assert!(tokens(last) <= 512);
            assert_eq!(out.concat(), md);
        }
    }

    #[test]
    fn split_handles_one_huge_paragraph() {
        // ~5,000 tokens of sentences, then ~1,500 tokens with no sentence end at all.
        let sentences = "This is one sentence of the huge paragraph. ".repeat(450);
        let unbroken = "x".repeat(6000);
        for md in [sentences.trim().to_owned(), unbroken] {
            let out = split(&md);
            assert!(out.len() > 1);
            let (last, rest) = out.split_last().unwrap();
            for p in rest {
                assert!((256..=512).contains(&tokens(p)), "{} tokens", tokens(p));
            }
            assert!(tokens(last) <= 512);
            let bare = |s: &str| s.split_whitespace().collect::<String>();
            assert_eq!(bare(&out.concat()), bare(&md));
        }
        assert_eq!(split(""), Vec::<String>::new());
        assert_eq!(split("short\n\nand small"), ["short\n\nand small"]);
    }
}
