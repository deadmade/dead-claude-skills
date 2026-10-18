//! Drawing, in Night City's palette (plugins/default/themes/night-city.json): a big clock on the running ticket, a
//! timeline of today, the ticket list, and Today, Week and Help as overlays.

use jiff::Timestamp;
use jiff::civil::Date;
use jiff::tz::TimeZone;
use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Margin, Rect};
use ratatui::style::{Color, Style, Stylize as _};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Clear, Paragraph, Row, Table, TableState};

use crate::log::{day, hm, monday, signed, target_on, totals};
use crate::{App, Overlay};

const TEXT: Color = Color::from_u32(0x00e6_dcf7);
const DIM: Color = Color::from_u32(0x009a_90c2);
const SUBTLE: Color = Color::from_u32(0x004b_4370);
const PINK: Color = Color::from_u32(0x00f0_8bb4);
const VIOLET: Color = Color::from_u32(0x00c7_9af0);
const CYAN: Color = Color::from_u32(0x007c_cfe0);
const GREEN: Color = Color::from_u32(0x008f_ddb0);
const YELLOW: Color = Color::from_u32(0x00f5_d07a);
const BLUE: Color = Color::from_u32(0x007a_a7f0);
const ORANGE: Color = Color::from_u32(0x00f2_a36b);
const RED: Color = Color::from_u32(0x00f2_788c);
const SELECT: Color = Color::from_u32(0x0046_3a6e);
const PANEL: Color = Color::from_u32(0x0022_1c33);

/// Tickets get these in the order they were first timed today; the timeline and the list share them.
const TICKET_COLORS: [Color; 6] = [PINK, CYAN, GREEN, YELLOW, BLUE, ORANGE];

/// The big clock's glyphs, three rows each: `0`–`9`, then `:`.
const GLYPHS: [[&str; 3]; 11] = [
    ["█▀█", "█ █", "▀▀▀"],
    ["▀█ ", " █ ", "▀▀▀"],
    ["▀▀█", "█▀▀", "▀▀▀"],
    ["▀▀█", " ▀█", "▀▀▀"],
    ["█ █", "▀▀█", "  ▀"],
    ["█▀▀", "▀▀█", "▀▀▀"],
    ["█▀▀", "█▀█", "▀▀▀"],
    ["▀▀█", "  █", "  ▀"],
    ["█▀█", "█▀█", "▀▀▀"],
    ["█▀█", "▀▀█", "▀▀▀"],
    ["▄", "▄", " "],
];

/// What every part of the screen measures against.
struct Ctx {
    now: Timestamp,
    tz: TimeZone,
    today: Date,
    from: Timestamp,
    to: Timestamp,
    /// Ticket id to colour, for the tickets timed today.
    colors: Vec<(i32, Color)>,
}

impl Ctx {
    fn color(&self, id: i32) -> Option<Color> {
        self.colors.iter().find(|(i, _)| *i == id).map(|(_, c)| *c)
    }

    fn local(&self, t: Timestamp) -> String {
        t.to_zoned(self.tz.clone()).strftime("%H:%M").to_string()
    }
}

pub fn draw(f: &mut Frame, app: &App) {
    let now = Timestamp::now();
    let tz = TimeZone::system();
    let today = now.to_zoned(tz.clone()).date();
    let (from, to) = day(today, &tz);
    let mut colors: Vec<(i32, Color)> = Vec::new();
    let mut todays: Vec<_> = app
        .log
        .all()
        .filter(|e| e.end.unwrap_or(now) > from && e.start < to)
        .collect();
    todays.sort_by_key(|e| e.start);
    for e in todays {
        if !colors.iter().any(|(id, _)| *id == e.ticket.id) {
            colors.push((
                e.ticket.id,
                TICKET_COLORS[colors.len() % TICKET_COLORS.len()],
            ));
        }
    }
    let cx = Ctx {
        now,
        tz,
        today,
        from,
        to,
        colors,
    };

    let area = f.area().inner(Margin::new(2, 1));
    let find = app.filtering || !app.filter.is_empty();
    let [
        head,
        _,
        clock,
        caption,
        _,
        bar,
        ticks,
        _,
        find_line,
        list,
        foot,
    ] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(3),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(u16::from(find)),
        Constraint::Min(0),
        Constraint::Length(1),
    ])
    .areas(area);

    header(f, app, &cx, head);
    big_clock(f, app, &cx, clock, caption);
    timeline(f, app, &cx, bar, ticks);
    if find {
        let mut l = vec![
            Span::from("/ ").fg(PINK),
            Span::from(app.filter.as_str()).fg(TEXT),
        ];
        if app.filtering {
            l.push(Span::from("▏").fg(PINK));
        }
        f.render_widget(Line::from(l), find_line);
    }
    tickets(f, app, &cx, list);
    footer(f, app, foot);

    match app.overlay {
        Some(Overlay::Today) => today_overlay(f, app, &cx),
        Some(Overlay::Week) => week_overlay(f, app, &cx),
        Some(Overlay::Help) => help_overlay(f),
        None => {}
    }
}

fn header(f: &mut Frame, app: &App, cx: &Ctx, area: Rect) {
    let d = app.log.day(cx.from, cx.to, cx.now);
    let mut left = match (&app.log.shift, d.first_in) {
        (Some(s), first) => vec![
            Span::from("● ").fg(GREEN),
            Span::from("clocked in ").fg(DIM),
            Span::from(cx.local(first.unwrap_or(s.start))).fg(TEXT),
        ],
        (None, _) => vec![Span::from("○ clocked out").fg(DIM)],
    };
    if d.breaks > 0 {
        left.push(Span::from(format!("   break {}", hm(d.breaks))).fg(DIM));
    }
    f.render_widget(Line::from(left), area);
    let target = target_on(cx.today, app.target);
    let right = vec![
        Span::from("worked ").fg(DIM),
        Span::from(hm(d.worked)).fg(TEXT).bold(),
        if target > 0 {
            Span::from(format!(" / {}", hm(target))).fg(DIM)
        } else {
            Span::from("  weekend").fg(DIM)
        },
    ];
    f.render_widget(Line::from(right).right_aligned(), area);
}

/// `h:mm:ss`.
fn clock_text(secs: i64) -> String {
    format!("{}:{:02}:{:02}", secs / 3600, secs / 60 % 60, secs % 60)
}

fn lerp(a: Color, b: Color, t: f32) -> Color {
    let (Color::Rgb(ar, ag, ab), Color::Rgb(br, bg, bb)) = (a, b) else {
        return a;
    };
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let mix = |x: u8, y: u8| (f32::from(x) + (f32::from(y) - f32::from(x)) * t).round() as u8;
    Color::Rgb(mix(ar, br), mix(ag, bg), mix(ab, bb))
}

/// `text` in the big glyphs, shaded left to right along `stops`; `wide` doubles every column.
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
fn big(text: &str, stops: &[Color], wide: bool) -> Vec<Line<'static>> {
    let glyphs: Vec<&[&str; 3]> = text
        .chars()
        .filter_map(|c| match c {
            ':' => Some(&GLYPHS[10]),
            _ => c.to_digit(10).map(|d| &GLYPHS[d as usize]),
        })
        .collect();
    let scale = if wide { 2 } else { 1 };
    let width: usize = glyphs
        .iter()
        .map(|g| g[0].chars().count() * scale + 1)
        .sum();
    (0..3)
        .map(|row| {
            let mut x = 0;
            let mut spans = Vec::new();
            for g in &glyphs {
                for c in g[row].chars() {
                    for _ in 0..scale {
                        let t = x as f32 / width.max(1) as f32 * (stops.len() - 1) as f32;
                        let i = (t as usize).min(stops.len() - 2);
                        let color = lerp(stops[i], stops[i + 1], t - i as f32);
                        spans.push(Span::from(c.to_string()).fg(color));
                        x += 1;
                    }
                }
                spans.push(Span::from(" "));
                x += 1;
            }
            Line::from(spans)
        })
        .collect()
}

fn big_clock(f: &mut Frame, app: &App, cx: &Ctx, area: Rect, caption: Rect) {
    let (secs, stops, line) = if let Some(e) = &app.log.running {
        let color = cx.color(e.ticket.id).unwrap_or(PINK);
        let line = Line::from(vec![
            Span::from(format!("#{}", e.ticket.id)).fg(color).bold(),
            Span::from(format!("  {}", e.ticket.title)).fg(TEXT),
            Span::from(format!("  {}", e.ticket.project)).fg(DIM),
        ]);
        let secs = cx.now.as_second() - e.start.as_second();
        (secs, vec![PINK, VIOLET, CYAN], line)
    } else {
        let hint = if app.log.shift.is_some() {
            "on no ticket · ⏎ starts the selected one"
        } else {
            "worked today · c clocks in"
        };
        let secs = app.log.day(cx.from, cx.to, cx.now).worked;
        (secs, vec![SUBTLE, DIM], Line::from(hint).fg(DIM))
    };
    f.render_widget(
        Paragraph::new(big(&clock_text(secs), &stops, area.width >= 48)).centered(),
        area,
    );
    f.render_widget(line.centered(), caption);
}

/// What one slice of the timeline shows at `at`.
fn slice(app: &App, cx: &Ctx, at: Timestamp) -> Span<'static> {
    if at > cx.now {
        return Span::from("─").fg(SUBTLE);
    }
    let on = |s: Timestamp, e: Option<Timestamp>| s <= at && at < e.unwrap_or(cx.now);
    if let Some(e) = app.log.all().find(|e| on(e.start, e.end)) {
        return Span::from("█").fg(cx.color(e.ticket.id).unwrap_or(DIM));
    }
    if app.log.all_shifts().any(|s| on(s.start, s.end)) {
        return Span::from("░").fg(DIM);
    }
    Span::from("─").fg(SUBTLE)
}

/// Today from 08:00 (or earlier) to 18:00 (or later): tickets in their colour, clocked-in time on no ticket shaded,
/// breaks and the rest a thin line, now a pink bar.
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
fn timeline(f: &mut Frame, app: &App, cx: &Ctx, bar: Rect, ticks: Rect) {
    let width = i64::from(bar.width);
    if width < 10 {
        return;
    }
    let off = |t: Timestamp| t.as_second() - cx.from.as_second();
    let day_len = cx.to.as_second() - cx.from.as_second();
    let first = app
        .log
        .all()
        .map(|e| e.start)
        .chain(app.log.all_shifts().map(|s| s.start))
        .filter(|t| (cx.from..cx.to).contains(t))
        .map(off)
        .min()
        .unwrap_or(i64::MAX);
    let lo = first.min(8 * 3600) / 3600 * 3600;
    let hi = ((off(cx.now).max(18 * 3600) + 3599) / 3600 * 3600).min(day_len);
    let step = (hi - lo) as f64 / width as f64;
    let now_cell = ((off(cx.now) - lo) as f64 / step) as i64;
    let spans: Vec<Span> = (0..width)
        .map(|i| {
            if i == now_cell {
                return Span::from("│").fg(PINK);
            }
            let mid = cx.from.as_second() + lo + ((i as f64 + 0.5) * step) as i64;
            slice(app, cx, Timestamp::from_second(mid).unwrap_or(cx.now))
        })
        .collect();
    f.render_widget(Line::from(spans), bar);

    let per_hour = width * 3600 / (hi - lo).max(1);
    let every = match per_hour {
        4.. => 1,
        2..=3 => 2,
        _ => 4,
    };
    let mut labels = vec![' '; bar.width as usize];
    for h in (lo / 3600..=hi / 3600).step_by(every) {
        let x = ((h * 3600 - lo) as f64 / step) as usize;
        if x + 2 <= labels.len() {
            labels.splice(x..x + 2, format!("{:02}", h % 24).chars());
        }
    }
    f.render_widget(
        Line::from(labels.into_iter().collect::<String>()).fg(SUBTLE),
        ticks,
    );
}

fn tickets(f: &mut Frame, app: &App, cx: &Ctx, area: Rect) {
    let visible = app.visible();
    if visible.is_empty() {
        let msg = if app.filter.is_empty() {
            "no tickets yet · r reloads, / #1234 looks one up"
        } else {
            "no match · ⏎ looks the typed #id up"
        };
        f.render_widget(Line::from(msg).fg(DIM), area);
        return;
    }
    let today = totals(app.log.all(), cx.from, cx.to, cx.now);
    let running = app.log.running.as_ref().map(|e| e.ticket.id);
    let rows = visible.into_iter().map(|t| {
        let spent = today
            .iter()
            .find(|(x, _)| x.id == t.id)
            .map_or(String::new(), |(_, s)| hm(*s));
        Row::new([
            Line::from(vec![
                Span::from(if Some(t.id) == running { "● " } else { "  " }).fg(PINK),
                Span::from(t.id.to_string()).fg(cx.color(t.id).unwrap_or(DIM)),
            ]),
            Line::from(t.title.as_str()).fg(TEXT),
            Line::from(t.project.as_str()).fg(DIM).right_aligned(),
            Line::from(spent).fg(DIM).right_aligned(),
        ])
    });
    let widths = [
        Constraint::Length(8),
        Constraint::Min(10),
        Constraint::Length(14),
        Constraint::Length(6),
    ];
    let table = Table::new(rows, widths)
        .column_spacing(2)
        .row_highlight_style(Style::new().bg(SELECT))
        .highlight_symbol(Line::from("▸ ").fg(PINK));
    let mut state = TableState::default().with_selected(Some(app.selected));
    f.render_stateful_widget(table, area, &mut state);
}

fn footer(f: &mut Frame, app: &App, area: Rect) {
    let clock = if app.log.shift.is_some() {
        "clock out"
    } else {
        "clock in"
    };
    let keys = [
        ("⏎", "start"),
        ("s", "stop"),
        ("c", clock),
        ("/", "find"),
        ("t", "today"),
        ("w", "week"),
        ("?", "more"),
    ];
    let mut spans = Vec::new();
    for (k, what) in keys {
        spans.push(Span::from(k).fg(CYAN));
        spans.push(Span::from(format!(" {what}   ")).fg(DIM));
    }
    f.render_widget(Line::from(spans), area);
    let status = app.status();
    if !status.is_empty() {
        let width = u16::try_from(status.chars().count() + 2).unwrap_or(u16::MAX);
        let [_, r] =
            Layout::horizontal([Constraint::Min(0), Constraint::Length(width)]).areas(area);
        f.render_widget(Line::from(status).fg(GREEN).right_aligned(), r);
    }
}

/// A centered panel at most `w` by `h`; returns the inside.
fn panel(f: &mut Frame, w: u16, h: u16, title: &str, hint: &str) -> Rect {
    let area = f.area();
    let w = w.min(area.width.saturating_sub(4));
    let h = h.min(area.height.saturating_sub(2));
    let rect = Rect::new(
        area.x + (area.width - w) / 2,
        area.y + (area.height - h) / 2,
        w,
        h,
    );
    f.render_widget(Clear, rect);
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(VIOLET))
        .title(Line::from(format!(" {title} ")).fg(PINK).bold())
        .title_bottom(Line::from(format!(" {hint} ")).fg(DIM).right_aligned())
        .style(Style::new().bg(PANEL));
    let inner = block.inner(rect).inner(Margin::new(2, 1));
    f.render_widget(block, rect);
    inner
}

fn len(n: usize) -> u16 {
    u16::try_from(n).unwrap_or(u16::MAX)
}

fn today_overlay(f: &mut Frame, app: &App, cx: &Ctx) {
    let d = app.log.day(cx.from, cx.to, cx.now);
    let sums = totals(app.log.all(), cx.from, cx.to, cx.now);
    let mut entries: Vec<_> = app
        .log
        .all()
        .filter(|e| e.end.unwrap_or(cx.now) > cx.from && e.start < cx.to)
        .collect();
    entries.sort_by_key(|e| e.start);
    let inner = panel(
        f,
        96,
        len(sums.len() + entries.len()).saturating_add(10),
        "today",
        "t or esc closes",
    );
    let [summary, _, per, _, shifts, _, list] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(len(sums.len())),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(0),
    ])
    .areas(inner);
    let unbooked = (d.worked - d.booked).max(0);
    let stat =
        |k: &'static str, v: String, c: Color| [Span::from(k).fg(DIM), Span::from(v).fg(c).bold()];
    let first = d.first_in.map_or_else(|| "–".into(), |t| cx.local(t));
    let line: Vec<Span> = [
        stat("in ", first, TEXT),
        stat("    worked ", hm(d.worked), TEXT),
        stat("    break ", hm(d.breaks), TEXT),
        stat("    booked ", hm(d.booked), TEXT),
        stat(
            "    unbooked ",
            hm(unbooked),
            if unbooked > 0 { YELLOW } else { TEXT },
        ),
    ]
    .into_iter()
    .flatten()
    .collect();
    f.render_widget(Line::from(line), summary);

    let rows = sums.iter().map(|(t, s)| {
        let c = cx.color(t.id).unwrap_or(DIM);
        Row::new([
            Line::from("■").fg(c),
            Line::from(format!("#{}", t.id)).fg(c),
            Line::from(t.title.as_str()).fg(TEXT),
            Line::from(hm(*s)).fg(TEXT).bold().right_aligned(),
        ])
    });
    let widths = [
        Constraint::Length(1),
        Constraint::Length(6),
        Constraint::Min(10),
        Constraint::Length(6),
    ];
    f.render_widget(Table::new(rows, widths).column_spacing(2), per);

    let mut today_shifts: Vec<_> = app
        .log
        .all_shifts()
        .filter(|s| s.end.unwrap_or(cx.now) > cx.from && s.start < cx.to)
        .collect();
    today_shifts.sort_by_key(|s| s.start);
    let mut spans = vec![Span::from("shifts  ").fg(DIM)];
    for s in today_shifts {
        let end = s.end.map_or_else(|| "now".into(), |t| cx.local(t));
        spans.push(Span::from(format!("{}–{end}   ", cx.local(s.start))).fg(TEXT));
    }
    f.render_widget(Line::from(spans), shifts);

    let rows = entries.into_iter().map(|e| {
        let end = e.end.map_or_else(|| "now".into(), |t| cx.local(t));
        let secs = e.end.unwrap_or(cx.now).as_second() - e.start.as_second();
        Row::new([
            Line::from(format!("{}–{end}", cx.local(e.start))).fg(DIM),
            Line::from(hm(secs)).fg(TEXT).right_aligned(),
            Line::from(format!("#{}", e.ticket.id)).fg(cx.color(e.ticket.id).unwrap_or(DIM)),
            Line::from(e.ticket.title.as_str()).fg(DIM),
        ])
    });
    let widths = [
        Constraint::Length(11),
        Constraint::Length(5),
        Constraint::Length(6),
        Constraint::Min(10),
    ];
    f.render_widget(Table::new(rows, widths).column_spacing(2), list);
}

fn right(l: impl Into<Line<'static>>) -> Line<'static> {
    l.into().right_aligned()
}

/// `h:mm`, or a faint dot for nothing.
fn cell(s: i64) -> Line<'static> {
    if s == 0 {
        right("·").fg(SUBTLE)
    } else {
        right(hm(s)).fg(TEXT)
    }
}

fn plus_minus(s: i64) -> Line<'static> {
    right(signed(s)).fg(if s < 0 { RED } else { GREEN })
}

fn week_overlay(f: &mut Frame, app: &App, cx: &Ctx) {
    let mon = monday(cx.today, app.week);
    let days: Vec<Date> = (0..7).map(|i| mon + jiff::Span::new().days(i)).collect();
    let bounds: Vec<_> = days.iter().map(|d| day(*d, &cx.tz)).collect();
    let all = totals(app.log.all(), bounds[0].0, bounds[6].1, cx.now);
    let per_day: Vec<_> = bounds
        .iter()
        .map(|(a, b)| totals(app.log.all(), *a, *b, cx.now))
        .collect();
    let stats: Vec<_> = bounds
        .iter()
        .map(|(a, b)| app.log.day(*a, *b, cx.now))
        .collect();
    let inner = panel(
        f,
        112,
        len(all.len()).saturating_add(13),
        &format!("week of {mon}"),
        "←/→ weeks · w or esc closes",
    );
    let [grid, _, foot] = Layout::vertical([
        Constraint::Min(0),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(inner);

    let row = |label: Line<'static>, vals: Vec<Line<'static>>, total: Line<'static>| {
        let mut r = vec![label];
        r.extend(vals);
        r.push(total);
        Row::new(r)
    };
    let mut rows: Vec<Row> = all
        .iter()
        .map(|(t, total)| {
            let c = cx.color(t.id).unwrap_or(DIM);
            let label = Line::from(vec![
                Span::from(format!("#{} ", t.id)).fg(c),
                Span::from(t.title.clone()).fg(TEXT),
            ]);
            let vals = per_day
                .iter()
                .map(|p| cell(p.iter().find(|(x, _)| x.id == t.id).map_or(0, |(_, s)| *s)))
                .collect();
            row(label, vals, right(hm(*total)).fg(TEXT).bold())
        })
        .collect();
    rows.push(Row::new([""]));
    let sum_row = |name: &'static str, vals: Vec<i64>| {
        let total = vals.iter().sum();
        row(
            Line::from(name).fg(DIM),
            vals.into_iter().map(cell).collect(),
            right(hm(total)).fg(TEXT).bold(),
        )
    };
    rows.push(sum_row(
        "booked",
        per_day
            .iter()
            .map(|p| p.iter().map(|(_, s)| s).sum())
            .collect(),
    ));
    rows.push(sum_row("worked", stats.iter().map(|s| s.worked).collect()));
    rows.push(sum_row("break", stats.iter().map(|s| s.breaks).collect()));
    // Only days with time on the clock owe the target, so a day off costs nothing.
    let diffs: Vec<Option<i64>> = stats
        .iter()
        .zip(&days)
        .map(|(s, d)| (s.worked > 0).then(|| s.worked - target_on(*d, app.target)))
        .collect();
    rows.push(row(
        Line::from("± target").fg(DIM),
        diffs
            .iter()
            .map(|d| d.map_or_else(|| right("·").fg(SUBTLE), plus_minus))
            .collect(),
        plus_minus(diffs.iter().flatten().sum()).bold(),
    ));

    let mut head = vec![Line::from("")];
    head.extend(days.iter().map(|d| {
        let l = right(d.strftime("%a %d").to_string());
        if *d == cx.today {
            l.fg(PINK).bold()
        } else {
            l.fg(CYAN)
        }
    }));
    head.push(right("total").fg(CYAN));
    let mut widths = vec![Constraint::Min(16)];
    widths.extend([Constraint::Length(6); 8]);
    f.render_widget(
        Table::new(rows, widths)
            .header(Row::new(head).bottom_margin(1))
            .column_spacing(2),
        grid,
    );

    f.render_widget(balance_line(app, cx), foot);
}

/// The overtime balance so far.
fn balance_line(app: &App, cx: &Ctx) -> Line<'static> {
    let balance = app.log.balance(cx.today, &cx.tz, app.target, cx.now);
    Line::from(vec![
        Span::from("balance ").fg(DIM),
        Span::from(signed(balance))
            .fg(if balance < 0 { RED } else { GREEN })
            .bold(),
        Span::from(format!(
            "   over every worked day before today, against {} a weekday",
            hm(app.target)
        ))
        .fg(DIM),
    ])
}

fn help_overlay(f: &mut Frame) {
    let keys = [
        ("⏎", "start the selected ticket (switches; clocks you in)"),
        ("s", "stop the ticket, stay clocked in"),
        ("c", "clock in / out (out stops the ticket)"),
        ("/", "find by title, project or id; ⏎ on #1234 looks it up"),
        ("↑ ↓", "move"),
        ("t", "today: shifts, breaks, tickets, entries"),
        ("w", "week: per day, worked vs target, balance"),
        ("← →", "earlier / later week"),
        ("r", "reload work items"),
        ("q", "quit; ticket and clock keep running"),
    ];
    let inner = panel(
        f,
        70,
        len(keys.len()).saturating_add(4),
        "keys",
        "? or esc closes",
    );
    let lines: Vec<Line> = keys
        .iter()
        .map(|(k, what)| {
            Line::from(vec![
                Span::from(format!("{k:>4}  ")).fg(CYAN),
                Span::from(*what).fg(TEXT),
            ])
        })
        .collect();
    f.render_widget(Paragraph::new(lines), inner);
}
