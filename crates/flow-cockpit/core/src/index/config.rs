//! Where the cockpit looks (`Home`) and what the user set by hand in `config.toml` (`Config`).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// The folders the core reads from.
#[derive(Debug, Clone)]
pub struct Home {
    /// `~/.claude/projects`: one folder per working directory, a `<session>.jsonl` transcript per session.
    pub claude_projects: PathBuf,
    /// The hooks' capture files, one `<session_id>.jsonl` each.
    pub capture_dir: PathBuf,
}

/// `config.toml`: the repositories whose own views load, and the projects to leave out (by id or name).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct Config {
    pub trusted: Vec<PathBuf>,
    pub hidden: Vec<String>,
}

impl Config {
    /// Reads the TOML text.
    ///
    /// # Errors
    /// The TOML error's message, when the text is not valid or has a field of the wrong type.
    pub fn parse(text: &str) -> Result<Config, String> {
        toml::from_str(text).map_err(|e| e.to_string())
    }

    /// Reads `path`; a missing file is the default config.
    ///
    /// # Errors
    /// The file could not be read, or is not valid TOML.
    pub fn load(path: &Path) -> Result<Config, String> {
        match fs::read_to_string(path) {
            Ok(text) => Config::parse(&text),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Config::default()),
            Err(e) => Err(format!("{}: {e}", path.display())),
        }
    }

    pub(crate) fn hides(&self, id: &str, name: &str) -> bool {
        self.hidden
            .iter()
            .any(|h| h == id || h.eq_ignore_ascii_case(name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_trusted_and_hidden() {
        let c = Config::parse("trusted = ['/a/b']\nhidden = ['x']\n").unwrap();
        assert_eq!(c.trusted, [PathBuf::from("/a/b")]);
        assert!(c.hides("id", "X"));
    }

    #[test]
    fn empty_and_missing_are_default() {
        assert_eq!(Config::parse("").unwrap(), Config::default());
        assert_eq!(
            Config::load(Path::new("/nope/config.toml")).unwrap(),
            Config::default()
        );
    }

    #[test]
    fn wrong_type_is_an_error() {
        assert!(Config::parse("hidden = 3").is_err());
    }
}
