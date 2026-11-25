//! Full-screen Project Activity Dashboard renderer.
//!
//! Pure Ratatui renderer consuming [`ActivityDashboardViewModel`] and drawing
//! directly into a [`Buffer`]:
//! - Non-wrapping chrome rows (header, optional Swarm Plan DAG bar reusing
//!   [`crate::swarm_gallery::plan_progress_bar`], tab bar, dividers, tree rows,
//!   peek metadata, and bottom action bar / inline prompt), each strictly
//!   clamped to its display-cell budget via [`crate::agent_activity::clamp_line_to_width`].
//! - Responsive split body: horizontal (`45%` tree | `55%` peek) at
//!   `area.width >= 110`, vertical (`55%` tree / `45%` peek) below `110`.
//! - Reuses caller-provided `peek_context_bar` spans verbatim so `rayucode-tui`
//!   passes `info_widget::render_inline_limit_bar` directly without inventing
//!   a second bar glyph or color convention.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::prelude::{Color, Frame, Line, Modifier, Span, Style};
use ratatui::widgets::{Clear, Widget};
use rayucode_protocol::{
    AgentAttention, AgentAttentionKind, AutonomousRunnerItem, AutonomousRunnerKind,
    BackgroundTaskActivityItem, PeekTarget, ProjectActivitySummary, SessionPeekPayload,
    SubagentActivityItem, SwarmLiveStatus, SwarmMemberStatus, SwarmPlanSummary, SwarmTodoItem,
};
use rayucode_tui_style::color::rgb;
use rayucode_tui_style::theme::{
    accent_color, border_color, dim_color, error_color, header_name_color, info_color,
    selection_bg_color, success_color, warning_color,
};
use unicode_width::UnicodeWidthStr;

use crate::agent_activity::{
    clamp_line_to_width, format_agent_live_activity, format_elapsed_compact,
    format_subagent_live_activity, sanitize_single_line, truncate_cells_with_ellipsis,
};
use crate::memory_tiles::split_by_display_width;
use crate::swarm_gallery::{is_active_status, plan_progress_bar, status_accent};

/// Horizontal/vertical split breakpoint (columns).
pub const DASHBOARD_WIDE_BREAKPOINT: u16 = 110;

/// Filter tabs along the top of the Project Activity Dashboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ActivityTab {
    #[default]
    All,
    MySwarm,
    Peers,
    BgTasks,
    Runners,
}

impl ActivityTab {
    /// All tabs in display order.
    pub const ALL: [ActivityTab; 5] = [
        Self::All,
        Self::MySwarm,
        Self::Peers,
        Self::BgTasks,
        Self::Runners,
    ];

    /// Zero-based index into `tab_counts: [usize; 5]`.
    pub fn index(self) -> usize {
        match self {
            Self::All => 0,
            Self::MySwarm => 1,
            Self::Peers => 2,
            Self::BgTasks => 3,
            Self::Runners => 4,
        }
    }

    /// Full human-readable tab label.
    pub fn label(self) -> &'static str {
        match self {
            Self::All => "All",
            Self::MySwarm => "My Swarm",
            Self::Peers => "Peers",
            Self::BgTasks => "Bg Tasks",
            Self::Runners => "Runners",
        }
    }

    /// Compact tab label for narrow viewports.
    pub fn short_label(self) -> &'static str {
        match self {
            Self::All => "All",
            Self::MySwarm => "Swarm",
            Self::Peers => "Peers",
            Self::BgTasks => "Bg",
            Self::Runners => "Run",
        }
    }

    /// Digit hotkey (`'1'`..=`'5'`).
    pub fn digit(self) -> char {
        match self {
            Self::All => '1',
            Self::MySwarm => '2',
            Self::Peers => '3',
            Self::BgTasks => '4',
            Self::Runners => '5',
        }
    }

    /// Next tab, wrapping around.
    pub fn next(self) -> Self {
        match self {
            Self::All => Self::MySwarm,
            Self::MySwarm => Self::Peers,
            Self::Peers => Self::BgTasks,
            Self::BgTasks => Self::Runners,
            Self::Runners => Self::All,
        }
    }

    /// Previous tab, wrapping around.
    pub fn prev(self) -> Self {
        match self {
            Self::All => Self::Runners,
            Self::MySwarm => Self::All,
            Self::Peers => Self::MySwarm,
            Self::BgTasks => Self::Peers,
            Self::Runners => Self::BgTasks,
        }
    }

    /// Map number key `'1'`..=`'5'` to a tab.
    pub fn from_digit(ch: char) -> Option<Self> {
        match ch {
            '1' => Some(Self::All),
            '2' => Some(Self::MySwarm),
            '3' => Some(Self::Peers),
            '4' => Some(Self::BgTasks),
            '5' => Some(Self::Runners),
            _ => None,
        }
    }
}

/// Collapsible section groups inside the Activity Tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ActivitySection {
    MySwarm,
    Peers,
    BgTasks,
    Runners,
}

impl ActivitySection {
    pub fn title(self) -> &'static str {
        match self {
            Self::MySwarm => "MY SWARM & SUBAGENTS",
            Self::Peers => "PEER SESSIONS & OTHER SWARMS",
            Self::BgTasks => "BACKGROUND TASKS & WATCHERS",
            Self::Runners => "AUTONOMOUS RUNNERS",
        }
    }
}

/// Typed content of one logical row in the Activity Tree.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
pub enum ActivityRowKind {
    SectionHeader {
        section: ActivitySection,
        count: usize,
        collapsed: bool,
    },
    SwarmMember {
        member: SwarmMemberStatus,
        depth: usize,
        is_self: bool,
    },
    Subagent {
        item: SubagentActivityItem,
        depth: usize,
    },
    BackgroundTask {
        item: BackgroundTaskActivityItem,
    },
    Runner {
        item: AutonomousRunnerItem,
    },
}

/// One selectable row in the Activity Dashboard tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityDashboardRow {
    pub kind: ActivityRowKind,
    pub target_session_id: Option<String>,
    pub peek_target: Option<PeekTarget>,
    pub needs_attention: bool,
    pub searchable_text: String,
}

/// Inline 1-line prompt that replaces the bottom action bar during interaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DashboardInlinePrompt {
    Filter { query: String },
    Dm { target_label: String, buffer: String },
    ConfirmStop { label: String },
}

/// Pure view model passed by `rayucode-tui` into [`render_activity_dashboard`].
#[derive(Debug, Clone)]
pub struct ActivityDashboardViewModel<'a> {
    pub project_name: &'a str,
    pub branch: Option<&'a str>,
    pub summary: &'a ProjectActivitySummary,
    pub plan_summary: Option<&'a SwarmPlanSummary>,
    pub active_tab: ActivityTab,
    pub tab_counts: [usize; 5],
    pub filter_query: &'a str,
    pub rows: &'a [ActivityDashboardRow],
    pub selected_index: usize,
    pub tree_scroll: usize,
    pub peek: Option<&'a SessionPeekPayload>,
    /// Pre-rendered context bar spans supplied by caller via
    /// `info_widget::render_inline_limit_bar` so bar glyph/color stays unified.
    pub peek_context_bar: Option<Vec<Span<'static>>>,
    pub peek_follow: bool,
    pub peek_scroll: usize,
    pub has_return_session: bool,
    pub inline_prompt: Option<&'a DashboardInlinePrompt>,
    pub status_banner: Option<&'a str>,
}

/// Measured pane rectangles and visual line counts produced by
/// [`render_activity_dashboard`], allowing callers to persist `tree_scroll`,
/// compute exact wrapped `peek_scroll` bounds, and route mouse scroll events
/// to the hovered pane.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ActivityDashboardLayoutMetrics {
    pub tree_area: Rect,
    pub tree_visible_rows: usize,
    pub tree_resolved_scroll: usize,
    pub peek_area: Rect,
    pub peek_tail_height: usize,
    pub peek_wrapped_lines: usize,
}

/// Count the wrapped visual lines produced by `render_peek_pane` for
/// `output_lines` inside a peek pane of `pane_width` columns.
pub fn count_peek_wrapped_lines(output_lines: &[String], pane_width: usize) -> usize {
    let inner_w = pane_width.saturating_sub(2).max(1);
    let mut total = 0usize;
    for raw in output_lines {
        if raw.is_empty() {
            total += 1;
            continue;
        }
        for subline in raw.lines() {
            let chunks = split_by_display_width(subline, inner_w);
            total += chunks.len().max(1);
        }
    }
    total
}

/// Convenience wrapper for rendering into a [`Frame`].
pub fn draw_activity_dashboard(
    frame: &mut Frame,
    area: Rect,
    vm: &ActivityDashboardViewModel<'_>,
) -> ActivityDashboardLayoutMetrics {
    render_activity_dashboard(frame.buffer_mut(), area, vm)
}

/// Render the full-screen Project Activity Dashboard into `buf` within `area`.
pub fn render_activity_dashboard(
    buf: &mut Buffer,
    area: Rect,
    vm: &ActivityDashboardViewModel<'_>,
) -> ActivityDashboardLayoutMetrics {
    let mut metrics = ActivityDashboardLayoutMetrics::default();
    let area = area.intersection(buf.area);
    if area.is_empty() {
        return metrics;
    }

    // Clear the dashboard region so underlying chat lines never bleed through.
    Clear.render(area, buf);

    let width = usize::from(area.width);
    let mut y = area.y;
    let bottom = area.bottom();

    // ---- Row 0: Header ----
    let header_line = build_header_line(vm, width);
    put_clamped_line(buf, area.x, y, header_line, width);
    y += 1;
    if y >= bottom {
        return metrics;
    }

    // Reserve the bottom action bar (+ divider when height permits).
    let has_bottom_bar = bottom.saturating_sub(y) >= 2;
    let footer_y = if has_bottom_bar { bottom - 1 } else { bottom };
    let has_bottom_divider = has_bottom_bar && footer_y.saturating_sub(y) >= 3;
    let body_bottom = if has_bottom_divider {
        footer_y - 1
    } else {
        footer_y
    };

    // ---- Optional Plan DAG row ----
    if let Some(plan) = vm.plan_summary
        && y < body_bottom
    {
        let plan_line = build_plan_dag_line(plan, width);
        put_clamped_line(buf, area.x, y, plan_line, width);
        y += 1;
    }

    // ---- Tab bar row ----
    if y < body_bottom {
        let tab_line = build_tab_bar_line(vm, width);
        put_clamped_line(buf, area.x, y, tab_line, width);
        y += 1;
    }

    // ---- Optional status banner row ----
    if let Some(banner) = vm
        .status_banner
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty())
        && y < body_bottom
    {
        let banner_line = Line::from(vec![
            Span::styled("ℹ ", Style::default().fg(info_color())),
            Span::styled(banner, Style::default().fg(warning_color())),
        ]);
        put_clamped_line(buf, area.x, y, banner_line, width);
        y += 1;
    }

    let wide = area.width >= DASHBOARD_WIDE_BREAKPOINT;
    let split_col = if wide {
        ((u32::from(area.width) * 45) / 100).max(20) as u16
    } else {
        0
    };

    // ---- Top divider ----
    if y < body_bottom && body_bottom.saturating_sub(y) >= 2 {
        let div_line = if wide && split_col < area.width {
            build_split_rule(width, usize::from(split_col), '┬')
        } else {
            build_plain_rule(width)
        };
        put_clamped_line(buf, area.x, y, div_line, width);
        y += 1;
    }

    // ---- Responsive Body ----
    let body_area = Rect {
        x: area.x,
        y,
        width: area.width,
        height: body_bottom.saturating_sub(y),
    };

    if !body_area.is_empty() {
        if wide && split_col > 0 && split_col + 1 < body_area.width {
            let tree_area = Rect {
                x: body_area.x,
                y: body_area.y,
                width: split_col,
                height: body_area.height,
            };
            let divider_x = body_area.x + split_col;
            let peek_area = Rect {
                x: divider_x + 1,
                y: body_area.y,
                width: body_area.width - split_col - 1,
                height: body_area.height,
            };

            metrics.tree_area = tree_area;
            metrics.tree_visible_rows = usize::from(tree_area.height);
            metrics.tree_resolved_scroll = render_tree_pane(buf, tree_area, vm);
            let div_style = Style::default().fg(border_color());
            for row_y in body_area.y..body_area.bottom() {
                if let Some(cell) = buf.cell_mut((divider_x, row_y)) {
                    cell.set_symbol("│").set_style(div_style);
                }
            }
            metrics.peek_area = peek_area;
            let (tail_h, wrapped_n) = render_peek_pane(buf, peek_area, vm);
            metrics.peek_tail_height = tail_h;
            metrics.peek_wrapped_lines = wrapped_n;
        } else {
            // Stacked narrow layout: 55% tree top / 1-row divider / 45% peek bottom.
            if body_area.height >= 4 {
                let usable = body_area.height - 1; // 1 row for horizontal divider
                let tree_h = ((u32::from(usable) * 55) / 100)
                    .max(1)
                    .min(u32::from(usable.saturating_sub(1))) as u16;
                let peek_h = usable.saturating_sub(tree_h);

                let tree_area = Rect {
                    x: body_area.x,
                    y: body_area.y,
                    width: body_area.width,
                    height: tree_h,
                };
                let divider_y = body_area.y + tree_h;
                let peek_area = Rect {
                    x: body_area.x,
                    y: divider_y + 1,
                    width: body_area.width,
                    height: peek_h,
                };

                metrics.tree_area = tree_area;
                metrics.tree_visible_rows = usize::from(tree_area.height);
                metrics.tree_resolved_scroll = render_tree_pane(buf, tree_area, vm);
                put_clamped_line(buf, body_area.x, divider_y, build_plain_rule(width), width);
                metrics.peek_area = peek_area;
                let (tail_h, wrapped_n) = render_peek_pane(buf, peek_area, vm);
                metrics.peek_tail_height = tail_h;
                metrics.peek_wrapped_lines = wrapped_n;
            } else {
                metrics.tree_area = body_area;
                metrics.tree_visible_rows = usize::from(body_area.height);
                metrics.tree_resolved_scroll = render_tree_pane(buf, body_area, vm);
            }
        }
    }

    // ---- Bottom divider ----
    if has_bottom_divider {
        let div_line = if wide && split_col < area.width {
            build_split_rule(width, usize::from(split_col), '┴')
        } else {
            build_plain_rule(width)
        };
        put_clamped_line(buf, area.x, body_bottom, div_line, width);
    }

    // ---- Bottom Action Bar or Inline Prompt ----
    if has_bottom_bar {
        let bottom_line = match vm.inline_prompt {
            Some(prompt) => build_inline_prompt_line(prompt, width),
            None => build_action_bar_line(vm, width),
        };
        put_clamped_line(buf, area.x, footer_y, bottom_line, width);
    }

    metrics
}

fn put_clamped_line(buf: &mut Buffer, x: u16, y: u16, line: Line<'static>, width: usize) {
    if width == 0 {
        return;
    }
    let clamped = clamp_line_to_width(line, width);
    buf.set_line(x, y, &clamped, width as u16);
}

fn build_plain_rule(width: usize) -> Line<'static> {
    Line::from(Span::styled(
        "─".repeat(width),
        Style::default().fg(border_color()),
    ))
}

fn build_split_rule(width: usize, split_col: usize, junction: char) -> Line<'static> {
    let style = Style::default().fg(border_color());
    let left = "─".repeat(split_col.min(width));
    let right = "─".repeat(width.saturating_sub(split_col + 1));
    Line::from(vec![
        Span::styled(left, style),
        Span::styled(junction.to_string(), style),
        Span::styled(right, style),
    ])
}

/// Place `left` on the left and `right` right-aligned within `width` display
/// cells, truncating `left` with `…` before dropping `right`, and strictly
/// guaranteeing final width `<= width`.
fn align_left_and_right(
    left: Line<'static>,
    right: Line<'static>,
    width: usize,
) -> Line<'static> {
    if width == 0 {
        return Line::from("");
    }
    let right_w = right.width();
    if right_w == 0 {
        return clamp_line_to_width(left, width);
    }
    // Keep at least 1 gap cell between left and right when both are shown.
    if right_w + 2 >= width {
        return clamp_line_to_width(right, width);
    }
    let left_budget = width - right_w - 1;
    let clamped_left = clamp_line_to_width(left, left_budget);
    let left_w = clamped_left.width();
    let pad = width.saturating_sub(left_w + right_w);

    let mut spans = clamped_left.spans;
    if pad > 0 {
        spans.push(Span::raw(" ".repeat(pad)));
    }
    spans.extend(right.spans);
    clamp_line_to_width(Line::from(spans), width)
}

fn build_header_line(vm: &ActivityDashboardViewModel<'_>, width: usize) -> Line<'static> {
    let project = sanitize_single_line(vm.project_name);
    let branch = vm
        .branch
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty());

    let mut left_spans = vec![
        Span::styled("🐝 ", Style::default().fg(rgb(255, 200, 100))),
        Span::styled(
            "Project Activity",
            Style::default()
                .fg(header_name_color())
                .add_modifier(Modifier::BOLD),
        ),
    ];
    if !project.is_empty() {
        left_spans.push(Span::styled(" · ", Style::default().fg(dim_color())));
        left_spans.push(Span::styled(
            project,
            Style::default()
                .fg(rgb(230, 230, 240))
                .add_modifier(Modifier::BOLD),
        ));
    }
    if let Some(br) = branch {
        left_spans.push(Span::styled(
            format!(" ({br})"),
            Style::default().fg(info_color()),
        ));
    }

    let attn = vm.summary.attention_count;
    let mut right_spans: Vec<Span<'static>> = Vec::new();
    if attn > 0 {
        let attn_text = if width >= 70 {
            format!("⚠ {attn} needs input")
        } else {
            format!("⚠{attn}")
        };
        right_spans.push(Span::styled(
            attn_text,
            Style::default()
                .fg(warning_color())
                .add_modifier(Modifier::BOLD),
        ));
        right_spans.push(Span::styled(" · ", Style::default().fg(dim_color())));
    }
    let esc_text = if width >= 55 { "[Esc] Close" } else { "Esc" };
    right_spans.push(Span::styled(esc_text, Style::default().fg(dim_color())));

    align_left_and_right(Line::from(left_spans), Line::from(right_spans), width)
}

fn build_plan_dag_line(plan: &SwarmPlanSummary, width: usize) -> Line<'static> {
    let prefix_text = match plan
        .swarm_label
        .as_deref()
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty())
    {
        Some(lbl) if width >= 80 => format!("Plan DAG ({lbl}): "),
        _ => "Plan DAG: ".to_string(),
    };

    let mut stats_spans: Vec<Span<'static>> = Vec::new();
    let compact = width < 70;
    if compact {
        stats_spans.push(Span::styled(
            format!("{}/{}", plan.done, plan.total),
            Style::default().fg(rgb(210, 210, 220)),
        ));
        if plan.running > 0 {
            stats_spans.push(Span::styled(
                format!(" · {}r", plan.running),
                Style::default().fg(rgb(255, 200, 100)),
            ));
        }
        if plan.blocked > 0 {
            stats_spans.push(Span::styled(
                format!(" · {}b", plan.blocked),
                Style::default().fg(warning_color()),
            ));
        }
        if plan.failed > 0 {
            stats_spans.push(Span::styled(
                format!(" · {}f", plan.failed),
                Style::default().fg(error_color()),
            ));
        }
    } else {
        stats_spans.push(Span::styled(
            format!("{}/{} done", plan.done, plan.total),
            Style::default().fg(success_color()),
        ));
        if plan.running > 0 {
            stats_spans.push(Span::styled(" · ", Style::default().fg(dim_color())));
            stats_spans.push(Span::styled(
                format!("{} running", plan.running),
                Style::default().fg(rgb(255, 200, 100)),
            ));
        }
        if plan.blocked > 0 {
            stats_spans.push(Span::styled(" · ", Style::default().fg(dim_color())));
            stats_spans.push(Span::styled(
                format!("{} blocked", plan.blocked),
                Style::default().fg(warning_color()),
            ));
        }
        if plan.failed > 0 {
            stats_spans.push(Span::styled(" · ", Style::default().fg(dim_color())));
            stats_spans.push(Span::styled(
                format!("{} failed", plan.failed),
                Style::default().fg(error_color()),
            ));
        }
    }

    let stats_line = Line::from(stats_spans);
    let prefix_w = UnicodeWidthStr::width(prefix_text.as_str());
    let stats_w = stats_line.width();
    let avail_for_bar = width.saturating_sub(prefix_w + stats_w + 2);
    let bar_w = avail_for_bar.clamp(4, 20);

    let bar = plan_progress_bar(
        plan.done as u32,
        plan.running as u32,
        plan.total as u32,
        bar_w,
    );

    let mut spans = vec![Span::styled(
        prefix_text,
        Style::default()
            .fg(rgb(175, 175, 185))
            .add_modifier(Modifier::BOLD),
    )];
    spans.extend(bar.spans);
    spans.push(Span::raw("  "));
    spans.extend(stats_line.spans);

    clamp_line_to_width(Line::from(spans), width)
}

fn build_tab_bar_line(vm: &ActivityDashboardViewModel<'_>, width: usize) -> Line<'static> {
    let filter_clean = sanitize_single_line(vm.filter_query);
    let filter_line = if !filter_clean.is_empty() {
        Line::from(vec![
            Span::styled("Filter: ", Style::default().fg(info_color())),
            Span::styled(
                truncate_cells_with_ellipsis(&filter_clean, (width / 4).max(6)),
                Style::default()
                    .fg(accent_color())
                    .add_modifier(Modifier::BOLD),
            ),
        ])
    } else if width >= 68 {
        Line::from(Span::styled("Filter: /", Style::default().fg(dim_color())))
    } else {
        Line::from("")
    };

    let render_tabs = |mode: u8| -> Line<'static> {
        let mut spans: Vec<Span<'static>> = Vec::new();
        for (idx, tab) in ActivityTab::ALL.iter().enumerate() {
            if idx > 0 {
                spans.push(Span::raw(if mode == 0 { "  " } else { " " }));
            }
            let count = vm.tab_counts[tab.index()];
            let is_active = *tab == vm.active_tab;
            let text = match mode {
                0 => format!("[{}:{} ({count})]", tab.digit(), tab.label()),
                1 => format!("[{}:{}({count})]", tab.digit(), tab.short_label()),
                _ => {
                    if is_active {
                        format!("[{}:{}({count})]", tab.digit(), tab.short_label())
                    } else {
                        format!("{}:{count}", tab.digit())
                    }
                }
            };
            let style = if is_active {
                Style::default()
                    .fg(accent_color())
                    .bg(selection_bg_color())
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(dim_color())
            };
            spans.push(Span::styled(text, style));
        }
        Line::from(spans)
    };

    let filter_w = filter_line.width();
    let budget = if filter_w > 0 {
        width.saturating_sub(filter_w + 1)
    } else {
        width
    };

    let tabs_line = {
        let full = render_tabs(0);
        if full.width() <= budget {
            full
        } else {
            let short = render_tabs(1);
            if short.width() <= budget {
                short
            } else {
                render_tabs(2)
            }
        }
    };

    if filter_w > 0 && tabs_line.width() + 1 + filter_w <= width {
        align_left_and_right(tabs_line, filter_line, width)
    } else {
        clamp_line_to_width(tabs_line, width)
    }
}

fn render_tree_pane(buf: &mut Buffer, area: Rect, vm: &ActivityDashboardViewModel<'_>) -> usize {
    if area.is_empty() {
        return 0;
    }
    let width = usize::from(area.width);
    let visible_rows = usize::from(area.height);

    if vm.rows.is_empty() {
        let empty_msg = if !vm.filter_query.trim().is_empty() {
            format!(
                "No items matching \"{}\".",
                sanitize_single_line(vm.filter_query)
            )
        } else {
            "No active project agents, tasks, or runners.".to_string()
        };
        put_clamped_line(
            buf,
            area.x,
            area.y,
            Line::from(Span::styled(empty_msg, Style::default().fg(dim_color()))),
            width,
        );
        return 0;
    }

    let selected = vm.selected_index.min(vm.rows.len().saturating_sub(1));
    let mut scroll = vm.tree_scroll.min(vm.rows.len().saturating_sub(1));
    if selected < scroll {
        scroll = selected;
    } else if selected >= scroll + visible_rows {
        scroll = selected + 1 - visible_rows;
    }

    for (offset, (row_idx, row)) in vm
        .rows
        .iter()
        .enumerate()
        .skip(scroll)
        .take(visible_rows)
        .enumerate()
    {
        let row_y = area.y + offset as u16;
        let is_selected = row_idx == selected;
        let line = build_tree_row_line(row, is_selected, width);
        if is_selected {
            buf.set_style(
                Rect {
                    x: area.x,
                    y: row_y,
                    width: area.width,
                    height: 1,
                },
                Style::default().bg(selection_bg_color()),
            );
        }
        put_clamped_line(buf, area.x, row_y, line, width);
    }
    scroll
}

fn member_row_glyph(member: &SwarmMemberStatus, is_attention: bool, is_failed: bool) -> (&'static str, Color) {
    if is_failed {
        return ("✗", error_color());
    }
    if is_attention {
        return ("⚠", warning_color());
    }
    match member.status.to_ascii_lowercase().as_str() {
        "running" | "streaming" | "thinking" => ("●", status_accent(&member.status)),
        "waiting" => ("◷", status_accent("waiting")),
        "completed" | "done" => ("✓", success_color()),
        "stopped" => ("◼", dim_color()),
        _ => ("○", dim_color()),
    }
}

fn build_tree_row_line(
    row: &ActivityDashboardRow,
    is_selected: bool,
    width: usize,
) -> Line<'static> {
    let row_bg = if is_selected {
        Some(selection_bg_color())
    } else {
        None
    };
    let apply_bg = |mut style: Style| -> Style {
        if let Some(bg) = row_bg {
            style = style.bg(bg);
        }
        style
    };

    match &row.kind {
        ActivityRowKind::SectionHeader {
            section,
            count,
            collapsed,
        } => {
            let arrow = if *collapsed { "▸" } else { "▼" };
            let header = format!("{arrow} {} ({count})", section.title());
            let style = apply_bg(
                Style::default()
                    .fg(if is_selected {
                        accent_color()
                    } else {
                        rgb(155, 165, 185)
                    })
                    .add_modifier(Modifier::BOLD),
            );
            clamp_line_to_width(Line::from(Span::styled(header, style)), width)
        }
        ActivityRowKind::SwarmMember {
            member,
            depth,
            is_self,
        } => {
            let formatted = format_agent_live_activity(member);
            let (glyph, glyph_fg) =
                member_row_glyph(member, formatted.is_attention, formatted.is_failed);
            let marker = if is_selected { "▸ " } else { "  " };
            let indent = "  ".repeat((*depth).min(4));
            let base_name = member
                .friendly_name
                .as_deref()
                .map(sanitize_single_line)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| member.session_id.chars().take(8).collect());

            let mut left_spans = vec![
                Span::styled(
                    format!("{marker}{indent}"),
                    apply_bg(Style::default().fg(if is_selected {
                        accent_color()
                    } else {
                        dim_color()
                    })),
                ),
                Span::styled(format!("{glyph} "), apply_bg(Style::default().fg(glyph_fg))),
                Span::styled(
                    base_name,
                    apply_bg(
                        Style::default()
                            .fg(if is_selected {
                                rgb(245, 245, 255)
                            } else {
                                rgb(215, 215, 225)
                            })
                            .add_modifier(if is_selected {
                                Modifier::BOLD
                            } else {
                                Modifier::empty()
                            }),
                    ),
                ),
            ];

            if *is_self {
                left_spans.push(Span::styled(
                    " (you)",
                    apply_bg(Style::default().fg(info_color())),
                ));
            } else if let Some(swarm_lbl) = member
                .runtime
                .swarm_label
                .as_deref()
                .map(sanitize_single_line)
                .filter(|s| !s.is_empty())
                && width >= 54
            {
                left_spans.push(Span::styled(
                    format!(" ({swarm_lbl})"),
                    apply_bg(Style::default().fg(dim_color())),
                ));
            }

            if !formatted.summary.is_empty() {
                let summary_fg = if formatted.is_failed {
                    error_color()
                } else if formatted.is_attention {
                    warning_color()
                } else if formatted.is_active {
                    rgb(220, 200, 145)
                } else {
                    dim_color()
                };
                left_spans.push(Span::styled(" · ", apply_bg(Style::default().fg(dim_color()))));
                left_spans.push(Span::styled(
                    formatted.summary,
                    apply_bg(
                        Style::default()
                            .fg(summary_fg)
                            .add_modifier(if formatted.is_attention {
                                Modifier::BOLD
                            } else {
                                Modifier::empty()
                            }),
                    ),
                ));
            }

            let mut right_parts = Vec::new();
            if let Some((done, total)) = member.todo_progress {
                right_parts.push(format!("{done}/{total}"));
            }
            if let Some(secs) = member.runtime.elapsed_secs.or(member.status_age_secs) {
                right_parts.push(format_elapsed_compact(secs));
            }
            let right_line = if !right_parts.is_empty() && width >= 34 {
                Line::from(Span::styled(
                    right_parts.join(" · "),
                    apply_bg(Style::default().fg(dim_color())),
                ))
            } else {
                Line::from("")
            };

            let mut line = align_left_and_right(Line::from(left_spans), right_line, width);
            if let Some(bg) = row_bg {
                line = line.style(Style::default().bg(bg));
            }
            line
        }
        ActivityRowKind::Subagent { item, depth } => {
            let formatted = format_subagent_live_activity(item);
            let marker = if is_selected { "▸ " } else { "  " };
            let indent = "  ".repeat((*depth).clamp(1, 5));
            let (glyph, glyph_fg) = if formatted.is_failed {
                ("✗", error_color())
            } else if formatted.is_active {
                ("◐", info_color())
            } else if item.status.eq_ignore_ascii_case("completed")
                || item.status.eq_ignore_ascii_case("done")
            {
                ("✓", success_color())
            } else {
                ("○", dim_color())
            };

            let kind_clean = sanitize_single_line(&item.kind);
            let label_clean = sanitize_single_line(&item.label);
            let title = if !kind_clean.is_empty()
                && !label_clean
                    .to_ascii_lowercase()
                    .starts_with(&kind_clean.to_ascii_lowercase())
            {
                format!("{kind_clean}:{label_clean}")
            } else if !label_clean.is_empty() {
                label_clean
            } else {
                kind_clean
            };

            let mut left_spans = vec![
                Span::styled(
                    format!("{marker}{indent}└ "),
                    apply_bg(Style::default().fg(dim_color())),
                ),
                Span::styled(format!("{glyph} "), apply_bg(Style::default().fg(glyph_fg))),
                Span::styled(
                    title,
                    apply_bg(Style::default().fg(if is_selected {
                        rgb(240, 240, 250)
                    } else {
                        rgb(190, 195, 210)
                    })),
                ),
            ];
            if !formatted.summary.is_empty() {
                left_spans.push(Span::styled(" · ", apply_bg(Style::default().fg(dim_color()))));
                left_spans.push(Span::styled(
                    formatted.summary,
                    apply_bg(Style::default().fg(if formatted.is_failed {
                        error_color()
                    } else {
                        dim_color()
                    })),
                ));
            }

            let right_line = item
                .live_status
                .as_ref()
                .filter(|ls| ls.elapsed_ms > 0)
                .filter(|_| width >= 34)
                .map(|ls| {
                    Line::from(Span::styled(
                        format_elapsed_compact(ls.elapsed_ms / 1000),
                        apply_bg(Style::default().fg(dim_color())),
                    ))
                })
                .unwrap_or_else(|| Line::from(""));

            let mut line = align_left_and_right(Line::from(left_spans), right_line, width);
            if let Some(bg) = row_bg {
                line = line.style(Style::default().bg(bg));
            }
            line
        }
        ActivityRowKind::BackgroundTask { item } => {
            let marker = if is_selected { "▸ " } else { "  " };
            let status_lower = item.status.to_ascii_lowercase();
            let (glyph, glyph_fg) = if item.stalled {
                ("⚠", warning_color())
            } else if matches!(status_lower.as_str(), "failed" | "error" | "cancelled") {
                ("✗", error_color())
            } else if matches!(status_lower.as_str(), "completed" | "done") {
                ("✓", success_color())
            } else {
                ("⏳", rgb(150, 190, 230))
            };

            let name = item
                .display_name
                .as_deref()
                .map(sanitize_single_line)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| sanitize_single_line(&item.tool_name));
            let short_id: String = item.task_id.chars().take(6).collect();
            let display_title = if !short_id.is_empty() && !item.is_watcher && width >= 44 {
                format!("{short_id} · {name}")
            } else {
                name
            };

            let detail = if item.stalled {
                "⚠ stalled".to_string()
            } else if let Some(pct) = item.progress_percent {
                match item
                    .progress_label
                    .as_deref()
                    .map(sanitize_single_line)
                    .filter(|s| !s.is_empty())
                {
                    Some(lbl) => format!("{pct}% · {lbl}"),
                    None => format!("{pct}%"),
                }
            } else if let Some(lbl) = item
                .progress_label
                .as_deref()
                .map(sanitize_single_line)
                .filter(|s| !s.is_empty())
            {
                lbl
            } else if let Some(code) = item.exit_code {
                format!("{} (exit {code})", item.status)
            } else {
                sanitize_single_line(&item.status)
            };

            let mut left_spans = vec![
                Span::styled(
                    format!("{marker}  "),
                    apply_bg(Style::default().fg(if is_selected {
                        accent_color()
                    } else {
                        dim_color()
                    })),
                ),
                Span::styled(format!("{glyph} "), apply_bg(Style::default().fg(glyph_fg))),
                Span::styled(
                    display_title,
                    apply_bg(Style::default().fg(rgb(215, 215, 225))),
                ),
            ];
            if !detail.is_empty() {
                left_spans.push(Span::styled(" · ", apply_bg(Style::default().fg(dim_color()))));
                left_spans.push(Span::styled(
                    detail,
                    apply_bg(Style::default().fg(if item.stalled {
                        warning_color()
                    } else {
                        dim_color()
                    })),
                ));
            }
            if let Some(owner) = item
                .owner_label
                .as_deref()
                .map(sanitize_single_line)
                .filter(|s| !s.is_empty())
                && width >= 54
            {
                left_spans.push(Span::styled(
                    format!(" ({owner})"),
                    apply_bg(Style::default().fg(dim_color())),
                ));
            }

            let right_line = if width >= 32 {
                Line::from(Span::styled(
                    format_elapsed_compact(item.elapsed_secs),
                    apply_bg(Style::default().fg(dim_color())),
                ))
            } else {
                Line::from("")
            };

            let mut line = align_left_and_right(Line::from(left_spans), right_line, width);
            if let Some(bg) = row_bg {
                line = line.style(Style::default().bg(bg));
            }
            line
        }
        ActivityRowKind::Runner { item } => {
            let marker = if is_selected { "▸ " } else { "  " };
            let (glyph, glyph_fg) = match item.kind {
                AutonomousRunnerKind::Overnight => ("🌙", rgb(180, 160, 240)),
                AutonomousRunnerKind::Ambient => ("⏰", info_color()),
                AutonomousRunnerKind::Reminder => ("🔔", warning_color()),
            };

            let mut detail_parts = Vec::new();
            if let (Some(cur), Some(tot)) = (item.step_current, item.step_total) {
                detail_parts.push(format!("step {cur}/{tot}"));
            }
            let status_clean = sanitize_single_line(&item.status);
            if !status_clean.is_empty() {
                detail_parts.push(status_clean);
            }
            if let Some(det) = item
                .detail
                .as_deref()
                .map(sanitize_single_line)
                .filter(|s| !s.is_empty())
            {
                detail_parts.push(det);
            } else if let Some(next_secs) = item.next_run_secs {
                detail_parts.push(format!("next in {}", format_elapsed_compact(next_secs)));
            }

            let mut left_spans = vec![
                Span::styled(
                    format!("{marker}  "),
                    apply_bg(Style::default().fg(if is_selected {
                        accent_color()
                    } else {
                        dim_color()
                    })),
                ),
                Span::styled(format!("{glyph} "), apply_bg(Style::default().fg(glyph_fg))),
                Span::styled(
                    sanitize_single_line(&item.title),
                    apply_bg(Style::default().fg(rgb(215, 215, 225))),
                ),
            ];
            if !detail_parts.is_empty() {
                left_spans.push(Span::styled(" · ", apply_bg(Style::default().fg(dim_color()))));
                left_spans.push(Span::styled(
                    detail_parts.join(" · "),
                    apply_bg(Style::default().fg(dim_color())),
                ));
            }

            let right_line = item
                .elapsed_secs
                .filter(|_| width >= 32)
                .map(|secs| {
                    Line::from(Span::styled(
                        format_elapsed_compact(secs),
                        apply_bg(Style::default().fg(dim_color())),
                    ))
                })
                .unwrap_or_else(|| Line::from(""));

            let mut line = align_left_and_right(Line::from(left_spans), right_line, width);
            if let Some(bg) = row_bg {
                line = line.style(Style::default().bg(bg));
            }
            line
        }
    }
}

fn format_tokens_compact(tokens: u64) -> String {
    if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 100_000 {
        format!("{}k", tokens / 1_000)
    } else if tokens >= 1_000 {
        format!("{:.1}k", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}

fn attention_banner_label(kind: AgentAttentionKind) -> &'static str {
    match kind {
        AgentAttentionKind::Permission => "Waiting on permission",
        AgentAttentionKind::Question => "Waiting on answer",
        AgentAttentionKind::Stdin => "Waiting on stdin",
        AgentAttentionKind::Stalled => "Stalled",
        AgentAttentionKind::Failed => "Failed",
    }
}

fn render_peek_pane(
    buf: &mut Buffer,
    area: Rect,
    vm: &ActivityDashboardViewModel<'_>,
) -> (usize, usize) {
    if area.is_empty() {
        return (0, 0);
    }
    let width = usize::from(area.width);
    let mut y = area.y;
    let bottom = area.bottom();

    let Some(peek) = vm.peek else {
        put_clamped_line(
            buf,
            area.x,
            y,
            Line::from(Span::styled(
                "Select an agent, task, or runner to inspect live output.",
                Style::default().fg(dim_color()),
            )),
            width,
        );
        return (0, 0);
    };

    // ---- 1. Peek Header line (1 row, clamped) ----
    let glyph = if peek.attention.is_some() {
        ("⚠", warning_color())
    } else if peek
        .live_status
        .as_ref()
        .is_some_and(|ls| is_active_status(&ls.phase) || ls.tool_name.is_some())
    {
        ("●", rgb(255, 200, 100))
    } else {
        ("●", info_color())
    };
    let mut hdr_left = vec![
        Span::styled(format!("{} ", glyph.0), Style::default().fg(glyph.1)),
        Span::styled(
            sanitize_single_line(&peek.title),
            Style::default()
                .fg(rgb(240, 240, 250))
                .add_modifier(Modifier::BOLD),
        ),
    ];
    if let Some(sub) = peek
        .subtitle
        .as_deref()
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty())
    {
        hdr_left.push(Span::styled(
            format!(" ({sub})"),
            Style::default().fg(dim_color()),
        ));
    }
    let hdr_right = peek
        .live_status
        .as_ref()
        .filter(|ls| ls.elapsed_ms > 0)
        .map(|ls| {
            Line::from(Span::styled(
                format!("elapsed {}", format_elapsed_compact(ls.elapsed_ms / 1000)),
                Style::default().fg(dim_color()),
            ))
        })
        .unwrap_or_else(|| Line::from(""));
    put_clamped_line(
        buf,
        area.x,
        y,
        align_left_and_right(Line::from(hdr_left), hdr_right, width),
        width,
    );
    y += 1;
    if y >= bottom {
        return (0, 0);
    }

    // ---- 2. Model / Provider / TPS line (1 row, clamped) ----
    let model = peek
        .model
        .as_deref()
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty());
    let provider = peek
        .provider
        .as_deref()
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty());
    let tps = peek
        .tokens_per_sec
        .or_else(|| peek.live_status.as_ref().and_then(SwarmLiveStatus::tokens_per_sec))
        .filter(|t| *t >= 0.1);

    if model.is_some() || provider.is_some() || tps.is_some() {
        let mut model_spans: Vec<Span<'static>> = vec![Span::styled(
            "Model: ",
            Style::default().fg(dim_color()),
        )];
        match (model, provider) {
            (Some(m), Some(p)) => {
                model_spans.push(Span::styled(m, Style::default().fg(rgb(215, 215, 225))));
                model_spans.push(Span::styled(
                    format!(" ({p})"),
                    Style::default().fg(dim_color()),
                ));
            }
            (Some(m), None) => {
                model_spans.push(Span::styled(m, Style::default().fg(rgb(215, 215, 225))));
            }
            (None, Some(p)) => {
                model_spans.push(Span::styled(p, Style::default().fg(rgb(215, 215, 225))));
            }
            (None, None) => {}
        }
        if let Some(tps_val) = tps {
            if model_spans.len() > 1 {
                model_spans.push(Span::styled(" · ", Style::default().fg(dim_color())));
            }
            model_spans.push(Span::styled(
                format!("{tps_val:.1} tps"),
                Style::default().fg(rgb(255, 200, 100)),
            ));
        }
        put_clamped_line(buf, area.x, y, Line::from(model_spans), width);
        y += 1;
        if y >= bottom {
            return (0, 0);
        }
    }

    // ---- 3. Context Usage (pre-rendered bar verbatim) + Files Touched Count (1 row, clamped) ----
    let has_context = vm.peek_context_bar.is_some() || peek.context_used.is_some();
    if has_context || !peek.files_touched.is_empty() {
        let mut ctx_left: Vec<Span<'static>> = Vec::new();
        if has_context {
            ctx_left.push(Span::styled("Context: ", Style::default().fg(dim_color())));
            if let Some(bar_spans) = vm.peek_context_bar.as_ref() {
                ctx_left.extend(bar_spans.iter().cloned());
                if let (Some(used), Some(limit)) = (peek.context_used, peek.context_limit)
                    && limit > 0
                {
                    let extra = format!(
                        " {}/{}",
                        format_tokens_compact(used),
                        format_tokens_compact(limit)
                    );
                    let current_w = Line::from(ctx_left.clone()).width();
                    if current_w + UnicodeWidthStr::width(extra.as_str()) <= width {
                        ctx_left.push(Span::styled(extra, Style::default().fg(dim_color())));
                    }
                }
            } else if let (Some(used), Some(limit)) = (peek.context_used, peek.context_limit)
                && limit > 0
            {
                let pct = (used.saturating_mul(100) / limit).min(100);
                ctx_left.push(Span::styled(
                    format!(
                        "{}/{} ({pct}%)",
                        format_tokens_compact(used),
                        format_tokens_compact(limit)
                    ),
                    Style::default().fg(rgb(200, 200, 210)),
                ));
            } else if let Some(used) = peek.context_used {
                ctx_left.push(Span::styled(
                    format!("{} tok", format_tokens_compact(used)),
                    Style::default().fg(rgb(200, 200, 210)),
                ));
            }
        }
        let ctx_left_line = Line::from(ctx_left);
        let ctx_right = if !peek.files_touched.is_empty() {
            Line::from(Span::styled(
                format!("Files touched: {}", peek.files_touched.len()),
                Style::default().fg(dim_color()),
            ))
        } else {
            Line::from("")
        };
        let line = if ctx_left_line.width() == 0 {
            ctx_right
        } else if ctx_right.width() > 0 && ctx_left_line.width() + 2 + ctx_right.width() <= width {
            align_left_and_right(ctx_left_line, ctx_right, width)
        } else {
            ctx_left_line
        };
        put_clamped_line(buf, area.x, y, line, width);
        y += 1;
        if y >= bottom {
            return (0, 0);
        }
    }

    // ---- 4. Highlighted Attention Banner (when present) ----
    if let Some(attn) = peek.attention.as_ref() {
        let banner_fg = match attn.kind {
            AgentAttentionKind::Failed => error_color(),
            _ => warning_color(),
        };
        let attn_line = build_attention_banner_line(attn, banner_fg, width);
        put_clamped_line(buf, area.x, y, attn_line, width);
        y += 1;
        if y >= bottom {
            return (0, 0);
        }
    }

    // Reserve minimum rows for Live Stream Tail (divider + header + >=2 lines)
    // so Todos and Files Touched never starve the live tail on stacked screens.
    const MIN_TAIL_ROWS: u16 = 4;

    // ---- 5. Compact Todos section (capped) ----
    if !peek.todos.is_empty() && bottom.saturating_sub(y) >= MIN_TAIL_ROWS + 2 {
        let file_row = u16::from(!peek.files_touched.is_empty());
        let avail_for_todos = bottom.saturating_sub(y + MIN_TAIL_ROWS + file_row);
        if avail_for_todos >= 2 {
            let max_todo_rows = usize::from(avail_for_todos).clamp(2, 5);
            let done_count = peek
                .todos
                .iter()
                .filter(|t| {
                    t.status.eq_ignore_ascii_case("completed")
                        || t.status.eq_ignore_ascii_case("done")
                })
                .count();

            put_clamped_line(
                buf,
                area.x,
                y,
                Line::from(Span::styled(
                    format!("Todos ({done_count}/{}):", peek.todos.len()),
                    Style::default()
                        .fg(rgb(175, 175, 185))
                        .add_modifier(Modifier::BOLD),
                )),
                width,
            );
            y += 1;

            let item_budget = max_todo_rows.saturating_sub(1);
            let active_idx = peek
                .todos
                .iter()
                .position(|t| t.status == "in_progress")
                .or_else(|| peek.todos.iter().position(|t| t.status != "completed"))
                .unwrap_or_else(|| peek.todos.len().saturating_sub(1));
            let start = active_idx
                .saturating_sub(1)
                .min(peek.todos.len().saturating_sub(item_budget));

            for todo in peek.todos.iter().skip(start).take(item_budget) {
                if y >= bottom {
                    break;
                }
                put_clamped_line(buf, area.x, y, build_peek_todo_line(todo), width);
                y += 1;
            }
            if y >= bottom {
                return (0, 0);
            }
        }
    }

    // ---- 6. Files Touched line (1 row, clamped) ----
    if !peek.files_touched.is_empty() && bottom.saturating_sub(y) > MIN_TAIL_ROWS {
        let joined = peek
            .files_touched
            .iter()
            .map(|f| sanitize_single_line(f))
            .filter(|f| !f.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        let files_line = Line::from(vec![
            Span::styled("Files: ", Style::default().fg(dim_color())),
            Span::styled(joined, Style::default().fg(info_color())),
        ]);
        put_clamped_line(buf, area.x, y, files_line, width);
        y += 1;
        if y >= bottom {
            return (0, 0);
        }
    }

    // ---- 7. Divider + Scrollable Live Stream Tail ----
    if bottom.saturating_sub(y) >= 4 {
        put_clamped_line(buf, area.x, y, build_plain_rule(width), width);
        y += 1;
    }

    if y < bottom {
        let follow_badge = if vm.peek_follow {
            Span::styled(
                "[FOLLOW ●]",
                Style::default()
                    .fg(success_color())
                    .add_modifier(Modifier::BOLD),
            )
        } else {
            Span::styled(
                "[PAUSED]",
                Style::default()
                    .fg(warning_color())
                    .add_modifier(Modifier::BOLD),
            )
        };
        let tail_left = Line::from(vec![
            Span::styled(
                "Live Stream Tail ",
                Style::default()
                    .fg(rgb(190, 190, 200))
                    .add_modifier(Modifier::BOLD),
            ),
            follow_badge,
        ]);
        let tail_right = if width >= 44 {
            Line::from(Span::styled(
                "(J/K scroll, f toggle)",
                Style::default().fg(dim_color()),
            ))
        } else {
            Line::from("")
        };
        put_clamped_line(
            buf,
            area.x,
            y,
            align_left_and_right(tail_left, tail_right, width),
            width,
        );
        y += 1;
    }

    let tail_height = usize::from(bottom.saturating_sub(y));
    if tail_height == 0 {
        return (0, 0);
    }

    // Wrap prose lines cleanly inside the bounded stream tail viewport only.
    let inner_w = width.saturating_sub(2).max(1);
    let mut wrapped_lines: Vec<String> = Vec::new();
    for raw in &peek.output_lines {
        if raw.is_empty() {
            wrapped_lines.push(String::new());
            continue;
        }
        for subline in raw.lines() {
            let chunks = split_by_display_width(subline, inner_w);
            if chunks.is_empty() {
                wrapped_lines.push(String::new());
            } else {
                wrapped_lines.extend(chunks);
            }
        }
    }

    if wrapped_lines.is_empty() {
        put_clamped_line(
            buf,
            area.x,
            y,
            Line::from(Span::styled(
                "  (no stream output yet)",
                Style::default().fg(dim_color()),
            )),
            width,
        );
        return (tail_height, 0);
    }

    let max_scroll = wrapped_lines.len().saturating_sub(tail_height);
    let start = if vm.peek_follow {
        max_scroll
    } else {
        vm.peek_scroll.min(max_scroll)
    };

    let body_style = Style::default().fg(rgb(200, 200, 210));
    for (offset, text) in wrapped_lines
        .iter()
        .skip(start)
        .take(tail_height)
        .enumerate()
    {
        let row_y = y + offset as u16;
        let line = Line::from(Span::styled(format!("  {text}"), body_style));
        put_clamped_line(buf, area.x, row_y, line, width);
    }
    (tail_height, wrapped_lines.len())
}

fn build_attention_banner_line(
    attn: &AgentAttention,
    fg: Color,
    width: usize,
) -> Line<'static> {
    let summary = sanitize_single_line(&attn.summary);
    let label = attention_banner_label(attn.kind);
    let body = if summary.is_empty() {
        format!("⚠ ATTENTION: {label}")
    } else {
        format!("⚠ ATTENTION: {label} · {summary}")
    };
    let left = Line::from(Span::styled(
        body,
        Style::default().fg(fg).add_modifier(Modifier::BOLD),
    ));
    let cue_text = if width >= 54 {
        "[Press a to answer]"
    } else {
        "[Press a]"
    };
    let right = Line::from(Span::styled(
        cue_text,
        Style::default()
            .fg(accent_color())
            .add_modifier(Modifier::BOLD),
    ));
    align_left_and_right(left, right, width)
}

fn build_peek_todo_line(todo: &SwarmTodoItem) -> Line<'static> {
    let (glyph, glyph_fg, text_style) = match todo.status.as_str() {
        "completed" | "done" => ("✓", success_color(), Style::default().fg(dim_color())),
        "in_progress" => (
            "●",
            rgb(255, 200, 100),
            Style::default()
                .fg(rgb(230, 230, 240))
                .add_modifier(Modifier::BOLD),
        ),
        _ => ("○", dim_color(), Style::default().fg(dim_color())),
    };

    let mut spans = vec![
        Span::raw("  "),
        Span::styled(format!("{glyph} "), Style::default().fg(glyph_fg)),
        Span::styled(sanitize_single_line(&todo.content), text_style),
    ];

    if todo.status == "in_progress"
        && let Some(active_tool) = todo.tool_intents.last()
    {
        let tool_name = sanitize_single_line(&active_tool.tool_name);
        let intent = sanitize_single_line(&active_tool.intent);
        let note = if intent.is_empty() {
            format!(" ({tool_name})")
        } else {
            format!(" ({tool_name}: {intent})")
        };
        spans.push(Span::styled(note, Style::default().fg(dim_color())));
    }

    Line::from(spans)
}

fn build_inline_prompt_line(prompt: &DashboardInlinePrompt, width: usize) -> Line<'static> {
    match prompt {
        DashboardInlinePrompt::Filter { query } => {
            let left = Line::from(vec![
                Span::styled(
                    "Filter: ",
                    Style::default()
                        .fg(info_color())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("{}█", sanitize_single_line(query)),
                    Style::default().fg(rgb(240, 240, 250)),
                ),
            ]);
            let right = Line::from(Span::styled(
                if width >= 54 {
                    "[Enter] Apply  [Esc] Clear"
                } else {
                    "[Enter/Esc]"
                },
                Style::default().fg(dim_color()),
            ));
            align_left_and_right(left, right, width)
        }
        DashboardInlinePrompt::Dm {
            target_label,
            buffer,
        } => {
            let left = Line::from(vec![
                Span::styled(
                    format!("DM → {}: ", sanitize_single_line(target_label)),
                    Style::default()
                        .fg(accent_color())
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("{}█", sanitize_single_line(buffer)),
                    Style::default().fg(rgb(240, 240, 250)),
                ),
            ]);
            let right = Line::from(Span::styled(
                if width >= 58 {
                    "[Enter] Send  [Esc] Cancel"
                } else {
                    "[Enter/Esc]"
                },
                Style::default().fg(dim_color()),
            ));
            align_left_and_right(left, right, width)
        }
        DashboardInlinePrompt::ConfirmStop { label } => {
            let left = Line::from(Span::styled(
                format!("Stop {}? [y/N]", sanitize_single_line(label)),
                Style::default()
                    .fg(error_color())
                    .add_modifier(Modifier::BOLD),
            ));
            let right = Line::from(Span::styled(
                if width >= 56 {
                    "[y] Confirm  [N/Esc] Cancel"
                } else {
                    "[y/N]"
                },
                Style::default().fg(dim_color()),
            ));
            align_left_and_right(left, right, width)
        }
    }
}

fn build_action_bar_line(vm: &ActivityDashboardViewModel<'_>, width: usize) -> Line<'static> {
    let mut actions: Vec<(&'static str, &'static str)> = vec![
        ("[Enter]", "Switch"),
        ("[a]", "Attention"),
        ("[m]", "DM"),
        ("[x]", "Stop/Cancel"),
        ("[r]", "Retry"),
        ("[f]", "Follow"),
        ("[Tab]", "Tab"),
    ];
    if vm.has_return_session {
        actions.push(("[Alt+B]", "Back"));
    }

    let key_style = Style::default()
        .fg(info_color())
        .add_modifier(Modifier::BOLD);
    let label_style = Style::default().fg(dim_color());

    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut used = 0usize;
    for (idx, (key, label)) in actions.iter().enumerate() {
        let sep = if idx == 0 { "" } else { "  " };
        let piece_w = UnicodeWidthStr::width(sep)
            + UnicodeWidthStr::width(*key)
            + 1
            + UnicodeWidthStr::width(*label);
        if used + piece_w > width {
            if idx == 0 {
                spans.push(Span::styled(*key, key_style));
                spans.push(Span::styled(format!(" {label}"), label_style));
            }
            break;
        }
        if !sep.is_empty() {
            spans.push(Span::raw(sep));
        }
        spans.push(Span::styled(*key, key_style));
        spans.push(Span::styled(format!(" {label}"), label_style));
        used += piece_w;
    }

    clamp_line_to_width(Line::from(spans), width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rayucode_protocol::{SwarmMemberRuntime, SwarmToolIntent};

    fn buffer_rows(buf: &Buffer, area: Rect) -> Vec<String> {
        let mut rows = Vec::with_capacity(usize::from(area.height));
        for y in area.y..area.bottom() {
            let mut row = String::new();
            for x in area.x..area.right() {
                if let Some(cell) = buf.cell((x, y)) {
                    row.push_str(cell.symbol());
                }
            }
            rows.push(row);
        }
        rows
    }

    fn sample_fixture() -> (
        ProjectActivitySummary,
        SwarmPlanSummary,
        Vec<ActivityDashboardRow>,
        SessionPeekPayload,
        Vec<Span<'static>>,
    ) {
        let attn = AgentAttention {
            kind: AgentAttentionKind::Permission,
            summary: "bash `cargo test -p rayucode-tui --lib`".into(),
            request_id: Some("perm-42".into()),
            since_epoch_ms: Some(10_000),
        };
        let summary = ProjectActivitySummary {
            active_agents: 3,
            total_agents: 5,
            running_bg_tasks: 2,
            active_watchers: 1,
            active_runners: 1,
            attention_count: 1,
            primary_attention: Some(attn.clone()),
            active_runtime_note: None,
        };
        let plan = SwarmPlanSummary {
            swarm_id: "swarm-1".into(),
            swarm_label: Some("auth".into()),
            total: 10,
            done: 6,
            running: 2,
            blocked: 1,
            failed: 1,
        };

        let worker_auth = SwarmMemberStatus {
            session_id: "sess-auth-01".into(),
            friendly_name: Some("worker-auth".into()),
            status: "running".into(),
            todo_progress: Some((3, 5)),
            runtime: SwarmMemberRuntime {
                pending_attention: Some(attn.clone()),
                elapsed_secs: Some(102),
                swarm_label: Some("swarm #1".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        let worker_ui = SwarmMemberStatus {
            session_id: "sess-ui-02".into(),
            friendly_name: Some("worker-ui".into()),
            status: "running".into(),
            todo_progress: Some((1, 3)),
            runtime: SwarmMemberRuntime {
                elapsed_secs: Some(54),
                live_status: Some(SwarmLiveStatus {
                    phase: "tool".into(),
                    tool_name: Some("edit".into()),
                    tool_intent: Some("ui_input.rs".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            ..Default::default()
        };
        let subagent = SubagentActivityItem {
            subagent_id: "sub-1".into(),
            parent_session_id: "sess-auth-01".into(),
            kind: "subagent".into(),
            label: "explore".into(),
            role: "explorer".into(),
            status: "running".into(),
            live_status: Some(SwarmLiveStatus {
                phase: "tool".into(),
                elapsed_ms: 8_000,
                tool_name: Some("grep".into()),
                tool_intent: Some("\"oauth\"".into()),
                ..Default::default()
            }),
            started_at_ms: 1000,
        };
        let bg = BackgroundTaskActivityItem {
            task_id: "8492a1ff".into(),
            tool_name: "bash".into(),
            display_name: Some("cargo test --workspace".into()),
            session_id: "sess-auth-01".into(),
            owner_label: Some("worker-auth".into()),
            status: "running".into(),
            elapsed_secs: 72,
            progress_percent: Some(65),
            progress_label: None,
            stalled: false,
            exit_code: None,
            is_watcher: false,
        };
        let runner = AutonomousRunnerItem {
            id: "ov-1".into(),
            kind: AutonomousRunnerKind::Overnight,
            title: "overnight-nightly".into(),
            status: "running".into(),
            step_current: Some(4),
            step_total: Some(12),
            detail: None,
            next_run_secs: None,
            session_id: None,
            elapsed_secs: Some(2520),
        };

        let rows = vec![
            ActivityDashboardRow {
                kind: ActivityRowKind::SectionHeader {
                    section: ActivitySection::MySwarm,
                    count: 3,
                    collapsed: false,
                },
                target_session_id: None,
                peek_target: None,
                needs_attention: false,
                searchable_text: "my swarm".into(),
            },
            ActivityDashboardRow {
                kind: ActivityRowKind::SwarmMember {
                    member: worker_auth,
                    depth: 0,
                    is_self: false,
                },
                target_session_id: Some("sess-auth-01".into()),
                peek_target: Some(PeekTarget::Session {
                    session_id: "sess-auth-01".into(),
                }),
                needs_attention: true,
                searchable_text: "worker-auth".into(),
            },
            ActivityDashboardRow {
                kind: ActivityRowKind::Subagent {
                    item: subagent,
                    depth: 1,
                },
                target_session_id: None,
                peek_target: None,
                needs_attention: false,
                searchable_text: "explore".into(),
            },
            ActivityDashboardRow {
                kind: ActivityRowKind::SwarmMember {
                    member: worker_ui,
                    depth: 0,
                    is_self: false,
                },
                target_session_id: Some("sess-ui-02".into()),
                peek_target: Some(PeekTarget::Session {
                    session_id: "sess-ui-02".into(),
                }),
                needs_attention: false,
                searchable_text: "worker-ui".into(),
            },
            ActivityDashboardRow {
                kind: ActivityRowKind::SectionHeader {
                    section: ActivitySection::BgTasks,
                    count: 1,
                    collapsed: false,
                },
                target_session_id: None,
                peek_target: None,
                needs_attention: false,
                searchable_text: "bg tasks".into(),
            },
            ActivityDashboardRow {
                kind: ActivityRowKind::BackgroundTask { item: bg },
                target_session_id: None,
                peek_target: Some(PeekTarget::BackgroundTask {
                    task_id: "8492a1ff".into(),
                }),
                needs_attention: false,
                searchable_text: "cargo test".into(),
            },
            ActivityDashboardRow {
                kind: ActivityRowKind::SectionHeader {
                    section: ActivitySection::Runners,
                    count: 1,
                    collapsed: false,
                },
                target_session_id: None,
                peek_target: None,
                needs_attention: false,
                searchable_text: "runners".into(),
            },
            ActivityDashboardRow {
                kind: ActivityRowKind::Runner { item: runner },
                target_session_id: None,
                peek_target: Some(PeekTarget::Overnight {
                    run_id: "ov-1".into(),
                }),
                needs_attention: false,
                searchable_text: "overnight".into(),
            },
        ];

        let peek = SessionPeekPayload {
            target: PeekTarget::Session {
                session_id: "sess-auth-01".into(),
            },
            title: "worker-auth".into(),
            subtitle: Some("worker · swarm #1".into()),
            live_status: Some(SwarmLiveStatus {
                phase: "streaming".into(),
                elapsed_ms: 102_000,
                output_tps_milli: Some(48_200),
                ..Default::default()
            }),
            model: Some("claude-sonnet-4-6".into()),
            provider: Some("anthropic".into()),
            context_used: Some(64_000),
            context_limit: Some(200_000),
            tokens_per_sec: Some(48.2),
            attention: Some(attn),
            todos: vec![
                SwarmTodoItem {
                    content: "Read token refresh handler".into(),
                    status: "completed".into(),
                    tool_intents: Vec::new(),
                },
                SwarmTodoItem {
                    content: "Run unit tests".into(),
                    status: "in_progress".into(),
                    tool_intents: vec![SwarmToolIntent {
                        tool_call_id: "tc-1".into(),
                        tool_name: "bash".into(),
                        intent: "cargo test".into(),
                        status: "running".into(),
                        progress: None,
                    }],
                },
            ],
            files_touched: vec!["src/auth/pkce.rs".into(), "src/auth/token.rs".into()],
            output_lines: vec![
                "Running `cargo test -p rayucode-tui --lib`...".into(),
                "Compiling rayucode-tui v0.1.0".into(),
                "Waiting for permission approval to execute command...".into(),
            ],
            updated_at_ms: 12_000,
        };

        // Pre-rendered context bar simulating `info_widget::render_inline_limit_bar`.
        let context_bar = vec![
            Span::styled("███", Style::default().fg(rgb(100, 200, 100))),
            Span::styled("░░░░░", Style::default().fg(rgb(80, 80, 90))),
            Span::styled(" 32% used", Style::default().fg(rgb(170, 170, 180))),
        ];

        (summary, plan, rows, peek, context_bar)
    }

    #[test]
    fn activity_tab_navigation_and_digits() {
        assert_eq!(ActivityTab::All.next(), ActivityTab::MySwarm);
        assert_eq!(ActivityTab::Runners.next(), ActivityTab::All);
        assert_eq!(ActivityTab::All.prev(), ActivityTab::Runners);
        assert_eq!(ActivityTab::from_digit('1'), Some(ActivityTab::All));
        assert_eq!(ActivityTab::from_digit('2'), Some(ActivityTab::MySwarm));
        assert_eq!(ActivityTab::from_digit('3'), Some(ActivityTab::Peers));
        assert_eq!(ActivityTab::from_digit('4'), Some(ActivityTab::BgTasks));
        assert_eq!(ActivityTab::from_digit('5'), Some(ActivityTab::Runners));
        assert_eq!(ActivityTab::from_digit('9'), None);
        assert_eq!(ActivityTab::ALL.len(), 5);
    }

    #[test]
    fn renders_cleanly_across_narrow_and_wide_viewports() {
        let (summary, plan, rows, peek, context_bar) = sample_fixture();

        for width in [40u16, 60, 80, 100, 120, 160] {
            let area = Rect::new(0, 0, width, 28);
            let mut buf = Buffer::empty(area);
            let vm = ActivityDashboardViewModel {
                project_name: "rayucode-v2",
                branch: Some("dev"),
                summary: &summary,
                plan_summary: Some(&plan),
                active_tab: ActivityTab::All,
                tab_counts: [5, 3, 0, 1, 1],
                filter_query: "",
                rows: &rows,
                selected_index: 1,
                tree_scroll: 0,
                peek: Some(&peek),
                peek_context_bar: Some(context_bar.clone()),
                peek_follow: true,
                peek_scroll: 0,
                has_return_session: true,
                inline_prompt: None,
                status_banner: None,
            };

            render_activity_dashboard(&mut buf, area, &vm);
            let rendered = buffer_rows(&buf, area);
            let full_text = rendered.join("\n");

            // Header row is row 0, Plan DAG is row 1, Tab bar is row 2.
            assert!(
                rendered[0].contains("Project Activity"),
                "w={width}: header missing in row 0: {:?}",
                rendered[0]
            );
            assert!(
                rendered[1].contains("Plan DAG") && rendered[1].contains('▁'),
                "w={width}: Plan DAG bar missing in row 1: {:?}",
                rendered[1]
            );
            assert!(
                rendered[2].contains("1:All"),
                "w={width}: Tab bar missing in row 2: {:?}",
                rendered[2]
            );

            // Pre-rendered peek_context_bar appears verbatim.
            assert!(
                full_text.contains("███░░░░░ 32% used"),
                "w={width}: pre-rendered context bar missing:\n{full_text}"
            );

            // Attention banner + Press a cue + Live Stream Tail present.
            assert!(
                full_text.contains("ATTENTION") && full_text.contains("[Press a"),
                "w={width}: attention banner missing:\n{full_text}"
            );
            assert!(
                full_text.contains("Live Stream Tail") && full_text.contains("[FOLLOW ●]"),
                "w={width}: stream tail header missing:\n{full_text}"
            );
            assert!(
                full_text.contains("Waiting for permission approval"),
                "w={width}: stream tail output missing:\n{full_text}"
            );

            // Bottom row has action bar.
            let last_row = rendered.last().unwrap();
            assert!(
                last_row.contains("[Enter] Switch"),
                "w={width}: action bar missing in bottom row: {last_row:?}"
            );

            // Wide split uses vertical separator `│` and junction `┬`/`┴`; narrow stacks horizontally.
            if width >= DASHBOARD_WIDE_BREAKPOINT {
                assert!(
                    rendered[3].contains('┬'),
                    "w={width}: expected split junction in top divider: {:?}",
                    rendered[3]
                );
                assert!(
                    full_text.contains('│'),
                    "w={width}: expected vertical split divider"
                );
            } else {
                assert!(
                    !rendered[3].contains('┬'),
                    "w={width}: narrow layout should stack vertically without ┬"
                );
            }
        }
    }

    #[test]
    fn renders_inline_dm_filter_and_confirm_stop_prompts() {
        let (summary, plan, rows, peek, context_bar) = sample_fixture();
        let area = Rect::new(0, 0, 120, 24);

        let prompts = [
            (
                DashboardInlinePrompt::Dm {
                    target_label: "worker-auth".into(),
                    buffer: "please rerun tests".into(),
                },
                "DM → worker-auth: please rerun tests",
            ),
            (
                DashboardInlinePrompt::Filter {
                    query: "oauth".into(),
                },
                "Filter: oauth",
            ),
            (
                DashboardInlinePrompt::ConfirmStop {
                    label: "worker-auth".into(),
                },
                "Stop worker-auth? [y/N]",
            ),
        ];

        for (prompt, expected) in prompts {
            let mut buf = Buffer::empty(area);
            let vm = ActivityDashboardViewModel {
                project_name: "rayucode-v2",
                branch: Some("dev"),
                summary: &summary,
                plan_summary: Some(&plan),
                active_tab: ActivityTab::All,
                tab_counts: [5, 3, 0, 1, 1],
                filter_query: "",
                rows: &rows,
                selected_index: 1,
                tree_scroll: 0,
                peek: Some(&peek),
                peek_context_bar: Some(context_bar.clone()),
                peek_follow: false,
                peek_scroll: 0,
                has_return_session: false,
                inline_prompt: Some(&prompt),
                status_banner: Some("Sent nudge to worker-auth"),
            };
            render_activity_dashboard(&mut buf, area, &vm);
            let rendered = buffer_rows(&buf, area);
            let last_row = rendered.last().unwrap();
            assert!(
                last_row.contains(expected),
                "expected {expected:?} in bottom row: {last_row:?}"
            );
            assert!(
                rendered[3].contains("Sent nudge to worker-auth"),
                "status banner missing in row 3: {:?}",
                rendered[3]
            );
        }
    }

    #[test]
    fn degenerate_sizes_never_panic() {
        let (summary, plan, rows, peek, context_bar) = sample_fixture();
        let vm = ActivityDashboardViewModel {
            project_name: "日本語プロジェクト🚀",
            branch: Some("feature/日本語"),
            summary: &summary,
            plan_summary: Some(&plan),
            active_tab: ActivityTab::MySwarm,
            tab_counts: [5, 3, 0, 1, 1],
            filter_query: "テスト",
            rows: &rows,
            selected_index: 99,
            tree_scroll: 99,
            peek: Some(&peek),
            peek_context_bar: Some(context_bar),
            peek_follow: true,
            peek_scroll: 99,
            has_return_session: true,
            inline_prompt: None,
            status_banner: None,
        };

        for width in [0u16, 1, 5, 12, 35, 109, 110] {
            for height in [0u16, 1, 2, 4, 8, 20] {
                let area = Rect::new(0, 0, width, height);
                let mut buf = Buffer::empty(area);
                render_activity_dashboard(&mut buf, area, &vm);
            }
        }
    }

    #[test]
    fn all_chrome_rows_strictly_respect_display_cell_width() {
        let (summary, plan, rows, peek, context_bar) = sample_fixture();
        let prompts = [
            DashboardInlinePrompt::Filter {
                query: "日本語フィルタ🚀テスト".into(),
            },
            DashboardInlinePrompt::Dm {
                target_label: "日本語ワーカー-auth".into(),
                buffer: "非常に長いメッセージ送信確認テスト🚀".into(),
            },
            DashboardInlinePrompt::ConfirmStop {
                label: "日本語ワーカー-auth-long-name".into(),
            },
        ];

        for width in [10usize, 35, 40, 60, 80, 100, 120, 160] {
            let vm = ActivityDashboardViewModel {
                project_name: "日本語プロジェクト🚀rayucode-v2",
                branch: Some("feature/超長いブランチ名"),
                summary: &summary,
                plan_summary: Some(&plan),
                active_tab: ActivityTab::MySwarm,
                tab_counts: [12, 5, 3, 2, 2],
                filter_query: "フィルタ",
                rows: &rows,
                selected_index: 1,
                tree_scroll: 0,
                peek: Some(&peek),
                peek_context_bar: Some(context_bar.clone()),
                peek_follow: true,
                peek_scroll: 0,
                has_return_session: true,
                inline_prompt: None,
                status_banner: None,
            };

            let chrome_lines = [
                build_header_line(&vm, width),
                build_plan_dag_line(&plan, width),
                build_tab_bar_line(&vm, width),
                build_action_bar_line(&vm, width),
                build_attention_banner_line(
                    peek.attention.as_ref().unwrap(),
                    warning_color(),
                    width,
                ),
            ];
            for line in &chrome_lines {
                assert!(
                    line.width() <= width,
                    "chrome line overflowed width={width}: w={} line={line:?}",
                    line.width()
                );
            }
            for row in &rows {
                for selected in [false, true] {
                    let line = build_tree_row_line(row, selected, width);
                    assert!(
                        line.width() <= width,
                        "tree row overflowed width={width}: w={} line={line:?}",
                        line.width()
                    );
                }
            }
            for prompt in &prompts {
                let line = build_inline_prompt_line(prompt, width);
                assert!(
                    line.width() <= width,
                    "inline prompt overflowed width={width}: w={} line={line:?}",
                    line.width()
                );
            }
        }
    }
}
