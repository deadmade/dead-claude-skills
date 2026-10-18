//! Drawing, in Night City's palette (plugins/default/themes/night-city.json).

use jiff::Timestamp;
use jiff::tz::TimeZone;
use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Cell, Paragraph, Row, Table, TableState, Tabs};

use crate::log::{day, hm, monday, totals};
use crate::{App, View};

const TEXT: Color = Color::from_u32(0x00e6_dcf7);
const DIM: Color = Color::from_u32(0x009a_90c2);
const PINK: Color = Color::from_u32(0x00f0_8bb4);
const CYAN: Color = Color::from_u32(0x007c_cfe0);
const GREEN: Color = Color::from_u32(0x008f_ddb0);
const BAR: Color = Color::from_u32(0x002a_2340);
const SELECT: Color = Color::from_u32(0x0046_3a6e);

pub fn draw(f: &mut Frame, app: &App) {
    let [top, tabs, body, foot] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(0),
        Constraint::Length(1),
    ])
    .areas(f.area());
    let now = Timestamp::now();
    let tz = TimeZone::system();
    let today = now.to_zoned(tz.clone()).date();
    let sum = |from, to| {
        totals(app.log.all(), from, to, now)
            .iter()
            .map(|(_, s)| s)
            .sum::<i64>()
    };
    let (d0, d1) = day(today, &tz);
    let (w0, _) = day(monday(today, 0), &tz);
    let mut bar = match &app.log.running {
        Some(e) => vec![
            Span::styled(" ● ", Style::new().fg(PINK)),
            Span::styled(
                format!("#{} {}  ", e.ticket.id, e.ticket.title),
                Style::new().fg(TEXT),
            ),
            Span::styled(
                clock(now.as_second() - e.start.as_second()),
                Style::new().fg(PINK).bold(),
            ),
        ],
        None => vec![Span::styled(" ○ no timer", Style::new().fg(DIM))],
    };
    bar.push(Span::styled(
        format!("   today {}  week {}", hm(sum(d0, d1)), hm(sum(w0, d1))),
        Style::new().fg(CYAN),
    ));
    f.render_widget(
        Paragraph::new(Line::from(bar)).style(Style::new().bg(BAR)),
        top,
    );

    let selected = match app.view {
        View::Tickets => 0,
        View::Today => 1,
        View::Week => 2,
    };
    f.render_widget(
        Tabs::new(["1 Tickets", "2 Today", "3 Week"])
            .select(selected)
            .style(Style::new().fg(DIM))
            .highlight_style(Style::new().fg(PINK).add_modifier(Modifier::BOLD)),
        tabs,
    );

    match app.view {
        View::Tickets => tickets(f, app, body),
        View::Today => today_view(f, app, body, now, &tz),
        View::Week => week(f, app, body, now, &tz),
    }

    let help = if app.filtering {
        format!(" /{}▏  enter start · esc clear", app.filter)
    } else {
        match app.view {
            View::Tickets => " enter start · s stop · / filter or #id · r refresh · tab view · q quit (timer keeps running)",
            View::Today => " s stop · tab view · q quit",
            View::Week => " ←/→ week · s stop · tab view · q quit",
        }
        .to_owned()
    };
    let status = if app.loading {
        "loading…"
    } else {
        app.status.as_str()
    };
    let [l, r] = Layout::horizontal([Constraint::Min(0), Constraint::Length(48)]).areas(foot);
    f.render_widget(Paragraph::new(help).style(Style::new().fg(DIM)), l);
    f.render_widget(
        Paragraph::new(status)
            .style(Style::new().fg(GREEN))
            .right_aligned(),
        r,
    );
}

/// `h:mm:ss`.
fn clock(secs: i64) -> String {
    format!("{}:{:02}:{:02}", secs / 3600, secs / 60 % 60, secs % 60)
}

fn header<'a>(cells: impl IntoIterator<Item = &'a str>) -> Row<'a> {
    Row::new(cells).style(Style::new().fg(CYAN).add_modifier(Modifier::BOLD))
}

fn tickets(f: &mut Frame, app: &App, area: Rect) {
    let running = app.log.running.as_ref().map(|e| e.ticket.id);
    let rows = app.visible().into_iter().map(|t| {
        let mark = if Some(t.id) == running { "●" } else { "" };
        Row::new([
            Cell::from(mark).style(Style::new().fg(PINK)),
            Cell::from(t.id.to_string()),
            Cell::from(t.project.clone()).style(Style::new().fg(DIM)),
            Cell::from(t.kind.clone()).style(Style::new().fg(DIM)),
            Cell::from(t.state.clone()).style(Style::new().fg(DIM)),
            Cell::from(t.title.clone()),
        ])
    });
    let widths = [
        Constraint::Length(1),
        Constraint::Length(7),
        Constraint::Length(16),
        Constraint::Length(12),
        Constraint::Length(10),
        Constraint::Min(10),
    ];
    let table = Table::new(rows, widths)
        .header(header(["", "id", "project", "type", "state", "title"]))
        .style(Style::new().fg(TEXT))
        .row_highlight_style(Style::new().bg(SELECT));
    let mut state = TableState::default().with_selected(Some(app.selected));
    f.render_stateful_widget(table, area, &mut state);
}

fn today_view(f: &mut Frame, app: &App, area: Rect, now: Timestamp, tz: &TimeZone) {
    let (from, to) = day(now.to_zoned(tz.clone()).date(), tz);
    let sums = totals(app.log.all(), from, to, now);
    let [top, bottom] = Layout::vertical([
        Constraint::Length(
            u16::try_from(sums.len())
                .unwrap_or(u16::MAX)
                .saturating_add(3),
        ),
        Constraint::Min(0),
    ])
    .areas(area);
    let rows = sums
        .iter()
        .map(|(t, s)| Row::new([hm(*s), format!("#{}", t.id), t.title.clone()]));
    let widths = [
        Constraint::Length(7),
        Constraint::Length(8),
        Constraint::Min(10),
    ];
    f.render_widget(
        Table::new(rows, widths)
            .header(header(["time", "ticket", "title"]))
            .style(Style::new().fg(TEXT))
            .block(
                Block::bordered()
                    .title(" per ticket ")
                    .border_style(Style::new().fg(DIM)),
            ),
        top,
    );
    let local = |t: Timestamp| t.to_zoned(tz.clone()).strftime("%H:%M").to_string();
    let rows = app
        .log
        .all()
        .filter(|e| e.end.unwrap_or(now) > from && e.start < to)
        .map(|e| {
            let end = e.end.map_or_else(|| "now".to_owned(), local);
            Row::new([
                format!("{}–{end}", local(e.start)),
                hm(e.end.unwrap_or(now).as_second() - e.start.as_second()),
                format!("#{}", e.ticket.id),
                e.ticket.title.clone(),
            ])
        });
    let widths = [
        Constraint::Length(13),
        Constraint::Length(7),
        Constraint::Length(8),
        Constraint::Min(10),
    ];
    f.render_widget(
        Table::new(rows, widths)
            .header(header(["when", "time", "ticket", "title"]))
            .style(Style::new().fg(TEXT))
            .block(
                Block::bordered()
                    .title(" entries ")
                    .border_style(Style::new().fg(DIM)),
            ),
        bottom,
    );
}

fn week(f: &mut Frame, app: &App, area: Rect, now: Timestamp, tz: &TimeZone) {
    let mon = monday(now.to_zoned(tz.clone()).date(), app.week);
    let days: Vec<_> = (0..7).map(|i| mon + jiff::Span::new().days(i)).collect();
    let bounds: Vec<_> = days.iter().map(|d| day(*d, tz)).collect();
    let (from, to) = (bounds[0].0, bounds[6].1);
    let all = totals(app.log.all(), from, to, now);
    let per_day: Vec<_> = bounds
        .iter()
        .map(|(a, b)| totals(app.log.all(), *a, *b, now))
        .collect();
    let secs = |d: usize, id: i32| {
        per_day[d]
            .iter()
            .find(|(t, _)| t.id == id)
            .map_or(0, |(_, s)| *s)
    };
    let cell = |s: i64| if s == 0 { String::new() } else { hm(s) };
    let mut rows: Vec<Row> = all
        .iter()
        .map(|(t, total)| {
            let mut r = vec![format!("#{} {}", t.id, t.title)];
            r.extend((0..7).map(|d| cell(secs(d, t.id))));
            r.push(hm(*total));
            Row::new(r)
        })
        .collect();
    let mut sum = vec!["total".to_owned()];
    sum.extend(per_day.iter().map(|p| cell(p.iter().map(|(_, s)| s).sum())));
    sum.push(hm(all.iter().map(|(_, s)| s).sum()));
    rows.push(Row::new(sum).style(Style::new().fg(PINK).add_modifier(Modifier::BOLD)));
    let mut head = vec!["ticket".to_owned()];
    head.extend(days.iter().map(|d| d.strftime("%a %d").to_string()));
    head.push("total".into());
    let mut widths = vec![Constraint::Min(20)];
    widths.extend([Constraint::Length(7); 8]);
    let title = format!(" week of {mon} ");
    f.render_widget(
        Table::new(rows, widths)
            .header(Row::new(head).style(Style::new().fg(CYAN).add_modifier(Modifier::BOLD)))
            .style(Style::new().fg(TEXT))
            .block(
                Block::bordered()
                    .title(title)
                    .border_style(Style::new().fg(DIM)),
            ),
        area,
    );
}
