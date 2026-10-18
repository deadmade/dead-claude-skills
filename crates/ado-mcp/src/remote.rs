//! Maps a git remote onto the configured collection, so a PAT is only ever sent to `ADO_ORG_URL`.
#![allow(dead_code)] // called by the context that comes with Task 4

use std::path::Path;
use std::process::Command;

use url::Url;

/// Percent-decodes once (`%2520` becomes `%20`); bytes that are not valid UTF-8 become U+FFFD.
pub(crate) fn decode_path(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16);
        if b[i] == b'%'
            && let (Some(h), Some(l)) = (
                b.get(i + 1).and_then(|&c| hex(c)),
                b.get(i + 2).and_then(|&c| hex(c)),
            )
        {
            out.push(u8::try_from(h * 16 + l).unwrap_or_default());
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The remote as an HTTPS URL under `org_url`, or a one-line reason it is not one of ours.
pub(crate) fn https_remote(remote: &str, org_url: &Url) -> Result<String, String> {
    const NOT_ADO: &str = "not an Azure DevOps remote: pass project and repo";
    let remote = remote.trim();
    let (host, path) = if remote.contains("://") {
        let u = Url::parse(remote).map_err(|_| NOT_ADO.to_string())?;
        if !matches!(u.scheme(), "https" | "ssh") {
            return Err(NOT_ADO.into());
        }
        (
            u.host_str().unwrap_or_default().to_string(),
            u.path().to_string(),
        )
    } else {
        // scp-style `user@host:path`
        let (left, path) = remote.split_once(':').ok_or(NOT_ADO)?;
        (
            left.rsplit('@').next().unwrap_or(left).to_ascii_lowercase(),
            format!("/{path}"),
        )
    };
    if !path.contains("/_git/") {
        return Err(NOT_ADO.into());
    }
    let org_host = org_url.host_str().unwrap_or_default();
    if !host.eq_ignore_ascii_case(org_host) {
        return Err(format!(
            "this repo is on {host}, but mcp-azure is set up for {org_host}"
        ));
    }
    let collection = org_url
        .path_segments()
        .and_then(|mut s| s.rfind(|s| !s.is_empty()))
        .unwrap_or_default();
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let Some(at) = segs
        .iter()
        .position(|s| decode_path(s).eq_ignore_ascii_case(&decode_path(collection)))
    else {
        return Err(format!(
            "this repo is not in collection {collection} that mcp-azure is set up for"
        ));
    };
    org_url
        .join(&segs[at + 1..].join("/"))
        .map(String::from)
        .map_err(|e| e.to_string())
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()?;
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (out.status.success() && !s.is_empty()).then_some(s)
}

pub(crate) fn origin_url(dir: &Path) -> Option<String> {
    git(dir, &["remote", "get-url", "origin"])
}

/// `None` outside a repo or on a detached HEAD. `symbolic-ref`, not `rev-parse --abbrev-ref`, which fails before the first commit.
pub(crate) fn current_branch(dir: &Path) -> Option<String> {
    git(dir, &["symbolic-ref", "--short", "-q", "HEAD"])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn org() -> Url {
        Url::parse("https://srv/tfs/Coll/").unwrap()
    }
    const SAME: &str = "https://srv/tfs/Coll/Proj/_git/Repo";

    #[test]
    fn https_same() {
        assert_eq!(https_remote(SAME, &org()).unwrap(), SAME);
    }

    #[test]
    fn strips_userinfo() {
        assert_eq!(
            https_remote("https://me@srv/tfs/Coll/Proj/_git/Repo", &org()).unwrap(),
            SAME
        );
    }

    #[test]
    fn ssh_with_tfs() {
        assert_eq!(
            https_remote("ssh://srv:22/tfs/Coll/Proj/_git/Repo", &org()).unwrap(),
            SAME
        );
    }

    #[test]
    fn ssh_without_tfs() {
        assert_eq!(
            https_remote("ssh://srv:22/Coll/Proj/_git/Repo", &org()).unwrap(),
            SAME
        );
    }

    #[test]
    fn scp_style() {
        assert_eq!(
            https_remote("git@srv:Coll/Proj/_git/Repo", &org()).unwrap(),
            SAME
        );
    }

    #[test]
    fn keeps_encoded_project() {
        let r = https_remote("https://srv/tfs/Coll/My%20Project/_git/Repo", &org()).unwrap();
        assert_eq!(r, "https://srv/tfs/Coll/My%20Project/_git/Repo");
    }

    #[test]
    fn other_host_refused() {
        let e = https_remote("https://evil/tfs/Coll/P/_git/R", &org()).unwrap_err();
        assert!(e.contains("evil") && e.contains("srv"), "{e}");
    }

    #[test]
    fn other_collection_refused() {
        let e = https_remote("https://srv/tfs/CollB/P/_git/R", &org()).unwrap_err();
        assert!(e.contains("collection Coll "), "{e}");
    }

    #[test]
    fn decodes_spaces_once() {
        assert_eq!(decode_path("My%20Project%2520x"), "My Project%20x");
    }

    #[test]
    fn not_azure() {
        let e = https_remote("https://srv/a/b.git", &org()).unwrap_err();
        assert!(e.contains("pass project and repo"), "{e}");
    }

    #[test]
    fn branch_of_temp_repo() {
        let dir = std::env::temp_dir().join(format!("ado-mcp-branch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args(["init", "-q", "-b", "feat/x"])
            .status()
            .unwrap();
        assert!(ok.success());
        assert_eq!(current_branch(&dir).as_deref(), Some("feat/x"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
