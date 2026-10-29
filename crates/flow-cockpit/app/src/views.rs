//! Which views exist and where each one's code comes from. Views come in extensions: a folder `<name>/` holding one
//! or more view files `<id>.ts` and an optional `style.css`, its name the extension's name. The default extensions
//! ship with the app; the user's own, in their extensions folder, add to them, and one with a default's name replaces
//! that whole default. On a project's pages, a repository the user trusts (`config.toml`'s `trusted`) adds its own
//! `.flow-cockpit/extensions/` above both, the same way. `config.toml`'s `disabled` switches extensions off by name.
//! Every folder is read on every call, so a changed file shows on the next load.

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
    /// One of a trusted repository's extensions, in its `.flow-cockpit/extensions/`.
    Repo,
}

/// One view the window can load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ViewInfo {
    pub id: String,
    pub source: ViewSource,
    /// A view of the user's or of a trusted repository stands in for a default view of the same id.
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

/// The extensions folders, the names switched off and the repositories trusted.
pub struct Views {
    defaults: Defaults,
    user: PathBuf,
    /// `config.toml`'s `disabled`, which the poll keeps current.
    disabled: RwLock<Vec<String>>,
    /// `config.toml`'s `trusted`, which the poll keeps current.
    trusted: RwLock<Vec<PathBuf>>,
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

/// The enabled extensions of each folder, lowest first: the defaults, the user's, and a trusted repository's.
type Layers = Vec<(ViewSource, Vec<Extension>)>;

impl Views {
    #[must_use]
    pub fn new(
        defaults: Defaults,
        user: PathBuf,
        disabled: Vec<String>,
        trusted: Vec<PathBuf>,
    ) -> Views {
        Views {
            defaults,
            user,
            disabled: RwLock::new(disabled),
            trusted: RwLock::new(trusted),
        }
    }

    /// The folders the poll watches besides the trusted repositories': the default extensions (when found) and the
    /// user's.
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

    /// `config.toml`'s `trusted`, read again.
    pub fn set_trusted(&self, trusted: Vec<PathBuf>) {
        *self.trusted.write().unwrap_or_else(PoisonError::into_inner) = trusted;
    }

    fn disabled(&self) -> Vec<String> {
        self.disabled
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// The extensions folder of a project with these roots (its checkouts and worktrees), when `trusted` names one of
    /// them: the first main checkout's `.flow-cockpit/extensions/` that exists, else the first worktree's. Nothing in
    /// an untrusted project's folders is read. A linked `.flow-cockpit` or `extensions` is no folder, as everywhere
    /// else.
    #[must_use]
    pub fn repo(&self, roots: &[PathBuf]) -> Option<PathBuf> {
        let trusted = self.trusted.read().unwrap_or_else(PoisonError::into_inner);
        if !roots
            .iter()
            .any(|root| trusted.iter().any(|t| same_folder(t, root)))
        {
            return None;
        }
        drop(trusted);
        // A checkout's `.git` is a folder; a worktree's, a file.
        let (main, worktrees): (Vec<&PathBuf>, Vec<&PathBuf>) = roots
            .iter()
            .partition(|root| is_real_dir(&root.join(".git")));
        main.into_iter()
            .chain(worktrees)
            .map(|root| root.join(".flow-cockpit"))
            .filter(|dir| is_real_dir(dir))
            .map(|dir| dir.join("extensions"))
            .find(|dir| is_real_dir(dir))
    }

    /// Every view id once, from the extension that wins, sorted by id. `repo` is a trusted repository's extensions
    /// folder ([`Views::repo`]), given on that project's pages only.
    #[must_use]
    pub fn list(&self, repo: Option<&Path>) -> Vec<ViewInfo> {
        resolve(&self.layers(repo))
            .into_iter()
            .map(|(id, r)| ViewInfo {
                id,
                source: r.source,
                replaced: r.replaced,
            })
            .collect()
    }

    /// The view's code with its types stripped. `builtin` reads the default extensions' view of that id even when
    /// another replaces it: the window draws it below a broken replacement.
    ///
    /// # Errors
    /// No view has that id (no default one, with `builtin`), two extensions in one folder both have it, its file
    /// can't be read, or it doesn't strip (the message names the line).
    pub fn source(&self, id: &str, builtin: bool, repo: Option<&Path>) -> Result<String, String> {
        // Only ids a listing found: an id is never joined onto a path.
        let found = if builtin {
            self.default_views()
                .remove(id)
                .ok_or_else(|| format!("no default view {id}"))?
        } else {
            resolve(&self.layers(repo))
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
    pub fn extensions(&self, repo: Option<&Path>) -> Extensions {
        let layers = self.layers(repo);
        let mut shown: Vec<&Extension> = shown(&layers).flat_map(|(_, exts)| exts).collect();
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

    /// The extensions not switched off, by folder: the defaults, the user's, and the repository's when given.
    fn layers(&self, repo: Option<&Path>) -> Layers {
        let disabled: BTreeSet<String> = self.disabled().into_iter().collect();
        let scan_enabled = |dir: Option<&Path>| -> Vec<Extension> {
            dir.map(scan)
                .unwrap_or_default()
                .into_iter()
                .filter(|e| !disabled.contains(&e.name))
                .collect()
        };
        let mut layers = vec![
            (
                ViewSource::Builtin,
                scan_enabled(self.defaults.found.as_deref()),
            ),
            (ViewSource::Global, scan_enabled(Some(&self.user))),
        ];
        if repo.is_some() {
            layers.push((ViewSource::Repo, scan_enabled(repo)));
        }
        layers
    }

    /// The default extensions' views, those another extension replaced included.
    fn default_views(&self) -> BTreeMap<String, Found> {
        let mut layers = self.layers(None);
        views_of(&layers.swap_remove(0).1)
    }
}

/// Each view id, from the highest folder that has it; `replaced` when a default view of that id is behind it.
fn resolve(layers: &Layers) -> BTreeMap<String, Resolved> {
    let behind = layers
        .first()
        .map(|(_, defaults)| views_of(defaults))
        .unwrap_or_default();
    let mut out = BTreeMap::new();
    for (source, extensions) in shown(layers) {
        for (id, found) in views_of(extensions) {
            let replaced = source != ViewSource::Builtin && behind.contains_key(&id);
            out.insert(
                id,
                Resolved {
                    source,
                    found,
                    replaced,
                },
            );
        }
    }
    out
}

/// Each folder's extensions that no higher folder's extension of the same name replaces.
fn shown(layers: &Layers) -> impl Iterator<Item = (ViewSource, Vec<&Extension>)> {
    layers.iter().enumerate().map(|(i, (source, extensions))| {
        let kept = extensions
            .iter()
            .filter(|ext| {
                !layers[i + 1..]
                    .iter()
                    .any(|(_, higher)| higher.iter().any(|h| h.name == ext.name))
            })
            .collect();
        (*source, kept)
    })
}

/// The same folder: equal paths, or paths that resolve to the same folder.
fn same_folder(a: &Path, b: &Path) -> bool {
    a == b
        || matches!(
            (fs::canonicalize(a), fs::canonicalize(b)),
            (Ok(x), Ok(y)) if x == y
        )
}

/// A folder, not a link to one.
fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
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
                Vec::new(),
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
            views.list(None),
            [
                info("list", ViewSource::Builtin, false),
                info("run", ViewSource::Builtin, false),
            ]
        );
        let run = views.source("run", false, None).unwrap();
        assert!(run.contains("run") && !run.contains(": number"), "{run}");
        t.write("defaults/run/run.ts", "export default { id: 'edited' };\n");
        assert!(views.source("run", false, None).unwrap().contains("edited"));
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
            views.list(None),
            [
                info("extra", ViewSource::Global, false),
                info("list", ViewSource::Builtin, false),
                info("run", ViewSource::Global, true),
            ]
        );
        assert!(views.source("run", false, None).unwrap().contains("mine"));
        // The default behind it, which the window draws below a broken replacement.
        let builtin = views.source("run", true, None).unwrap();
        assert!(
            builtin.contains("id: \"run\"") && !builtin.contains("mine"),
            "{builtin}"
        );
        // No default behind a view of its own: an error, so the window shows only the error card.
        assert!(views.source("extra", true, None).is_err());
        // Removing the user's folder brings the default back.
        fs::remove_dir_all(t.0.join("user/run")).unwrap();
        assert_eq!(
            views
                .list(None)
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
                .list(None)
                .contains(&info("run", ViewSource::Global, true))
        );
        assert!(views.source("run", false, None).unwrap().contains("mine"));
        assert!(!views.source("run", true, None).unwrap().contains("mine"));
    }

    #[test]
    fn disabled_removes_an_extensions_views() {
        let t = temp("disabled");
        t.write("user/more/extra.ts", "export default {};\n");
        let views = t.views(&["run", "more"]);
        assert_eq!(views.list(None), [info("list", ViewSource::Builtin, false)]);
        assert!(views.source("run", false, None).is_err());
        assert_eq!(views.extensions(None).disabled, ["run", "more"]);
        // Read live: switching it back on brings the views back.
        views.set_disabled(vec![]);
        assert_eq!(views.list(None).len(), 3);
        // A disabled default is no fallback either.
        t.write("user/run/run.ts", "export default { id: 'mine' };\n");
        views.set_disabled(vec!["run".to_string()]);
        assert_eq!(views.list(None).len(), 2);
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
                .list(None)
                .contains(&info("extra", ViewSource::Global, false))
        );
        assert_eq!(
            views.source("extra", false, None).unwrap_err(),
            "the extensions a and b both have a view extra"
        );
        assert_eq!(
            views.source("list", false, None).unwrap_err(),
            "the extensions list and other both have a view list"
        );
        // Across the two folders it is no clash: the user's wins.
        fs::remove_dir_all(t.0.join("user/b")).unwrap();
        assert!(views.source("extra", false, None).is_ok());
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
        let got = views.extensions(None);
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
        assert!(views.source("nope", false, None).is_err());
        assert!(views.source("../list", false, None).is_err());
        assert!(views.source("list/list", false, None).is_err());
    }

    /// A trusted repository's extensions sit above the user's, which sit above the defaults: by folder name (the
    /// whole extension) and by view id.
    #[test]
    fn trusted_repo_view_replaces_global() {
        let t = temp("repo-order");
        t.write("user/run/run.ts", "export default { id: 'user run' };\n");
        t.write("user/run/style.css", "/* user run */\n");
        t.write(
            "user/notes/notes.ts",
            "export default { id: 'user notes' };\n",
        );
        t.write("user/mine/mine.ts", "export default { id: 'user mine' };\n");
        t.write("repo/run/run.ts", "export default { id: 'repo run' };\n");
        t.write("repo/run/style.css", "/* repo run */\n");
        t.write(
            "repo/team/notes.ts",
            "export default { id: 'repo notes' };\n",
        );
        t.write("repo/team/list.ts", "export default { id: 'repo list' };\n");
        t.write("repo/off/off.ts", "export default {};\n");
        let views = t.views(&["off"]);
        let repo = t.0.join("repo");
        let repo = Some(repo.as_path());
        assert_eq!(
            views.list(repo),
            [
                info("list", ViewSource::Repo, true),
                info("mine", ViewSource::Global, false),
                info("notes", ViewSource::Repo, false),
                info("run", ViewSource::Repo, true),
            ]
        );
        for (id, from) in [
            ("run", "repo run"),
            ("notes", "repo notes"),
            ("list", "repo list"),
            ("mine", "user mine"),
        ] {
            assert!(
                views.source(id, false, repo).unwrap().contains(from),
                "{id}"
            );
        }
        // The default behind a broken replacement is still the default.
        let builtin = views.source("run", true, repo).unwrap();
        assert!(builtin.contains("id: \"run\""), "{builtin}");
        // The repository's `run` replaced the user's whole `run`, style and all.
        let styles: Vec<String> = views
            .extensions(repo)
            .styles
            .into_iter()
            .map(|s| s.css)
            .collect();
        assert_eq!(styles, ["/* repo run */\n"]);
        // Without the repository (another project's pages) the user's own come back.
        assert!(
            views
                .source("run", false, None)
                .unwrap()
                .contains("user run")
        );
        assert!(
            views
                .source("notes", false, None)
                .unwrap()
                .contains("user notes")
        );
        assert!(
            views
                .list(None)
                .iter()
                .all(|v| v.source != ViewSource::Repo)
        );
    }

    /// A project is trusted by any of its checkouts' or worktrees' paths; its extensions come from the main checkout
    /// when several carry them, and from a worktree when only that one does.
    #[test]
    fn repo_folder_follows_trust_and_prefers_the_main_checkout() {
        let t = temp("repo-folder");
        let main = t.0.join("app");
        let tree = t.0.join("app/.claude/worktrees/wt");
        fs::create_dir_all(main.join(".git")).unwrap();
        t.write(
            "app/.claude/worktrees/wt/.git",
            "gitdir: ../../../.git/worktrees/wt\n",
        );
        t.write(
            "app/.claude/worktrees/wt/.flow-cockpit/extensions/x/x.ts",
            "",
        );
        let roots = [main.clone(), tree.clone()];
        let views = t.views(&[]);
        assert_eq!(views.repo(&roots), None, "untrusted");
        views.set_trusted(vec![main.clone()]);
        let wt_dir = tree.join(".flow-cockpit/extensions");
        assert_eq!(views.repo(&roots), Some(wt_dir.clone()));
        t.write("app/.flow-cockpit/extensions/x/x.ts", "");
        let main_dir = main.join(".flow-cockpit/extensions");
        assert_eq!(views.repo(&roots), Some(main_dir.clone()));
        // Trusting the worktree trusts the project: the same folder.
        views.set_trusted(vec![tree.join("")]);
        assert_eq!(views.repo(&roots), Some(main_dir));
        // Another project's path trusts nothing here.
        views.set_trusted(vec![t.0.join("other")]);
        assert_eq!(views.repo(&roots), None);
    }

    /// A linked `.flow-cockpit` or `extensions` folder is no folder, as a linked extension is none.
    #[cfg(unix)]
    #[test]
    fn linked_repo_folder_is_ignored() {
        let t = temp("repo-link");
        let main = t.0.join("app");
        fs::create_dir_all(main.join(".git")).unwrap();
        t.write("elsewhere/extensions/x/x.ts", "");
        std::os::unix::fs::symlink(t.0.join("elsewhere"), main.join(".flow-cockpit")).unwrap();
        let views = t.views(&[]);
        views.set_trusted(vec![main.clone()]);
        assert_eq!(views.repo(std::slice::from_ref(&main)), None);
        fs::remove_file(main.join(".flow-cockpit")).unwrap();
        fs::create_dir_all(main.join(".flow-cockpit")).unwrap();
        std::os::unix::fs::symlink(
            t.0.join("elsewhere/extensions"),
            main.join(".flow-cockpit/extensions"),
        )
        .unwrap();
        assert_eq!(views.repo(std::slice::from_ref(&main)), None);
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
            Vec::new(),
        );
        assert_eq!(views.list(None), []);
        assert_eq!(
            views.extensions(None).looked,
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
            Vec::new(),
        );
        let ids: Vec<String> = views.list(None).into_iter().map(|v| v.id).collect();
        assert_eq!(ids, ["activity", "docs", "list", "run"]);
        for id in &ids {
            let source = views.source(id, false, None).unwrap();
            assert!(source.contains("slot"), "{id}");
        }
    }
}
