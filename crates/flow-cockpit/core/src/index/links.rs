//! Which flow runs a session worked on: the `docs/features/<slug>/flow.md` files its Edit and Write calls touched.
//! A transcript can be tens of megabytes, so a file is read once per (path, size, mtime) and its answer is kept.

use std::collections::{BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;

/// The answers of earlier scans, in memory. A file whose size and mtime are unchanged is not read again.
#[derive(Debug, Default)]
pub struct LinkCache {
    files: HashMap<PathBuf, Cached>,
    bytes_read: u64,
}

#[derive(Debug)]
struct Cached {
    size: u64,
    mtime: Option<SystemTime>,
    /// Just after the last line that ended in a newline: a scan of a grown file starts here.
    offset: u64,
    slugs: BTreeSet<String>,
}

impl LinkCache {
    /// How many bytes of transcripts this cache's scans have read so far.
    #[must_use]
    pub fn bytes_read(&self) -> u64 {
        self.bytes_read
    }

    /// The flow slugs the transcript at `path` edited or wrote, from the cache when the file is unchanged. A file that
    /// grew (its mtime not moved back) is read from where the last scan stopped; one that shrank, in full.
    pub(crate) fn slugs(&mut self, path: &Path) -> Vec<String> {
        let Ok(meta) = fs::metadata(path) else {
            self.files.remove(path);
            return Vec::new();
        };
        let (size, mtime) = (meta.len(), meta.modified().ok());
        let (mut start, mut slugs) = (0, BTreeSet::new());
        if let Some(hit) = self.files.get(path) {
            if hit.size == size && hit.mtime == mtime {
                return hit.slugs.iter().cloned().collect();
            }
            if size >= hit.offset && mtime >= hit.mtime {
                start = hit.offset;
                slugs.clone_from(&hit.slugs);
            }
        }
        let offset = scan(path, start, &mut slugs, &mut self.bytes_read);
        let out = slugs.iter().cloned().collect();
        self.files.insert(
            path.to_path_buf(),
            Cached {
                size,
                mtime,
                offset,
                slugs,
            },
        );
        out
    }
}

/// Reads the file from `start` line by line into `slugs` and returns the offset after its last complete line. Only a
/// line that names `flow.md` is parsed; a line cut short at the end of a file still being written does not parse, and
/// the next scan reads it again.
fn scan(path: &Path, start: u64, slugs: &mut BTreeSet<String>, bytes_read: &mut u64) -> u64 {
    let Ok(mut file) = File::open(path) else {
        return start;
    };
    if file.seek(SeekFrom::Start(start)).is_err() {
        return start;
    }
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut offset = start;
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(n) => n as u64,
        };
        *bytes_read += n;
        if line.ends_with(b"\n") {
            offset += n;
        }
        if !contains(&line, b"flow.md") {
            continue;
        }
        if let Ok(entry) = serde_json::from_slice::<Value>(&line) {
            slugs.extend(edited_slugs(&entry));
        }
    }
    offset
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// The slugs of the `flow.md` files an assistant entry's Edit, `MultiEdit` and Write calls touch.
fn edited_slugs(entry: &Value) -> Vec<String> {
    if entry.get("type").and_then(Value::as_str) != Some("assistant") {
        return Vec::new();
    }
    let Some(blocks) = entry
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
        .filter(|b| {
            matches!(
                b.get("name").and_then(Value::as_str),
                Some("Edit" | "MultiEdit" | "Write")
            )
        })
        .filter_map(|b| b.get("input")?.get("file_path")?.as_str())
        .filter_map(slug_of)
        .collect()
}

/// `<slug>` of a path that ends in `docs/features/<slug>/flow.md` (either slash).
fn slug_of(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split(['/', '\\']).collect();
    let [.., docs, features, slug, file] = parts.as_slice() else {
        return None;
    };
    (*docs == "docs" && *features == "features" && *file == "flow.md" && !slug.is_empty())
        .then(|| (*slug).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_needs_the_whole_tail() {
        assert_eq!(
            slug_of("/r/docs/features/login/flow.md").as_deref(),
            Some("login")
        );
        assert_eq!(
            slug_of(r"C:\r\docs\features\login\flow.md").as_deref(),
            Some("login")
        );
        assert_eq!(slug_of("/r/docs/features/login/plan.md"), None);
        assert_eq!(slug_of("docs/features/flow.md"), None);
        assert_eq!(slug_of("/r/notes/features/login/flow.md"), None);
    }
}
