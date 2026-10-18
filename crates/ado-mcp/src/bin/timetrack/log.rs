//! The time log, in files safe to edit by hand: finished ticket entries in `log.jsonl` and finished shifts (clocked in to
//! clocked out) in `shifts.jsonl`, one JSON object per line; the running timer in `running.json` and the open shift in
//! `shift.json`, so both keep running while the TUI is closed.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write as _};
use std::path::{Path, PathBuf};

use ado_mcp::Ticket;
use anyhow::{Context as _, Result};
use jiff::civil::{Date, Weekday};
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan as _};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

const LOG: &str = "log.jsonl";
const RUNNING: &str = "running.json";
const SHIFTS: &str = "shifts.jsonl";
const SHIFT: &str = "shift.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    #[serde(flatten)]
    pub ticket: Ticket,
    pub start: Timestamp,
    /// `None` while the timer runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<Timestamp>,
}

/// Clocked in at `start`; `None` while still clocked in.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Shift {
    pub start: Timestamp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<Timestamp>,
}

pub struct Log {
    dir: PathBuf,
    pub entries: Vec<Entry>,
    pub running: Option<Entry>,
    pub shifts: Vec<Shift>,
    pub shift: Option<Shift>,
    /// Lines of the `.jsonl` files that didn't parse; they stay in the files untouched.
    pub bad: usize,
}

/// Every line of `path` that parses; `bad` counts the others.
fn read_lines<T: DeserializeOwned>(path: &Path, bad: &mut usize) -> Result<Vec<T>> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).map_err(|_| *bad += 1).ok())
            .collect()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e).with_context(|| format!("can't read {}", path.display())),
    }
}

fn read_one<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::read_to_string(path) {
        Ok(text) => {
            Ok(Some(serde_json::from_str(&text).with_context(|| {
                format!("{} doesn't parse", path.display())
            })?))
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("can't read {}", path.display())),
    }
}

/// Replaces `path` whole, so a crash leaves the old file or the new one.
fn write_one(path: &Path, v: &impl Serialize) -> Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_vec(v)?)?;
    fs::rename(&tmp, path).with_context(|| format!("can't write {}", path.display()))
}

fn append(path: &Path, v: &impl Serialize) -> Result<()> {
    let mut line = serde_json::to_string(v)?;
    line.push('\n');
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(line.as_bytes())
        .with_context(|| format!("can't write {}", path.display()))
}

impl Log {
    pub fn open(dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&dir).with_context(|| format!("can't create {}", dir.display()))?;
        let mut bad = 0;
        Ok(Self {
            entries: read_lines(&dir.join(LOG), &mut bad)?,
            running: read_one(&dir.join(RUNNING))?,
            shifts: read_lines(&dir.join(SHIFTS), &mut bad)?,
            shift: read_one(&dir.join(SHIFT))?,
            bad,
            dir,
        })
    }

    /// Clocks in unless already in.
    pub fn clock_in(&mut self, now: Timestamp) -> Result<()> {
        if self.shift.is_none() {
            let shift = Shift {
                start: now,
                end: None,
            };
            write_one(&self.dir.join(SHIFT), &shift)?;
            self.shift = Some(shift);
        }
        Ok(())
    }

    /// Stops the running timer and clocks out. Already out is fine.
    pub fn clock_out(&mut self, now: Timestamp) -> Result<()> {
        self.stop(now)?;
        let Some(mut shift) = self.shift else {
            return Ok(());
        };
        shift.end = Some(now);
        append(&self.dir.join(SHIFTS), &shift)?;
        fs::remove_file(self.dir.join(SHIFT))?;
        self.shift = None;
        self.shifts.push(shift);
        Ok(())
    }

    /// Clocks in if needed, stops the running timer, if any, then starts one on `ticket`.
    pub fn start(&mut self, ticket: Ticket, now: Timestamp) -> Result<()> {
        self.clock_in(now)?;
        self.stop(now)?;
        let entry = Entry {
            ticket,
            start: now,
            end: None,
        };
        write_one(&self.dir.join(RUNNING), &entry)?;
        self.running = Some(entry);
        Ok(())
    }

    /// Appends the running timer to the log and clears it. Nothing running is fine.
    pub fn stop(&mut self, now: Timestamp) -> Result<()> {
        let Some(mut entry) = self.running.clone() else {
            return Ok(());
        };
        entry.end = Some(now);
        append(&self.dir.join(LOG), &entry)?;
        fs::remove_file(self.dir.join(RUNNING))?;
        self.running = None;
        self.entries.push(entry);
        Ok(())
    }

    /// The finished entries and the running one.
    pub fn all(&self) -> impl Iterator<Item = &Entry> {
        self.entries.iter().chain(&self.running)
    }

    /// The finished shifts and the open one.
    pub fn all_shifts(&self) -> impl Iterator<Item = &Shift> {
        self.shifts.iter().chain(&self.shift)
    }

    /// One day, `[from, to)`.
    pub fn day(&self, from: Timestamp, to: Timestamp, now: Timestamp) -> Day {
        let mut spans: Vec<(i64, i64)> = self
            .all_shifts()
            .map(|s| {
                let start = s.start.max(from).as_second();
                (start, s.end.unwrap_or(now).min(to).as_second())
            })
            .filter(|(a, b)| a < b)
            .collect();
        spans.sort_unstable();
        let worked = spans.iter().map(|(a, b)| b - a).sum();
        let breaks = match (spans.first(), spans.iter().map(|s| s.1).max()) {
            (Some(first), Some(last)) => last - first.0 - worked,
            _ => 0,
        };
        Day {
            worked,
            breaks,
            booked: totals(self.all(), from, to, now)
                .iter()
                .map(|(_, s)| s)
                .sum(),
            first_in: spans.first().and_then(|s| Timestamp::from_second(s.0).ok()),
        }
    }

    /// Worked time minus the target, over the days from the first shift to the day before `until` that have a shift.
    pub fn balance(&self, until: Date, tz: &TimeZone, target: i64, now: Timestamp) -> i64 {
        let Some(first) = self.all_shifts().map(|s| s.start).min() else {
            return 0;
        };
        let mut d = first.to_zoned(tz.clone()).date();
        let mut sum = 0;
        while d < until {
            let (from, to) = day(d, tz);
            let worked = self.day(from, to, now).worked;
            if worked > 0 {
                sum += worked - target_on(d, target);
            }
            d = d.tomorrow().expect("dates near today are in range");
        }
        sum
    }
}

/// What a day adds up to, in seconds.
pub struct Day {
    /// Clocked in.
    pub worked: i64,
    /// Clocked out between the first clock-in and the last clock-out.
    pub breaks: i64,
    /// On tickets.
    pub booked: i64,
    pub first_in: Option<Timestamp>,
}

/// The daily target on `d`: none at the weekend, where every minute is overtime.
pub fn target_on(d: Date, target: i64) -> i64 {
    match d.weekday() {
        Weekday::Saturday | Weekday::Sunday => 0,
        _ => target,
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

/// `+h:mm` or `−h:mm`.
pub fn signed(secs: i64) -> String {
    format!("{}{}", if secs < 0 { '−' } else { '+' }, hm(secs.abs()))
}

/// `h:mm` or `h` to seconds.
pub fn parse_hm(s: &str) -> Option<i64> {
    let (h, m) = s.trim().split_once(':').unwrap_or((s.trim(), "0"));
    let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
    (h >= 0 && (0..60).contains(&m)).then_some(h * 3600 + m * 60)
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
    fn shift(start: &str, end: Option<&str>) -> Shift {
        Shift {
            start: ts(start),
            end: end.map(ts),
        }
    }

    #[test]
    fn a_day_adds_up_shifts_breaks_and_booked_time() {
        let mut log = Log::open(dir()).unwrap();
        log.shifts = vec![
            shift("2026-10-16T07:00:00Z", Some("2026-10-16T11:00:00Z")),
            shift("2026-10-16T11:30:00Z", Some("2026-10-16T16:00:00Z")),
        ];
        log.entries = vec![entry(
            1,
            "2026-10-16T07:00:00Z",
            Some("2026-10-16T10:00:00Z"),
        )];
        let now = ts("2026-10-18T12:00:00Z");
        let d = log.day(ts("2026-10-16T00:00:00Z"), ts("2026-10-17T00:00:00Z"), now);
        assert_eq!(
            (d.worked, d.breaks, d.booked),
            (8 * 3600 + 1800, 1800, 3 * 3600)
        );
        assert_eq!(d.first_in, Some(ts("2026-10-16T07:00:00Z")));
        // Friday 8:30 worked against 8:00, Saturday 1:00 all overtime, today (Sunday) not yet counted.
        log.shifts
            .push(shift("2026-10-17T09:00:00Z", Some("2026-10-17T10:00:00Z")));
        log.shift = Some(shift("2026-10-18T09:00:00Z", None));
        let tz = TimeZone::UTC;
        assert_eq!(
            log.balance("2026-10-18".parse().unwrap(), &tz, 8 * 3600, now),
            5400
        );
        assert_eq!(signed(-5400), "−1:30");
        assert_eq!(parse_hm("7:30"), Some(27000));
        assert_eq!(parse_hm("8"), Some(28800));
        assert_eq!(parse_hm("7:75"), None);
    }

    #[test]
    fn clocking_out_stops_the_timer_and_starting_clocks_in() {
        let d = dir();
        let mut log = Log::open(d.clone()).unwrap();
        log.start(ticket(1), ts("2026-10-18T08:00:00Z")).unwrap();
        assert!(Log::open(d.clone()).unwrap().shift.is_some());
        log.clock_out(ts("2026-10-18T09:00:00Z")).unwrap();
        let reopened = Log::open(d.clone()).unwrap();
        assert!(reopened.running.is_none() && reopened.shift.is_none());
        assert_eq!(reopened.entries.len(), 1);
        assert_eq!(reopened.shifts[0].end, Some(ts("2026-10-18T09:00:00Z")));
        fs::remove_dir_all(d).unwrap();
    }
}
