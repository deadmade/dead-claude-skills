//! Writing a review cache: the progress lines the mod reads on stdout, and the chunk files they announce. `tui-review gen`
//! and `tui-review review` both write through here, so the mod cannot tell them apart.

use std::io::{self, Write};
use std::path::Path;

use crate::format::{CHUNK_LINES, HlChunk, Kind, LinesChunk, Manifest, chunk_name, write_atomic};

/// The stdout protocol: `manifest <dir>` or `cached <dir>`, then `text N` / `hl N` as chunks land, then `done`.
/// Each line is flushed as it is written, so the mod can paint a chunk the moment it exists.
pub struct Progress<W: Write>(pub W);

impl<W: Write> Progress<W> {
    /// # Errors
    /// When stdout is closed (the mod went away).
    pub fn say(&mut self, line: std::fmt::Arguments) -> io::Result<()> {
        self.0.write_fmt(line)?;
        self.0.write_all(b"\n")?;
        self.0.flush()
    }
}

/// Writes `manifest.bin` and announces the cache.
///
/// # Errors
/// When the file cannot be written or stdout is closed.
pub fn write_manifest<W: Write>(dir: &Path, manifest: &Manifest, progress: &mut Progress<W>) -> io::Result<()> {
    write_atomic(&dir.join("manifest.bin"), &manifest.encode())?;
    progress.say(format_args!("manifest {}", dir.display()))
}

/// Marks the cache complete: a later run finding `done` answers `cached` without diffing again.
///
/// # Errors
/// When the marker cannot be written or stdout is closed.
pub fn finish<W: Write>(dir: &Path, progress: &mut Progress<W>) -> io::Result<()> {
    write_atomic(&dir.join("done"), b"")?;
    progress.say(format_args!("done"))
}

/// Fills `NNNN.lines` chunks in order and writes each as it fills. With `hl`, each line's spans are written alongside
/// into `NNNN.hl` (what `tui-review gen` does); without, colours come later through [`HlWriter`].
pub struct LinesWriter<'a, W: Write> {
    dir: &'a Path,
    progress: &'a mut Progress<W>,
    lines: LinesChunk,
    hl: Option<HlChunk>,
    index: usize,
}

impl<'a, W: Write> LinesWriter<'a, W> {
    pub fn new(dir: &'a Path, progress: &'a mut Progress<W>, with_hl: bool) -> Self {
        Self { dir, progress, lines: LinesChunk::default(), hl: with_hl.then(HlChunk::default), index: 0 }
    }

    /// # Errors
    /// When a chunk cannot be written or stdout is closed.
    pub fn push(&mut self, kind: Kind, old: u32, new: u32, text: &str, spans: &[u32]) -> io::Result<()> {
        self.lines.push(kind, old, new, text);
        if let Some(hl) = &mut self.hl {
            hl.push_line(spans.iter().copied());
        }
        self.flush_if_full()
    }

    /// Appends every line of `from`, a file's lines laid out already.
    ///
    /// # Errors
    /// When a chunk cannot be written or stdout is closed.
    pub fn push_all(&mut self, from: &LinesChunk) -> io::Result<()> {
        for i in 0..from.len() {
            self.lines.push_from(from, i);
            if let Some(hl) = &mut self.hl {
                hl.push_line([]);
            }
            self.flush_if_full()?;
        }
        Ok(())
    }

    fn flush_if_full(&mut self) -> io::Result<()> {
        if self.lines.len() == CHUNK_LINES { self.flush() } else { Ok(()) }
    }

    /// Writes the last, partly filled chunk.
    ///
    /// # Errors
    /// When the chunk cannot be written or stdout is closed.
    pub fn flush(&mut self) -> io::Result<()> {
        if self.lines.is_empty() {
            return Ok(());
        }
        write_atomic(&self.dir.join(chunk_name(self.index, "lines")), &self.lines.encode())?;
        self.progress.say(format_args!("text {}", self.index))?;
        if let Some(hl) = &mut self.hl {
            write_atomic(&self.dir.join(chunk_name(self.index, "hl")), &hl.encode())?;
            self.progress.say(format_args!("hl {}", self.index))?;
            *hl = HlChunk::default();
        }
        self.index += 1;
        self.lines = LinesChunk::default();
        Ok(())
    }
}

/// Fills `NNNN.hl` chunks a line at a time, in the same order the lines were written, and writes each as it fills.
pub struct HlWriter<'a, W: Write> {
    dir: &'a Path,
    progress: &'a mut Progress<W>,
    hl: HlChunk,
    lines: usize,
    index: usize,
}

impl<'a, W: Write> HlWriter<'a, W> {
    pub fn new(dir: &'a Path, progress: &'a mut Progress<W>) -> Self {
        Self { dir, progress, hl: HlChunk::default(), lines: 0, index: 0 }
    }

    /// # Errors
    /// When a chunk cannot be written or stdout is closed.
    pub fn push_line(&mut self, spans: impl IntoIterator<Item = u32>) -> io::Result<()> {
        self.hl.push_line(spans);
        self.lines += 1;
        if self.lines == CHUNK_LINES { self.flush() } else { Ok(()) }
    }

    /// Writes the last, partly filled chunk.
    ///
    /// # Errors
    /// When the chunk cannot be written or stdout is closed.
    pub fn flush(&mut self) -> io::Result<()> {
        if self.lines == 0 {
            return Ok(());
        }
        write_atomic(&self.dir.join(chunk_name(self.index, "hl")), &self.hl.encode())?;
        self.progress.say(format_args!("hl {}", self.index))?;
        self.index += 1;
        self.lines = 0;
        self.hl = HlChunk::default();
        Ok(())
    }
}
