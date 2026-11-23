import * as React from "react";
import {
  BookOpen,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  Hand,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Monitor,
  Search,
  Wrench,
} from "lucide-react";

import { RayuProcessingMark, TechFileBadge } from "@/components/ui";
import {
  callRpc,
  cn,
  postToHost,
  useAppStore,
  type FileReadStep,
  type FileReadTarget,
  type InlineDiffCardData,
  type ListStep,
  type ShellCommandStep,
  type TraceStepItem,
  type WorkStepGroup,
} from "@/lib";

import { EditorialMarkdown } from "./EditorialMarkdown";
import { InlineDiffCard } from "./InlineDiffCard";
import { ShellCard } from "./ShellCard";
import { ToolStepCard, type ToolStepCardData } from "./ToolStepCard";

export type WorkPreviewDocKind =
  | "browser"
  | "excel"
  | "markdown"
  | "slide"
  | "diagram"
  | "pdf"
  | "html";

export interface ExtendedWorkStepGroup extends WorkStepGroup {
  toolSteps?: ToolStepCardData[];
  diffCards?: InlineDiffCardData[];
}

export interface WorkTraceSummaryMetrics {
  fileCount: number;
  cmdCount: number;
  toolCount: number;
  summaryText: string;
}

/**
 * Coalesces consecutive `read` steps within a step list so that consecutive file reads
 * never render as stacked tool-call walls, merging them into a single
 * "Explored N files" step with deduplicated file targets.
 */
export function coalesceTraceSteps(steps: TraceStepItem[]): TraceStepItem[] {
  const out: TraceStepItem[] = [];

  for (const step of steps) {
    const prev = out[out.length - 1];
    if (step.kind === "read" && prev && prev.kind === "read") {
      const existingKeys = new Set(
        prev.files.map((f) => `${f.path}:${f.line}`),
      );
      const mergedFiles: FileReadTarget[] = [...prev.files];
      for (const file of step.files) {
        const key = `${file.path}:${file.line}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          mergedFiles.push(file);
        }
      }
      out[out.length - 1] = {
        ...prev,
        label:
          mergedFiles.length > 1
            ? `Explored ${mergedFiles.length} files`
            : prev.label,
        files: mergedFiles,
      };
    } else if (step.kind === "read" && step.files.length > 1) {
      out.push({
        ...step,
        label:
          step.label === "Read"
            ? `Explored ${step.files.length} files`
            : step.label,
      });
    } else {
      out.push(step);
    }
  }

  return out;
}

/**
 * Coalesces consecutive read/search/list groups and merges consecutive FileReadSteps.
 */
export function coalesceTraceGroups(
  groups: ExtendedWorkStepGroup[],
): ExtendedWorkStepGroup[] {
  const mergedGroups: ExtendedWorkStepGroup[] = [];

  for (const group of groups) {
    const coalescedSteps = coalesceTraceSteps(group.steps);
    const prev = mergedGroups[mergedGroups.length - 1];
    const isReadOrSearchGroup =
      group.steps.length > 0 &&
      group.steps.every(
        (s) => s.kind === "read" || s.kind === "search" || s.kind === "list",
      ) &&
      (!group.toolSteps || group.toolSteps.length === 0) &&
      (!group.diffCards || group.diffCards.length === 0);

    const prevIsReadOrSearchGroup =
      prev &&
      prev.steps.length > 0 &&
      prev.steps.every(
        (s) => s.kind === "read" || s.kind === "search" || s.kind === "list",
      ) &&
      (!prev.toolSteps || prev.toolSteps.length === 0) &&
      (!prev.diffCards || prev.diffCards.length === 0);

    if (isReadOrSearchGroup && prevIsReadOrSearchGroup && prev) {
      const combinedSteps = coalesceTraceSteps([
        ...prev.steps,
        ...coalescedSteps,
      ]);
      const readFilesCount = combinedSteps.reduce(
        (acc, s) => (s.kind === "read" ? acc + s.files.length : acc),
        0,
      );
      mergedGroups[mergedGroups.length - 1] = {
        ...prev,
        title:
          readFilesCount > 1
            ? `Explored ${readFilesCount} files`
            : prev.title,
        steps: combinedSteps,
      };
    } else {
      mergedGroups.push({
        ...group,
        steps: coalescedSteps,
      });
    }
  }

  return mergedGroups;
}

export function summarizeWorkTraceMetrics(
  workedDuration: string,
  groups: ExtendedWorkStepGroup[],
): WorkTraceSummaryMetrics {
  const uniqueFiles = new Set<string>();
  let cmdCount = 0;
  let toolCount = 0;

  for (const group of groups) {
    for (const step of group.steps) {
      toolCount += 1;
      if (step.kind === "read") {
        for (const f of step.files) {
          uniqueFiles.add(f.path);
        }
      } else if (step.kind === "command") {
        if (step.isMono !== false) {
          cmdCount += 1;
        }
      }
    }
    for (const ts of group.toolSteps ?? []) {
      toolCount += 1;
      if (ts.filePath) {
        uniqueFiles.add(ts.filePath);
      }
      if (
        ts.toolName === "bash" ||
        ts.toolName === "run_command" ||
        ts.toolName === "bg"
      ) {
        cmdCount += 1;
      }
    }
    for (const dc of group.diffCards ?? []) {
      uniqueFiles.add(dc.file);
    }
  }

  const fileCount = uniqueFiles.size;
  const parts: string[] = [`Worked for ${workedDuration}`];
  if (fileCount > 0) {
    parts.push(`${fileCount} ${fileCount === 1 ? "file" : "files"}`);
  }
  if (cmdCount > 0) {
    parts.push(`${cmdCount} ${cmdCount === 1 ? "cmd" : "cmds"}`);
  }

  return {
    fileCount,
    cmdCount,
    toolCount,
    summaryText: parts.join(" · "),
  };
}

export interface WorkTraceProps {
  workedDuration: string;
  isLive?: boolean;
  connectionPhaseLabel?: string | null;
  notes: string[];
  groups: ExtendedWorkStepGroup[];
  activeToolStatus?: string | null;
  showLiveBackgroundPill?: boolean;
  sessionId?: string;
  defaultExpanded?: boolean;
  defaultOpenShellIds?: string[];
  onOpenCodeFile?: (file: string, line?: number | null) => void;
  onOpenDocPreview?: (kind: WorkPreviewDocKind, pillLabel: string) => void;
  onBackgroundTool?: () => void;
  className?: string;
}

function TraceGroupIcon({ title }: { title: string }) {
  const lower = title.toLowerCase();
  const iconClass = "size-[15px] shrink-0 text-muted-ink";
  if (lower.includes("loaded a tool") || lower.includes("skill")) {
    return <Wrench className={iconClass} aria-hidden="true" />;
  }
  if (lower.includes("searched")) {
    return <Search className={iconClass} aria-hidden="true" />;
  }
  if (
    lower.includes("viewed an image") ||
    lower.includes("viewed ") ||
    lower.includes("preview")
  ) {
    return <ImageIcon className={iconClass} aria-hidden="true" />;
  }
  if (lower.includes("browser") || lower.includes("computer use")) {
    return <Monitor className={iconClass} aria-hidden="true" />;
  }
  if (lower.includes("permission")) {
    return <Hand className={iconClass} aria-hidden="true" />;
  }
  if (
    lower.includes("inspect") ||
    lower.includes("import") ||
    lower.includes("artifact") ||
    lower.includes("integration")
  ) {
    return <LayoutGrid className={iconClass} aria-hidden="true" />;
  }
  if (lower.includes("ran a command") || lower.includes("ran command")) {
    return <Monitor className={iconClass} aria-hidden="true" />;
  }
  return <BookOpen className={iconClass} aria-hidden="true" />;
}

function renderFileReadStep(
  step: FileReadStep,
  onOpenCodeFile: (file: string, line?: number | null) => void,
  onOpenDocPreview: (kind: WorkPreviewDocKind, pillLabel: string) => void,
) {
  const isSkillStep = step.label.toLowerCase().includes("skill");

  return (
    <div
      key={step.id}
      data-slot="work-step-read"
      data-testid={`work-step-read-${step.id}`}
      className="-ml-2 flex w-full flex-wrap items-center gap-1.5 rounded-[9px] px-2 py-1 text-[13px] leading-[1.4] text-muted-ink"
    >
      {isSkillStep ? (
        <Wrench
          className="size-3.5 shrink-0 text-muted-ink"
          aria-hidden="true"
        />
      ) : (
        <BookOpen
          className="size-3.5 shrink-0 text-muted-ink"
          aria-hidden="true"
        />
      )}
      <span>{step.label}</span>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {step.files.map((target, idx) => {
          const lower = target.file.toLowerCase();
          const isMarkdown = lower.endsWith(".md");
          const isExcel = lower.endsWith(".xlsx");
          const isSlide =
            lower.endsWith(".pptx") || lower.includes("slide");
          return (
            <React.Fragment key={`${step.id}-${target.path}-${target.line}`}>
              {idx > 0 && <span className="text-faint">·</span>}
              <button
                type="button"
                data-testid={`trace-file-link-${target.path}`}
                onClick={() => {
                  postToHost({
                    type: "rayucode.editor.openFile",
                    path: target.path,
                    line: target.line,
                  });
                  if (isSlide) {
                    onOpenDocPreview("slide", "Slide");
                  } else if (isMarkdown) {
                    onOpenDocPreview("markdown", target.file);
                  } else if (isExcel) {
                    onOpenDocPreview("excel", target.file);
                  } else {
                    onOpenCodeFile(target.path, target.line);
                  }
                }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-[5px] border border-hairline-soft bg-inset px-1.5 py-0.5 font-mono text-xs text-body transition-colors hover:border-premium hover:bg-active hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <TechFileBadge path={target.path} className="size-3.5" />
                <span>{target.rangeLabel}</span>
              </button>
            </React.Fragment>
          );
        })}
      </span>
    </div>
  );
}

function renderListOrPreviewStep(
  step: ListStep,
  onOpenDocPreview: (kind: WorkPreviewDocKind, pillLabel: string) => void,
) {
  if (step.kind === "previews") {
    return (
      <div
        key={step.id}
        data-slot="work-step-previews"
        className="flex flex-col gap-1.5"
      >
        {step.text ? (
          <div className="-ml-2 flex w-full items-center gap-2 rounded-[9px] px-2 py-1 text-[13px] leading-[1.4] text-muted-ink">
            <ImageIcon
              className="size-3.5 shrink-0 text-muted-ink"
              aria-hidden="true"
            />
            <span>{step.text}</span>
          </div>
        ) : null}
        {step.previews && step.previews.length > 0 && (
          <div className="flex items-stretch gap-2.5 overflow-x-auto pt-1 pb-0.5">
            {step.previews.map((thumb) => (
              <button
                key={thumb.id}
                type="button"
                onClick={() =>
                  onOpenDocPreview(
                    thumb.kind as WorkPreviewDocKind,
                    thumb.pillLabel,
                  )
                }
                className="flex h-[70px] w-[112px] shrink-0 cursor-pointer flex-col justify-between rounded-lg border border-premium bg-pane px-2 py-[7px] text-left transition-all hover:-translate-y-px hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1 font-mono text-[10px] text-muted-ink">
                  {thumb.kind === "excel" && (
                    <FileSpreadsheet
                      className="size-[11px] shrink-0 text-office-excel"
                      aria-hidden="true"
                    />
                  )}
                  {(thumb.kind === "markdown" ||
                    thumb.kind === "pdf" ||
                    thumb.kind === "html") && (
                    <FileText
                      className="size-[11px] shrink-0 text-code-type"
                      aria-hidden="true"
                    />
                  )}
                  {thumb.kind === "diagram" && (
                    <Globe
                      className="size-[11px] shrink-0 text-info"
                      aria-hidden="true"
                    />
                  )}
                  <span>{thumb.badge}</span>
                </span>
                <span className="flex flex-col gap-[3px]" aria-hidden="true">
                  <span className="block h-1 w-[78%] rounded-[2px] bg-active" />
                  <span className="block h-1 w-[54%] rounded-[2px] bg-hover" />
                </span>
                <span className="truncate text-[10.5px] font-medium text-body">
                  {thumb.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      key={step.id}
      data-slot={`work-step-${step.kind}`}
      className="-ml-2 flex w-full items-center gap-2 rounded-[9px] px-2 py-1 text-[13px] leading-[1.4] text-muted-ink"
    >
      {step.kind === "search" ? (
        <Search
          className="size-3.5 shrink-0 text-muted-ink"
          aria-hidden="true"
        />
      ) : (
        <Folder
          className="size-3.5 shrink-0 text-muted-ink"
          aria-hidden="true"
        />
      )}
      <span>
        {step.text}{" "}
        {step.highlight && (
          <strong className="font-semibold text-body">{step.highlight}</strong>
        )}
      </span>
    </div>
  );
}

interface TraceGroupSectionProps {
  group: ExtendedWorkStepGroup;
  sessionId?: string;
  defaultOpen?: boolean;
  defaultOpenShellSet: Set<string>;
  onOpenCodeFile: (file: string, line?: number | null) => void;
  onOpenDocPreview: (kind: WorkPreviewDocKind, pillLabel: string) => void;
  onMoveShellToBackground?: (step: ShellCommandStep) => void;
}

function TraceGroupSection({
  group,
  sessionId,
  defaultOpen = true,
  defaultOpenShellSet,
  onOpenCodeFile,
  onOpenDocPreview,
  onMoveShellToBackground,
}: TraceGroupSectionProps) {
  const [groupOpen, setGroupOpen] = React.useState(defaultOpen);
  const railId = `work-rail-${group.id}`;
  const hasSteps =
    group.steps.length > 0 ||
    (group.toolSteps?.length ?? 0) > 0 ||
    (group.diffCards?.length ?? 0) > 0;

  const renderStep = (step: TraceStepItem) => {
    switch (step.kind) {
      case "command":
        return (
          <ShellCard
            key={step.id}
            step={step}
            sessionId={sessionId}
            defaultExpanded={defaultOpenShellSet.has(step.id)}
            onMoveToBackground={onMoveShellToBackground}
          />
        );
      case "read":
        return renderFileReadStep(step, onOpenCodeFile, onOpenDocPreview);
      case "list":
      case "search":
      case "previews":
        return renderListOrPreviewStep(step, onOpenDocPreview);
    }
  };

  return (
    <div data-slot="work-group" className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={groupOpen}
        aria-controls={railId}
        onClick={() => setGroupOpen((prev) => !prev)}
        className="group/work-group inline-flex cursor-pointer items-center gap-2 self-start rounded-lg py-0.5 pr-2 pl-0.5 text-[13.5px] font-normal text-muted-ink transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TraceGroupIcon title={group.title} />
        <span>{group.title}</span>
        {hasSteps ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-ink transition-all duration-150",
              groupOpen
                ? "rotate-90 opacity-80"
                : "opacity-0 group-hover/work-group:opacity-80",
            )}
            aria-hidden="true"
          />
        ) : null}
      </button>

      {groupOpen && hasSteps && (
        <div
          id={railId}
          data-slot="work-rail"
          className="ml-2 flex flex-col gap-1.5 border-l border-hairline py-0.5 pl-4"
        >
          {group.steps.map(renderStep)}
          {group.toolSteps?.map((ts) => (
            <ToolStepCard key={ts.id} step={ts} />
          ))}
          {group.diffCards?.map((dc) => (
            <InlineDiffCard key={dc.id} diff={dc} sessionId={sessionId} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkTrace({
  workedDuration,
  isLive = false,
  connectionPhaseLabel,
  notes,
  groups,
  activeToolStatus,
  showLiveBackgroundPill = false,
  sessionId,
  defaultExpanded = false,
  defaultOpenShellIds = [],
  onOpenCodeFile,
  onOpenDocPreview,
  onBackgroundTool,
  className,
}: WorkTraceProps) {
  const [userExpanded, setUserExpanded] = React.useState<boolean | null>(null);
  const bodyId = React.useId();

  // Depth 0 is the calm single-line default; clicking expands Depth 1.
  const expanded = userExpanded ?? defaultExpanded;

  const coalescedGroups = React.useMemo(
    () => coalesceTraceGroups(groups),
    [groups],
  );

  const metrics = React.useMemo(
    () => summarizeWorkTraceMetrics(workedDuration, coalescedGroups),
    [workedDuration, coalescedGroups],
  );

  const defaultOpenShellSet = React.useMemo(
    () => new Set(defaultOpenShellIds),
    [defaultOpenShellIds],
  );

  const handleOpenCodeFile = React.useCallback(
    (file: string, line?: number | null) => {
      if (onOpenCodeFile) {
        onOpenCodeFile(file, line);
      } else {
        useAppStore.getState().openCodeFile(file, line ?? null);
      }
    },
    [onOpenCodeFile],
  );

  const handleOpenDocPreview = React.useCallback(
    (kind: WorkPreviewDocKind, pillLabel: string) => {
      if (onOpenDocPreview) {
        onOpenDocPreview(kind, pillLabel);
      } else {
        const tab =
          kind === "slide" || kind === "excel" || kind === "pdf" || kind === "html"
            ? "sidePanel"
            : kind;
        useAppStore.getState().openRightTab(tab, pillLabel);
      }
    },
    [onOpenDocPreview],
  );

  const handleLiveBackgroundClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    onBackgroundTool?.();
    const sid =
      sessionId ?? useAppStore.getState().activeSessionId ?? "ses_vscode_shell";
    try {
      await callRpc("background.backgroundTool", { sessionId: sid });
    } catch {
      // ignore offline error
    }
  };

  const interleaveCount = Math.max(notes.length, coalescedGroups.length);

  const liveHeaderLabel = React.useMemo(() => {
    const trailing =
      connectionPhaseLabel ??
      activeToolStatus ??
      (metrics.fileCount > 0 || metrics.cmdCount > 0
        ? [
            metrics.fileCount > 0
              ? `${metrics.fileCount} ${metrics.fileCount === 1 ? "file" : "files"}`
              : null,
            metrics.cmdCount > 0
              ? `${metrics.cmdCount} ${metrics.cmdCount === 1 ? "cmd" : "cmds"}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : null);
    return trailing
      ? `Working · ${workedDuration} · ${trailing}`
      : `Working · ${workedDuration}`;
  }, [
    activeToolStatus,
    connectionPhaseLabel,
    metrics.cmdCount,
    metrics.fileCount,
    workedDuration,
  ]);

  return (
    <div
      data-slot="work-trace"
      data-testid="work-trace"
      data-live={isLive ? "true" : "false"}
      data-depth={expanded ? "1" : "0"}
      className={cn("flex flex-col gap-2.5", className)}
    >
      {/* Depth 0: Calm single-line header */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="work-trace-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setUserExpanded(!expanded)}
          title="Inspect execution steps and shell output"
          className={cn(
            "-ml-2 inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full border border-transparent py-1 pr-2.5 pl-2 text-[13px] font-medium text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink focus-visible:border-brand focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isLive && "text-ink",
          )}
        >
          {isLive && (
            <RayuProcessingMark animated className="size-4 shrink-0" />
          )}
          <span data-testid="work-trace-summary" className="tabular-nums">
            {isLive ? liveHeaderLabel : metrics.summaryText}
          </span>
          <ChevronRight
            className={cn(
              "size-[13px] text-muted-ink transition-transform duration-150",
              expanded && "rotate-90",
            )}
            aria-hidden="true"
          />
        </button>

        {isLive && showLiveBackgroundPill && (
          <button
            type="button"
            data-testid="work-trace-live-bg-btn"
            onClick={(e) => void handleLiveBackgroundClick(e)}
            title="Move foreground command to Background Process Viewer (Alt+B)"
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-hairline bg-pane px-2.5 py-0.5 text-[11px] font-medium text-muted-ink transition-colors hover:border-premium hover:bg-hover hover:text-ink"
          >
            <Layers className="size-3 shrink-0" aria-hidden="true" />
            <span>Background</span>
            <kbd className="ml-0.5 font-mono text-[10px] text-faint">Alt+B</kbd>
          </button>
        )}
      </div>

      {/* Depth 1: Expanded vertical rail */}
      {expanded && (
        <div
          id={bodyId}
          data-slot="work-body"
          data-testid="work-trace-body"
          className="flex flex-col gap-2.5 pb-1.5"
        >
          {Array.from({ length: interleaveCount }, (_, index) => {
            const note = notes[index];
            const group = coalescedGroups[index];
            return (
              <React.Fragment key={`trace-slice-${index}`}>
                {note && (
                  <div
                    data-slot="work-note"
                    className="max-w-[70ch] text-sm leading-[1.58] text-ink"
                  >
                    <EditorialMarkdown content={note} inline />
                  </div>
                )}
                {group && (
                  <TraceGroupSection
                    group={group}
                    sessionId={sessionId}
                    defaultOpen
                    defaultOpenShellSet={defaultOpenShellSet}
                    onOpenCodeFile={handleOpenCodeFile}
                    onOpenDocPreview={handleOpenDocPreview}
                  />
                )}
              </React.Fragment>
            );
          })}

          {isLive && activeToolStatus && (
            <div
              data-testid="work-active-tool-status"
              className="inline-flex items-center gap-2 py-0.5 text-[13px] text-muted-ink"
            >
              <LayoutGrid
                className="size-[15px] shrink-0 animate-pulse text-muted-ink"
                aria-hidden="true"
              />
              <span className="animate-pulse">{activeToolStatus}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
