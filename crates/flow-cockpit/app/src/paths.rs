//! Where the cockpit reads from. The capture rules here are the ones the hooks follow (Task 10's `captureDir`).

use std::path::PathBuf;

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

/// The global views folder and `config.toml` live here: `$XDG_CONFIG_HOME/flow-cockpit` (default
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
}
