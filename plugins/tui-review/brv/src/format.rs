//! The on-disk cache the mod reads: fixed-layout column arrays it views with typed arrays, no parsing.
//!
//! Every file starts with a 16-byte [`Header`]. Sections follow in a fixed order, each padded to 4 bytes, so a
//! `Uint32Array` / `Uint16Array` view over the mod's buffer lands aligned. All integers are little-endian (only
//! little-endian targets are built). `hooks/chunks.ts` is the reader; keep the two in step and bump [`VERSION`].
//!
//! - `manifest.brv`: header (`n` = files, `m` = string units), [`Meta`], `files: [FileRecord; n]`,
//!   `strings: [u16; m]`.
//! - `NNNN.lines`: header (`n` = lines, `m` = text units), `kind: [u8; n]`, `old_no: [u32; n]`, `new_no: [u32; n]`,
//!   `start: [u32; n + 1]`, `text: [u16; m]`. The text is already Raster code points (see [`to_cells`]).
//! - `NNNN.hl`: header (`n` = lines, `m` = spans), `start: [u32; n + 1]`, `spans: [u32; m]` packed by [`span`].

use std::fs;
use std::io;
use std::path::Path;

use unicode_width::UnicodeWidthChar;
use zerocopy::{Immutable, IntoBytes, KnownLayout};

#[cfg(not(target_endian = "little"))]
compile_error!("the cache format is little-endian; brv is only built for little-endian targets");

/// Bumped on any layout change; part of the cache directory name, so old caches are never misread.
pub const VERSION: u16 = 1;
/// Diff lines per chunk. Fixed, so the mod finds a line's chunk as `line / CHUNK_LINES` with no table, and a chunk
/// stays under 1 MiB even when every line is cut at [`MAX_COLS`] (1024 × 512 × 2 bytes).
pub const CHUNK_LINES: usize = 1024;
/// Lines are cut here; also the most a Raster can be wide.
pub const MAX_COLS: usize = 512;
const TAB: usize = 4;
/// Stands in for anything the Raster cannot draw in one cell (wide, astral, control).
const PLACEHOLDER: u16 = 0x00B7;

pub const MAGIC_MANIFEST: [u8; 4] = *b"BRVM";
pub const MAGIC_LINES: [u8; 4] = *b"BRVL";
pub const MAGIC_HL: [u8; 4] = *b"BRVH";

#[derive(IntoBytes, Immutable, KnownLayout, Debug, Clone, Copy)]
#[repr(C)]
pub struct Header {
    pub magic: [u8; 4],
    pub version: u16,
    pub flags: u16,
    pub n: u32,
    pub m: u32,
}

/// What a diff line is; the mod colours by it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Kind {
    File = 0,
    Hunk = 1,
    Context = 2,
    Add = 3,
    Del = 4,
    /// A one-line stand-in for a collapsed file (lockfile, minified, generated) or a binary one.
    Note = 5,
}

/// Manifest fields after the header. String fields are `(offset, len)` in u16 units into `strings`.
#[derive(IntoBytes, Immutable, KnownLayout, Debug, Clone, Copy, Default)]
#[repr(C)]
pub struct Meta {
    pub total_lines: u32,
    pub chunk_lines: u32,
    pub base_name: [u32; 2],
    pub head_name: [u32; 2],
    pub base_sha: [u32; 2],
    pub head_sha: [u32; 2],
    pub merge_base_sha: [u32; 2],
}

pub mod file_flags {
    pub const COLLAPSED: u32 = 1;
    pub const BINARY: u32 = 2;
}

#[derive(IntoBytes, Immutable, KnownLayout, Debug, Clone, Copy, Default)]
#[repr(C)]
pub struct FileRecord {
    pub path: [u32; 2],
    /// The new blob's id, so "viewed" marks survive a rebase that leaves the file alone.
    pub blob: [u32; 2],
    /// Low byte: status (`A`, `M`, `D`, `R` as ASCII); bits 8..: [`file_flags`].
    pub status_flags: u32,
    pub added: u32,
    pub removed: u32,
    /// Global index of the file's header line, and how many lines it takes.
    pub first_line: u32,
    pub line_count: u32,
}

/// Packs a highlight span: column (9 bits), length (10 bits), style (8 bits).
#[must_use]
pub const fn span(col: u16, len: u16, style: u8) -> u32 {
    debug_assert!((col as usize) < MAX_COLS && len as usize <= MAX_COLS);
    (col as u32) | ((len as u32) << 9) | ((style as u32) << 19)
}

/// Turns a source line into Raster code points: tabs to the next multiple of 4, zero-width marks dropped, anything
/// not one BMP cell wide replaced by `·`, cut at [`MAX_COLS`].
pub fn to_cells(line: &str, out: &mut Vec<u16>) {
    // The usual line: printable ASCII, no tabs, short enough. Copied as is, which the compiler vectorizes.
    let bytes = line.as_bytes();
    if bytes.len() <= MAX_COLS && bytes.iter().all(|b| (0x20..0x7f).contains(b)) {
        out.extend(bytes.iter().map(|&b| u16::from(b)));
        return;
    }
    let mut cols = 0;
    for c in line.chars() {
        if cols >= MAX_COLS {
            break;
        }
        // Most source text: printable ASCII is one cell, no width lookup needed.
        if c.is_ascii_graphic() || c == ' ' {
            out.push(c as u16);
            cols += 1;
            continue;
        }
        if c == '\t' {
            let to = (cols / TAB + 1) * TAB;
            while cols < to.min(MAX_COLS) {
                out.push(u16::from(b' '));
                cols += 1;
            }
            continue;
        }
        let unit = match (c.width(), u16::try_from(u32::from(c))) {
            (Some(0), _) => continue,
            (Some(1), Ok(unit)) => unit,
            _ => PLACEHOLDER,
        };
        out.push(unit);
        cols += 1;
    }
}

/// A count or offset as stored. Chunks hold at most [`CHUNK_LINES`] lines of at most [`MAX_COLS`] cells, and the
/// manifest's strings are paths, so nothing stored comes near `u32::MAX`.
#[expect(clippy::cast_possible_truncation, reason = "bounded by CHUNK_LINES × MAX_COLS; checked in debug builds")]
pub(crate) fn count(n: usize) -> u32 {
    debug_assert!(u32::try_from(n).is_ok());
    n as u32
}

fn pad4(buf: &mut Vec<u8>) {
    buf.resize(buf.len().next_multiple_of(4), 0);
}

fn header(magic: [u8; 4], n: usize, m: usize) -> Header {
    Header {
        magic,
        version: VERSION,
        flags: 0,
        n: count(n),
        m: count(m),
    }
}

/// Writes `bytes` to `path` through a temporary name, so a reader never sees half a file.
///
/// # Errors
/// When the file cannot be written or renamed into place.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

#[derive(Default)]
pub struct Strings(Vec<u16>);

impl Strings {
    pub fn add(&mut self, s: &str) -> [u32; 2] {
        let start = self.0.len();
        self.0.extend(s.encode_utf16());
        let len = self.0.len() - start;
        [count(start), count(len)]
    }
}

pub struct Manifest {
    pub meta: Meta,
    pub files: Vec<FileRecord>,
    pub strings: Strings,
}

impl Manifest {
    #[must_use]
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(
            16 + size_of::<Meta>() + self.files.len() * size_of::<FileRecord>() + self.strings.0.len() * 2 + 4,
        );
        buf.extend_from_slice(header(MAGIC_MANIFEST, self.files.len(), self.strings.0.len()).as_bytes());
        buf.extend_from_slice(self.meta.as_bytes());
        buf.extend_from_slice(self.files.as_bytes());
        buf.extend_from_slice(self.strings.0.as_bytes());
        pad4(&mut buf);
        buf
    }
}

/// One chunk's lines, built by pushing them in order.
#[derive(Default)]
pub struct LinesChunk {
    kind: Vec<u8>,
    old_no: Vec<u32>,
    new_no: Vec<u32>,
    start: Vec<u32>,
    text: Vec<u16>,
}

impl LinesChunk {
    /// Line numbers are 1-based; 0 means the side has none (an added line has no old number).
    pub fn push(&mut self, kind: Kind, old_no: u32, new_no: u32, line: &str) {
        self.kind.push(kind as u8);
        self.old_no.push(old_no);
        self.new_no.push(new_no);
        self.start.push(count(self.text.len()));
        to_cells(line, &mut self.text);
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.kind.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.kind.is_empty()
    }

    #[must_use]
    pub fn encode(&self) -> Vec<u8> {
        let n = self.len();
        let mut buf = Vec::with_capacity(16 + n * 13 + 8 + self.text.len() * 2 + 4);
        buf.extend_from_slice(header(MAGIC_LINES, n, self.text.len()).as_bytes());
        buf.extend_from_slice(&self.kind);
        pad4(&mut buf);
        buf.extend_from_slice(self.old_no.as_bytes());
        buf.extend_from_slice(self.new_no.as_bytes());
        buf.extend_from_slice(self.start.as_bytes());
        buf.extend_from_slice(count(self.text.len()).as_bytes());
        buf.extend_from_slice(self.text.as_bytes());
        pad4(&mut buf);
        buf
    }
}

/// One chunk's highlight spans, a line at a time in the same order as its [`LinesChunk`].
#[derive(Default)]
pub struct HlChunk {
    start: Vec<u32>,
    spans: Vec<u32>,
}

impl HlChunk {
    pub fn push_line(&mut self, spans: impl IntoIterator<Item = u32>) {
        self.start.push(count(self.spans.len()));
        self.spans.extend(spans);
    }

    #[must_use]
    pub fn encode(&self) -> Vec<u8> {
        let n = self.start.len();
        let mut buf = Vec::with_capacity(16 + (n + 1) * 4 + self.spans.len() * 4);
        buf.extend_from_slice(header(MAGIC_HL, n, self.spans.len()).as_bytes());
        buf.extend_from_slice(self.start.as_bytes());
        buf.extend_from_slice(count(self.spans.len()).as_bytes());
        buf.extend_from_slice(self.spans.as_bytes());
        buf
    }
}

#[must_use]
pub fn chunk_name(index: usize, ext: &str) -> String {
    format!("{index:04}.{ext}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u32_at(buf: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(buf[at..at + 4].try_into().unwrap())
    }

    #[test]
    fn cells_expand_tabs_cut_and_replace() {
        let mut out = Vec::new();
        to_cells("\tab\u{4e2d}\u{301}x\u{1f600}", &mut out);
        let s: String = char::decode_utf16(out.iter().copied()).map(Result::unwrap).collect();
        assert_eq!(s, "    ab·x·");

        out.clear();
        to_cells(&"y".repeat(MAX_COLS + 50), &mut out);
        assert_eq!(out.len(), MAX_COLS);
    }

    #[test]
    fn lines_layout_is_what_the_reader_expects() {
        let mut chunk = LinesChunk::default();
        chunk.push(Kind::File, 0, 0, "src/a.rs");
        chunk.push(Kind::Add, 0, 7, "let x = 1;");
        chunk.push(Kind::Del, 3, 0, "é");
        let buf = chunk.encode();
        let n = 3;
        assert_eq!(&buf[..4], b"BRVL");
        assert_eq!(u32_at(&buf, 8), n);
        let text_units = u32_at(&buf, 12) as usize;
        assert_eq!(text_units, 8 + 10 + 1);
        // kind padded to 4, then old_no, new_no, start (n + 1), text.
        let kind_at = 16;
        assert_eq!(&buf[kind_at..kind_at + 3], &[0, 3, 4]);
        let old_at = kind_at + 4;
        let new_at = old_at + 4 * 3;
        let start_at = new_at + 4 * 3;
        let text_at = start_at + 4 * 4;
        assert_eq!(u32_at(&buf, old_at + 8), 3);
        assert_eq!(u32_at(&buf, new_at + 4), 7);
        assert_eq!(u32_at(&buf, start_at + 4), 8);
        assert_eq!(u32_at(&buf, start_at + 12), 19);
        let last = u16::from_le_bytes(buf[text_at + 18 * 2..text_at + 19 * 2].try_into().unwrap());
        assert_eq!(last, 'é' as u16);
        assert_eq!(buf.len() % 4, 0);
    }

    #[test]
    fn span_packing() {
        let s = span(511, 512, 200);
        assert_eq!(s & 0x1ff, 511);
        assert_eq!((s >> 9) & 0x3ff, 512);
        assert_eq!(s >> 19, 200);
    }
}
