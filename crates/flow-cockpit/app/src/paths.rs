//! Where the cockpit reads from. The capture rules here are the ones the hooks follow (Task 10's `captureDir`).

use std::path::{Path, PathBuf};

/// The two systems the cockpit runs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Linux,
    Windows,
}

impl Platform {
    #[must_use]
    pub fn current() -> Platform {
        if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Linux
        }
    }
}

/// The hooks' capture folder: `$XDG_STATE_HOME/flow-cockpit/capture` (default `~/.local/state/...`) on Linux,
/// `%LOCALAPPDATA%\flow-cockpit\capture` (default `%USERPROFILE%\AppData\Local`) on Windows.
pub fn capture_dir(env: impl Fn(&str) -> Option<String>, platform: Platform) -> PathBuf {
    let base = match platform {
        Platform::Linux => var(&env, "XDG_STATE_HOME")
            .unwrap_or_else(|| home(&env, platform).join(".local").join("state")),
        Platform::Windows => var(&env, "LOCALAPPDATA")
            .unwrap_or_else(|| home(&env, platform).join("AppData").join("Local")),
    };
    base.join("flow-cockpit").join("capture")
}

/// The user's extensions folder and `config.toml` live here: `$XDG_CONFIG_HOME/flow-cockpit` (default
/// `~/.config/flow-cockpit`) on Linux, `%APPDATA%\flow-cockpit` (default `%USERPROFILE%\AppData\Roaming`) on Windows.
pub fn config_dir(env: impl Fn(&str) -> Option<String>, platform: Platform) -> PathBuf {
    let base = match platform {
        Platform::Linux => {
            var(&env, "XDG_CONFIG_HOME").unwrap_or_else(|| home(&env, platform).join(".config"))
        }
        Platform::Windows => var(&env, "APPDATA")
            .unwrap_or_else(|| home(&env, platform).join("AppData").join("Roaming")),
    };
    base.join("flow-cockpit")
}

/// Where the default extensions, the ones that ship with the app, were looked for and found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Defaults {
    /// The first of `looked` that exists, made absolute; none when none does.
    pub found: Option<PathBuf>,
    /// Every folder tried, in order.
    pub looked: Vec<PathBuf>,
}

/// The default extensions folder, the first that exists of: `$FLOW_COCKPIT_EXTENSIONS` (a development override, such
/// as a checkout's `crates/flow-cockpit/extensions`, so edits show without a rebuild), `<exe dir>/../share/flow-cockpit/
/// extensions` (Nix and Linux installs) and `<exe dir>/extensions` (Windows). `exe` is the resolved path of the
/// running program, so its folder's parent is the install's root.
pub fn default_extensions(env: impl Fn(&str) -> Option<String>, exe: Option<&Path>) -> Defaults {
    let mut looked: Vec<PathBuf> = var(&env, "FLOW_COCKPIT_EXTENSIONS").into_iter().collect();
    if let Some(dir) = exe.and_then(Path::parent) {
        let root = dir.parent().unwrap_or(dir);
        looked.push(root.join("share").join("flow-cockpit").join("extensions"));
        looked.push(dir.join("extensions"));
    }
    let found = looked
        .iter()
        .find(|dir| dir.is_dir())
        .map(|dir| std::path::absolute(dir).unwrap_or_else(|_| dir.clone()));
    Defaults { found, looked }
}

/// Claude Code's transcripts: `projects/` in `$CLAUDE_CONFIG_DIR`, default `~/.claude`.
pub fn claude_projects(env: impl Fn(&str) -> Option<String>, platform: Platform) -> PathBuf {
    var(&env, "CLAUDE_CONFIG_DIR")
        .unwrap_or_else(|| home(&env, platform).join(".claude"))
        .join("projects")
}

/// A variable that is set and not empty (the XDG rule: an empty one counts as unset).
fn var(env: &impl Fn(&str) -> Option<String>, key: &str) -> Option<PathBuf> {
    env(key).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// `$HOME`, or `%USERPROFILE%` on Windows; empty (the current folder) when unset.
fn home(env: &impl Fn(&str) -> Option<String>, platform: Platform) -> PathBuf {
    let key = match platform {
        Platform::Linux => "HOME",
        Platform::Windows => "USERPROFILE",
    };
    var(env, key).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let vars: Vec<(String, String)> = vars
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        move |key| vars.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }

    fn path(parts: &[&str]) -> PathBuf {
        parts.iter().collect()
    }

    #[test]
    fn paths_match_capture_rules() {
        let linux = Platform::Linux;
        let windows = Platform::Windows;
        let cases = [
            (
                capture_dir(env(&[("HOME", "/h"), ("XDG_STATE_HOME", "/s")]), linux),
                path(&["/s", "flow-cockpit", "capture"]),
            ),
            (
                capture_dir(env(&[("HOME", "/h")]), linux),
                path(&["/h", ".local", "state", "flow-cockpit", "capture"]),
            ),
            // An empty XDG variable counts as unset, as the XDG spec says.
            (
                capture_dir(env(&[("HOME", "/h"), ("XDG_STATE_HOME", "")]), linux),
                path(&["/h", ".local", "state", "flow-cockpit", "capture"]),
            ),
            (
                capture_dir(
                    env(&[
                        ("LOCALAPPDATA", r"C:\Users\u\AppData\Local"),
                        ("XDG_STATE_HOME", "/s"),
                    ]),
                    windows,
                ),
                path(&[r"C:\Users\u\AppData\Local", "flow-cockpit", "capture"]),
            ),
            (
                capture_dir(env(&[("USERPROFILE", r"C:\Users\u")]), windows),
                path(&[r"C:\Users\u", "AppData", "Local", "flow-cockpit", "capture"]),
            ),
        ];
        for (got, want) in cases {
            assert_eq!(got, want);
        }
    }

    #[test]
    fn config_and_claude_folders() {
        assert_eq!(
            config_dir(env(&[("HOME", "/h")]), Platform::Linux),
            path(&["/h", ".config", "flow-cockpit"])
        );
        assert_eq!(
            config_dir(
                env(&[("HOME", "/h"), ("XDG_CONFIG_HOME", "/c")]),
                Platform::Linux
            ),
            path(&["/c", "flow-cockpit"])
        );
        assert_eq!(
            config_dir(env(&[("APPDATA", r"C:\R")]), Platform::Windows),
            path(&[r"C:\R", "flow-cockpit"])
        );
        assert_eq!(
            claude_projects(env(&[("HOME", "/h")]), Platform::Linux),
            path(&["/h", ".claude", "projects"])
        );
        assert_eq!(
            claude_projects(env(&[("USERPROFILE", r"C:\Users\u")]), Platform::Windows),
            path(&[r"C:\Users\u", ".claude", "projects"])
        );
        assert_eq!(
            claude_projects(
                env(&[("HOME", "/h"), ("CLAUDE_CONFIG_DIR", "/cc")]),
                Platform::Linux
            ),
            path(&["/cc", "projects"])
        );
    }

    struct Temp(PathBuf);

    impl Drop for Temp {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    /// A fake install: a `bin/` for the exe, and whichever extension folders `make` names.
    fn install(tag: &str, make: &[&str]) -> Temp {
        let root =
            std::env::temp_dir().join(format!("flow-cockpit-paths-{}-{tag}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join("bin")).unwrap();
        for dir in make {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        Temp(std::fs::canonicalize(root).unwrap())
    }

    #[test]
    fn default_extensions_lookup_order() {
        let t = install(
            "order",
            &["dev", "share/flow-cockpit/extensions", "bin/extensions"],
        );
        let exe = t.0.join("bin").join("flow-cockpit");
        let dev = t.0.join("dev");
        let share = t.0.join("share").join("flow-cockpit").join("extensions");
        let beside = t.0.join("bin").join("extensions");

        // The dev override wins when it exists.
        let vars = [("FLOW_COCKPIT_EXTENSIONS", dev.to_str().unwrap())];
        let with_dev = env(&vars);
        assert_eq!(
            default_extensions(&with_dev, Some(&exe)),
            Defaults {
                found: Some(dev.clone()),
                looked: vec![dev.clone(), share.clone(), beside.clone()],
            }
        );
        // Unset or empty: the install's share folder.
        for vars in [env(&[]), env(&[("FLOW_COCKPIT_EXTENSIONS", "")])] {
            let got = default_extensions(&vars, Some(&exe));
            assert_eq!(got.found, Some(share.clone()));
            assert_eq!(got.looked, [share.clone(), beside.clone()]);
        }
        // No share folder: the one next to the exe (Windows).
        std::fs::remove_dir_all(t.0.join("share")).unwrap();
        assert_eq!(
            default_extensions(env(&[]), Some(&exe)).found,
            Some(beside.clone())
        );
        // An override that doesn't exist is passed over, and still named.
        let gone = env(&[("FLOW_COCKPIT_EXTENSIONS", "/nonexistent/extensions")]);
        let got = default_extensions(&gone, Some(&exe));
        assert_eq!(got.found, Some(beside));
        assert_eq!(got.looked[0], PathBuf::from("/nonexistent/extensions"));
    }

    #[test]
    fn no_default_extensions_names_where_it_looked() {
        let t = install("none", &[]);
        let exe = t.0.join("bin").join("flow-cockpit");
        let got = default_extensions(env(&[]), Some(&exe));
        assert_eq!(got.found, None);
        assert_eq!(
            got.looked,
            [
                t.0.join("share").join("flow-cockpit").join("extensions"),
                t.0.join("bin").join("extensions"),
            ]
        );
        assert_eq!(
            default_extensions(env(&[]), None).looked,
            Vec::<PathBuf>::new()
        );
    }
}
