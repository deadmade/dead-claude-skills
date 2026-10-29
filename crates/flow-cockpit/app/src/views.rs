//! Which views exist and where each one's code comes from. The built-in views are embedded in the binary; a
//! same-named `.ts` file in the global views folder replaces one, a new name adds one.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use include_dir::{Dir, DirEntry, File};
use serde::Serialize;
use ts_rs::TS;

use crate::strip::strip;

/// Embeds the named files of `views/builtin/` as one folder.
macro_rules! builtin {
    ($($name:literal),* $(,)?) => {
        Dir::new("", &[$(DirEntry::File(File::new(
            $name,
            include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/views/builtin/", $name)),
        ))),*])
    };
}

/// The built-in views, embedded at build time: the view files only, not the tests and fixtures beside them. A new
/// built-in is added here (`builtin_embeds_only_the_view_files` fails until it is).
pub static BUILTIN: Dir<'static> = builtin!["activity.ts", "docs.ts", "list.ts", "run.ts"];

/// Where a view's code comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub enum ViewSource {
    Builtin,
    Global,
    /// A trusted repository's `.flow-cockpit/views/`.
    #[expect(dead_code, reason = "repository views load once trust is in (slice 2)")]
    Repo,
}

/// One view the window can load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ViewInfo {
    pub id: String,
    pub source: ViewSource,
    /// A file in a views folder stands in for the built-in of the same id.
    pub replaced: bool,
}

/// The views folders and the built-ins, read on every call so a changed file shows on the next load.
pub struct Views {
    builtin: &'static Dir<'static>,
    global: PathBuf,
}

impl Views {
    #[must_use]
    pub fn new(builtin: &'static Dir<'static>, global: PathBuf) -> Views {
        Views { builtin, global }
    }

    /// The global views folder, which the poll watches.
    #[must_use]
    pub fn global(&self) -> &Path {
        &self.global
    }

    /// Every view id once, from the source that wins, sorted by id.
    #[must_use]
    pub fn list(&self) -> Vec<ViewInfo> {
        let mut views: BTreeMap<String, ViewInfo> = builtin_ids(self.builtin)
            .map(|id| {
                let info = ViewInfo {
                    id: id.to_string(),
                    source: ViewSource::Builtin,
                    replaced: false,
                };
                (id.to_string(), info)
            })
            .collect();
        for id in self.global_files().into_keys() {
            let replaced = views.contains_key(&id);
            let info = ViewInfo {
                id: id.clone(),
                source: ViewSource::Global,
                replaced,
            };
            views.insert(id, info);
        }
        views.into_values().collect()
    }

    /// The view's code with its types stripped. `builtin` skips the views folders and reads the built-in, which the
    /// window draws below a broken replacement.
    ///
    /// # Errors
    /// No view has that id (no built-in, with `builtin`), its file can't be read, or it doesn't strip (the message
    /// names the line).
    pub fn source(&self, id: &str, builtin: bool) -> Result<String, String> {
        // Only ids the listing found: an id is never joined onto a path.
        let global = if builtin {
            None
        } else {
            self.global_files().remove(id)
        };
        let typescript = if let Some(path) = global {
            fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?
        } else if let Some(text) = print_view(self.builtin, id) {
            text.to_string()
        } else if builtin {
            return Err(format!("no built-in view {id}"));
        } else {
            return Err(format!("no view {id}"));
        };
        strip(&typescript)
    }

    /// The view files in the global folder by id; none when the folder doesn't exist.
    fn global_files(&self) -> BTreeMap<String, PathBuf> {
        let Ok(read) = fs::read_dir(&self.global) else {
            return BTreeMap::new();
        };
        read.flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|e| {
                let name = e.file_name().into_string().ok()?;
                Some((view_id(&name)?.to_string(), e.path()))
            })
            .collect()
    }
}

/// A built-in view's TypeScript as shipped.
#[must_use]
pub fn print_view<'a>(builtin: &'a Dir<'a>, id: &str) -> Option<&'a str> {
    builtin
        .files()
        .find(|f| file_id(f) == Some(id))
        .and_then(File::contents_utf8)
}

fn builtin_ids<'a>(builtin: &'a Dir<'a>) -> impl Iterator<Item = &'a str> {
    builtin.files().filter_map(file_id)
}

fn file_id<'a>(file: &'a File<'a>) -> Option<&'a str> {
    view_id(file.path().to_str()?)
}

/// `list` for `list.ts`; nothing for a name with another dot (`flow-cockpit.d.ts`, `list.test.ts`) or any other file.
fn view_id(name: &str) -> Option<&str> {
    let id = name.strip_suffix(".ts")?;
    (!id.is_empty() && !id.contains(['/', '\\']) && Path::new(id).extension().is_none())
        .then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = "const view = { id: 'list' };\nexport default view;\n";
    const RUN: &str = "const n: number = 1;\nexport default { id: 'run', n };\n";

    static TEST_BUILTIN: Dir<'static> = Dir::new(
        "",
        &[
            DirEntry::File(File::new("list.ts", LIST.as_bytes())),
            DirEntry::File(File::new("run.ts", RUN.as_bytes())),
            DirEntry::File(File::new("views.test.ts", b"")),
            DirEntry::File(File::new(".gitkeep", b"")),
        ],
    );

    struct Temp(PathBuf);

    impl Drop for Temp {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).ok();
        }
    }

    fn temp(tag: &str) -> Temp {
        let dir =
            std::env::temp_dir().join(format!("flow-cockpit-views-{}-{tag}", std::process::id()));
        fs::remove_dir_all(&dir).ok();
        fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }

    fn info(id: &str, source: ViewSource, replaced: bool) -> ViewInfo {
        ViewInfo {
            id: id.to_string(),
            source,
            replaced,
        }
    }

    #[test]
    fn view_lookup_order() {
        let t = temp("order");
        fs::write(t.0.join("run.ts"), "export default { id: 'mine' };\n").unwrap();
        fs::write(t.0.join("extra.ts"), "export default {};\n").unwrap();
        // Not views: the printed types, a test, and anything not TypeScript.
        fs::write(t.0.join("flow-cockpit.d.ts"), "export type X = 1;\n").unwrap();
        fs::write(t.0.join("extra.test.ts"), "").unwrap();
        fs::write(t.0.join("notes.md"), "").unwrap();
        let views = Views::new(&TEST_BUILTIN, t.0.clone());
        assert_eq!(
            views.list(),
            [
                info("extra", ViewSource::Global, false),
                info("list", ViewSource::Builtin, false),
                info("run", ViewSource::Global, true),
            ]
        );
        assert!(views.source("run", false).unwrap().contains("mine"));
        assert!(views.source("list", false).unwrap().contains("list"));
        fs::remove_file(t.0.join("run.ts")).unwrap();
        let run = views.source("run", false).unwrap();
        assert!(run.contains("run") && !run.contains(": number"), "{run}");
    }

    #[test]
    fn builtin_source_ignores_global() {
        let t = temp("builtin");
        fs::write(t.0.join("run.ts"), "export default { id: 'mine' };\n").unwrap();
        fs::write(t.0.join("extra.ts"), "export default {};\n").unwrap();
        let views = Views::new(&TEST_BUILTIN, t.0.clone());
        assert!(views.source("run", false).unwrap().contains("mine"));
        let run = views.source("run", true).unwrap();
        assert!(
            run.contains("id: \"run\"") && !run.contains("mine"),
            "{run}"
        );
        // No built-in behind a view of its own: an error, so the window shows only the error card.
        assert!(views.source("extra", true).is_err());
    }

    #[test]
    fn unknown_or_path_like_id_is_an_error() {
        let t = temp("unknown");
        let views = Views::new(&TEST_BUILTIN, t.0.clone());
        assert!(views.source("nope", false).is_err());
        assert!(views.source("../list", false).is_err());
    }

    #[test]
    fn missing_global_folder_lists_builtins() {
        let views = Views::new(
            &TEST_BUILTIN,
            PathBuf::from("/nonexistent/flow-cockpit/views"),
        );
        assert_eq!(
            views.list(),
            [
                info("list", ViewSource::Builtin, false),
                info("run", ViewSource::Builtin, false),
            ]
        );
    }

    /// Only the view files ship: the tests and their fixtures next to them stay out of the binary.
    #[test]
    fn builtin_embeds_only_the_view_files() {
        let mut on_disk: Vec<String> =
            fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/views/builtin"))
                .unwrap()
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|name| view_id(name).is_some())
                .collect();
        on_disk.sort();
        let embedded: Vec<&str> = BUILTIN
            .entries()
            .iter()
            .map(|e| e.path().to_str().unwrap())
            .collect();
        assert_eq!(embedded, on_disk);
        assert!(print_view(&BUILTIN, "run").is_some_and(|s| s.contains("slot")));
    }

    #[test]
    fn print_view_prints_builtin() {
        assert_eq!(print_view(&TEST_BUILTIN, "run"), Some(RUN));
        assert_eq!(print_view(&TEST_BUILTIN, "views.test"), None);
        assert_eq!(print_view(&TEST_BUILTIN, "nope"), None);
    }
}
