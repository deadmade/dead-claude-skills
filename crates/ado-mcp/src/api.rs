//! The Azure DevOps REST client: PAT auth, api-versions, timeouts, and errors that fit on one line.
// The tools that use the rest of this come with later tasks.
#![allow(dead_code)]

use std::error::Error as _;
use std::fmt;
use std::time::Duration;

use anyhow::Result;
use base64::Engine as _;
use reqwest::header::{ACCEPT, CONTENT_TYPE, HeaderMap, HeaderValue, RETRY_AFTER};
use reqwest::{Client, Method};
use serde::de::DeserializeOwned;
use serde_json::Value;
use url::Url;

use crate::config::Config;

/// Everything not named below.
pub(crate) const V71: &str = "7.1";
/// Policy evaluations and `connectionData`.
pub(crate) const V71_P1: &str = "7.1-preview.1";
/// Work-item comments.
pub(crate) const V71_P4: &str = "7.1-preview.4";

const TIMEOUT: Duration = Duration::from_mins(1);
const PAT_LINE: &str = "Azure DevOps rejected the PAT (expired or wrong); set a new one with /plugin configure mcp-azure";

/// What went wrong, already worded for the model. Never holds the PAT or the `Authorization` value.
#[derive(Debug)]
pub(crate) struct ApiError {
    pub status: Option<u16>,
    /// A `TFnnnnnn` code from the server's message.
    pub tf: Option<String>,
    pub msg: String,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.msg)
    }
}

impl std::error::Error for ApiError {}

impl ApiError {
    fn local(msg: impl Into<String>) -> Self {
        Self {
            status: None,
            tf: None,
            msg: msg.into(),
        }
    }

    /// Words a 404 as `not found: {label}`; other errors stay as they are.
    #[must_use]
    pub fn with_what(mut self, label: &str) -> Self {
        if self.status == Some(404) {
            self.msg = format!("not found: {label}");
        }
        self
    }
}

pub(crate) struct Api {
    client: Client,
    org: Url,
    timeout: Duration,
}

impl Api {
    /// # Errors
    /// When the HTTP client can't be built.
    pub fn new(cfg: &Config) -> Result<Self> {
        let basic = base64::engine::general_purpose::STANDARD.encode(format!(":{}", cfg.pat));
        let mut auth = HeaderValue::from_str(&format!("Basic {basic}"))?;
        auth.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert(reqwest::header::AUTHORIZATION, auth);
        headers.insert(
            "X-TFS-FedAuthRedirect",
            HeaderValue::from_static("Suppress"),
        );
        #[allow(unused_mut)]
        let mut timeout = TIMEOUT;
        // Test hook; a release build never reads it.
        #[cfg(debug_assertions)]
        if let Some(ms) = std::env::var("ADO_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
        {
            timeout = Duration::from_millis(ms);
        }
        let client = Client::builder()
            .user_agent(concat!("ado-mcp/", env!("CARGO_PKG_VERSION")))
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(10))
            .timeout(timeout)
            // A redirect would carry the PAT to wherever it points.
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            client,
            org: cfg.org_url.clone(),
            timeout,
        })
    }

    /// `path` is joined onto the collection URL; `query` and `api-version` follow.
    ///
    /// # Errors
    /// For anything the server answers with, see [`ApiError`]; also when the answer isn't JSON.
    pub async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
        ver: &str,
    ) -> Result<T, ApiError> {
        self.send(Method::GET, path, query, ver, &Value::Null, false)
            .await
    }

    /// Like [`Api::get`], for an answer that is plain text (a log).
    ///
    /// # Errors
    /// See [`Api::get`].
    pub async fn get_text(
        &self,
        path: &str,
        query: &[(&str, String)],
        ver: &str,
    ) -> Result<String, ApiError> {
        Ok(self
            .exec(Method::GET, path, query, ver, None, "text/plain")
            .await?
            .2)
    }

    /// A request with a JSON body (none for `Value::Null`); `json_patch` sends it as `application/json-patch+json`.
    ///
    /// # Errors
    /// See [`Api::get`].
    pub async fn send<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        ver: &str,
        body: &Value,
        json_patch: bool,
    ) -> Result<T, ApiError> {
        let body = (!body.is_null()).then_some((body, json_patch));
        let (status, ct, text) = self
            .exec(method, path, query, ver, body, "application/json")
            .await?;
        // 204 and friends have no body.
        let text = if text.trim().is_empty() {
            "null"
        } else {
            &text
        };
        serde_json::from_str(text).map_err(|_| unexpected(status, &ct))
    }

    fn url(&self, path: &str, query: &[(&str, String)], ver: &str) -> Result<Url, ApiError> {
        // `join` also takes an absolute URL, and `/x` or `../x` climb out of the collection: check the result.
        let mut url = self
            .org
            .join(path)
            .map_err(|_| ApiError::local(format!("not a usable path: {path}")))?;
        if !url.as_str().starts_with(self.org.as_str()) {
            return Err(ApiError::local(
                "refusing to send the PAT to a URL outside the configured collection",
            ));
        }
        url.query_pairs_mut()
            .extend_pairs(query.iter().map(|(k, v)| (*k, v.as_str())))
            .append_pair("api-version", ver);
        Ok(url)
    }

    /// Sends the request (once more after a 429) and returns `(status, content-type, body)` of a 2xx answer.
    async fn exec(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        ver: &str,
        body: Option<(&Value, bool)>,
        accept: &str,
    ) -> Result<(u16, String, String), ApiError> {
        let url = self.url(path, query, ver)?;
        let mut throttled = false;
        loop {
            let mut req = self
                .client
                .request(method.clone(), url.clone())
                .header(ACCEPT, accept);
            if let Some((json, patch)) = body {
                let ct = if patch {
                    "application/json-patch+json"
                } else {
                    "application/json"
                };
                req = req.header(CONTENT_TYPE, ct).body(json.to_string());
            }
            let resp = req.send().await.map_err(|e| self.net_err(&e, &url))?;
            let status = resp.status().as_u16();
            if status == 429 {
                if throttled {
                    return Err(ApiError {
                        status: Some(429),
                        tf: None,
                        msg: "the server is throttling requests; try again in a minute".into(),
                    });
                }
                throttled = true;
                let secs = resp
                    .headers()
                    .get(RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.trim().parse::<u64>().ok())
                    .unwrap_or(1);
                tokio::time::sleep(Duration::from_secs(secs.min(30))).await;
                continue;
            }
            let ct = resp
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("none")
                .to_owned();
            let text = resp.text().await.map_err(|e| self.net_err(&e, &url))?;
            return if (200..300).contains(&status) && !(status == 203 && ct.contains("html")) {
                Ok((status, ct, text))
            } else {
                Err(status_error(status, &ct, &text, path))
            };
        }
    }

    fn net_err(&self, e: &reqwest::Error, url: &Url) -> ApiError {
        if e.is_timeout() {
            return ApiError::local(format!(
                "the server didn't answer in {} s",
                self.timeout.as_secs()
            ));
        }
        let mut cause = e.to_string();
        let mut cur = e.source();
        while let Some(s) = cur {
            cause = s.to_string();
            cur = s.source();
        }
        let mut msg = format!(
            "can't reach {}: {cause}",
            url.host_str().unwrap_or("the server")
        );
        if is_cert_error(e) {
            msg.push_str(
                " (the certificate isn't trusted; ado-mcp uses the Windows certificate store)",
            );
        }
        ApiError::local(msg)
    }
}

/// Whether a rustls certificate error sits anywhere in `e`'s `source()` chain.
fn is_cert_error(e: &(dyn std::error::Error + 'static)) -> bool {
    let mut cur = Some(e);
    while let Some(s) = cur {
        // `io::Error::source` skips the error it wraps, so look inside it too.
        let inner = s
            .downcast_ref::<std::io::Error>()
            .and_then(std::io::Error::get_ref)
            .map_or(s, |i| i as &(dyn std::error::Error + 'static));
        if matches!(
            inner.downcast_ref::<rustls::Error>(),
            Some(rustls::Error::InvalidCertificate(_))
        ) {
            return true;
        }
        cur = s.source();
    }
    false
}

fn unexpected(status: u16, ct: &str) -> ApiError {
    ApiError {
        status: Some(status),
        tf: None,
        msg: format!("unexpected answer from the server ({status}, {ct})"),
    }
}

/// The segment after `_apis/` decides which PAT scope was missing.
fn scope(path: &str) -> &'static str {
    let area = path
        .split_once("_apis/")
        .and_then(|(_, r)| r.split(['/', '?']).next());
    match area {
        Some("git" | "policy") => "Code",
        Some("wit") => "Work Items",
        Some("build" | "pipelines") => "Build",
        Some("projects" | "identities" | "connectionData") => "Project and Team (Read)",
        _ => "a broader",
    }
}

/// The first `TF` followed by six digits.
fn find_tf(s: &str) -> Option<String> {
    s.match_indices("TF").find_map(|(i, _)| {
        let digits = s.get(i + 2..i + 8)?;
        digits
            .bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| format!("TF{digits}"))
    })
}

fn status_error(status: u16, ct: &str, body: &str, path: &str) -> ApiError {
    let err = |msg: String, tf| ApiError {
        status: Some(status),
        tf,
        msg,
    };
    match status {
        401 | 203 => err(PAT_LINE.into(), None),
        403 => err(
            format!(
                "the PAT may not do this: it needs the {} scope",
                scope(path)
            ),
            None,
        ),
        404 => err(format!("not found: {path}"), None),
        500.. => err(format!("the server failed ({status}); try again"), None),
        400..500 => {
            let message = serde_json::from_str::<Value>(body)
                .ok()
                .and_then(|v| v["message"].as_str().map(str::to_owned))
                .unwrap_or_else(|| format!("HTTP {status}"));
            let tf = find_tf(&message);
            err(format!("the server refused it: {message}"), tf)
        }
        // A redirect (not followed) or an odd 1xx/2xx/3xx.
        _ => unexpected(status, ct),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn api() -> Api {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let cfg = Config {
            org_url: Url::parse("https://ado.example/tfs/Coll/").unwrap(),
            pat: "secret-pat".into(),
            default_project: None,
            project_dir: PathBuf::new(),
        };
        Api::new(&cfg).unwrap()
    }

    #[tokio::test]
    async fn other_urls_are_refused_before_sending() {
        let api = api();
        for path in [
            "https://evil.example/tfs/Coll/_apis/projects",
            "http://ado.example/tfs/Coll/_apis/projects",
            "https://ado.example/tfs/Other/_apis/projects",
            "https://ado.example/tfs/Coll/../Other/x",
            "https://ado.example@evil.example/tfs/Coll/",
            "/tfs/Other/_apis/projects",
            "../x",
        ] {
            let e = api.get_text(path, &[], V71).await.unwrap_err();
            assert!(
                e.status.is_none() && e.msg.contains("outside the configured collection"),
                "{path}: {e}"
            );
            assert!(!e.msg.contains("secret-pat"));
        }
    }

    #[test]
    fn urls_under_the_collection_pass() {
        let u = api()
            .url("My Project/_apis/git", &[("$top", "1".into())], V71)
            .unwrap();
        assert_eq!(
            u.as_str(),
            "https://ado.example/tfs/Coll/My%20Project/_apis/git?%24top=1&api-version=7.1"
        );
        assert!(
            api()
                .url("https://ado.example/tfs/Coll/x?a=b", &[], V71_P1)
                .is_ok()
        );
    }

    #[test]
    fn scopes_follow_the_area() {
        let f = |p, s: &str| {
            assert_eq!(
                status_error(403, "", "", p).msg,
                format!("the PAT may not do this: it needs the {s} scope")
            );
        };
        f("P/_apis/git/repositories", "Code");
        f("P/_apis/policy/evaluations", "Code");
        f("P/_apis/wit/workitems/1", "Work Items");
        f("P/_apis/build/builds", "Build");
        f("P/_apis/pipelines/1/runs", "Build");
        f("_apis/projects", "Project and Team (Read)");
        f("_apis/connectionData", "Project and Team (Read)");
        f("P/_apis/other", "a broader");
    }

    #[test]
    fn tf_code_and_404_label() {
        let e = status_error(
            409,
            "application/json",
            r#"{"message":"TF401179: An active pull request exists."}"#,
            "x",
        );
        assert_eq!(e.tf.as_deref(), Some("TF401179"));
        assert_eq!(e.status, Some(409));
        let e = status_error(404, "", "", "P/_apis/git/repositories/r").with_what("repo r");
        assert_eq!(e.msg, "not found: repo r");
        assert_eq!(
            status_error(400, "", "<html>", "x").msg,
            "the server refused it: HTTP 400"
        );
        assert_eq!(
            find_tf("TF12 and TFabcdef and TF000123"),
            Some("TF000123".into())
        );
    }

    #[test]
    fn certificate_errors_are_found_through_io_errors() {
        let cert = rustls::Error::InvalidCertificate(rustls::CertificateError::UnknownIssuer);
        assert!(is_cert_error(&std::io::Error::other(cert)));
        assert!(!is_cert_error(&std::io::Error::other("refused")));
    }
}
