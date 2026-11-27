import * as React from "react";
import {
  BookOpen,
  Box,
  Brain,
  Calendar,
  ChevronRight,
  Clock,
  Code2,
  ExternalLink,
  FileDiff,
  FileSearch,
  FileText,
  Globe,
  Layers,
  LayoutPanelLeft,
  ListTodo,
  Mail,
  MessageSquare,
  Monitor,
  Network,
  Plug,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";

import { Badge, Button, TechFileBadge } from "@/components/ui";
import { basenameOf, cn, postToHost, useAppStore } from "@/lib";

/**
 * Complete catalog of all 45 Rust built-in engine tools grouped into the 8
 * Quiet-Signal domain categories required by Spec 02.
 */
export const ALL_45_RUST_TOOLS = [
  // 1. Files/Edit/Patch/AgentGrep (8)
  "read",
  "read_file",
  "edit",
  "edit_file",
  "write",
  "write_file",
  "apply_patch",
  "agentgrep",
  // 2. Bash/Bg (4)
  "bash",
  "run_command",
  "bg",
  "list_files",
  // 3. Browser/WebFetch/WebSearch/Open/macOS (6)
  "browser",
  "webfetch",
  "websearch",
  "open",
  "macos_computer_use",
  "view_image",
  // 4. Todo/Memory/SessionSearch (5)
  "todo",
  "memory",
  "session_search",
  "conversation_search",
  "search_files",
  // 5. Panel/AskUser (5)
  "panel",
  "side_panel",
  "applet",
  "ask_user_question",
  "user_response",
  // 6. Gmail/Calendar/Schedule (4)
  "gmail",
  "calendar",
  "schedule",
  "integration_tools",
  // 7. Docs/Feedback/SelfDev (5)
  "rayu_docs",
  "maintainer_feedback",
  "selfdev",
  "desktop_selfdev",
  "skill_manage",
  // 8. Swarm/Overnight/Codemode/MCP (8)
  "swarm",
  "overnight",
  "codemode",
  "batch",
  "mcp_tool",
  "mcp_resource",
  "mcp_prompt",
  "ambient",
] as const;

export type RustToolName = (typeof ALL_45_RUST_TOOLS)[number] | string;

export type ToolDomainGroup =
  | "files_edit_patch_grep"
  | "bash_bg"
  | "browser_web_macos"
  | "todo_memory_search"
  | "panel_ask_user"
  | "gmail_calendar_schedule"
  | "docs_feedback_selfdev"
  | "swarm_overnight_codemode_mcp";

export interface ToolDomainMeta {
  group: ToolDomainGroup;
  groupLabel: string;
  pillClass: string;
  actionLabel?: string;
}

export function classifyRustTool(toolName: string): ToolDomainMeta {
  const lower = toolName.trim().toLowerCase();

  if (
    lower === "read" ||
    lower === "read_file" ||
    lower === "edit" ||
    lower === "edit_file" ||
    lower === "write" ||
    lower === "write_file" ||
    lower === "apply_patch" ||
    lower === "agentgrep" ||
    lower === "list_files" ||
    lower === "search_files" ||
    lower === "grep" ||
    lower === "rg"
  ) {
    return {
      group: "files_edit_patch_grep",
      groupLabel: "Files & Patch",
      pillClass: "bg-pill-read-bg text-pill-read-fg",
      actionLabel:
        lower === "edit" ||
        lower === "edit_file" ||
        lower === "write" ||
        lower === "write_file" ||
        lower === "apply_patch"
          ? "Open Diff"
          : "Open File",
    };
  }

  if (
    lower === "bash" ||
    lower === "run_command" ||
    lower === "shell" ||
    lower === "bg"
  ) {
    return {
      group: "bash_bg",
      groupLabel: "Execution",
      pillClass: "bg-brand-softer text-brand-text",
      actionLabel: lower === "bg" ? "Open Process Viewer" : undefined,
    };
  }

  if (
    lower === "browser" ||
    lower === "webfetch" ||
    lower === "websearch" ||
    lower === "open" ||
    lower === "macos_computer_use" ||
    lower === "view_image"
  ) {
    return {
      group: "browser_web_macos",
      groupLabel: "Browser & Web",
      pillClass: "bg-info-soft text-info",
      actionLabel: "Open URL",
    };
  }

  if (
    lower === "todo" ||
    lower === "memory" ||
    lower === "session_search" ||
    lower === "conversation_search"
  ) {
    return {
      group: "todo_memory_search",
      groupLabel: "Todo & Memory",
      pillClass: "bg-pill-think-bg text-pill-think-fg",
      actionLabel:
        lower === "todo"
          ? undefined
          : lower === "memory"
            ? "Open Memory Graph"
            : "View Sessions",
    };
  }

  if (
    lower === "panel" ||
    lower === "side_panel" ||
    lower === "applet" ||
    lower === "ask_user_question" ||
    lower === "user_response"
  ) {
    return {
      group: "panel_ask_user",
      groupLabel: "Panel & Interactive",
      pillClass: "bg-pill-edit-bg text-pill-edit-fg",
      actionLabel: undefined,
    };
  }

  if (
    lower === "gmail" ||
    lower === "calendar" ||
    lower === "schedule" ||
    lower === "integration_tools"
  ) {
    return {
      group: "gmail_calendar_schedule",
      groupLabel: "Workspace & Schedule",
      pillClass: "bg-warn-soft text-warn",
      actionLabel:
        lower === "schedule" ? "Open Schedules" : "Open Integrations",
    };
  }

  if (
    lower === "rayu_docs" ||
    lower === "maintainer_feedback" ||
    lower === "selfdev" ||
    lower === "desktop_selfdev" ||
    lower === "skill_manage"
  ) {
    return {
      group: "docs_feedback_selfdev",
      groupLabel: "Docs & Self-Dev",
      pillClass: "bg-active text-body",
      actionLabel: lower === "skill_manage" ? "Open Skills" : "Open Settings",
    };
  }

  return {
    group: "swarm_overnight_codemode_mcp",
    groupLabel: "Swarm, Codemode & MCP",
    pillClass: "bg-pill-grep-bg text-pill-grep-fg",
    actionLabel:
      lower === "swarm"
        ? "Open Swarm"
        : lower === "overnight" || lower === "ambient"
          ? "Open Automations"
          : lower.startsWith("mcp")
            ? "Open MCP"
            : undefined,
  };
}

function ToolIcon({ toolName }: { toolName: string }) {
  const lower = toolName.trim().toLowerCase();
  const cls = "size-3.5 shrink-0 text-muted-ink";

  if (
    lower === "edit" ||
    lower === "edit_file" ||
    lower === "write" ||
    lower === "write_file" ||
    lower === "apply_patch"
  ) {
    return <FileDiff className={cls} aria-hidden="true" />;
  }
  if (lower === "read" || lower === "read_file") {
    return <BookOpen className={cls} aria-hidden="true" />;
  }
  if (
    lower === "agentgrep" ||
    lower === "search_files" ||
    lower === "grep" ||
    lower === "rg"
  ) {
    return <Search className={cls} aria-hidden="true" />;
  }
  if (lower === "session_search" || lower === "conversation_search") {
    return <FileSearch className={cls} aria-hidden="true" />;
  }
  if (lower === "bash" || lower === "run_command" || lower === "shell") {
    return <Terminal className={cls} aria-hidden="true" />;
  }
  if (lower === "bg") {
    return <Layers className={cls} aria-hidden="true" />;
  }
  if (lower === "browser" || lower === "webfetch" || lower === "websearch" || lower === "open") {
    return <Globe className={cls} aria-hidden="true" />;
  }
  if (lower === "macos_computer_use" || lower === "view_image") {
    return <Monitor className={cls} aria-hidden="true" />;
  }
  if (lower === "todo") {
    return <ListTodo className={cls} aria-hidden="true" />;
  }
  if (lower === "memory") {
    return <Brain className={cls} aria-hidden="true" />;
  }
  if (lower === "panel" || lower === "side_panel" || lower === "applet") {
    return <LayoutPanelLeft className={cls} aria-hidden="true" />;
  }
  if (lower === "ask_user_question" || lower === "user_response") {
    return <MessageSquare className={cls} aria-hidden="true" />;
  }
  if (lower === "gmail") {
    return <Mail className={cls} aria-hidden="true" />;
  }
  if (lower === "calendar") {
    return <Calendar className={cls} aria-hidden="true" />;
  }
  if (lower === "schedule" || lower === "overnight" || lower === "ambient") {
    return <Clock className={cls} aria-hidden="true" />;
  }
  if (lower === "swarm") {
    return <Network className={cls} aria-hidden="true" />;
  }
  if (lower === "codemode" || lower === "batch") {
    return <Code2 className={cls} aria-hidden="true" />;
  }
  if (lower.startsWith("mcp")) {
    return <Plug className={cls} aria-hidden="true" />;
  }
  if (lower === "rayu_docs") {
    return <FileText className={cls} aria-hidden="true" />;
  }
  if (lower === "skill_manage") {
    return <Box className={cls} aria-hidden="true" />;
  }
  if (lower === "selfdev" || lower === "desktop_selfdev" || lower === "maintainer_feedback") {
    return <Wrench className={cls} aria-hidden="true" />;
  }
  return <Sparkles className={cls} aria-hidden="true" />;
}

export interface ToolStepCardData {
  id: string;
  toolName: RustToolName;
  intent: string;
  status?: "running" | "completed" | "failed";
  durationLabel?: string;
  filePath?: string;
  line?: number;
  additions?: number;
  deletions?: number;
  url?: string;
  payloadJson?: string;
  output?: string;
  subSteps?: Array<{ id: string; label: string; status: "completed" | "running" | "failed" }>;
}

export interface ToolStepCardProps {
  step: ToolStepCardData;
  defaultExpanded?: boolean;
  className?: string;
}

export function ToolStepCard({
  step,
  defaultExpanded = false,
  className,
}: ToolStepCardProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const meta = React.useMemo(
    () => classifyRustTool(step.toolName),
    [step.toolName],
  );

  const status = step.status ?? "completed";
  const isEditTool =
    step.toolName === "edit" ||
    step.toolName === "edit_file" ||
    step.toolName === "write" ||
    step.toolName === "write_file" ||
    step.toolName === "apply_patch";

  const handleContextualJump = (e: React.MouseEvent) => {
    e.stopPropagation();
    const store = useAppStore.getState();
    const lower = step.toolName.toLowerCase();

    if (step.filePath) {
      if (isEditTool) {
        postToHost({
          type: "rayucode.editor.openDiff",
          path: step.filePath,
          sessionId: store.activeSessionId ?? undefined,
          scope: "session",
        });
      } else {
        postToHost({
          type: "rayucode.editor.openFile",
          path: step.filePath,
          line: step.line,
        });
      }
      return;
    }

    if (step.url) {
      postToHost({
        type: "rayucode.editor.openExternal",
        url: step.url,
      });
      return;
    }

    if (lower === "bg") {
      store.setBackgroundDrawerOpen(true);
    } else if (lower === "swarm") {
      store.setActiveRoute("swarm");
    } else if (lower === "schedule" || lower === "overnight" || lower === "ambient") {
      store.setActiveRoute("automations");
    } else if (
      lower === "memory" ||
      lower === "skill_manage" ||
      lower.startsWith("mcp") ||
      lower === "gmail" ||
      lower === "calendar" ||
      lower === "integration_tools"
    ) {
      store.setActiveRoute("plugins");
    } else if (lower === "selfdev" || lower === "desktop_selfdev") {
      store.setActiveRoute("settings");
    }
  };

  return (
    <div
      data-slot="tool-step-card"
      data-testid={`tool-step-${step.id}`}
      data-tool-name={step.toolName}
      data-tool-group={meta.group}
      className={cn("flex flex-col", className)}
    >
      {/* Depth 1: Single calm timeline row */}
      <div className="-ml-2 flex items-center gap-2 rounded-[9px] px-2 py-1 text-[13px] leading-[1.4] transition-colors hover:bg-hover/70">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-muted-ink hover:text-ink focus-visible:outline-none"
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              status === "failed"
                ? "bg-danger"
                : status === "running"
                  ? "animate-pulse bg-brand"
                  : "bg-muted-ink/70",
            )}
            aria-hidden="true"
          />
          <ToolIcon toolName={step.toolName} />
          {step.filePath && (
            <TechFileBadge path={step.filePath} className="size-3.5" />
          )}
          <span className="min-w-0 flex-1 truncate text-body">
            {step.intent}
          </span>
          {step.filePath && (
            <span className="shrink-0 font-mono text-xs text-ink">
              {basenameOf(step.filePath)}
              {step.line ? `:${step.line}` : ""}
            </span>
          )}
          {(step.additions !== undefined || step.deletions !== undefined) && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums">
              <span className="text-brand-text">+{step.additions ?? 0}</span>{" "}
              <span className="text-danger">-{step.deletions ?? 0}</span>
            </span>
          )}
          {step.durationLabel && (
            <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">
              {step.durationLabel}
            </span>
          )}
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-ink transition-transform duration-150",
              expanded && "rotate-90 text-ink",
            )}
            aria-hidden="true"
          />
        </button>

        {(step.filePath || step.url || meta.actionLabel) && (
          <button
            type="button"
            data-testid={`tool-step-jump-${step.id}`}
            onClick={handleContextualJump}
            className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] font-medium text-brand-text transition-colors hover:bg-brand-soft hover:underline"
          >
            {meta.actionLabel ?? "Inspect"}
          </button>
        )}
      </div>

      {/* Depth 2: Expanded tool detail card */}
      {expanded && (
        <div
          data-testid={`tool-step-detail-${step.id}`}
          className="my-1.5 overflow-hidden rounded-xl border border-hairline bg-inset p-3 text-xs shadow-bevel-surface"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10.5px]">
                {step.toolName}
              </Badge>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                  meta.pillClass,
                )}
              >
                {meta.groupLabel}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {(step.filePath || step.url || meta.actionLabel) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={handleContextualJump}
                >
                  <ExternalLink className="size-3" aria-hidden="true" />
                  <span>{meta.actionLabel ?? "Open"}</span>
                </Button>
              )}
            </div>
          </div>

          {step.subSteps && step.subSteps.length > 0 && (
            <div className="mb-2 flex flex-col gap-1 border-l border-hairline pl-3">
              {step.subSteps.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center gap-2 text-[11.5px] text-body"
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      sub.status === "failed"
                        ? "bg-danger"
                        : sub.status === "running"
                          ? "bg-brand"
                          : "bg-brand-text",
                    )}
                  />
                  <span>{sub.label}</span>
                </div>
              ))}
            </div>
          )}

          {step.output ? (
            <pre className="m-0 max-h-48 overflow-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-body">
              {step.output}
            </pre>
          ) : (
            <p className="m-0 text-[11.5px] text-muted-ink">{step.intent}</p>
          )}
        </div>
      )}
    </div>
  );
}
