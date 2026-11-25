//! Shared live agent activity formatting, Unicode display-cell clamping, and
//! minimal overscroll footer badge rendering.
//!
//! Single source of truth consumed by the Project Activity Dashboard, the
//! overscroll status bar badge, the swarm gallery/live cards, and margin docks
//! so every TUI surface displays consistent live progress without wrapping.

use ratatui::prelude::{Line, Modifier, Span, Style};
use rayucode_protocol::{
    AgentAttention, AgentAttentionKind, ProjectActivitySummary, SubagentActivityItem,
    SwarmLiveStatus, SwarmMemberStatus,
};
use rayucode_tui_style::color::rgb;
use rayucode_tui_style::theme::{dim_color, error_color, info_color, warning_color};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

/// Normalized live activity summary for a single agent or subagent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormattedAgentActivity {
    /// Short categorical badge (e.g. `"⚠ perm"`, `"bash"`, `"streaming"`), when applicable.
    pub badge: Option<String>,
    /// Single-line human-readable progress text.
    pub summary: String,
    /// Whether this item requires user/operator attention (prompt, stall, block, failure).
    pub is_attention: bool,
    /// Whether this item is actively working (tool execution, thinking, streaming, etc.).
    pub is_active: bool,
    /// Whether this item is in a failed/crashed state.
    pub is_failed: bool,
}

/// Collapse embedded line breaks / control characters into clean single-line text.
pub(crate) fn sanitize_single_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut prev_space = false;
    for ch in text.chars() {
        if ch == '\n' || ch == '\r' || ch == '\t' {
            if !prev_space && !out.is_empty() {
                out.push(' ');
                prev_space = true;
            }
        } else if ch.is_control() {
            continue;
        } else if ch.is_whitespace() {
            if !prev_space && !out.is_empty() {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    while out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Truncate `text` to strictly `<= max_cells` Unicode display cells, appending
/// an ellipsis (`…`) when truncation occurs.
///
/// Guarantees `UnicodeWidthStr::width(result.as_str()) <= max_cells` for all
/// inputs including `max_cells == 0`, `max_cells == 1`, CJK double-width
/// characters, and wide emojis.
pub fn truncate_cells_with_ellipsis(text: &str, max_cells: usize) -> String {
    if max_cells == 0 {
        return String::new();
    }
    if UnicodeWidthStr::width(text) <= max_cells {
        return text.to_string();
    }
    if max_cells == 1 {
        return "…".to_string();
    }

    let target = max_cells - 1;
    let mut out = String::new();
    let mut used = 0usize;
    for ch in text.chars() {
        let cw = UnicodeWidthChar::width(ch).unwrap_or(0);
        if used + cw > target {
            break;
        }
        out.push(ch);
        used += cw;
    }
    // Guard against grapheme/variation-selector width discrepancies where
    // `UnicodeWidthStr::width` exceeds the sum of individual `UnicodeWidthChar`.
    while UnicodeWidthStr::width(out.as_str()) > target {
        if out.pop().is_none() {
            break;
        }
    }
    out.push('…');
    out
}

/// Guarantee that a styled Ratatui [`Line`] has Unicode display width
/// `<= max_cells`, truncating the overflowing span with `…` while preserving
/// line style and alignment.
pub fn clamp_line_to_width(line: Line<'static>, max_cells: usize) -> Line<'static> {
    if max_cells == 0 {
        let mut empty = Line::from("").style(line.style);
        empty.alignment = line.alignment;
        return empty;
    }
    if line.width() <= max_cells {
        return line;
    }
    if max_cells == 1 {
        let mut single = Line::from(Span::styled("…", line.style)).style(line.style);
        single.alignment = line.alignment;
        return single;
    }

    let target = max_cells - 1;
    let mut spans: Vec<Span<'static>> = Vec::with_capacity(line.spans.len() + 1);
    let mut used = 0usize;
    let mut ellipsis_style = line.style;

    for span in line.spans {
        let text = span.content.as_ref();
        let span_w = UnicodeWidthStr::width(text);
        if used + span_w <= target {
            used += span_w;
            ellipsis_style = span.style;
            spans.push(span);
            continue;
        }

        let remaining = target.saturating_sub(used);
        if remaining > 0 {
            let mut clipped = String::new();
            let mut clipped_w = 0usize;
            for ch in text.chars() {
                let cw = UnicodeWidthChar::width(ch).unwrap_or(0);
                if clipped_w + cw > remaining {
                    break;
                }
                clipped.push(ch);
                clipped_w += cw;
            }
            while UnicodeWidthStr::width(clipped.as_str()) > remaining {
                if clipped.pop().is_none() {
                    break;
                }
            }
            if !clipped.is_empty() {
                ellipsis_style = span.style;
                spans.push(Span::styled(clipped, span.style));
            }
        }
        break;
    }

    spans.push(Span::styled("…", ellipsis_style));
    let mut clamped = Line::from(spans).style(line.style);
    clamped.alignment = line.alignment;

    // Final safety guarantee if multi-span width composition ever exceeds max_cells.
    while clamped.width() > max_cells && clamped.spans.len() > 1 {
        let last = clamped.spans.pop();
        if let Some(prev) = clamped.spans.last_mut() {
            let mut s = prev.content.to_string();
            s.pop();
            if s.is_empty() {
                clamped.spans.pop();
            } else {
                prev.content = s.into();
            }
        }
        if let Some(el) = last {
            clamped.spans.push(el);
        }
    }
    clamped
}

/// Format an elapsed duration compactly (e.g. `8s`, `1m42s`, `2h05m`).
pub fn format_elapsed_compact(secs: u64) -> String {
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m{:02}s", secs / 60, secs % 60)
    } else {
        let hours = secs / 3600;
        let mins = (secs % 3600) / 60;
        format!("{hours}h{mins:02}m")
    }
}

fn format_attention(
    attention: &AgentAttention,
    stalled_secs: Option<u64>,
) -> FormattedAgentActivity {
    let clean = sanitize_single_line(&attention.summary);
    match attention.kind {
        AgentAttentionKind::Permission => FormattedAgentActivity {
            badge: Some("⚠ perm".to_string()),
            summary: if clean.is_empty() {
                "⚠ perm".to_string()
            } else {
                format!("⚠ perm: {clean}")
            },
            is_attention: true,
            is_active: false,
            is_failed: false,
        },
        AgentAttentionKind::Question => FormattedAgentActivity {
            badge: Some("⚠ question".to_string()),
            summary: if clean.is_empty() {
                "⚠ question".to_string()
            } else {
                format!("⚠ question: {clean}")
            },
            is_attention: true,
            is_active: false,
            is_failed: false,
        },
        AgentAttentionKind::Stdin => FormattedAgentActivity {
            badge: Some("⚠ stdin".to_string()),
            summary: if clean.is_empty() {
                "⚠ stdin".to_string()
            } else {
                format!("⚠ stdin: {clean}")
            },
            is_attention: true,
            is_active: false,
            is_failed: false,
        },
        AgentAttentionKind::Stalled => {
            let trimmed_stalled = clean
                .strip_prefix("stalled")
                .or_else(|| clean.strip_prefix("Stalled"))
                .map(str::trim)
                .unwrap_or(&clean);
            let summary = if !trimmed_stalled.is_empty() {
                format!("⚠ stalled {trimmed_stalled}")
            } else if let Some(secs) = stalled_secs.filter(|&s| s > 0) {
                format!("⚠ stalled {}", format_elapsed_compact(secs))
            } else {
                "⚠ stalled".to_string()
            };
            FormattedAgentActivity {
                badge: Some("⚠ stalled".to_string()),
                summary,
                is_attention: true,
                is_active: false,
                is_failed: false,
            }
        }
        AgentAttentionKind::Failed => FormattedAgentActivity {
            badge: Some("✗ failed".to_string()),
            summary: if clean.is_empty() {
                "✗ failed".to_string()
            } else {
                format!("✗ {clean}")
            },
            is_attention: true,
            is_active: false,
            is_failed: true,
        },
    }
}

fn format_from_live_status(ls: &SwarmLiveStatus) -> Option<FormattedAgentActivity> {
    // Priority 3: active tool + intent, or batch progress.
    if let Some(tool_raw) = ls.tool_name.as_deref() {
        let tool = sanitize_single_line(tool_raw);
        if !tool.is_empty() {
            let intent = ls
                .tool_intent
                .as_deref()
                .map(sanitize_single_line)
                .filter(|s| !s.is_empty());
            let summary = match (ls.batch_progress, intent) {
                (Some((done, total)), Some(intent)) => {
                    format!("{tool} {done}/{total} · {intent}")
                }
                (Some((done, total)), None) => format!("{tool} {done}/{total}"),
                (None, Some(intent)) => format!("{tool} {intent}"),
                (None, None) => tool.clone(),
            };
            return Some(FormattedAgentActivity {
                badge: Some(tool),
                summary,
                is_attention: false,
                is_active: true,
                is_failed: false,
            });
        }
    }

    if let Some((done, total)) = ls.batch_progress {
        return Some(FormattedAgentActivity {
            badge: Some("batch".to_string()),
            summary: format!("batch {done}/{total}"),
            is_attention: false,
            is_active: true,
            is_failed: false,
        });
    }

    // Priority 4: phase + tokens_per_sec / status_detail.
    let phase = sanitize_single_line(&ls.phase);
    let detail = ls
        .status_detail
        .as_deref()
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty());
    let phase_lower = phase.to_ascii_lowercase();

    if !phase.is_empty() && !matches!(phase_lower.as_str(), "idle" | "ready") {
        let tps = ls.tokens_per_sec().filter(|t| *t >= 0.1);
        let (is_attention, is_active, is_failed) = match phase_lower.as_str() {
            "failed" | "error" | "crashed" => (true, false, true),
            "stalled" => (true, false, false),
            "blocked" | "waiting_network" => (true, false, false),
            "waiting" | "paused" | "completed" | "done" | "stopped" => (false, false, false),
            _ => (false, true, false),
        };
        let summary = if phase_lower == "streaming" {
            match (tps, detail.as_deref()) {
                (Some(tps), _) => format!("streaming · {tps:.0} tps"),
                (None, Some(det)) => format!("streaming · {det}"),
                (None, None) => "streaming".to_string(),
            }
        } else if is_failed {
            match detail.as_deref() {
                Some(det) => format!("✗ {det}"),
                None => format!("✗ {phase}"),
            }
        } else {
            match (detail.as_deref(), tps) {
                (Some(det), _) => format!("{phase} · {det}"),
                (None, Some(tps)) => format!("{phase} · {tps:.0} tps"),
                (None, None) => phase.clone(),
            }
        };
        return Some(FormattedAgentActivity {
            badge: Some(phase_lower),
            summary,
            is_attention,
            is_active,
            is_failed,
        });
    }

    if let Some(det) = detail {
        return Some(FormattedAgentActivity {
            badge: None,
            summary: det,
            is_attention: false,
            is_active: true,
            is_failed: false,
        });
    }

    None
}

/// Format the highest-priority live activity for a swarm member.
///
/// Priority order:
/// 1. `member.runtime.pending_attention` (`⚠ perm: …`, `⚠ question: …`, `⚠ stdin: …`, `⚠ stalled …`, `✗ …`)
/// 2. `member.runtime.stalled_secs` if `> 0` (`⚠ stalled <dur>`)
/// 3. `live_status.tool_name` + `tool_intent` (e.g. `edit ui_input.rs`) or `live_status.batch_progress` (`batch 3/8`)
/// 4. `live_status.phase` + `tokens_per_sec()` / `status_detail` (e.g. `streaming · 48 tps`, `thinking`, `compacting`, `retrying`)
/// 5. `wait_reason` / `todo_blocked_reason` / `detail` / `status`
pub fn format_agent_live_activity(member: &SwarmMemberStatus) -> FormattedAgentActivity {
    // 1. Pending attention always wins.
    if let Some(attention) = member.runtime.pending_attention.as_ref() {
        return format_attention(attention, member.runtime.stalled_secs);
    }

    // 2. Watchdog stall duration.
    if let Some(stalled) = member.runtime.stalled_secs.filter(|&s| s > 0) {
        return FormattedAgentActivity {
            badge: Some("⚠ stalled".to_string()),
            summary: format!("⚠ stalled {}", format_elapsed_compact(stalled)),
            is_attention: true,
            is_active: false,
            is_failed: false,
        };
    }

    // 3 & 4. Live tool / batch / phase telemetry.
    if let Some(ls) = member.runtime.live_status.as_ref()
        && let Some(formatted) = format_from_live_status(ls)
    {
        return formatted;
    }

    // 5. Scoped wait reason, todo blocker, or lifecycle status fallback.
    if let Some(wait_reason) = member
        .runtime
        .wait_reason
        .as_deref()
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty())
    {
        return FormattedAgentActivity {
            badge: Some("waiting".to_string()),
            summary: format!("waiting: {wait_reason}"),
            is_attention: false,
            is_active: false,
            is_failed: false,
        };
    }

    if let Some(blocked_reason) = member
        .runtime
        .todo_blocked_reason
        .as_deref()
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty())
    {
        return FormattedAgentActivity {
            badge: Some("blocked".to_string()),
            summary: format!("blocked: {blocked_reason}"),
            is_attention: true,
            is_active: false,
            is_failed: false,
        };
    }

    let detail = member
        .detail
        .as_deref()
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty());
    let status_clean = sanitize_single_line(&member.status);
    let status_lower = status_clean.to_ascii_lowercase();

    match status_lower.as_str() {
        "failed" | "crashed" => FormattedAgentActivity {
            badge: Some("✗ failed".to_string()),
            summary: match detail {
                Some(det) => format!("✗ {det}"),
                None => "failed".to_string(),
            },
            is_attention: true,
            is_active: false,
            is_failed: true,
        },
        "blocked" | "waiting_network" => FormattedAgentActivity {
            badge: Some("blocked".to_string()),
            summary: match detail {
                Some(det) => format!("blocked: {det}"),
                None => "blocked".to_string(),
            },
            is_attention: true,
            is_active: false,
            is_failed: false,
        },
        "waiting" => FormattedAgentActivity {
            badge: Some("waiting".to_string()),
            summary: match detail {
                Some(det) => format!("waiting: {det}"),
                None => "waiting".to_string(),
            },
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
        "running" | "streaming" | "thinking" => {
            let active_todo = member
                .todo_items
                .iter()
                .find(|t| t.status == "in_progress")
                .map(|t| sanitize_single_line(&t.content))
                .filter(|s| !s.is_empty());
            let summary = active_todo.or(detail).unwrap_or(status_lower.clone());
            FormattedAgentActivity {
                badge: Some(status_lower),
                summary,
                is_attention: false,
                is_active: true,
                is_failed: false,
            }
        }
        "completed" | "done" => FormattedAgentActivity {
            badge: None,
            summary: "completed".to_string(),
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
        "stopped" => FormattedAgentActivity {
            badge: None,
            summary: "stopped".to_string(),
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
        "ready" | "spawned" | "idle" | "" => FormattedAgentActivity {
            badge: None,
            summary: detail.unwrap_or_else(|| "idle".to_string()),
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
        _ => FormattedAgentActivity {
            badge: None,
            summary: match detail {
                Some(det) => format!("{status_clean} · {det}"),
                None => status_clean,
            },
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
    }
}

/// Format live activity for an in-process subagent run (`subagent`, `/review`, `/judge`).
pub fn format_subagent_live_activity(sub: &SubagentActivityItem) -> FormattedAgentActivity {
    let status_clean = sanitize_single_line(&sub.status);
    let status_lower = status_clean.to_ascii_lowercase();

    if matches!(status_lower.as_str(), "failed" | "error" | "crashed") {
        let detail = sub
            .live_status
            .as_ref()
            .and_then(|ls| ls.status_detail.as_deref())
            .map(sanitize_single_line)
            .filter(|s| !s.is_empty());
        return FormattedAgentActivity {
            badge: Some("✗ failed".to_string()),
            summary: match detail {
                Some(det) => format!("✗ {det}"),
                None => "✗ failed".to_string(),
            },
            is_attention: true,
            is_active: false,
            is_failed: true,
        };
    }

    if let Some(ls) = sub.live_status.as_ref()
        && let Some(formatted) = format_from_live_status(ls)
    {
        return formatted;
    }

    match status_lower.as_str() {
        "completed" | "done" => FormattedAgentActivity {
            badge: None,
            summary: "completed".to_string(),
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
        "stopped" | "cancelled" => FormattedAgentActivity {
            badge: None,
            summary: status_lower,
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
        "running" | "streaming" | "thinking" => FormattedAgentActivity {
            badge: Some(status_lower.clone()),
            summary: status_lower,
            is_attention: false,
            is_active: true,
            is_failed: false,
        },
        "waiting" => FormattedAgentActivity {
            badge: Some("waiting".to_string()),
            summary: "waiting".to_string(),
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
        "" | "idle" | "ready" => FormattedAgentActivity {
            badge: None,
            summary: "idle".to_string(),
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
        _ => FormattedAgentActivity {
            badge: None,
            summary: status_clean,
            is_attention: false,
            is_active: false,
            is_failed: false,
        },
    }
}

fn spans_display_width(spans: &[Span<'_>]) -> usize {
    spans
        .iter()
        .map(|s| UnicodeWidthStr::width(s.content.as_ref()))
        .sum()
}

fn attention_short_tag(kind: AgentAttentionKind) -> &'static str {
    match kind {
        AgentAttentionKind::Permission => "perm",
        AgentAttentionKind::Question => "question",
        AgentAttentionKind::Stdin => "stdin",
        AgentAttentionKind::Stalled => "stall",
        AgentAttentionKind::Failed => "fail",
    }
}

fn attention_style(primary: Option<&AgentAttention>) -> Style {
    let color = match primary.map(|a| a.kind) {
        Some(AgentAttentionKind::Failed) => error_color(),
        _ => warning_color(),
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

fn push_sep(spans: &mut Vec<Span<'static>>, sep: &'static str) {
    if !spans.is_empty() {
        spans.push(Span::styled(sep, Style::default().fg(dim_color())));
    }
}

/// Render the minimal overscroll footer activity badge using a 4-tier width
/// compaction ladder that strictly fits within `max_cells` Unicode display cells.
///
/// - Returns an empty `Vec` when all counts are zero, `primary_attention` is
///   `None`, `active_runtime_note` is `None`, and `!has_return_session`.
/// - Tier 1 (wide): `[↩ Alt+B · ]🐝 3 active · 2 bg · 1 runner · ⚠1 perm · Alt+N`
/// - Tier 2 (medium): `[↩ Alt+B · ]🐝 3 · ⏳ 2 · ⚠1 perm · Alt+N`
/// - Tier 3 (narrow): `[↩ ]🐝3 ⏳2 ⚠1 · Alt+N`
/// - Tier 4 (ultra-narrow): `⚠1` (or `🐝3` / `⏳2` / `↩`), clamped to `max_cells`.
/// - Attention (`⚠N`) has the highest priority and is NEVER dropped when
///   `summary.attention_count > 0` and `max_cells >= 2`.
pub fn render_activity_footer_badge(
    summary: &ProjectActivitySummary,
    has_return_session: bool,
    max_cells: usize,
) -> Vec<Span<'static>> {
    render_activity_footer_badge_tiers(summary, has_return_session, max_cells)
        .into_iter()
        .next()
        .unwrap_or_default()
}

/// Render all distinct compaction tiers of the project activity footer badge
/// that fit within `max_cells`, ordered from widest (Tier 1) to narrowest
/// (Tier 4). Callers combining the badge with session facts can step the badge
/// down progressively alongside session-fact compaction rather than dropping
/// all session facts before shrinking a wide Tier 1 badge.
pub fn render_activity_footer_badge_tiers(
    summary: &ProjectActivitySummary,
    has_return_session: bool,
    max_cells: usize,
) -> Vec<Vec<Span<'static>>> {
    if max_cells == 0 {
        return Vec::new();
    }

    let bg_total = summary.running_bg_tasks + summary.active_watchers;
    let attention_n = summary
        .attention_count
        .max(usize::from(summary.primary_attention.is_some()));
    let runtime_note = summary
        .active_runtime_note
        .as_deref()
        .map(sanitize_single_line)
        .filter(|s| !s.is_empty());

    let is_empty = summary.active_agents == 0
        && summary.total_agents == 0
        && bg_total == 0
        && summary.active_runners == 0
        && attention_n == 0
        && runtime_note.is_none()
        && !has_return_session;
    if is_empty {
        return Vec::new();
    }

    let return_style = Style::default()
        .fg(info_color())
        .add_modifier(Modifier::BOLD);
    let agent_style = if summary.active_agents > 0 {
        Style::default().fg(rgb(255, 200, 100))
    } else {
        Style::default().fg(dim_color())
    };
    let bg_style = Style::default().fg(rgb(150, 190, 230));
    let runner_style = Style::default().fg(rgb(180, 160, 240));
    let note_style = Style::default().fg(warning_color());
    let attn_style = attention_style(summary.primary_attention.as_ref());
    let key_style = Style::default().fg(rgb(130, 150, 195));
    let attn_tag = summary
        .primary_attention
        .as_ref()
        .map(|a| attention_short_tag(a.kind));

    let mut tiers: Vec<Vec<Span<'static>>> = Vec::with_capacity(4);
    let mut push_tier = |candidate: Vec<Span<'static>>| {
        if candidate.is_empty() {
            return;
        }
        let w = spans_display_width(&candidate);
        if w > max_cells {
            return;
        }
        if tiers
            .last()
            .is_some_and(|prev| spans_display_width(prev) <= w)
        {
            return;
        }
        tiers.push(candidate);
    };

    // ---- Tier 1 (wide) ----
    let tier1 = {
        let mut s: Vec<Span<'static>> = Vec::new();
        if has_return_session {
            s.push(Span::styled("↩ Alt+B", return_style));
        }
        if summary.active_agents > 0 {
            push_sep(&mut s, " · ");
            s.push(Span::styled(
                format!("🐝 {} active", summary.active_agents),
                agent_style,
            ));
        } else if summary.total_agents > 0 {
            push_sep(&mut s, " · ");
            s.push(Span::styled(
                format!("🐝 {} idle", summary.total_agents),
                agent_style,
            ));
        }
        if summary.running_bg_tasks > 0 && summary.active_watchers > 0 {
            push_sep(&mut s, " · ");
            s.push(Span::styled(
                format!(
                    "{} bg · {} watch",
                    summary.running_bg_tasks, summary.active_watchers
                ),
                bg_style,
            ));
        } else if summary.running_bg_tasks > 0 {
            push_sep(&mut s, " · ");
            s.push(Span::styled(
                format!("{} bg", summary.running_bg_tasks),
                bg_style,
            ));
        } else if summary.active_watchers > 0 {
            push_sep(&mut s, " · ");
            s.push(Span::styled(
                format!("{} watch", summary.active_watchers),
                bg_style,
            ));
        }
        if summary.active_runners > 0 {
            push_sep(&mut s, " · ");
            let noun = if summary.active_runners == 1 {
                "runner"
            } else {
                "runners"
            };
            s.push(Span::styled(
                format!("{} {noun}", summary.active_runners),
                runner_style,
            ));
        }
        if let Some(note) = runtime_note.as_deref() {
            push_sep(&mut s, " · ");
            let clipped = truncate_cells_with_ellipsis(note, 20);
            s.push(Span::styled(clipped, note_style));
        }
        if attention_n > 0 {
            push_sep(&mut s, " · ");
            let text = match attn_tag {
                Some(tag) => format!("⚠{attention_n} {tag}"),
                None => format!("⚠{attention_n}"),
            };
            s.push(Span::styled(text, attn_style));
        }
        push_sep(&mut s, " · ");
        s.push(Span::styled("Alt+N", key_style));
        s
    };
    push_tier(tier1);

    // ---- Tier 2 (medium) ----
    let tier2 = {
        let mut s: Vec<Span<'static>> = Vec::new();
        if has_return_session {
            s.push(Span::styled("↩ Alt+B", return_style));
        }
        let agent_count = if summary.active_agents > 0 {
            summary.active_agents
        } else {
            summary.total_agents
        };
        if agent_count > 0 {
            push_sep(&mut s, " · ");
            s.push(Span::styled(format!("🐝 {agent_count}"), agent_style));
        }
        if bg_total > 0 {
            push_sep(&mut s, " · ");
            s.push(Span::styled(format!("⏳ {bg_total}"), bg_style));
        }
        if summary.active_runners > 0 {
            push_sep(&mut s, " · ");
            s.push(Span::styled(
                format!("🌙 {}", summary.active_runners),
                runner_style,
            ));
        }
        if let Some(note) = runtime_note.as_deref()
            && agent_count == 0
            && bg_total == 0
            && summary.active_runners == 0
        {
            push_sep(&mut s, " · ");
            s.push(Span::styled(
                truncate_cells_with_ellipsis(note, 14),
                note_style,
            ));
        }
        if attention_n > 0 {
            push_sep(&mut s, " · ");
            let text = match attn_tag {
                Some(tag) => format!("⚠{attention_n} {tag}"),
                None => format!("⚠{attention_n}"),
            };
            s.push(Span::styled(text, attn_style));
        }
        push_sep(&mut s, " · ");
        s.push(Span::styled("Alt+N", key_style));
        s
    };
    push_tier(tier2);

    // ---- Tier 3 (narrow) ----
    let tier3 = {
        let mut s: Vec<Span<'static>> = Vec::new();
        if has_return_session {
            s.push(Span::styled("↩", return_style));
        }
        let agent_count = if summary.active_agents > 0 {
            summary.active_agents
        } else {
            summary.total_agents
        };
        if agent_count > 0 {
            push_sep(&mut s, " ");
            s.push(Span::styled(format!("🐝{agent_count}"), agent_style));
        }
        if bg_total > 0 {
            push_sep(&mut s, " ");
            s.push(Span::styled(format!("⏳{bg_total}"), bg_style));
        }
        if summary.active_runners > 0 {
            push_sep(&mut s, " ");
            s.push(Span::styled(
                format!("🌙{}", summary.active_runners),
                runner_style,
            ));
        }
        if attention_n > 0 {
            push_sep(&mut s, " ");
            s.push(Span::styled(format!("⚠{attention_n}"), attn_style));
        }
        if s.is_empty()
            && let Some(note) = runtime_note.as_deref()
        {
            let note_budget = max_cells.saturating_sub(8).max(4);
            s.push(Span::styled(
                truncate_cells_with_ellipsis(note, note_budget),
                note_style,
            ));
        }
        push_sep(&mut s, " · ");
        s.push(Span::styled("Alt+N", key_style));
        s
    };
    push_tier(tier3);

    // ---- Tier 4 (ultra-narrow) ----
    // Attention has highest priority and is NEVER dropped when attention_n > 0
    // and max_cells >= 2 (and still surfaces `⚠` at max_cells == 1).
    let agent_count = if summary.active_agents > 0 {
        summary.active_agents
    } else {
        summary.total_agents
    };

    let tier4 = if attention_n > 0 {
        let attn_text = format!("⚠{attention_n}");
        let attn_w = UnicodeWidthStr::width(attn_text.as_str());
        if attn_w > max_cells {
            if max_cells == 1 {
                vec![Span::styled("⚠", attn_style)]
            } else {
                vec![Span::styled(
                    truncate_cells_with_ellipsis(&attn_text, max_cells),
                    attn_style,
                )]
            }
        } else {
            // Try pairing the highest-priority activity counter alongside `⚠N` if it fits.
            let mut s: Vec<Span<'static>> = Vec::new();
            if agent_count > 0 {
                let prefix = format!("🐝{agent_count}");
                if UnicodeWidthStr::width(prefix.as_str()) + 1 + attn_w <= max_cells {
                    s.push(Span::styled(prefix, agent_style));
                    s.push(Span::raw(" "));
                }
            } else if bg_total > 0 {
                let prefix = format!("⏳{bg_total}");
                if UnicodeWidthStr::width(prefix.as_str()) + 1 + attn_w <= max_cells {
                    s.push(Span::styled(prefix, bg_style));
                    s.push(Span::raw(" "));
                }
            } else if has_return_session && 2 + attn_w <= max_cells {
                s.push(Span::styled("↩", return_style));
                s.push(Span::raw(" "));
            }
            s.push(Span::styled(attn_text, attn_style));
            s
        }
    } else {
        let fallback = if agent_count > 0 {
            let mut s = vec![Span::styled(format!("🐝{agent_count}"), agent_style)];
            if bg_total > 0 {
                let bg = format!("⏳{bg_total}");
                if spans_display_width(&s) + 1 + UnicodeWidthStr::width(bg.as_str()) <= max_cells {
                    s.push(Span::raw(" "));
                    s.push(Span::styled(bg, bg_style));
                }
            }
            s
        } else if bg_total > 0 {
            vec![Span::styled(format!("⏳{bg_total}"), bg_style)]
        } else if summary.active_runners > 0 {
            vec![Span::styled(
                format!("🌙{}", summary.active_runners),
                runner_style,
            )]
        } else if has_return_session {
            vec![Span::styled("↩", return_style)]
        } else if let Some(note) = runtime_note.as_deref() {
            vec![Span::styled(
                truncate_cells_with_ellipsis(note, max_cells),
                note_style,
            )]
        } else {
            Vec::new()
        };

        if spans_display_width(&fallback) <= max_cells {
            fallback
        } else {
            clamp_line_to_width(Line::from(fallback), max_cells).spans
        }
    };
    push_tier(tier4);

    tiers
}

#[cfg(test)]
mod tests {
    use super::*;
    use rayucode_protocol::SwarmMemberRuntime;

    fn plain_spans(spans: &[Span<'_>]) -> String {
        spans.iter().map(|s| s.content.as_ref()).collect()
    }

    fn base_member() -> SwarmMemberStatus {
        SwarmMemberStatus {
            session_id: "sess-12345678".to_string(),
            friendly_name: Some("worker-auth".to_string()),
            status: "running".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn truncate_cells_handles_zero_one_cjk_and_emoji() {
        assert_eq!(truncate_cells_with_ellipsis("hello", 0), "");
        assert_eq!(truncate_cells_with_ellipsis("hello", 1), "…");
        assert_eq!(truncate_cells_with_ellipsis("hello", 5), "hello");
        assert_eq!(truncate_cells_with_ellipsis("hello world", 5), "hell…");

        // CJK double-width characters (each 2 display cells).
        let cjk = "日本語エージェントテスト";
        for max in 0..=24 {
            let out = truncate_cells_with_ellipsis(cjk, max);
            assert!(
                UnicodeWidthStr::width(out.as_str()) <= max,
                "CJK overflow at max={max}: {out:?} (w={})",
                UnicodeWidthStr::width(out.as_str())
            );
        }

        // Wide emojis.
        let emoji = "🐝🔥🚀プロジェクト🎉";
        for max in 0..=20 {
            let out = truncate_cells_with_ellipsis(emoji, max);
            assert!(
                UnicodeWidthStr::width(out.as_str()) <= max,
                "emoji overflow at max={max}: {out:?} (w={})",
                UnicodeWidthStr::width(out.as_str())
            );
        }
    }

    #[test]
    fn clamp_line_to_width_never_exceeds_max_cells() {
        let line = Line::from(vec![
            Span::styled("🐝 ", Style::default().fg(rgb(255, 200, 100))),
            Span::styled("日本語ワーカー", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" · "),
            Span::styled("⚠ perm: cargo test --workspace", Style::default()),
        ]);
        for max in 0..=60 {
            let clamped = clamp_line_to_width(line.clone(), max);
            let text = plain_spans(&clamped.spans);
            let w = UnicodeWidthStr::width(text.as_str());
            assert!(
                w <= max,
                "clamped line exceeded max={max}: w={w}, text={text:?}"
            );
            if max >= 1 && line.width() > max {
                assert!(
                    text.ends_with('…'),
                    "expected ellipsis at max={max}: {text:?}"
                );
            }
        }
    }

    #[test]
    fn format_elapsed_compact_buckets() {
        assert_eq!(format_elapsed_compact(0), "0s");
        assert_eq!(format_elapsed_compact(8), "8s");
        assert_eq!(format_elapsed_compact(59), "59s");
        assert_eq!(format_elapsed_compact(60), "1m00s");
        assert_eq!(format_elapsed_compact(102), "1m42s");
        assert_eq!(format_elapsed_compact(3600), "1h00m");
        assert_eq!(format_elapsed_compact(7500), "2h05m");
    }

    #[test]
    fn format_agent_live_activity_priority_ordering() {
        // 1. Attention beats everything (stalled, tool+intent, batch, phase, wait).
        let mut m = base_member();
        m.runtime = SwarmMemberRuntime {
            pending_attention: Some(AgentAttention {
                kind: AgentAttentionKind::Permission,
                summary: "bash `cargo test`".into(),
                request_id: Some("req-1".into()),
                since_epoch_ms: Some(1_000),
            }),
            stalled_secs: Some(95),
            live_status: Some(SwarmLiveStatus {
                phase: "streaming".into(),
                tool_name: Some("edit".into()),
                tool_intent: Some("ui_input.rs".into()),
                batch_progress: Some((3, 8)),
                output_tps_milli: Some(48_200),
                ..Default::default()
            }),
            wait_reason: Some("waiting on worker-b".into()),
            ..Default::default()
        };
        let a = format_agent_live_activity(&m);
        assert_eq!(a.summary, "⚠ perm: bash `cargo test`");
        assert!(a.is_attention);
        assert!(!a.is_active);
        assert!(!a.is_failed);

        // Attention variants: question, stdin, stalled, failed.
        m.runtime.pending_attention = Some(AgentAttention {
            kind: AgentAttentionKind::Question,
            summary: "Pick auth strategy".into(),
            request_id: None,
            since_epoch_ms: None,
        });
        assert_eq!(
            format_agent_live_activity(&m).summary,
            "⚠ question: Pick auth strategy"
        );

        m.runtime.pending_attention = Some(AgentAttention {
            kind: AgentAttentionKind::Stdin,
            summary: "Enter passphrase".into(),
            request_id: None,
            since_epoch_ms: None,
        });
        assert_eq!(
            format_agent_live_activity(&m).summary,
            "⚠ stdin: Enter passphrase"
        );

        m.runtime.pending_attention = Some(AgentAttention {
            kind: AgentAttentionKind::Failed,
            summary: "exit 1".into(),
            request_id: None,
            since_epoch_ms: None,
        });
        let failed = format_agent_live_activity(&m);
        assert_eq!(failed.summary, "✗ exit 1");
        assert!(failed.is_failed);
        assert!(failed.is_attention);

        // 2. Stalled beats tool+intent, batch, phase, wait.
        m.runtime.pending_attention = None;
        let stalled = format_agent_live_activity(&m);
        assert_eq!(stalled.summary, "⚠ stalled 1m35s");
        assert!(stalled.is_attention);
        assert!(!stalled.is_active);

        // 3a. Tool + intent beats phase + wait.
        m.runtime.stalled_secs = None;
        m.runtime.live_status.as_mut().unwrap().batch_progress = None;
        let tool = format_agent_live_activity(&m);
        assert_eq!(tool.summary, "edit ui_input.rs");
        assert!(tool.is_active);
        assert!(!tool.is_attention);

        // 3b. Batch progress without tool name beats phase + wait.
        {
            let ls = m.runtime.live_status.as_mut().unwrap();
            ls.tool_name = None;
            ls.tool_intent = None;
            ls.batch_progress = Some((3, 8));
        }
        let batch = format_agent_live_activity(&m);
        assert_eq!(batch.summary, "batch 3/8");
        assert!(batch.is_active);

        // 4. Phase + tps beats wait_reason / status.
        {
            let ls = m.runtime.live_status.as_mut().unwrap();
            ls.batch_progress = None;
            ls.phase = "streaming".into();
            ls.output_tps_milli = Some(48_200);
        }
        let streaming = format_agent_live_activity(&m);
        assert_eq!(streaming.summary, "streaming · 48 tps");
        assert!(streaming.is_active);

        {
            let ls = m.runtime.live_status.as_mut().unwrap();
            ls.phase = "thinking".into();
            ls.output_tps_milli = None;
        }
        assert_eq!(format_agent_live_activity(&m).summary, "thinking");

        // 5. Wait reason beats raw status.
        m.runtime.live_status = None;
        let wait = format_agent_live_activity(&m);
        assert_eq!(wait.summary, "waiting: waiting on worker-b");
        assert!(!wait.is_active);

        // 6. Lifecycle status fallback.
        m.runtime.wait_reason = None;
        m.status = "completed".into();
        assert_eq!(format_agent_live_activity(&m).summary, "completed");

        m.status = "ready".into();
        assert_eq!(format_agent_live_activity(&m).summary, "idle");

        m.status = "failed".into();
        let raw_fail = format_agent_live_activity(&m);
        assert_eq!(raw_fail.summary, "failed");
        assert!(raw_fail.is_failed);
    }

    #[test]
    fn format_subagent_live_activity_uses_shared_live_status() {
        let mut sub = SubagentActivityItem {
            subagent_id: "sub-1".into(),
            parent_session_id: "sess-1".into(),
            kind: "subagent".into(),
            label: "explore".into(),
            role: "explorer".into(),
            status: "running".into(),
            live_status: Some(SwarmLiveStatus {
                phase: "tool".into(),
                tool_name: Some("grep".into()),
                tool_intent: Some("\"oauth\"".into()),
                ..Default::default()
            }),
            started_at_ms: 0,
        };
        let f = format_subagent_live_activity(&sub);
        assert_eq!(f.summary, "grep \"oauth\"");
        assert!(f.is_active);

        sub.status = "failed".into();
        sub.live_status.as_mut().unwrap().status_detail = Some("timeout".into());
        let failed = format_subagent_live_activity(&sub);
        assert_eq!(failed.summary, "✗ timeout");
        assert!(failed.is_failed);
    }

    #[test]
    fn footer_badge_empty_when_idle_and_no_return_session() {
        let empty = ProjectActivitySummary::default();
        assert!(render_activity_footer_badge(&empty, false, 120).is_empty());
        assert!(render_activity_footer_badge(&empty, false, 35).is_empty());
        // Return session alone renders a badge.
        assert!(!render_activity_footer_badge(&empty, true, 80).is_empty());
    }

    #[test]
    fn footer_badge_compaction_ladder_and_attention_preservation() {
        let summary = ProjectActivitySummary {
            active_agents: 3,
            total_agents: 4,
            running_bg_tasks: 2,
            active_watchers: 0,
            active_runners: 1,
            attention_count: 1,
            primary_attention: Some(AgentAttention {
                kind: AgentAttentionKind::Permission,
                summary: "日本語テスト長いコマンド実行確認 🚀🔥".into(),
                request_id: Some("r1".into()),
                since_epoch_ms: None,
            }),
            active_runtime_note: Some("⚙ ビルド実行中非常に長いステータス通知テスト".into()),
        };

        for width in [2usize, 6, 15, 35, 45, 60, 80, 120, 160] {
            for has_return in [false, true] {
                let spans = render_activity_footer_badge(&summary, has_return, width);
                let text = plain_spans(&spans);
                let disp = UnicodeWidthStr::width(text.as_str());
                assert!(
                    disp <= width,
                    "footer badge exceeded width={width} (has_return={has_return}): disp={disp} text={text:?}"
                );
                assert!(
                    !text.contains('\n') && !text.contains('\r'),
                    "footer badge must be single row: {text:?}"
                );
                assert!(
                    text.contains("⚠1"),
                    "attention must never be dropped at width={width} (has_return={has_return}): {text:?}"
                );
            }
        }

        // Verify wide tier includes full descriptive labels and return hint.
        let wide = plain_spans(&render_activity_footer_badge(&summary, true, 160));
        assert!(wide.contains("↩ Alt+B"), "wide={wide:?}");
        assert!(wide.contains("🐝 3 active"), "wide={wide:?}");
        assert!(wide.contains("2 bg"), "wide={wide:?}");
        assert!(wide.contains("1 runner"), "wide={wide:?}");
        assert!(wide.contains("⚠1 perm"), "wide={wide:?}");
        assert!(wide.contains("Alt+N"), "wide={wide:?}");

        // Ultra-narrow 2 cells still keeps `⚠1`.
        let tiny = plain_spans(&render_activity_footer_badge(&summary, true, 2));
        assert_eq!(tiny, "⚠1");
    }
}
