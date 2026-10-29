//! Where a flow run stands: the spec's Status rules, as one pure function over facts and `now`.

use jiff::Timestamp;
use serde::Serialize;
use ts_rs::TS;

/// A transcript that grew within this many seconds is being worked on.
const WORKING_SECS: i64 = 2 * 60;
/// A run with nothing happening for this long is stale.
const STALE_SECS: i64 = 3 * 24 * 3600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub enum Status {
    Working,
    Waiting,
    Idle,
    Stale,
    Done,
}

/// What the rules read off a flow run.
pub(crate) struct Facts<'a> {
    pub phase: Option<&'a str>,
    /// The flow.md `now:` sentence.
    pub now_line: Option<&'a str>,
    /// The newest of the flow.md and its sessions' transcripts.
    pub last_activity: Timestamp,
    /// When the newest linked session's transcript last grew.
    pub transcript: Option<Timestamp>,
    /// A linked session has a question or permission prompt open, from the capture.
    pub asked: bool,
}

/// Done (`phase: done`) first, then Waiting (`now:` starts `Waiting for you`, or a linked session has a question or
/// permission prompt open), Working (a transcript grew in the last 2 minutes), Stale (nothing for 3 days), else Idle.
pub(crate) fn status(f: &Facts, now: Timestamp) -> Status {
    let age = |t: Timestamp| now.as_second() - t.as_second();
    if f.phase
        .is_some_and(|p| p.trim().eq_ignore_ascii_case("done"))
    {
        Status::Done
    } else if f.asked
        || f.now_line
            .is_some_and(|n| n.trim_start().starts_with("Waiting for you"))
    {
        Status::Waiting
    } else if f.transcript.is_some_and(|t| age(t) <= WORKING_SECS) {
        Status::Working
    } else if age(f.last_activity) > STALE_SECS {
        Status::Stale
    } else {
        Status::Idle
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn ago(secs: i64) -> Timestamp {
        Timestamp::from_second(NOW - secs).unwrap()
    }

    #[test]
    fn status_rules() {
        let day = 24 * 3600;
        let waiting = Some("Waiting for you to approve.");
        let busy = Some("Building.");
        // phase, now:, last activity ago, transcript grew ago, a capture wait, expected
        let table = [
            (Some("build"), waiting, 60, None, false, Status::Waiting),
            (Some("done"), waiting, 60, None, false, Status::Done),
            (Some("build"), busy, 4 * day, None, false, Status::Stale),
            (Some("build"), busy, 60, Some(60), false, Status::Working),
            (Some("build"), busy, 180, Some(180), false, Status::Idle),
            (Some("build"), None, 2 * day, None, false, Status::Idle),
            (None, None, 4 * day, Some(4 * day), false, Status::Stale),
            (Some("done"), None, 9 * day, None, false, Status::Done),
            (Some("build"), busy, 60, Some(60), true, Status::Waiting),
            (Some("build"), busy, 4 * day, None, true, Status::Waiting),
            (Some("done"), busy, 60, Some(60), true, Status::Done),
        ];
        for (phase, now_line, last, grew, asked, want) in table {
            let facts = Facts {
                phase,
                now_line,
                last_activity: ago(last),
                transcript: grew.map(ago),
                asked,
            };
            let got = status(&facts, ago(0));
            assert_eq!(got, want, "{phase:?} {now_line:?} {last}");
        }
    }
}
