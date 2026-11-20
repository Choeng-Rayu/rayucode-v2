use super::*;
use crate::tui::DisplayMessage;
use rayucode_tui_style::theme;
use std::borrow::Cow;
use std::collections::VecDeque;

const BASH_PREVIEW_ROWS: usize = 3;

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

pub(in crate::tui::ui) fn bash_metrics_on_header(tool: &ToolCall, width: usize) -> bool {
    is_shell_tool(tool) && width >= 40
}

fn pending_tool_subject(tool: &ToolCall, cells: usize) -> Cow<'_, str> {
    if !is_edit_tool_name(&tool.name)
        && tool_label(tool) != "Read"
        && let Some(intent) = tool
            .intent
            .as_deref()
            .filter(|intent| !intent.trim().is_empty())
    {
        return Cow::Borrowed(intent);
    }
    Cow::Owned(get_tool_summary_with_budget(tool, 50, Some(cells)))
}

pub(in crate::tui::ui) fn running_bash_header(
    tool: &ToolCall,
    metrics: Line<'static>,
    width: usize,
) -> Line<'static> {
    let suffix = width.saturating_sub(metrics.width() + 3);
    let mut header = tool_header(
        tool,
        &pending_tool_subject(tool, width),
        super::super::accent_color(),
        suffix,
    );
    header
        .spans
        .push(Span::styled(" · ", Style::default().fg(dim_color())));
    header.spans.extend(metrics.spans);
    super::super::truncate_line_with_ellipsis_to_width(&header, width)
}

/// Show the first command line in full context, with an end ellipsis for
/// longer commands. The result marker is reserved for output and status.
pub(in crate::tui::ui) fn inline_bash_command(
    tool: &ToolCall,
    width: usize,
) -> Option<Line<'static>> {
    if width < 26 || !is_shell_tool(tool) || !show_tool_call_details() {
        return None;
    }
    let command = tool.input.get("command")?.as_str()?;
    let command = crate::message::strip_ansi_escape_sequences(command);
    let mut source = command.trim().lines();
    let first: String = source
        .next()?
        .chars()
        .map(|c| if c == '\t' { ' ' } else { c })
        .filter(|c| !c.is_control())
        .collect();
    let continuation = if source.next().is_some() { " …" } else { "" };
    Some(super::super::truncate_line_with_ellipsis_to_width(
        &Line::styled(
            format!("    Command  {first}{continuation}"),
            Style::default().fg(dim_color()),
        ),
        width,
    ))
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
        &pending_tool_subject(tool, cells),
        dim_color(),
        cells,
    )];
    let preview = progress.map_or_else(Vec::new, |progress| {
        if expanded {
            output_rows(&progress.tail, cells, None)
        } else {
            live_bash_output_rows(progress, cells)
        }
    });
    let inline_metrics = running && bash_metrics_on_header(tool, cells);
    if !inline_metrics {
        lines.push(tool_response(activity, cells));
    }
    if expanded {
        lines.extend(full_tool_argument_rows(tool, cells));
    } else {
        lines.extend(inline_bash_command(tool, cells));
    }
    if inline_metrics && preview.is_empty() {
        lines.push(tool_response(activity, cells));
    }
    lines.extend(preview);
    if centered {
        super::super::left_pad_lines_to_block_width(&mut lines, width, block);
    }
    lines
}

pub(in crate::tui::ui) fn full_tool_argument_rows(
    tool: &ToolCall,
    width: usize,
) -> Vec<Line<'static>> {
    if tool.input.is_null() || tool.input.as_object().is_some_and(|input| input.is_empty()) {
        return Vec::new();
    }
    let mut rows = vec![tool_response("Arguments", width)];
    if is_shell_tool(tool)
        && let Some(command) = tool
            .input
            .get("command")
            .and_then(serde_json::Value::as_str)
    {
        rows.extend(output_rows(command, width, None));
        let mut options = tool.input.clone();
        if let Some(options) = options.as_object_mut() {
            options.remove("command");
        }
        if options
            .as_object()
            .is_some_and(|options| options.is_empty())
        {
            return rows;
        }
        rows.extend(output_rows(&options.to_string(), width, None));
    } else if let Ok(arguments) = serde_json::to_string_pretty(&tool.input) {
        rows.extend(output_rows(&arguments, width, None));
    }
    rows
}

pub(in crate::tui::ui) fn live_bash_output_rows(
    progress: &crate::protocol::BashProgress,
    width: usize,
) -> Vec<Line<'static>> {
    if width < 22 || !show_bash_output() {
        return Vec::new();
    }
    bash_preview_rows(&progress.tail, width, false)
}

fn bash_preview_rows(output: &str, width: usize, show_overflow: bool) -> Vec<Line<'static>> {
    let mut tail = VecDeque::with_capacity(BASH_PREVIEW_ROWS);
    let mut hidden = 0usize;
    for_each_output_row(output, width, true, |row| {
        if tail.len() == BASH_PREVIEW_ROWS {
            tail.pop_front();
            hidden += 1;
        }
        tail.push_back(row);
    });
    let mut rows: Vec<_> = tail
        .into_iter()
        .enumerate()
        .map(|(index, row)| output_row(row, width, index == 0))
        .collect();
    if show_overflow && hidden > 0 {
        rows.push(overflow_row(hidden, width));
    }
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

pub(in crate::tui::ui) fn compact_tool_result_rows(
    tool: &ToolCall,
    output: &str,
    width: usize,
) -> Vec<Line<'static>> {
    if is_shell_tool(tool) && show_bash_output() {
        let rows = bash_preview_rows(bash_result_output(tool, output), width, true);
        if rows.is_empty() {
            return vec![tool_response("(No output)", width)];
        }
        return rows;
    }
    read_search_result_summary(tool, output)
        .map(|summary| vec![tool_response(summary, width)])
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bash_preview_uses_same_tail_while_running_and_finished() {
        let output = "old row\nsecond old row\n  indented 界\n10%\r\x1b[31m90%\x1b[0m\r\nfinished";
        let live = bash_preview_rows(output, 50, false);
        let finished = bash_preview_rows(output, 50, true);
        let live: Vec<_> = live.iter().map(ToString::to_string).collect();
        let finished: Vec<_> = finished.iter().map(ToString::to_string).collect();
        assert_eq!(live, ["  ⎿   indented 界", "    90%", "    finished"]);
        assert_eq!(&finished[..3], &live);
        assert_eq!(finished[3], "    … +2 lines");
    }

    #[test]
    fn inline_bash_command_keeps_command_start_and_distinct_label() {
        let tool = ToolCall {
            name: "bash".into(),
            input: serde_json::json!({ "command":
                "printf\t'coherent command context that exceeds width'; printf trailing_code\nnext command"
            }),
            ..ToolCall::default()
        };
        let configured = tests_tool_call_details_override::get();
        tests_tool_call_details_override::set(true);
        let line = inline_bash_command(&tool, 40).unwrap();
        tests_tool_call_details_override::set(configured);
        let text = line.to_string();
        assert!(text.starts_with("    Command  printf 'coherent"), "{text}");
        assert!(text.ends_with('…'), "{text}");
        assert!(line.width() <= 40);
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
