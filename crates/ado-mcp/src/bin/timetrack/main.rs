//! timetrack: a TUI that times Azure DevOps work items and keeps the log in `%APPDATA%\timetrack` (or
//! `TIMETRACK_DIR`). The collection and PAT come from `ADO_ORG_URL` and `ADO_PAT`, as for the MCP server; without them
//! the timer still works on tickets already in the log.

mod log;
mod ui;

use std::path::PathBuf;
use std::sync::{Arc, mpsc};
use std::time::Duration;

use ado_mcp::{Api, Config, Ticket};
use anyhow::{Context as _, Result};
use jiff::Timestamp;
use ratatui::crossterm::event::{self, Event, KeyCode, KeyEventKind};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum View {
    Tickets,
    Today,
    Week,
}

/// What a background call brings back: the id it looked up (none: the "mine" list) and the tickets or an error.
type Done = (Option<i32>, Result<Vec<Ticket>, String>);

pub struct App {
    pub log: log::Log,
    api: Option<Arc<Api>>,
    tx: mpsc::Sender<Done>,
    rx: mpsc::Receiver<Done>,
    pub tickets: Vec<Ticket>,
    pub selected: usize,
    pub filter: String,
    pub filtering: bool,
    pub view: View,
    /// Weeks back from this one, in the week view.
    pub week: i64,
    pub status: String,
    pub loading: bool,
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
            (_, Err(e)) => self.status = e,
            (None, Ok(t)) => {
                self.status = format!("{} open work items", t.len());
                self.tickets = t;
                self.selected = self.selected.min(self.tickets.len().saturating_sub(1));
            }
            (Some(id), Ok(t)) => match t.into_iter().next() {
                Some(t) => self.start(&t),
                None => self.status = format!("no work item #{id}"),
            },
        }
    }

    fn start(&mut self, t: &Ticket) {
        self.status = match self.log.start(t.clone(), Timestamp::now()) {
            Ok(()) => format!("timing #{} {}", t.id, t.title),
            Err(e) => format!("{e:#}"),
        };
    }

    /// Starts the selected ticket; with none showing and an id typed in the filter, looks that id up.
    fn start_selected(&mut self) {
        if let Some(t) = self.visible().get(self.selected).map(|t| (*t).clone()) {
            self.start(&t);
        } else if let Ok(id) = self.filter.trim().trim_start_matches('#').parse() {
            self.status = format!("looking up #{id}");
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
        match code {
            KeyCode::Char('q') | KeyCode::Esc => return true,
            KeyCode::Tab => {
                self.view = match self.view {
                    View::Tickets => View::Today,
                    View::Today => View::Week,
                    View::Week => View::Tickets,
                }
            }
            KeyCode::Char('1') => self.view = View::Tickets,
            KeyCode::Char('2') => self.view = View::Today,
            KeyCode::Char('3') => self.view = View::Week,
            KeyCode::Char('/') => {
                self.view = View::Tickets;
                self.filtering = true;
            }
            KeyCode::Char('s') => {
                self.status = match self.log.stop(Timestamp::now()) {
                    Ok(()) => "stopped".into(),
                    Err(e) => format!("{e:#}"),
                }
            }
            KeyCode::Char('r') => self.fetch(None),
            KeyCode::Enter if self.view == View::Tickets => self.start_selected(),
            KeyCode::Up | KeyCode::Char('k') => self.step(false),
            KeyCode::Down | KeyCode::Char('j') => self.step(true),
            KeyCode::Left | KeyCode::Char('h') if self.view == View::Week => self.week += 1,
            KeyCode::Right | KeyCode::Char('l') if self.view == View::Week => {
                self.week = (self.week - 1).max(0);
            }
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

fn main() -> Result<()> {
    if std::env::args().nth(1).is_some_and(|a| a == "--version") {
        println!("timetrack {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let log = log::Log::open(data_dir()?)?;
    let (api, status) = match Config::from_env().and_then(|c| Api::new(&c)) {
        Ok(api) => (Some(Arc::new(api)), "loading work items…".to_owned()),
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
    let mut app = App {
        log,
        api,
        tx,
        rx,
        tickets,
        selected: 0,
        filter: String::new(),
        filtering: false,
        view: View::Tickets,
        week: 0,
        status,
        loading: false,
    };
    if app.log.bad > 0 {
        app.status = format!(
            "{} lines in log.jsonl don't parse and are skipped",
            app.log.bad
        );
    }
    app.fetch(None);
    ratatui::run(|term| -> Result<()> {
        loop {
            term.draw(|f| ui::draw(f, &app))?;
            while let Ok(done) = app.rx.try_recv() {
                app.received(done);
            }
            // A short poll keeps the running timer's clock ticking.
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
