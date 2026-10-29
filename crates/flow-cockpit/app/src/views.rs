//! Which views exist and where each one's code comes from. Views come in extensions: a folder `<name>/` holding one
//! or more view files `<id>.ts` and an optional `style.css`, its name the extension's name. The default extensions
//! ship with the app; the user's own, in their extensions folder, add to them, and one with a default's name replaces
//! that whole default. `config.toml`'s `disabled` switches extensions off by name. Both folders are read on every
//! call, so a changed file shows on the next load.

use std::collections::BTreeSet;
use std::collections::btree_map::{BTreeMap, Entry};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{PoisonError, RwLock};

use serde::Serialize;
use ts_rs::TS;

use crate::paths::Defaults;
use crate::strip::strip;

/// Where a view's code comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub enum ViewSource {
    /// A default extension, shipped with the app.
    Builtin,
    /// One of the user's extensions.
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
    /// One of the user's views stands in for a default view of the same id.
    pub replaced: bool,
}

/// What the window needs about the extensions besides their views.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Extensions {
    /// The loaded extensions' `style.css`, by extension name.
    pub styles: Vec<Style>,
    /// The extensions `config.toml` switches off.
    pub disabled: Vec<String>,
    /// Where the default extensions were looked for, when none of those folders exists; empty when one does.
    pub looked: Vec<String>,
}

/// One extension's `style.css`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Style {
    pub extension: String,
    pub css: String,
}

/// The two extensions folders and the names switched off.
pub struct Views {
    defaults: Defaults,
    user: PathBuf,
    /// `config.toml`'s `disabled`, which the poll keeps current.
    disabled: RwLock<Vec<String>>,
}

/// One extension folder: its view files by id and its style.
struct Extension {
    name: String,
    views: BTreeMap<String, PathBuf>,
    style: Option<PathBuf>,
}

/// A view id's file, or the error that two extensions in one folder both have it.
type Found = Result<PathBuf, String>;

/// A view id as the listing resolves it.
struct Resolved {
    source: ViewSource,
    found: Found,
    replaced: bool,
}

impl Views {
    #[must_use]
    pub fn new(defaults: Defaults, user: PathBuf, disabled: Vec<String>) -> Views {
        Views {
            defaults,
            user,
            disabled: RwLock::new(disabled),
        }
    }

    /// The folders the poll watches: the default extensions (when found) and the user's.
    pub fn folders(&self) -> impl Iterator<Item = &Path> {
        self.defaults
            .found
            .as_deref()
            .into_iter()
            .chain(std::iter::once(self.user.as_path()))
    }

    /// `config.toml`'s `disabled`, read again.
    pub fn set_disabled(&self, disabled: Vec<String>) {
        *self
            .disabled
            .write()
            .unwrap_or_else(PoisonError::into_inner) = disabled;
    }

    fn disabled(&self) -> Vec<String> {
        self.disabled
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Every view id once, from the extension that wins, sorted by id.
    #[must_use]
    pub fn list(&self) -> Vec<ViewInfo> {
        self.resolve()
            .into_iter()
            .map(|(id, r)| ViewInfo {
                id,
                source: r.source,
                replaced: r.replaced,
            })
            .collect()
    }

    /// The view's code with its types stripped. `builtin` reads the default extensions' view of that id even when
    /// the user's replaces it: the window draws it below a broken replacement.
    ///
    /// # Errors
    /// No view has that id (no default one, with `builtin`), two extensions in one folder both have it, its file
    /// can't be read, or it doesn't strip (the message names the line).
    pub fn source(&self, id: &str, builtin: bool) -> Result<String, String> {
        // Only ids a listing found: an id is never joined onto a path.
        let found = if builtin {
            self.default_views()
                .remove(id)
                .ok_or_else(|| format!("no default view {id}"))?
        } else {
            self.resolve()
                .remove(id)
                .ok_or_else(|| format!("no view {id}"))?
                .found
        };
        let path = found?;
        let typescript =
            fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        strip(&typescript)
    }

    /// The loaded extensions' styles, the names switched off, and where the defaults were looked for when missing.
    #[must_use]
    pub fn extensions(&self) -> Extensions {
        let (defaults, user) = self.enabled();
        let mut shown: Vec<&Extension> = replaceable(&defaults, &user).chain(&user).collect();
        shown.sort_by(|a, b| a.name.cmp(&b.name));
        let styles = shown
            .into_iter()
            .filter_map(|ext| {
                let css = fs::read_to_string(ext.style.as_ref()?).ok()?;
                Some(Style {
                    extension: ext.name.clone(),
                    css,
                })
            })
            .collect();
        let looked = if self.defaults.found.is_some() {
            Vec::new()
        } else {
            self.defaults
                .looked
                .iter()
                .map(|p| p.display().to_string())
                .collect()
        };
        Extensions {
            styles,
            disabled: self.disabled(),
            looked,
        }
    }

    /// The extensions not switched off: the defaults and the user's.
    fn enabled(&self) -> (Vec<Extension>, Vec<Extension>) {
        let disabled: BTreeSet<String> = self.disabled().into_iter().collect();
        let scan_enabled = |dir: Option<&Path>| -> Vec<Extension> {
            dir.map(scan)
                .unwrap_or_default()
                .into_iter()
                .filter(|e| !disabled.contains(&e.name))
                .collect()
        };
        (
            scan_enabled(self.defaults.found.as_deref()),
            scan_enabled(Some(&self.user)),
        )
    }

    /// The default extensions' views, those the user replaced included.
    fn default_views(&self) -> BTreeMap<String, Found> {
        views_of(&self.enabled().0)
    }

    /// Each view id, from the user's extensions over the defaults they don't replace.
    fn resolve(&self) -> BTreeMap<String, Resolved> {
        let (defaults, user) = self.enabled();
        let behind = views_of(&defaults);
        let mut out: BTreeMap<String, Resolved> = views_of(replaceable(&defaults, &user))
            .into_iter()
            .map(|(id, found)| {
                let r = Resolved {
                    source: ViewSource::Builtin,
                    found,
                    replaced: false,
                };
                (id, r)
            })
            .collect();
        for (id, found) in views_of(&user) {
            let replaced = behind.contains_key(&id);
            let r = Resolved {
                source: ViewSource::Global,
                found,
                replaced,
            };
            out.insert(id, r);
        }
        out
    }
}

/// The default extensions no user extension of the same name replaces.
fn replaceable<'a>(
    defaults: &'a [Extension],
    user: &'a [Extension],
) -> impl Iterator<Item = &'a Extension> {
    defaults
        .iter()
        .filter(|d| !user.iter().any(|u| u.name == d.name))
}

/// The views of extensions from one folder by id; an id two of them have is an error naming both.
fn views_of<'a>(extensions: impl IntoIterator<Item = &'a Extension>) -> BTreeMap<String, Found> {
    let mut out: BTreeMap<String, (String, Found)> = BTreeMap::new();
    for ext in extensions {
        for (id, path) in &ext.views {
            match out.entry(id.clone()) {
                Entry::Vacant(slot) => {
                    slot.insert((ext.name.clone(), Ok(path.clone())));
                }
                Entry::Occupied(mut slot) => {
                    let (first, found) = slot.get_mut();
                    *found = Err(format!(
                        "the extensions {first} and {} both have a view {id}",
                        ext.name
                    ));
                }
            }
        }
    }
    out.into_iter()
        .map(|(id, (_, found))| (id, found))
        .collect()
}

/// The extensions in `dir`, by name: each folder holding at least one view file. None when `dir` doesn't exist.
fn scan(dir: &Path) -> Vec<Extension> {
    let mut out: Vec<Extension> = files(dir)
        .filter(|(_, is_dir)| *is_dir)
        .filter_map(|(path, _)| {
            let name = path.file_name()?.to_str()?.to_string();
            let mut views = BTreeMap::new();
            let mut style = None;
            for (file, is_dir) in files(&path) {
                let Some(file_name) = file
                    .file_name()
                    .and_then(|n| n.to_str())
                    .filter(|_| !is_dir)
                else {
                    continue;
                };
                if file_name == "style.css" {
                    style = Some(file.clone());
                } else if let Some(id) = view_id(file_name) {
                    views.insert(id.to_string(), file.clone());
                }
            }
            (!views.is_empty()).then_some(Extension { name, views, style })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// A folder's files and folders, each with whether it is a folder; symlinks are neither, as the poll doesn't follow
/// them. None when `dir` can't be read.
fn files(dir: &Path) -> impl Iterator<Item = (PathBuf, bool)> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let kind = e.file_type().ok()?;
            (kind.is_dir() || kind.is_file()).then(|| (e.path(), kind.is_dir()))
        })
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

    struct Temp(PathBuf);

    impl Drop for Temp {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).ok();
        }
    }

    /// A temp folder with `defaults/` (the `list` and `run` extensions) and an empty `user/`.
    fn temp(tag: &str) -> Temp {
        let dir =
            std::env::temp_dir().join(format!("flow-cockpit-views-{}-{tag}", std::process::id()));
        fs::remove_dir_all(&dir).ok();
        fs::create_dir_all(dir.join("user")).unwrap();
        let t = Temp(dir);
        t.write("defaults/list/list.ts", LIST);
        t.write("defaults/run/run.ts", RUN);
        t
    }

    impl Temp {
        fn write(&self, rel: &str, text: &str) {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }

        fn views(&self, disabled: &[&str]) -> Views {
            Views::new(
                Defaults {
                    found: Some(self.0.join("defaults")),
                    looked: vec![self.0.join("defaults")],
                },
                self.0.join("user"),
                disabled.iter().map(ToString::to_string).collect(),
            )
        }
    }

    fn info(id: &str, source: ViewSource, replaced: bool) -> ViewInfo {
        ViewInfo {
            id: id.to_string(),
            source,
            replaced,
        }
    }

    #[test]
    fn defaults_load_from_disk_and_follow_edits() {
        let t = temp("defaults");
        // Not views: tests, printed types and other files; a folder with no view is no extension.
        t.write("defaults/run/run.test.ts", "");
        t.write("defaults/run/flow-cockpit.d.ts", "export type X = 1;\n");
        t.write("defaults/run/notes.md", "");
        t.write("defaults/tests/views.test.ts", "");
        t.write("defaults/tests/fixtures/x.json", "{}");
        let views = t.views(&[]);
        assert_eq!(
            views.list(),
            [
                info("list", ViewSource::Builtin, false),
                info("run", ViewSource::Builtin, false),
            ]
        );
        let run = views.source("run", false).unwrap();
        assert!(run.contains("run") && !run.contains(": number"), "{run}");
        t.write("defaults/run/run.ts", "export default { id: 'edited' };\n");
        assert!(views.source("run", false).unwrap().contains("edited"));
    }

    #[test]
    fn user_extension_replaces_a_default_by_name() {
        let t = temp("replace");
        // The user's `run` replaces the whole default `run`, extra views and all.
        t.write(
            "defaults/run/run-extra.ts",
            "export default { id: 'gone' };\n",
        );
        t.write("user/run/run.ts", "export default { id: 'mine' };\n");
        t.write("user/more/extra.ts", "export default {};\n");
        let views = t.views(&[]);
        assert_eq!(
            views.list(),
            [
                info("extra", ViewSource::Global, false),
                info("list", ViewSource::Builtin, false),
                info("run", ViewSource::Global, true),
            ]
        );
        assert!(views.source("run", false).unwrap().contains("mine"));
        // The default behind it, which the window draws below a broken replacement.
        let builtin = views.source("run", true).unwrap();
        assert!(
            builtin.contains("id: \"run\"") && !builtin.contains("mine"),
            "{builtin}"
        );
        // No default behind a view of its own: an error, so the window shows only the error card.
        assert!(views.source("extra", true).is_err());
        // Removing the user's folder brings the default back.
        fs::remove_dir_all(t.0.join("user/run")).unwrap();
        assert_eq!(
            views
                .list()
                .iter()
                .map(|v| v.id.as_str())
                .collect::<Vec<_>>(),
            ["extra", "list", "run", "run-extra"]
        );
    }

    #[test]
    fn user_view_wins_over_a_default_view_of_the_same_id() {
        let t = temp("same-id");
        t.write("user/mine/run.ts", "export default { id: 'mine' };\n");
        let views = t.views(&[]);
        assert!(
            views
                .list()
                .contains(&info("run", ViewSource::Global, true))
        );
        assert!(views.source("run", false).unwrap().contains("mine"));
        assert!(!views.source("run", true).unwrap().contains("mine"));
    }

    #[test]
    fn disabled_removes_an_extensions_views() {
        let t = temp("disabled");
        t.write("user/more/extra.ts", "export default {};\n");
        let views = t.views(&["run", "more"]);
        assert_eq!(views.list(), [info("list", ViewSource::Builtin, false)]);
        assert!(views.source("run", false).is_err());
        assert_eq!(views.extensions().disabled, ["run", "more"]);
        // Read live: switching it back on brings the views back.
        views.set_disabled(vec![]);
        assert_eq!(views.list().len(), 3);
        // A disabled default is no fallback either.
        t.write("user/run/run.ts", "export default { id: 'mine' };\n");
        views.set_disabled(vec!["run".to_string()]);
        assert_eq!(views.list().len(), 2);
    }

    #[test]
    fn same_view_id_twice_in_one_folder_is_an_error_naming_both() {
        let t = temp("twice");
        t.write("user/a/extra.ts", "export default {};\n");
        t.write("user/b/extra.ts", "export default {};\n");
        t.write("defaults/other/list.ts", "export default {};\n");
        let views = t.views(&[]);
        assert!(
            views
                .list()
                .contains(&info("extra", ViewSource::Global, false))
        );
        assert_eq!(
            views.source("extra", false).unwrap_err(),
            "the extensions a and b both have a view extra"
        );
        assert_eq!(
            views.source("list", false).unwrap_err(),
            "the extensions list and other both have a view list"
        );
        // Across the two folders it is no clash: the user's wins.
        fs::remove_dir_all(t.0.join("user/b")).unwrap();
        assert!(views.source("extra", false).is_ok());
    }

    #[test]
    fn styles_come_from_loaded_extensions_only() {
        let t = temp("styles");
        t.write(
            "defaults/list/style.css",
            "section[data-view=list] { color: red; }\n",
        );
        t.write("defaults/run/style.css", "section[data-view=run] {}\n");
        t.write("user/more/extra.ts", "export default {};\n");
        t.write("user/more/style.css", "section[data-view=extra] {}\n");
        // A style with no view is no extension.
        t.write("user/lonely/style.css", "body {}\n");
        let views = t.views(&["run"]);
        let got = views.extensions();
        assert_eq!(
            got.styles,
            [
                Style {
                    extension: "list".to_string(),
                    css: "section[data-view=list] { color: red; }\n".to_string(),
                },
                Style {
                    extension: "more".to_string(),
                    css: "section[data-view=extra] {}\n".to_string(),
                },
            ]
        );
        assert_eq!(got.looked, Vec::<String>::new());
    }

    #[test]
    fn unknown_or_path_like_id_is_an_error() {
        let t = temp("unknown");
        let views = t.views(&[]);
        assert!(views.source("nope", false).is_err());
        assert!(views.source("../list", false).is_err());
        assert!(views.source("list/list", false).is_err());
    }

    #[test]
    fn missing_folders_list_nothing_and_name_where_they_looked() {
        let views = Views::new(
            Defaults {
                found: None,
                looked: vec![
                    PathBuf::from("/nonexistent/a"),
                    PathBuf::from("/nonexistent/b"),
                ],
            },
            PathBuf::from("/nonexistent/flow-cockpit/extensions"),
            Vec::new(),
        );
        assert_eq!(views.list(), []);
        assert_eq!(
            views.extensions().looked,
            [
                PathBuf::from("/nonexistent/a").display().to_string(),
                PathBuf::from("/nonexistent/b").display().to_string(),
            ]
        );
    }

    /// The repository's own defaults: the four extensions, each view stripping cleanly, and nothing else (the tests
    /// and fixtures in `extensions/tests/` are no extension).
    #[test]
    fn repository_defaults_are_the_four_extensions() {
        let views = Views::new(
            Defaults {
                found: Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../extensions")),
                looked: Vec::new(),
            },
            PathBuf::from("/nonexistent/flow-cockpit/extensions"),
            Vec::new(),
        );
        let ids: Vec<String> = views.list().into_iter().map(|v| v.id).collect();
        assert_eq!(ids, ["activity", "docs", "list", "run"]);
        for id in &ids {
            let source = views.source(id, false).unwrap();
            assert!(source.contains("slot"), "{id}");
        }
    }
}
