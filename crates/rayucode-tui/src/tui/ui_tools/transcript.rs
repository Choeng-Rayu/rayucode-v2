use super::*;
use crate::tui::DisplayMessage;
use rayucode_tui_style::theme;
use std::borrow::Cow;

fn tool_label(tool: &ToolCall) -> &str {
    match canonical_tool_name(&tool.name) {
        "bash" | "shell" | "Bash" => "Bash",
        "read" | "file_read" | "Read" => "Read",
        "grep" | "Grep" => "Grep",
        "agentgrep" => "AgentGrep",
        "glob" | "Glob" => "Glob",
        "ls" | "list" | "list_directory" => "List",
        "edit" | "multiedit" => "Edit",
        "write" => "Write",
        "patch" | "apply_patch" => "Patch",
        "web_fetch" | "webfetch" => "WebFetch",
        "subagent" | "agent" => "Agent",
        "batch" => "Batch",
        _ => resolve_display_tool_name(&tool.name),
    }
}

pub(in crate::tui::ui) fn tool_header(
    tool: &ToolCall,
    subject: &str,
    color: Color,
    width: usize,
) -> Line<'static> {
    let label = tool_label(tool);
    let mut spans = vec![
        Span::styled("● ", Style::default().fg(color)),
        Span::styled(
            label.to_owned(),
            Style::default().fg(tool_category_color(&tool.name)).bold(),
        ),
    ];
    let subject = crate::message::strip_ansi_escape_sequences(subject);
    let subject = subject.split_whitespace().collect::<Vec<_>>().join(" ");
    let available = width.saturating_sub(label.width() + 4);
    if !subject.is_empty() && available > 0 {
        spans.push(Span::styled(
            format!("({})", truncate_end_display(&subject, available)),
            Style::default().fg(dim_color()),
        ));
    }
    super::super::truncate_line_with_ellipsis_to_width(&Line::from(spans), width)
}

pub(in crate::tui::ui) fn tool_category_color(name: &str) -> Color {
    use rayucode_tui_tool_display::ToolColorCategory::*;
    match rayucode_tui_tool_display::classify_tool_color_category(name) {
        Execute => theme::tool_execute_color(),
        Read => theme::tool_read_color(),
        Search => theme::tool_search_color(),
        Edit => theme::tool_edit_color(),
        Web => theme::tool_web_color(),
        Task => theme::tool_task_color(),
        Brand => theme::brand_color(),
    }
}

/// Give the call and its metrics separate width budgets so a long intent
/// or path cannot make the duration and token count disappear.
pub(in crate::tui::ui) fn tool_header_with_metrics(
    tool: &ToolCall,
    subject: &str,
    color: Color,
    width: usize,
    metrics: Vec<Span<'static>>,
) -> Vec<Line<'static>> {
    if metrics.is_empty() {
        return vec![tool_header(tool, subject, color, width)];
    }
    let metrics = Line::from(metrics);
    let minimum_header = tool_label(tool).width() + 2 + if subject.is_empty() { 0 } else { 5 };
    if minimum_header + 3 + metrics.width() <= width {
        let mut header = tool_header(tool, subject, color, width - 3 - metrics.width());
        header
            .spans
            .push(Span::styled(" · ", Style::default().fg(dim_color())));
        header.spans.extend(metrics.spans);
        vec![header]
    } else {
        let mut detail = Line::from(vec![Span::styled("  ⎿ ", Style::default().fg(dim_color()))]);
        detail.spans.extend(metrics.spans);
        vec![
            tool_header(tool, subject, color, width),
            super::super::truncate_line_with_ellipsis_to_width(&detail, width),
        ]
    }
}

pub(in crate::tui::ui) fn tool_response(text: impl Into<String>, width: usize) -> Line<'static> {
    super::super::truncate_line_with_ellipsis_to_width(
        &Line::from(vec![
            Span::styled("  ⎿ ", Style::default().fg(dim_color())),
            Span::styled(text.into(), Style::default().fg(dim_color())),
        ]),
        width,
    )
}

pub(in crate::tui::ui) fn compact_batch_subcall_lines(
    tool: &ToolCall,
    color: Color,
    width: usize,
    usage: Vec<Span<'static>>,
) -> Vec<Line<'static>> {
    let cells = width.saturating_sub(4);
    let mut rows =
        tool_header_with_metrics(tool, &tool_description(tool, cells), color, cells, usage);
    for row in &mut rows {
        row.spans.insert(0, Span::raw("    "));
    }
    rows
}

pub(in crate::tui::ui) fn running_metrics_on_header(width: usize) -> bool {
    width >= 40
}

pub(in crate::tui::ui) fn tool_description(tool: &ToolCall, cells: usize) -> Cow<'_, str> {
    if let Some(intent) = tool
        .intent
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Cow::Borrowed(intent)
    } else if is_shell_tool(tool) || tool.input.get("command").is_some() {
        Cow::Borrowed("Run command")
    } else if is_memory_store_tool(tool) {
        Cow::Borrowed("Save memory")
    } else if tool.name.starts_with("mcp__") {
        Cow::Borrowed("")
    } else {
        Cow::Owned(get_tool_summary_with_budget(tool, 50, Some(cells)))
    }
}

pub(in crate::tui::ui) fn running_tool_header(
    tool: &ToolCall,
    metrics: Line<'static>,
    width: usize,
) -> Line<'static> {
    let suffix = width.saturating_sub(metrics.width() + 3);
    let mut header = tool_header(
        tool,
        &tool_description(tool, width),
        super::super::accent_color(),
        suffix,
    );
    header
        .spans
        .push(Span::styled(" · ", Style::default().fg(dim_color())));
    header.spans.extend(metrics.spans);
    super::super::truncate_line_with_ellipsis_to_width(&header, width)
}

pub(in crate::tui::ui) fn tool_command_rows(tool: &ToolCall, width: usize) -> Vec<Line<'static>> {
    let Some(command) = tool
        .input
        .get("command")
        .and_then(serde_json::Value::as_str)
    else {
        return Vec::new();
    };
    let rows = output_rows(command, width, None);
    if rows.is_empty() {
        return rows;
    }
    let mut lines = vec![tool_response("Command", width)];
    lines.extend(rows);
    lines
}

pub(in crate::tui::ui) fn pending_tool_lines(
    message: &DisplayMessage,
    width: u16,
    progress: Option<&crate::protocol::BashProgress>,
    expanded: bool,
) -> Vec<Line<'static>> {
    let Some(tool) = &message.tool_data else {
        return Vec::new();
    };
    let centered = crate::tui::markdown::center_code_blocks();
    let block = if centered {
        super::super::centered_content_block_width(width, 96)
    } else {
        usize::from(width)
    };
    let cells = block.saturating_sub(1);
    let running = message.content == "Running…";
    let activity = if runs_in_background(tool) && running {
        "Starting in background…"
    } else {
        &message.content
    };
    let mut lines = vec![tool_header(
        tool,
        &tool_description(tool, cells),
        if running {
            super::super::accent_color()
        } else {
            dim_color()
        },
        cells,
    )];
    let metrics_below_header = running && !running_metrics_on_header(cells);
    if expanded || metrics_below_header {
        lines.push(tool_response(activity, cells));
    }
    if expanded {
        lines.extend(tool_command_rows(tool, cells));
        if let Some(progress) = progress {
            lines.extend(live_tool_output_rows(&progress.tail, cells));
        }
    }
    if centered {
        super::super::left_pad_lines_to_block_width(&mut lines, width, block);
    }
    lines
}

pub(in crate::tui::ui) fn live_tool_output_rows(output: &str, width: usize) -> Vec<Line<'static>> {
    let mut rows = Vec::new();
    for_each_output_row(output, width, true, |row| {
        rows.push(output_row(row, width, rows.is_empty()));
    });
    rows
}

fn output_row(text: String, width: usize, first: bool) -> Line<'static> {
    if first {
        tool_response(text, width)
    } else {
        Line::styled(format!("    {text}"), Style::default().fg(dim_color()))
    }
}

fn overflow_row(hidden: usize, width: usize) -> Line<'static> {
    super::super::truncate_line_with_ellipsis_to_width(
        &Line::styled(
            format!("    … +{hidden} lines"),
            Style::default().fg(dim_color()),
        ),
        width,
    )
}

pub(in crate::tui::ui) fn output_rows(
    output: &str,
    width: usize,
    limit: Option<usize>,
) -> Vec<Line<'static>> {
    let mut rows = Vec::new();
    let mut total = 0usize;
    for_each_output_row(output, width, false, |row| {
        if limit.is_none_or(|cap| total < cap) {
            rows.push(output_row(row, width, total == 0));
        }
        total += 1;
    });
    if let Some(cap) = limit
        && total > cap
    {
        rows.push(overflow_row(total - cap, width));
    }
    rows
}

fn for_each_output_row(
    output: &str,
    width: usize,
    carriage_return_updates: bool,
    mut append: impl FnMut(String),
) {
    use unicode_segmentation::UnicodeSegmentation;

    if width <= 4 {
        return;
    }
    let clean = crate::message::strip_ansi_escape_sequences(output);
    let cells = width - 4;
    for raw in clean.trim_end().lines() {
        let raw = if carriage_return_updates {
            raw.trim_end_matches('\r')
                .rsplit('\r')
                .next()
                .unwrap_or_default()
        } else {
            raw
        };
        let mut row = String::new();
        let mut used = 0usize;
        for grapheme in raw.graphemes(true) {
            let grapheme = if grapheme == "\t" { "    " } else { grapheme };
            if grapheme.chars().any(char::is_control) {
                continue;
            }
            let span = grapheme.width();
            if span > cells {
                continue;
            }
            if used + span > cells {
                append(std::mem::take(&mut row));
                used = 0;
            }
            row.push_str(grapheme);
            used += span;
        }
        append(row);
    }
}

pub(in crate::tui::ui) fn outcome_color(failed: bool, partial: bool) -> Color {
    match (failed, partial) {
        (true, _) => theme::error_color(),
        (_, true) => theme::warning_color(),
        _ => theme::success_color(),
    }
}

pub(in crate::tui::ui) fn is_shell_tool(tool: &ToolCall) -> bool {
    matches!(tool.name.as_str(), "bash" | "Bash" | "shell")
}

fn runs_in_background(tool: &ToolCall) -> bool {
    tool.input
        .get("run_in_background")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
}

pub(in crate::tui::ui) fn retained_tool_output<'a>(tool: &ToolCall, output: &'a str) -> &'a str {
    // The remote transcript tags the first line with the tool name. The
    // inline header already identifies the call.
    output
        .strip_prefix('[')
        .and_then(|text| text.strip_prefix(&tool.name))
        .and_then(|text| text.strip_prefix("] "))
        .unwrap_or(output)
}

pub(in crate::tui::ui) fn bash_result_output<'a>(tool: &ToolCall, output: &'a str) -> &'a str {
    let output = retained_tool_output(tool, output);
    if output.trim() == "Command completed successfully (no output)" {
        return "";
    }
    // The runner appends this status to the captured bytes. The failure row
    // shows the diagnostic separately from the output preview.
    if let Some((body, code)) = output.trim_end().rsplit_once("\n\nExit code: ")
        && code.parse::<i32>().is_ok_and(|code| code != 0)
    {
        return body;
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_bash_stream_is_visible_only_in_details() {
        let tool = ToolCall {
            id: "shell".into(),
            name: "bash".into(),
            intent: Some("Check the fixture".into()),
            input: serde_json::json!({"command": "printf example", "timeout": 90000}),
            ..Default::default()
        };
        let mut message = DisplayMessage::tool("Running…", tool);
        message.role = crate::tui::core::PENDING_TOOL_ROLE.into();
        let progress = crate::protocol::BashProgress {
            call_id: "shell".into(),
            elapsed_ms: 800,
            output_bytes: 13,
            tail: "fixture output".into(),
        };
        let compact = pending_tool_lines(&message, 80, Some(&progress), false);
        assert_eq!(compact.len(), 1);
        assert!(compact[0].to_string().contains("Bash(Check the fixture)"));
        let details = pending_tool_lines(&message, 80, Some(&progress), true)
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            details.contains("printf example") && details.contains("fixture output"),
            "{details}"
        );
        assert!(
            !details.contains("Arguments") && !details.contains("90000"),
            "{details}"
        );
    }

    #[test]
    fn live_tool_output_keeps_full_tail_and_replaces_carriage_return_updates() {
        let output = "old row\nsecond old row\n  indented 界\n10%\r\x1b[31m90%\x1b[0m\r\nfinished";
        let rows: Vec<_> = live_tool_output_rows(output, 50)
            .iter()
            .map(ToString::to_string)
            .collect();
        assert_eq!(
            rows,
            [
                "  ⎿ old row",
                "    second old row",
                "      indented 界",
                "    90%",
                "    finished"
            ]
        );
    }

    #[test]
    fn bash_preview_excludes_runner_exit_status() {
        let tool = ToolCall {
            name: "bash".into(),
            ..ToolCall::default()
        };
        let output = "[bash] warning line\nactual diagnostic\n\nExit code: 7";
        assert_eq!(
            bash_result_output(&tool, output),
            "warning line\nactual diagnostic"
        );
        assert!(
            bash_result_output(&tool, "[bash] Command completed successfully (no output)")
                .is_empty()
        );
    }

    #[test]
    fn bash_live_metrics_fit_below_the_header_in_a_short_terminal() {
        let usage = Line::from(live_tool_usage(
            std::time::Duration::from_millis(845),
            Some(92),
        ));
        let fitted = compact_tool_usage(usage, 14);
        assert_eq!(fitted.to_string(), "800ms ~23 tok");
        assert!(fitted.width() <= 14);
    }
}
