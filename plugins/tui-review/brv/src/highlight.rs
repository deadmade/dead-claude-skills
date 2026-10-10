//! Colours for the review: tree-sitter highlighting of the **whole** old and new file, mapped onto the diff's lines.
//!
//! Highlighting whole files rather than hunks keeps a line inside a multi-line string or comment right even when the
//! hunk starts halfway through it. Context and added lines take their colours from the new file, removed lines from
//! the old one.

use std::sync::LazyLock;

use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

use crate::diff::FileDiff;
use crate::format::{Kind, LinesChunk, MAX_COLS, cell_cols, span};
use crate::styles::Style;

/// Files bigger than this are shown plain: highlighting them would hold up every chunk after them.
const MAX_SOURCE: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Rust,
    CSharp,
    TypeScript,
    Tsx,
    JavaScript,
    Python,
    Nix,
    Json,
    Yaml,
    Toml,
    Bash,
}

impl Lang {
    pub const ALL: [Lang; 11] = [
        Lang::Rust,
        Lang::CSharp,
        Lang::TypeScript,
        Lang::Tsx,
        Lang::JavaScript,
        Lang::Python,
        Lang::Nix,
        Lang::Json,
        Lang::Yaml,
        Lang::Toml,
        Lang::Bash,
    ];

    /// The grammar for a path, by its extension or name.
    #[must_use]
    pub fn of(path: &str) -> Option<Lang> {
        let name = path.rsplit('/').next().unwrap_or(path);
        let ext = name.rsplit_once('.').map_or("", |(_, ext)| ext);
        Some(match ext {
            "rs" => Lang::Rust,
            "cs" | "csx" => Lang::CSharp,
            "ts" | "mts" | "cts" => Lang::TypeScript,
            "tsx" => Lang::Tsx,
            "js" | "jsx" | "mjs" | "cjs" => Lang::JavaScript,
            "py" | "pyi" => Lang::Python,
            "nix" => Lang::Nix,
            "json" | "jsonc" => Lang::Json,
            "yaml" | "yml" => Lang::Yaml,
            "toml" => Lang::Toml,
            "sh" | "bash" | "zsh" => Lang::Bash,
            _ if matches!(name, ".envrc" | ".bashrc" | ".profile" | ".zshrc") => Lang::Bash,
            _ => return None,
        })
    }

    fn config(self) -> Option<&'static HighlightConfiguration> {
        CONFIGS[self as usize].as_ref()
    }
}

type Config = LazyLock<Option<HighlightConfiguration>, fn() -> Option<HighlightConfiguration>>;

/// Built on first use: a review touching only Rust never compiles the other queries.
static CONFIGS: [Config; 11] = [
    LazyLock::new(|| build(Lang::Rust)),
    LazyLock::new(|| build(Lang::CSharp)),
    LazyLock::new(|| build(Lang::TypeScript)),
    LazyLock::new(|| build(Lang::Tsx)),
    LazyLock::new(|| build(Lang::JavaScript)),
    LazyLock::new(|| build(Lang::Python)),
    LazyLock::new(|| build(Lang::Nix)),
    LazyLock::new(|| build(Lang::Json)),
    LazyLock::new(|| build(Lang::Yaml)),
    LazyLock::new(|| build(Lang::Toml)),
    LazyLock::new(|| build(Lang::Bash)),
];

/// Capture names the queries use, and the style each gets. `configure` matches a capture to its longest listed
/// prefix, so `function.method.call` lands on `function.method`.
const NAMES: &[(&str, Style)] = &[
    ("attribute", Style::Attribute),
    ("boolean", Style::Constant),
    ("character", Style::String),
    ("comment", Style::Comment),
    ("conditional", Style::Keyword),
    ("constant", Style::Constant),
    ("constant.builtin", Style::Builtin),
    ("constructor", Style::Type),
    ("escape", Style::Escape),
    ("exception", Style::Keyword),
    ("float", Style::Number),
    ("function", Style::Function),
    ("function.builtin", Style::Builtin),
    ("function.macro", Style::Function),
    ("function.method", Style::Function),
    ("include", Style::Keyword),
    ("keyword", Style::Keyword),
    ("label", Style::Property),
    ("module", Style::Type),
    ("namespace", Style::Type),
    ("number", Style::Number),
    ("operator", Style::Operator),
    ("property", Style::Property),
    ("punctuation", Style::Punctuation),
    ("repeat", Style::Keyword),
    ("string", Style::String),
    ("string.escape", Style::Escape),
    ("string.special", Style::String),
    ("tag", Style::Tag),
    ("type", Style::Type),
    ("type.builtin", Style::Builtin),
    ("variable", Style::Variable),
    ("variable.builtin", Style::Builtin),
    ("variable.parameter", Style::Variable),
];

fn build(lang: Lang) -> Option<HighlightConfiguration> {
    use tree_sitter_javascript as js;
    use tree_sitter_typescript as ts;
    let js_jsx = || format!("{}\n{}", js::JSX_HIGHLIGHT_QUERY, js::HIGHLIGHT_QUERY);
    let (language, query): (tree_sitter::Language, String) = match lang {
        Lang::Rust => (
            tree_sitter_rust::LANGUAGE.into(),
            tree_sitter_rust::HIGHLIGHTS_QUERY.into(),
        ),
        Lang::CSharp => (
            tree_sitter_c_sharp::LANGUAGE.into(),
            tree_sitter_c_sharp::HIGHLIGHTS_QUERY.into(),
        ),
        // TypeScript's query only adds to JavaScript's; its own patterns go first so they win.
        Lang::TypeScript => (
            ts::LANGUAGE_TYPESCRIPT.into(),
            format!("{}\n{}", ts::HIGHLIGHTS_QUERY, js::HIGHLIGHT_QUERY),
        ),
        Lang::Tsx => (
            ts::LANGUAGE_TSX.into(),
            format!("{}\n{}", ts::HIGHLIGHTS_QUERY, js_jsx()),
        ),
        Lang::JavaScript => (js::LANGUAGE.into(), js_jsx()),
        Lang::Python => (
            tree_sitter_python::LANGUAGE.into(),
            tree_sitter_python::HIGHLIGHTS_QUERY.into(),
        ),
        Lang::Nix => (
            tree_sitter_nix::LANGUAGE.into(),
            tree_sitter_nix::HIGHLIGHTS_QUERY.into(),
        ),
        Lang::Json => (
            tree_sitter_json::LANGUAGE.into(),
            tree_sitter_json::HIGHLIGHTS_QUERY.into(),
        ),
        Lang::Yaml => (
            tree_sitter_yaml::LANGUAGE.into(),
            tree_sitter_yaml::HIGHLIGHTS_QUERY.into(),
        ),
        Lang::Toml => (
            tree_sitter_toml_ng::LANGUAGE.into(),
            tree_sitter_toml_ng::HIGHLIGHTS_QUERY.into(),
        ),
        Lang::Bash => (
            tree_sitter_bash::LANGUAGE.into(),
            tree_sitter_bash::HIGHLIGHT_QUERY.into(),
        ),
    };
    let mut config =
        HighlightConfiguration::new(language, format!("{lang:?}"), &query, "", "").ok()?;
    let names: Vec<&str> = NAMES.iter().map(|(name, _)| *name).collect();
    config.configure(&names);
    Some(config)
}

/// Whether `lang`'s grammar and query load; a query that does not compile leaves the language plain.
#[must_use]
pub fn loads(lang: Lang) -> bool {
    lang.config().is_some()
}

/// One file's highlights: per line of the source, the byte ranges within the line and their style.
struct Source<'a> {
    text: &'a str,
    /// Byte offset each line starts at.
    starts: Vec<usize>,
    /// `(line, from, to, style)`, in line order; `from` and `to` are byte offsets within the line.
    spans: Vec<(u32, u32, u32, u8)>,
}

impl<'a> Source<'a> {
    fn new(text: &'a str, lang: Option<Lang>, highlighter: &mut Highlighter) -> Self {
        let starts = std::iter::once(0)
            .chain(text.match_indices('\n').map(|(i, _)| i + 1))
            .collect();
        let mut source = Source {
            text,
            starts,
            spans: Vec::new(),
        };
        if let Some(config) = lang.and_then(Lang::config)
            && text.len() <= MAX_SOURCE
        {
            source.highlight(config, highlighter);
        }
        source
    }

    fn highlight(&mut self, config: &HighlightConfiguration, highlighter: &mut Highlighter) {
        let Ok(events) = highlighter.highlight(config, self.text.as_bytes(), None, None, |_| None)
        else {
            return;
        };
        let mut stack: Vec<u8> = Vec::new();
        let mut line = 0;
        for event in events {
            match event {
                Ok(HighlightEvent::HighlightStart(h)) => stack.push(NAMES[h.0].1 as u8),
                Ok(HighlightEvent::HighlightEnd) => {
                    stack.pop();
                }
                Ok(HighlightEvent::Source { start, end }) => {
                    let Some(&style) = stack.last() else { continue };
                    self.push(&mut line, start, end, style);
                }
                // A parse that gave up: what was found so far stands, the rest stays plain.
                Err(_) => return,
            }
        }
    }

    /// Records `start..end` with `style`, split at line ends.
    fn push(&mut self, line: &mut usize, start: usize, end: usize, style: u8) {
        let mut s = start;
        while s < end {
            while *line + 1 < self.starts.len() && self.starts[*line + 1] <= s {
                *line += 1;
            }
            let from = self.starts[*line];
            let next = self
                .starts
                .get(*line + 1)
                .copied()
                .unwrap_or(self.text.len() + 1);
            let line_end = next - 1;
            let e = end.min(line_end);
            if e > s {
                self.spans.push((
                    crate::format::count(*line),
                    offset(s - from),
                    offset(e - from),
                    style,
                ));
            }
            if end <= line_end {
                break;
            }
            s = next;
        }
    }

    fn line(&self, n: usize) -> &'a str {
        let from = self.starts.get(n).copied().unwrap_or(self.text.len());
        let to = self.starts.get(n + 1).map_or(self.text.len(), |&e| e - 1);
        self.text[from..to.max(from)].trim_end_matches('\r')
    }

    /// Packed spans for line `n` (0-based), in cell columns.
    fn packed(&self, n: usize, cols: &mut Vec<u16>, out: &mut Vec<u32>) {
        out.clear();
        let n32 = crate::format::count(n);
        let first = self.spans.partition_point(|s| s.0 < n32);
        let mut iter = self.spans[first..]
            .iter()
            .take_while(|s| s.0 == n32)
            .peekable();
        if iter.peek().is_none() {
            return;
        }
        let text = self.line(n);
        cell_cols(text, cols);
        for &(_, from, to, style) in iter {
            let (from, to) = (
                (from as usize).min(text.len()),
                (to as usize).min(text.len()),
            );
            let (c0, c1) = (cols[from], cols[to]);
            if c1 > c0 && usize::from(c0) < MAX_COLS {
                out.push(span(c0, c1 - c0, style));
            }
        }
    }
}

/// Byte offsets within one line; lines past `u32::MAX` bytes are not shown anyway.
fn offset(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Per diff line of `file`, its packed highlight spans; `old` and `new` are the file's whole old and new text.
pub fn row_spans(
    file: &FileDiff,
    old: &str,
    new: &str,
    highlighter: &mut Highlighter,
) -> Vec<Vec<u32>> {
    let lines: &LinesChunk = &file.lines;
    let mut out = vec![Vec::new(); lines.len()];
    let lang = Lang::of(&file.path);
    if !file.has_code() || lang.is_none() {
        return out;
    }
    let has = |kind: Kind| (0..lines.len()).any(|i| lines.kind(i) == kind as u8);
    let old_src = has(Kind::Del).then(|| Source::new(old, lang, highlighter));
    let new_src =
        (has(Kind::Add) || has(Kind::Context)).then(|| Source::new(new, lang, highlighter));
    let mut cols = Vec::new();
    for (i, row) in out.iter_mut().enumerate() {
        let kind = lines.kind(i);
        let (source, no) = if kind == Kind::Del as u8 {
            (&old_src, lines.old_no(i))
        } else if kind == Kind::Add as u8 || kind == Kind::Context as u8 {
            (&new_src, lines.new_no(i))
        } else {
            continue;
        };
        if let Some(source) = source
            && no > 0
        {
            source.packed(no as usize - 1, &mut cols, row);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::Kind;

    #[test]
    fn every_grammar_loads() {
        for lang in Lang::ALL {
            assert!(
                loads(lang),
                "{lang:?} query does not compile against its grammar"
            );
        }
    }

    fn styles_of(source: &str, lang: Lang, line: usize) -> Vec<(String, Style)> {
        let mut h = Highlighter::new();
        let src = Source::new(source, Some(lang), &mut h);
        let mut cols = Vec::new();
        let mut packed = Vec::new();
        src.packed(line, &mut cols, &mut packed);
        let mut cells = Vec::new();
        crate::format::to_cells(src.line(line), &mut cells);
        let text: Vec<char> = char::decode_utf16(cells).map(Result::unwrap).collect();
        packed
            .iter()
            .map(|&s| {
                let (col, len, style) = (
                    (s & 0x1ff) as usize,
                    ((s >> 9) & 0x3ff) as usize,
                    u8::try_from(s >> 19).unwrap(),
                );
                let style = NAMES
                    .iter()
                    .map(|n| n.1)
                    .find(|st| *st as u8 == style)
                    .unwrap_or(Style::Plain);
                (text[col..col + len].iter().collect(), style)
            })
            .collect()
    }

    #[test]
    fn rust_keywords_strings_and_a_comment_spanning_lines() {
        let src = "fn main() {\n    /* one\n    two */ let s = \"x\";\n}\n";
        let line0 = styles_of(src, Lang::Rust, 0);
        assert!(line0.contains(&("fn".into(), Style::Keyword)), "{line0:?}");
        assert!(
            line0.contains(&("main".into(), Style::Function)),
            "{line0:?}"
        );
        // The middle of a block comment, highlighted on its own line.
        let line2 = styles_of(src, Lang::Rust, 2);
        assert_eq!(line2[0], ("    two */".into(), Style::Comment), "{line2:?}");
        assert!(line2.contains(&("let".into(), Style::Keyword)), "{line2:?}");
        assert!(
            line2.contains(&("\"x\"".into(), Style::String)),
            "{line2:?}"
        );
    }

    #[test]
    fn tabs_shift_spans_to_cell_columns() {
        let spans = styles_of("\tlet x = 1;\n", Lang::Rust, 0);
        // `let` sits at cells 4..7, after the tab's four spaces.
        assert!(spans.contains(&("let".into(), Style::Keyword)), "{spans:?}");
        // The Rust query tags integer literals `@constant.builtin`.
        assert!(spans.contains(&("1".into(), Style::Builtin)), "{spans:?}");
    }

    #[test]
    fn rows_take_colours_from_their_side() {
        let old = "/* a\nb */\nlet x = 1;\n";
        let new = "/* a\nb */\nfn y() {}\n";
        let mut lines = LinesChunk::default();
        lines.push(Kind::File, 0, 0, "a.rs");
        let (added, removed) = crate::diff::hunk_lines(old, new, &mut lines);
        assert_eq!((added, removed), (1, 1));
        let file = FileDiff {
            path: "a.rs".into(),
            status: b'M',
            old: None,
            new: None,
            added,
            removed,
            flags: 0,
            lines,
        };
        let rows = row_spans(&file, old, new, &mut Highlighter::new());
        // File, hunk header, `/* a`, `b */`, -let, +fn.
        assert_eq!(rows.len(), 6);
        assert!(rows[0].is_empty() && rows[1].is_empty());
        let style = |s: u32| u8::try_from(s >> 19).unwrap();
        assert_eq!(
            style(rows[3][0]),
            Style::Comment as u8,
            "context line in the middle of a comment"
        );
        assert!(
            rows[4]
                .iter()
                .any(|&s| style(s) == Style::Keyword as u8 && (s >> 9) & 0x3ff == 3)
        );
        assert!(
            rows[5]
                .iter()
                .any(|&s| style(s) == Style::Keyword as u8 && (s >> 9) & 0x3ff == 2)
        );
    }
}
