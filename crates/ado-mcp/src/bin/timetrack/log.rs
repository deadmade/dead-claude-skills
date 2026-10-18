//! The time log: finished entries in `log.jsonl`, one JSON object per line and safe to edit by hand, and the running
//! timer in `running.json`, so it keeps running while the TUI is closed.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write as _};
use std::path::PathBuf;

use ado_mcp::Ticket;
use anyhow::{Context as _, Result};
use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan as _};
use serde::{Deserialize, Serialize};

const LOG: &str = "log.jsonl";
const RUNNING: &str = "running.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    #[serde(flatten)]
    pub ticket: Ticket,
    pub start: Timestamp,
    /// `None` while the timer runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<Timestamp>,
}

pub struct Log {
    dir: PathBuf,
    pub entries: Vec<Entry>,
    pub running: Option<Entry>,
    /// Lines of `log.jsonl` that didn't parse; they stay in the file untouched.
    pub bad: usize,
}

impl Log {
    pub fn open(dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&dir).with_context(|| format!("can't create {}", dir.display()))?;
        let mut bad = 0;
        let entries = match fs::read_to_string(dir.join(LOG)) {
            Ok(text) => text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .filter_map(|l| serde_json::from_str(l).map_err(|_| bad += 1).ok())
                .collect(),
            Err(e) if e.kind() == ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e).context(format!("can't read {LOG}")),
        };
        let running = match fs::read_to_string(dir.join(RUNNING)) {
            Ok(text) => Some(
                serde_json::from_str(&text).with_context(|| format!("{RUNNING} is not a timer"))?,
            ),
            Err(e) if e.kind() == ErrorKind::NotFound => None,
            Err(e) => return Err(e).context(format!("can't read {RUNNING}")),
        };
        Ok(Self {
            dir,
            entries,
            running,
            bad,
        })
    }

    /// Stops the running timer, if any, then starts one on `ticket`.
    pub fn start(&mut self, ticket: Ticket, now: Timestamp) -> Result<()> {
        self.stop(now)?;
        let entry = Entry {
            ticket,
            start: now,
            end: None,
        };
        let tmp = self.dir.join("running.json.tmp");
        fs::write(&tmp, serde_json::to_vec(&entry)?)?;
        fs::rename(&tmp, self.dir.join(RUNNING))?;
        self.running = Some(entry);
        Ok(())
    }

    /// Appends the running timer to the log and clears it. Nothing running is fine.
    pub fn stop(&mut self, now: Timestamp) -> Result<()> {
        let Some(mut entry) = self.running.clone() else {
            return Ok(());
        };
        entry.end = Some(now);
        let mut line = serde_json::to_string(&entry)?;
        line.push('\n');
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join(LOG))?
            .write_all(line.as_bytes())
            .with_context(|| format!("can't write {LOG}"))?;
        fs::remove_file(self.dir.join(RUNNING))?;
        self.running = None;
        self.entries.push(entry);
        Ok(())
    }

    /// The finished entries and the running one.
    pub fn all(&self) -> impl Iterator<Item = &Entry> {
        self.entries.iter().chain(&self.running)
    }
}

/// Seconds per ticket within `[from, to)`, most first. A running entry counts up to `now`.
pub fn totals<'a>(
    entries: impl IntoIterator<Item = &'a Entry>,
    from: Timestamp,
    to: Timestamp,
    now: Timestamp,
) -> Vec<(&'a Ticket, i64)> {
    let mut out: Vec<(&Ticket, i64)> = Vec::new();
    for e in entries {
        let end = e.end.unwrap_or(now).min(to);
        let secs = end.as_second() - e.start.max(from).as_second();
        if secs <= 0 {
            continue;
        }
        match out.iter_mut().find(|(t, _)| t.id == e.ticket.id) {
            Some((_, n)) => *n += secs,
            None => out.push((&e.ticket, secs)),
        }
    }
    out.sort_by_key(|(_, s)| -s);
    out
}

/// `[midnight, next midnight)` of `day` in `tz`.
pub fn day(day: Date, tz: &TimeZone) -> (Timestamp, Timestamp) {
    let midnight = |d: Date| {
        d.to_zoned(tz.clone())
            .expect("dates near today are in range")
            .timestamp()
    };
    (
        midnight(day),
        midnight(day.tomorrow().expect("dates near today are in range")),
    )
}

/// The Monday of `day`'s week, `back` weeks earlier.
pub fn monday(day: Date, back: i64) -> Date {
    day - (i64::from(day.weekday().to_monday_zero_offset()) + 7 * back).days()
}

/// `h:mm`.
pub fn hm(secs: i64) -> String {
    format!("{}:{:02}", secs / 3600, secs / 60 % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket(id: i32) -> Ticket {
        Ticket {
            id,
            project: "P".into(),
            kind: "Task".into(),
            state: "Active".into(),
            title: format!("t{id}"),
        }
    }

    fn ts(s: &str) -> Timestamp {
        s.parse().unwrap()
    }

    fn entry(id: i32, start: &str, end: Option<&str>) -> Entry {
        Entry {
            ticket: ticket(id),
            start: ts(start),
            end: end.map(ts),
        }
    }

    fn dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "timetrack-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn totals_clip_to_the_range_and_add_up_per_ticket() {
        let e = [
            // 23:00 to 01:00 across midnight: one hour falls on the 18th.
            entry(1, "2026-10-17T23:00:00Z", Some("2026-10-18T01:00:00Z")),
            entry(2, "2026-10-18T08:00:00Z", Some("2026-10-18T08:30:00Z")),
            entry(1, "2026-10-18T09:00:00Z", Some("2026-10-18T10:00:00Z")),
            // Running since 11:00, now is 11:15.
            entry(2, "2026-10-18T11:00:00Z", None),
            entry(3, "2026-10-19T09:00:00Z", Some("2026-10-19T10:00:00Z")),
        ];
        let got = totals(
            &e,
            ts("2026-10-18T00:00:00Z"),
            ts("2026-10-19T00:00:00Z"),
            ts("2026-10-18T11:15:00Z"),
        );
        let got: Vec<(i32, i64)> = got.iter().map(|(t, s)| (t.id, *s)).collect();
        assert_eq!(got, [(1, 7200), (2, 2700)]);
    }

    #[test]
    fn days_follow_the_time_zone_and_weeks_start_on_monday() {
        let tz = TimeZone::get("Europe/Berlin").unwrap();
        let (from, to) = day("2026-10-25".parse().unwrap(), &tz);
        // The clocks go back that night: the day is 25 hours long.
        assert_eq!(from, ts("2026-10-24T22:00:00Z"));
        assert_eq!(to.as_second() - from.as_second(), 25 * 3600);
        assert_eq!(
            monday("2026-10-18".parse().unwrap(), 0),
            "2026-10-12".parse::<Date>().unwrap()
        );
        assert_eq!(
            monday("2026-10-12".parse().unwrap(), 1),
            "2026-10-05".parse::<Date>().unwrap()
        );
        assert_eq!(hm(3725), "1:02");
    }

    #[test]
    fn start_stop_and_reopen_keep_the_log() {
        let d = dir();
        let mut log = Log::open(d.clone()).unwrap();
        log.start(ticket(1), ts("2026-10-18T08:00:00Z")).unwrap();
        // Switching tickets stops the first timer.
        log.start(ticket(2), ts("2026-10-18T09:00:00Z")).unwrap();
        let reopened = Log::open(d.clone()).unwrap();
        assert_eq!(reopened.entries.len(), 1);
        assert_eq!(reopened.running.as_ref().unwrap().ticket.id, 2);
        log.stop(ts("2026-10-18T09:30:00Z")).unwrap();
        fs::write(
            d.join(LOG),
            fs::read_to_string(d.join(LOG)).unwrap() + "not json\n",
        )
        .unwrap();
        let reopened = Log::open(d.clone()).unwrap();
        assert!(reopened.running.is_none());
        assert_eq!(reopened.entries.len(), 2);
        assert_eq!(reopened.entries[1].end, Some(ts("2026-10-18T09:30:00Z")));
        assert_eq!(reopened.bad, 1);
        fs::remove_dir_all(d).unwrap();
    }
}
