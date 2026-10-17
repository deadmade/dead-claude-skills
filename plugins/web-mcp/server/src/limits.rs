//! Per-host politeness: at most 4 requests in flight, and a minimum spacing for the APIs that ask for one.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::Instant;
use url::Url;

const PER_HOST: usize = 4;

#[derive(Default)]
pub struct HostLimits {
    hosts: Mutex<HashMap<String, (Arc<Semaphore>, Instant)>>,
}

/// Holds one of the host's slots until dropped.
pub struct HostPermit(#[allow(dead_code)] OwnedSemaphorePermit);

/// Minimum spacing between request starts (paper-lookup `SKILL.md:142`; `OpenAlex` is my call).
fn interval(url: &Url) -> Duration {
    match url.host_str().unwrap_or("") {
        "export.arxiv.org" => Duration::from_secs(3),
        // Single records (`/works/<doi>`) may go faster than list queries (`/works?…`).
        "api.crossref.org" if url.query().is_none() && url.path().starts_with("/works/") => {
            Duration::from_millis(200)
        }
        "api.crossref.org" | "api.openalex.org" => Duration::from_secs(1),
        // NVD's keyless limit (5 requests per 30 s); unverified: its docs page is a JS shell.
        "services.nvd.nist.gov" => Duration::from_secs(6),
        _ => Duration::ZERO,
    }
}

impl HostLimits {
    pub async fn acquire(&self, url: &Url) -> HostPermit {
        let host = url.host_str().unwrap_or("").to_owned();
        let sem = {
            let mut hosts = self.hosts.lock().unwrap_or_else(PoisonError::into_inner);
            let e = hosts
                .entry(host.clone())
                .or_insert_with(|| (Arc::new(Semaphore::new(PER_HOST)), Instant::now()));
            Arc::clone(&e.0)
        };
        let permit = sem.acquire_owned().await.expect("never closed");
        let start = {
            let mut hosts = self.hosts.lock().unwrap_or_else(PoisonError::into_inner);
            let next = &mut hosts.get_mut(&host).expect("inserted above").1;
            let start = (*next).max(Instant::now());
            *next = start + interval(url);
            start
        };
        tokio::time::sleep_until(start).await;
        HostPermit(permit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn intervals_per_api() {
        let ms = |s| interval(&u(s)).as_millis();
        assert_eq!(ms("https://export.arxiv.org/api/query?id_list=1"), 3000);
        assert_eq!(ms("https://api.crossref.org/works/10.1/x"), 200);
        assert_eq!(ms("https://api.crossref.org/works?query=rust"), 1000);
        assert_eq!(ms("https://api.openalex.org/works?search=x"), 1000);
        assert_eq!(ms("https://example.com/"), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn spaces_calls_and_caps_in_flight() {
        let l = Arc::new(HostLimits::default());
        let t0 = Instant::now();
        let arxiv = u("https://export.arxiv.org/api/query");
        for i in 0..3 {
            drop(l.acquire(&arxiv).await);
            assert_eq!(t0.elapsed().as_secs(), i * 3);
        }
        let site = u("https://example.com/");
        let held: Vec<_> = futures::future::join_all((0..4).map(|_| l.acquire(&site))).await;
        let l2 = Arc::clone(&l);
        let mut fifth = tokio::spawn(async move { l2.acquire(&u("https://example.com/")).await });
        assert!(
            tokio::time::timeout(Duration::from_secs(60), &mut fifth)
                .await
                .is_err()
        );
        drop(held);
        fifth.await.unwrap();
    }
}
