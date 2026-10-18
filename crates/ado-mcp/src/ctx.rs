//! What every tool needs first: the project and repo (from arguments, the git remote or the default project), who
//! "me" is, who a name is, and which pipeline a name means. Answers are cached for the life of the server.
// The tools that use all of this come with later tasks.
#![allow(dead_code)]

use std::collections::HashMap;
use std::fmt::Write as _;
use std::future::Future;
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Deserialize;

use crate::api::{Api, ApiError, V71, V71_P1};
use crate::config::Config;
use crate::remote::{current_branch, https_remote, is_azure_remote, origin_url};

/// Where a tool works. The ids are what API paths use: names can hold spaces and non-ASCII characters.
#[derive(Clone)]
pub(crate) struct Scope {
    /// The cache entry this came from; [`Ctx::retry_stale`] drops it.
    pub key: String,
    pub project_id: String,
    pub project: String,
    pub repo_id: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
}

/// A user, as `connectionData` and the identities API both give one.
#[derive(Clone, Deserialize)]
pub(crate) struct Me {
    pub id: String,
    #[serde(rename = "providerDisplayName")]
    pub name: String,
}

#[derive(Deserialize)]
struct Proj {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct Repo {
    id: String,
    name: String,
    project: Proj,
}

/// `{remote}/vsts/info`.
#[derive(Deserialize)]
struct VstsInfo {
    repository: Repo,
}

#[derive(Deserialize)]
struct Connection {
    #[serde(rename = "authenticatedUser")]
    user: Me,
}

#[derive(Deserialize)]
struct Users {
    value: Vec<Me>,
}

#[derive(Deserialize)]
struct Def {
    id: u32,
    name: String,
    #[serde(default)]
    path: String,
}

#[derive(Deserialize)]
struct Defs {
    value: Vec<Def>,
}

#[derive(Default)]
struct Cache {
    scopes: HashMap<String, Scope>,
    me: Option<Me>,
    /// `(project id, lower-case name)` to the definition id.
    pipelines: HashMap<(String, String), u32>,
}

pub(crate) struct Ctx {
    pub api: Api,
    pub cfg: Config,
    /// Never held across an `.await`. Concurrent misses may each fetch; the last write wins.
    cache: Mutex<Cache>,
}

/// A path segment, percent-encoded so a name can't add a `/`, `?` or `#` of its own.
pub(crate) fn seg(s: &str) -> String {
    s.bytes().fold(String::new(), |mut out, b| {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(char::from(b));
        } else {
            let _ = write!(out, "%{b:02X}");
        }
        out
    })
}

/// An argument the model left out may arrive as an empty string.
pub(crate) fn given(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}

impl Ctx {
    /// # Errors
    /// When the HTTP client can't be built.
    pub fn new(cfg: Config) -> anyhow::Result<Self> {
        Ok(Self {
            api: Api::new(&cfg)?,
            cfg,
            cache: Mutex::default(),
        })
    }

    fn cache(&self) -> MutexGuard<'_, Cache> {
        self.cache.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The project (and repo) a tool works in. Explicit arguments win, then the clone's `origin`, then the default
    /// project. `branch` is the argument, else the clone's current branch.
    ///
    /// # Errors
    /// When nothing names a project, the remote isn't ours (nothing is sent then), or the server refuses.
    pub async fn scope(
        &self,
        project: Option<&str>,
        repo: Option<&str>,
        branch: Option<&str>,
    ) -> Result<Scope, ApiError> {
        let mut scope = if let Some(p) = given(project) {
            self.named(p, given(repo)).await?
        } else {
            let base = self.ambient().await?;
            // A repo argument without a project means that repo in the remote's (or default) project.
            match given(repo) {
                Some(r) => self.named(&base.project_id, Some(r)).await?,
                None => base,
            }
        };
        scope.branch = given(branch)
            .map(str::to_owned)
            .or_else(|| current_branch(&self.cfg.project_dir));
        Ok(scope)
    }

    /// The cached scope under `key`, else what `fetch` returns (which is then cached).
    async fn cached(
        &self,
        key: String,
        fetch: impl Future<Output = Result<Scope, ApiError>>,
    ) -> Result<Scope, ApiError> {
        if let Some(s) = self.cache().scopes.get(&key).cloned() {
            return Ok(s);
        }
        let s = fetch.await?;
        self.cache().scopes.insert(key, s.clone());
        Ok(s)
    }

    /// A project by name or id, and optionally one of its repos.
    async fn named(&self, project: &str, repo: Option<&str>) -> Result<Scope, ApiError> {
        // `.` and `..` would climb out of the segment they name.
        if [Some(project), repo]
            .into_iter()
            .flatten()
            .any(|s| matches!(s, "." | ".."))
        {
            return Err(ApiError::local("bad project or repo name"));
        }
        let key = format!("arg:{project}/{}", repo.unwrap_or_default());
        self.cached(key.clone(), async {
            let p = seg(project);
            let (proj, repo) = if let Some(r) = repo {
                let found: Repo = self
                    .api
                    .get(&format!("{p}/_apis/git/repositories/{}", seg(r)), &[], V71)
                    .await
                    .map_err(|e| e.with_what(&format!("repo {r} in {project}")))?;
                (found.project, Some((found.id, found.name)))
            } else {
                let proj: Proj = self
                    .api
                    .get(&format!("_apis/projects/{p}"), &[], V71)
                    .await
                    .map_err(|e| e.with_what(&format!("project {project}")))?;
                (proj, None)
            };
            Ok(Scope {
                key,
                project_id: proj.id,
                project: proj.name,
                repo_id: repo.as_ref().map(|r| r.0.clone()),
                repo: repo.map(|r| r.1),
                branch: None,
            })
        })
        .await
    }

    /// The clone's `origin`, else the default project.
    async fn ambient(&self) -> Result<Scope, ApiError> {
        // A clone of something else (GitHub, say) falls through to the default project.
        if let Some(remote) = origin_url(&self.cfg.project_dir).filter(|r| is_azure_remote(r)) {
            // Nothing is sent when the remote is another server or collection.
            let https = https_remote(&remote, &self.cfg.org_url).map_err(ApiError::local)?;
            let key = format!("remote:{https}");
            return self
                .cached(key.clone(), async {
                    let info: VstsInfo = self
                        .api
                        .get(&format!("{https}/vsts/info"), &[], V71)
                        .await
                        .map_err(|e| e.with_what("this repo on the server"))?;
                    let r = info.repository;
                    Ok(Scope {
                        key,
                        project_id: r.project.id,
                        project: r.project.name,
                        repo_id: Some(r.id),
                        repo: Some(r.name),
                        branch: None,
                    })
                })
                .await;
        }
        match &self.cfg.default_project {
            Some(p) => self.named(p, None).await,
            None => Err(ApiError::local(
                "no project: pass project, or open Claude Code in a clone of an Azure DevOps repo",
            )),
        }
    }

    /// Runs `f`; if it fails with a 404, drops the cached scope `key` (a repo or project that was deleted or
    /// recreated under the same name) and runs it once more. `f` resolves its scope again inside.
    ///
    /// # Errors
    /// What the second run returns, or the first run's error when it isn't a 404.
    pub async fn retry_stale<F, Fut, T>(&self, key: &str, mut f: F) -> Result<T, ApiError>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<T, ApiError>>,
    {
        match f().await {
            Err(e) if e.status == Some(404) => {
                self.cache().scopes.remove(key);
                f().await
            }
            r => r,
        }
    }

    /// Whoever the PAT belongs to.
    ///
    /// # Errors
    /// When the server refuses.
    pub async fn me(&self) -> Result<Me, ApiError> {
        if let Some(m) = self.cache().me.clone() {
            return Ok(m);
        }
        let d: Connection = self.api.get("_apis/connectionData", &[], V71_P1).await?;
        self.cache().me = Some(d.user.clone());
        Ok(d.user)
    }

    /// `me`, or the one user whose name or account matches `text`.
    ///
    /// # Errors
    /// When nobody or several match (the first five are named), or the server refuses.
    pub async fn user(&self, text: &str) -> Result<Me, ApiError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(ApiError::local("no user given"));
        }
        if text.eq_ignore_ascii_case("me") {
            return self.me().await;
        }
        let q = [
            ("searchFilter", "General".to_owned()),
            ("filterValue", text.to_owned()),
        ];
        let mut found = self
            .api
            .get::<Users>("_apis/identities", &q, V71)
            .await?
            .value;
        match found.len() {
            0 => Err(ApiError::local(format!("no user matches \"{text}\""))),
            1 => Ok(found.remove(0)),
            n => {
                let names: Vec<&str> = found.iter().take(5).map(|m| m.name.as_str()).collect();
                let more = if n > 5 { ", …" } else { "" };
                Err(ApiError::local(format!(
                    "\"{text}\" matches: {}{more}",
                    names.join(", ")
                )))
            }
        }
    }

    /// A pipeline's definition id from its id or its name.
    ///
    /// # Errors
    /// When the name matches none or several (the folders are named), or the server refuses.
    pub async fn pipeline_id(&self, scope: &Scope, name_or_id: &str) -> Result<u32, ApiError> {
        let name = name_or_id.trim();
        if let Ok(id) = name.parse() {
            return Ok(id);
        }
        let key = (scope.project_id.clone(), name.to_lowercase());
        if let Some(id) = self.cache().pipelines.get(&key) {
            return Ok(*id);
        }
        let path = format!("{}/_apis/build/definitions", seg(&scope.project_id));
        let list: Defs = self
            .api
            .get(&path, &[("name", name.to_owned())], V71)
            .await?;
        // The name filter takes wildcards; only an exact name is the pipeline asked for.
        let mut hits: Vec<Def> = list
            .value
            .into_iter()
            .filter(|d| d.name.eq_ignore_ascii_case(name))
            .collect();
        match hits.len() {
            0 => Err(ApiError::local(format!("not found: pipeline \"{name}\""))),
            1 => {
                let id = hits.remove(0).id;
                self.cache().pipelines.insert(key, id);
                Ok(id)
            }
            _ => {
                let at: Vec<String> = hits
                    .iter()
                    .map(|d| format!("{}\\{}", d.path.trim_end_matches('\\'), d.name))
                    .collect();
                Err(ApiError::local(format!(
                    "pipeline \"{name}\" is ambiguous: {}",
                    at.join(", ")
                )))
            }
        }
    }
}
