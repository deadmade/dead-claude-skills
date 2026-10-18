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
    // `port` is only compared for https; an ssh port is not the web port.
    let (host, port, path, is_https) = if remote.contains("://") {
        let u = Url::parse(remote).map_err(|_| NOT_ADO.to_string())?;
        if !matches!(u.scheme(), "https" | "ssh") {
            return Err(NOT_ADO.into());
        }
        let https = u.scheme() == "https";
        (
            u.host_str().unwrap_or_default().to_string(),
            u.port_or_known_default().filter(|_| https),
            u.path().to_string(),
            https,
        )
    } else {
        // scp-style `user@host:path`
        let (left, path) = remote.split_once(':').ok_or(NOT_ADO)?;
        (
            left.rsplit('@').next().unwrap_or(left).to_ascii_lowercase(),
            None,
            format!("/{path}"),
            false,
        )
    };
    if !path.contains("/_git/") {
        return Err(NOT_ADO.into());
    }
    let org_host = org_url.host_str().unwrap_or_default();
    let org_port = org_url.port_or_known_default();
    if !host.eq_ignore_ascii_case(org_host) || port.is_some_and(|p| Some(p) != org_port) {
        let at = |h: &str, p: Option<u16>| p.map_or_else(|| h.to_string(), |p| format!("{h}:{p}"));
        return Err(format!(
            "this repo is on {}, but mcp-azure is set up for {}",
            at(&host, port),
            at(org_host, port.and(org_port))
        ));
    }
    // Decode first, then refuse anything that could steer the URL out of the collection.
    let segs: Vec<String> = path[1..].split('/').map(decode_path).collect();
    if segs.iter().any(|s| {
        s.is_empty()
            || s == "."
            || s == ".."
            || s.contains(['\\', ':', '/'])
            || s.contains(char::is_control)
    }) {
        return Err("not an Azure DevOps remote: unsupported characters in the path".into());
    }
    let org_segs: Vec<String> = org_url
        .path_segments()
        .map(|s| s.filter(|s| !s.is_empty()).map(decode_path).collect())
        .unwrap_or_default();
    let Some((collection, prefix)) = org_segs.split_last() else {
        return Err("mcp-azure is set up without a collection in its URL".into());
    };
    // The collection sits right after the virtual directory (`tfs`); ssh paths may omit it.
    let same = |a: &[String], b: &[String]| {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.eq_ignore_ascii_case(y))
    };
    let n = prefix.len();
    let start = [n, 0]
        .into_iter()
        .take(if is_https { 1 } else { 2 })
        .find(|&k| {
            segs.get(k)
                .is_some_and(|c| c.eq_ignore_ascii_case(collection))
                && (k == 0 || same(&segs[..k], prefix))
        })
        .ok_or_else(|| {
            format!("this repo is not in collection {collection} that mcp-azure is set up for")
        })?;
    let mut out = org_url.clone();
    out.set_query(None);
    out.set_fragment(None);
    out.path_segments_mut()
        .map_err(|()| NOT_ADO.to_string())?
        .pop_if_empty()
        .extend(&segs[start + 1..]);
    if out.origin() != org_url.origin() || !out.path().starts_with(org_url.path()) {
        return Err(NOT_ADO.into());
    }
    Ok(out.into())
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
    fn cannot_leave_the_collection() {
        for r in [
            r"git@srv:Coll/\/evil.com/_git/R",
            r"ssh://srv/Coll/\/evil.com/_git/R",
            "git@srv:Coll/../CollB/P/_git/R",
            "git@srv:Coll/%2e%2e/CollB/P/_git/R",
            "git@srv:Coll/a:b/_git/R",
            "git@srv:Coll/a%2Fb/_git/R",
            "git@srv:Coll//evil.com/_git/R",
            "https://srv/tfs/Coll//evil.com/_git/R",
        ] {
            assert!(https_remote(r, &org()).is_err(), "{r}");
        }
    }

    #[test]
    fn ok_results_stay_under_org() {
        for r in [
            SAME,
            "ssh://srv/Coll/Proj/_git/Repo",
            "git@srv:Coll/My%20Proj/_git/Repo",
            "https://srv/tfs/coll/%C3%9Cbergabe/_git/R",
        ] {
            let o = org();
            assert!(https_remote(r, &o).unwrap().starts_with(o.as_str()), "{r}");
        }
        assert_eq!(
            https_remote("https://srv/tfs/Coll/My%20Proj/_git/R", &org()).unwrap(),
            "https://srv/tfs/Coll/My%20Proj/_git/R"
        );
    }

    #[test]
    fn collection_must_follow_the_prefix() {
        assert!(https_remote("https://srv/tfs/Other/Coll/_git/R", &org()).is_err());
        assert!(https_remote("ssh://srv:22/x/Coll/Proj/_git/Repo", &org()).is_err());
        assert!(https_remote("https://srv/Coll/Proj/_git/Repo", &org()).is_err());
        assert!(https_remote("ssh://srv:22/Coll/Proj/_git/Repo", &org()).is_ok());
    }

    #[test]
    fn other_https_port_refused() {
        let e = https_remote("https://srv:9999/tfs/Coll/P/_git/R", &org()).unwrap_err();
        assert!(e.contains("srv:9999"), "{e}");
        assert!(https_remote("https://srv:443/tfs/Coll/P/_git/R", &org()).is_ok());
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
