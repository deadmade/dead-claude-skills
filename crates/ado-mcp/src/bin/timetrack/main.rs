//! timetrack: a TUI that times Azure DevOps work items and your workday, and keeps the log in `%APPDATA%\timetrack`
//! (or `TIMETRACK_DIR`). The collection and PAT come from `ADO_ORG_URL` and `ADO_PAT`, as for the MCP server; without
//! them the timer still works on tickets already in the log. `TIMETRACK_TARGET` (`h:mm`, default `8:00`) is the daily
//! target the overtime balance counts against. Claude Code's session logs add when Claude was working (`claude.rs`).

mod claude;
mod log;
mod ui;

use std::path::PathBuf;
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use ado_mcp::{Api, Config, Ticket};
use anyhow::{Context as _, Result, bail};
use jiff::{SignedDuration, Timestamp};
use ratatui::crossterm::event::{self, Event, KeyCode, KeyEventKind};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Overlay {
    Today,
    Week,
    Help,
}

/// What a background call brings back: the id it looked up (none: the "mine" list) and the tickets or an error.
type Done = (Option<i32>, Result<Vec<Ticket>, String>);

/// How long a status message stays.
const STATUS: Duration = Duration::from_secs(5);

pub struct App {
    pub log: log::Log,
    api: Option<Arc<Api>>,
    tx: mpsc::Sender<Done>,
    rx: mpsc::Receiver<Done>,
    pub tickets: Vec<Ticket>,
    pub selected: usize,
    pub filter: String,
    pub filtering: bool,
    pub overlay: Option<Overlay>,
    /// Weeks back from this one, in the week overlay.
    pub week: i64,
    /// The daily target, in seconds.
    pub target: i64,
    status: String,
    status_at: Instant,
    pub loading: bool,
    /// When Claude was working, refreshed in the background.
    pub claude: Vec<claude::Segment>,
    claude_rx: mpsc::Receiver<Vec<claude::Segment>>,
}

impl App {
    /// The tickets the filter lets through: text in the title or project, or the id.
    #[must_use]
    pub fn visible(&self) -> Vec<&Ticket> {
        let f = self.filter.to_lowercase();
        self.tickets
            .iter()
            .filter(|t| {
                f.is_empty()
                    || t.title.to_lowercase().contains(&f)
                    || t.project.to_lowercase().contains(&f)
                    || t.id.to_string().contains(&f)
            })
            .collect()
    }

    /// Every ticket id timetrack knows: the list and the log.
    #[must_use]
    pub fn known(&self) -> Vec<i32> {
        self.tickets
            .iter()
            .map(|t| t.id)
            .chain(self.log.all().map(|e| e.ticket.id))
            .collect()
    }

    /// The status message, until it goes stale.
    #[must_use]
    pub fn status(&self) -> &str {
        if self.loading {
            "loading…"
        } else if self.status_at.elapsed() < STATUS {
            &self.status
        } else {
            ""
        }
    }

    fn say(&mut self, msg: impl Into<String>) {
        self.status = msg.into();
        self.status_at = Instant::now();
    }

    fn said(&mut self, r: Result<()>, ok: &str) {
        match r {
            Ok(()) => self.say(ok),
            Err(e) => self.say(format!("{e:#}")),
        }
    }

    /// `id`: look that one work item up; none: the open ones assigned to me.
    fn fetch(&mut self, id: Option<i32>) {
        let Some(api) = self.api.clone() else {
            return;
        };
        let tx = self.tx.clone();
        self.loading = true;
        std::thread::spawn(move || {
            let res = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| e.to_string())
                .and_then(|rt| {
                    rt.block_on(async {
                        match id {
                            None => ado_mcp::mine(&api).await,
                            Some(id) => ado_mcp::tickets(&api, &[id]).await,
                        }
                    })
                    .map_err(|e| e.to_string())
                });
            let _ = tx.send((id, res));
        });
    }

    fn received(&mut self, (id, res): Done) {
        self.loading = false;
        match (id, res) {
            (_, Err(e)) => self.say(e),
            (None, Ok(t)) => {
                self.say(format!("{} open work items", t.len()));
                self.tickets = t;
                self.selected = self.selected.min(self.tickets.len().saturating_sub(1));
            }
            (Some(id), Ok(t)) => match t.into_iter().next() {
                Some(t) => self.start(&t),
                None => self.say(format!("no work item #{id}")),
            },
        }
    }

    fn start(&mut self, t: &Ticket) {
        let r = self.log.start(t.clone(), Timestamp::now());
        self.said(r, &format!("timing #{}", t.id));
    }

    /// Starts the selected ticket; with none showing and an id typed in the filter, looks that id up.
    fn start_selected(&mut self) {
        if let Some(t) = self.visible().get(self.selected).map(|t| (*t).clone()) {
            self.start(&t);
        } else if let Ok(id) = self.filter.trim().trim_start_matches('#').parse() {
            self.say(format!("looking up #{id}"));
            self.fetch(Some(id));
        }
    }

    fn step(&mut self, down: bool) {
        let n = self.visible().len();
        self.selected = if down {
            (self.selected + 1).min(n.saturating_sub(1))
        } else {
            self.selected.saturating_sub(1)
        };
    }

    fn toggle(&mut self, o: Overlay) {
        self.overlay = (self.overlay != Some(o)).then_some(o);
    }

    /// Whether to quit.
    fn key(&mut self, code: KeyCode) -> bool {
        if self.filtering {
            match code {
                KeyCode::Esc => {
                    self.filter.clear();
                    self.filtering = false;
                }
                KeyCode::Enter => {
                    self.filtering = false;
                    self.start_selected();
                }
                KeyCode::Backspace => {
                    self.filter.pop();
                    self.selected = 0;
                }
                KeyCode::Char(c) => {
                    self.filter.push(c);
                    self.selected = 0;
                }
                KeyCode::Up | KeyCode::Down => self.step(code == KeyCode::Down),
                _ => {}
            }
            return false;
        }
        let now = Timestamp::now();
        match code {
            KeyCode::Char('q') => return true,
            KeyCode::Esc if self.overlay.is_some() => self.overlay = None,
            KeyCode::Esc => self.filter.clear(),
            KeyCode::Char('t') => self.toggle(Overlay::Today),
            KeyCode::Char('w') => self.toggle(Overlay::Week),
            KeyCode::Char('?') => self.toggle(Overlay::Help),
            KeyCode::Left | KeyCode::Char('h') if self.overlay == Some(Overlay::Week) => {
                self.week += 1;
            }
            KeyCode::Right | KeyCode::Char('l') if self.overlay == Some(Overlay::Week) => {
                self.week = (self.week - 1).max(0);
            }
            KeyCode::Char('c') if self.log.shift.is_some() => {
                let r = self.log.clock_out(now);
                self.said(r, "clocked out");
            }
            KeyCode::Char('c') => {
                let r = self.log.clock_in(now);
                self.said(r, "clocked in");
            }
            KeyCode::Char('s') => {
                let r = self.log.stop(now);
                self.said(r, "stopped");
            }
            KeyCode::Char('r') => self.fetch(None),
            KeyCode::Char('/') => {
                self.overlay = None;
                self.filtering = true;
            }
            KeyCode::Enter if self.overlay.is_none() => self.start_selected(),
            KeyCode::Up | KeyCode::Char('k') => self.step(false),
            KeyCode::Down | KeyCode::Char('j') => self.step(true),
            _ => {}
        }
        false
    }
}

fn data_dir() -> Result<PathBuf> {
    let var = |k| std::env::var_os(k).filter(|v| !v.is_empty());
    var("TIMETRACK_DIR")
        .map(PathBuf::from)
        .or_else(|| var("APPDATA").map(|d| PathBuf::from(d).join("timetrack")))
        .context("set APPDATA or TIMETRACK_DIR to say where the log goes")
}

fn target() -> Result<i64> {
    match std::env::var("TIMETRACK_TARGET") {
        Ok(t) if !t.is_empty() => match log::parse_hm(&t) {
            Some(secs) => Ok(secs),
            None => bail!("TIMETRACK_TARGET is {t:?}; give it as h:mm, like 7:30"),
        },
        _ => Ok(8 * 3600),
    }
}

fn main() -> Result<()> {
    if std::env::args().nth(1).is_some_and(|a| a == "--version") {
        println!("timetrack {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let target = target()?;
    let log = log::Log::open(data_dir()?)?;
    let (api, status) = match Config::from_env().and_then(|c| Api::new(&c)) {
        Ok(api) => (Some(Arc::new(api)), String::new()),
        // The config's errors end in a hint for the plugin, which doesn't apply here.
        Err(e) => (
            None,
            format!(
                "offline: {}",
                e.to_string().split(':').next().unwrap_or_default()
            ),
        ),
    };
    // Until the server answers (or without one): the tickets in the log, last timed first.
    let mut tickets: Vec<Ticket> = Vec::new();
    for e in log.all().collect::<Vec<_>>().into_iter().rev() {
        if !tickets.iter().any(|t| t.id == e.ticket.id) {
            tickets.push(e.ticket.clone());
        }
    }
    let (tx, rx) = mpsc::channel();
    let (claude_tx, claude_rx) = mpsc::channel();
    if let Some(dir) = claude::root() {
        std::thread::spawn(move || {
            let mut cache = claude::Cache::new();
            loop {
                // The week overlay goes back further, but five weeks of logs is what's worth reading every minute.
                let since = Timestamp::now() - SignedDuration::from_hours(35 * 24);
                if claude_tx
                    .send(claude::scan(&dir, since, &mut cache))
                    .is_err()
                {
                    return;
                }
                std::thread::sleep(Duration::from_mins(1));
            }
        });
    }
    let mut app = App {
        log,
        api,
        tx,
        rx,
        tickets,
        selected: 0,
        filter: String::new(),
        filtering: false,
        overlay: None,
        week: 0,
        target,
        status,
        status_at: Instant::now(),
        loading: false,
        claude: Vec::new(),
        claude_rx,
    };
    if app.log.bad > 0 {
        let bad = app.log.bad;
        app.say(format!("{bad} log lines don't parse and are skipped"));
    }
    app.fetch(None);
    ratatui::run(|term| -> Result<()> {
        loop {
            term.draw(|f| ui::draw(f, &app))?;
            while let Ok(done) = app.rx.try_recv() {
                app.received(done);
            }
            while let Ok(segs) = app.claude_rx.try_recv() {
                app.claude = segs;
            }
            // A short poll keeps the running clock ticking.
            if event::poll(Duration::from_millis(250))?
                && let Event::Key(k) = event::read()?
                // Windows reports releases too.
                && k.kind == KeyEventKind::Press
                && app.key(k.code)
            {
                return Ok(());
            }
        }
    })
}
