//! One JSON/text API request: host limits, a deadline per attempt, one retry and checked redirects.

use std::time::Duration;

use reqwest::Method;
use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION, USER_AGENT};
use serde_json::Value;
use url::Url;

use crate::Ctx;
use crate::archive::is_private;
use crate::fetch::{read_capped, retry_after};

const MAX_RETRY_WAIT: Duration = Duration::from_secs(10);
const MAX_BODY: usize = 20 * 1024 * 1024;
const MAX_HOPS: usize = 3;
const LOOKUP_UA: &str = concat!(
    "web-mcp/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/deadmade/dead-claude-skills)"
);

pub struct Answer {
    /// The URL that answered, after redirects.
    pub url: Url,
    pub status: u16,
    pub body: String,
}

/// One request and its redirect hops; each hop waits for its own slot, then runs against `deadline`.
/// Returns the final answer and how long its `Retry-After` asks to wait.
async fn once(
    ctx: &Ctx,
    url: &Url,
    json: Option<&Value>,
    accept: Option<&str>,
    deadline: Duration,
    lookup_ua: bool,
) -> Result<(Answer, Duration), String> {
    let mut url = url.clone();
    let mut post = json.is_some();
    for hop in 0..=MAX_HOPS {
        let _slot = ctx.limits.acquire(&url).await;
        let run = async {
            let mut req = ctx
                .http_public
                .request(if post { Method::POST } else { Method::GET }, url.clone());
            if let (true, Some(j)) = (post, json) {
                req = req
                    .header(CONTENT_TYPE, "application/json")
                    .body(j.to_string());
            }
            if let Some(a) = accept {
                req = req.header(ACCEPT, a);
            }
            if lookup_ua {
                req = req.header(USER_AGENT, LOOKUP_UA);
            }
            let resp = req.send().await.map_err(|e| e.without_url().to_string())?;
            let status = resp.status().as_u16();
            let wait = retry_after(resp.headers()).min(MAX_RETRY_WAIT);
            let next = matches!(status, 301 | 302 | 303 | 307 | 308)
                .then(|| {
                    resp.headers()
                        .get(LOCATION)?
                        .to_str()
                        .ok()
                        .map(str::to_owned)
                })
                .flatten();
            let body = read_capped(resp, MAX_BODY)
                .await
                .map_err(|e| e.to_string())?
                .ok_or("body over 20 MB")?;
            Ok::<_, String>((status, wait, next, body))
        };
        let (status, wait, next, body) = tokio::time::timeout(deadline, run)
            .await
            .map_err(|_| format!("no answer within {} s", deadline.as_secs_f32()))??;
        let Some(loc) = next else {
            let body = String::from_utf8_lossy(&body).into_owned();
            return Ok((Answer { url, status, body }, wait));
        };
        if hop == MAX_HOPS {
            return Err("too many redirects".into());
        }
        let to = url.join(&loc).map_err(|e| e.to_string())?;
        if is_private(&to) {
            return Err(format!("redirect to a private address ({to})"));
        }
        if status == 303 {
            post = false;
        }
        url = to;
    }
    unreachable!("the last hop returns")
}

/// GET (POST with `json`) through the host limits. A 429 or 5xx is retried once after `Retry-After`,
/// and the second answer is returned whatever its status; `Err` is for failures with no answer.
pub(crate) async fn send(
    ctx: &Ctx,
    url: &Url,
    json: Option<&Value>,
    accept: Option<&str>,
    deadline: Duration,
    lookup_ua: bool,
) -> Result<Answer, String> {
    let (first, wait) = once(ctx, url, json, accept, deadline, lookup_ua).await?;
    if first.status != 429 && first.status < 500 {
        return Ok(first);
    }
    tokio::time::sleep(wait).await;
    Ok(once(ctx, url, json, accept, deadline, lookup_ua).await?.0)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::fetch::tests::test_ctx;

    type Seen = Arc<Mutex<Vec<String>>>;

    /// Serves `replies` (raw HTTP) in order, the last repeating, each after `delay`; returns the URL and the requests seen.
    fn stub(replies: Vec<String>, delay: Duration) -> (Url, Seen) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        let seen = Seen::default();
        let log = Arc::clone(&seen);
        let n = AtomicUsize::new(0);
        std::thread::spawn(move || {
            for mut c in listener.incoming().flatten() {
                let mut buf = [0; 8192];
                let len = c.read(&mut buf).unwrap_or(0);
                log.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&buf[..len]).into_owned());
                std::thread::sleep(delay);
                let i = n.fetch_add(1, Ordering::SeqCst).min(replies.len() - 1);
                let _ = c.write_all(replies[i].as_bytes());
            }
        });
        (url, seen)
    }

    fn reply(status: &str, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
            body.len()
        )
    }

    const D: Duration = Duration::from_secs(5);

    #[tokio::test(flavor = "multi_thread")]
    async fn refuses_private_redirect() {
        let r = reply("302 Found", "Location: http://10.0.0.1/\r\n", "");
        let (url, _) = stub(vec![r], Duration::ZERO);
        let err = send(&test_ctx(), &url, None, None, D, false)
            .await
            .err()
            .expect("error");
        assert!(err.contains("private"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn retries_one_5xx() {
        let r = vec![
            reply("502 Bad Gateway", "Retry-After: 0\r\n", ""),
            reply("200 OK", "", "ok"),
        ];
        let (url, seen) = stub(r, Duration::ZERO);
        let got = send(&test_ctx(), &url, None, None, D, false).await.unwrap();
        assert_eq!((got.status, got.body.as_str()), (200, "ok"));
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn second_5xx_is_returned() {
        let r = reply("502 Bad Gateway", "Retry-After: 0\r\n", "");
        let (url, seen) = stub(vec![r], Duration::ZERO);
        let got = send(&test_ctx(), &url, None, None, D, false).await.unwrap();
        assert_eq!(got.status, 502);
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn deadline_starts_after_the_slot() {
        let (url, _) = stub(vec![reply("200 OK", "", "ok")], Duration::from_millis(50));
        let ctx = test_ctx();
        let mut held = Vec::new();
        for _ in 0..4 {
            held.push(ctx.limits.acquire(&url).await);
        }
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            drop(held);
        });
        let got = send(&ctx, &url, None, None, Duration::from_millis(200), false)
            .await
            .unwrap();
        assert_eq!(got.status, 200);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn post_sends_json() {
        let (url, seen) = stub(vec![reply("200 OK", "", "ok")], Duration::ZERO);
        let body = serde_json::json!({"q": 1});
        send(
            &test_ctx(),
            &url,
            Some(&body),
            Some("application/json"),
            D,
            true,
        )
        .await
        .unwrap();
        let req = seen.lock().unwrap()[0].to_lowercase();
        assert!(req.starts_with("post / "), "{req}");
        assert!(req.contains("{\"q\":1}"), "{req}");
        assert!(req.contains("accept: application/json"), "{req}");
        assert!(req.contains("user-agent: web-mcp/"), "{req}");
        assert!(
            req.contains("(+https://github.com/deadmade/dead-claude-skills)"),
            "{req}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn oversize_body_is_an_error() {
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            MAX_BODY + 1
        );
        let (url, _) = stub(vec![head], Duration::ZERO);
        let err = send(&test_ctx(), &url, None, None, D, false)
            .await
            .err()
            .expect("error");
        assert_eq!(err, "body over 20 MB");
    }
}
