use super::*;
use crate::tui::DisplayMessage;
use rayucode_tui_style::theme;

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

pub(in crate::tui::ui) fn pending_tool_lines(
    message: &DisplayMessage,
    width: u16,
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
    let fallback = get_tool_summary_with_budget(tool, 50, Some(cells));
    let subject = tool
        .intent
        .as_deref()
        .filter(|intent| !intent.trim().is_empty())
        .unwrap_or(&fallback);
    let activity = if runs_in_background(tool) && message.content == "Running…" {
        "Starting in background…"
    } else {
        &message.content
    };
    let mut lines = vec![
        tool_header(tool, subject, dim_color(), cells),
        tool_response(activity, cells),
    ];
    lines.extend(codemode_preview(tool, cells));
    if centered {
        super::super::left_pad_lines_to_block_width(&mut lines, width, block);
    }
    lines
}

pub(in crate::tui::ui) fn output_rows(
    output: &str,
    width: usize,
    limit: Option<usize>,
) -> Vec<Line<'static>> {
    use unicode_segmentation::UnicodeSegmentation;

    if width <= 4 {
        return Vec::new();
    }
    let clean = crate::message::strip_ansi_escape_sequences(output);
    let cells = width - 4;
    let mut rows = Vec::new();
    let mut total = 0usize;
    let mut append = |text: String, total: &mut usize| {
        if limit.is_none_or(|cap| *total < cap) {
            if *total == 0 {
                rows.push(tool_response(text, width));
            } else {
                rows.push(Line::styled(
                    format!("    {text}"),
                    Style::default().fg(dim_color()),
                ));
            }
        }
        *total += 1;
    };
    for raw in clean.trim_end().lines() {
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
                append(std::mem::take(&mut row), &mut total);
                used = 0;
            }
            if limit.is_none_or(|cap| total < cap) {
                row.push_str(grapheme);
            }
            used += span;
        }
        append(row, &mut total);
    }
    if let Some(cap) = limit
        && total > cap
    {
        rows.push(super::super::truncate_line_with_ellipsis_to_width(
            &Line::styled(
                format!("    … +{} lines", total - cap),
                Style::default().fg(dim_color()),
            ),
            width,
        ));
    }
    rows
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

pub(in crate::tui::ui) fn read_search_result_summary(
    tool: &ToolCall,
    output: &str,
) -> Option<String> {
    let output = retained_tool_output(tool, output);
    let count_label = |count, single, plural| if count == 1 { single } else { plural };
    match tool_label(tool) {
        "Read" => {
            let lines = output
                .lines()
                .filter(|line| {
                    line.split_once('\t')
                        .is_some_and(|(number, _)| number.trim().parse::<usize>().is_ok())
                })
                .count();
            if lines > 0 {
                Some(format!(
                    "Read {lines} {}",
                    count_label(lines, "line", "lines")
                ))
            } else if output.trim() == "(empty file)" {
                Some("Empty file".into())
            } else {
                None
            }
        }
        "Grep" | "Glob" | "List" | "AgentGrep" => output.lines().map(str::trim).find_map(|line| {
            if let Some(count) = line.strip_prefix("matches: ") {
                if let Some((matches, files)) = count.split_once(" in ") {
                    let matches = matches.parse::<usize>().ok()?;
                    let files = files.split_whitespace().next()?.parse::<usize>().ok()?;
                    return Some(format!(
                        "Found {matches} {} in {files} {}",
                        count_label(matches, "match", "matches"),
                        count_label(files, "file", "files"),
                    ));
                }
                return Some(format!("Matches: {count}"));
            }
            (line.starts_with("Found ")
                || line.starts_with("No ")
                || line.starts_with("Listed ")
                || line
                    .split_whitespace()
                    .next()
                    .is_some_and(|count| count.parse::<usize>().is_ok())
                    && (line.contains("match") || line.contains("file")))
            .then(|| line.to_owned())
        }),
        _ => None,
    }
}
