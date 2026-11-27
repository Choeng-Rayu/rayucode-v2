import * as React from "react"
import {
  BookOpen,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  Hand,
  Image as ImageIcon,
  LayoutGrid,
  Monitor,
  Search,
  Terminal,
  Wrench,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { RayuProcessingMark } from "@/components/ui/rayu-processing-mark"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import type {
  FileReadStep,
  ListStep,
  TraceGroup,
  TraceStepItem,
  TraceTimelineItem,
} from "../types"
import { EditorialMarkdown } from "./cite-link"
import { ShellCard } from "./shell-card"

export type WorkPreviewDocKind = "browser" | "excel" | "markdown" | "slide"

export interface WorkTraceProps {
  workedDuration: string
  isLive?: boolean
  notes: string[]
  groups: TraceGroup[]
  timeline?: TraceTimelineItem[]
  activeToolStatus?: string | null
  defaultExpanded?: boolean
  defaultOpenShellIds?: string[]
  onOpenCodeFile?: (file: string, line?: number | null) => void
  onOpenDocPreview?: (kind: WorkPreviewDocKind, pillLabel: string) => void
  className?: string
}

function TraceGroupIcon({ title }: { title: string }) {
  const lower = title.toLowerCase()
  const iconClass = "size-[15px] shrink-0 text-muted-ink"
  if (lower.includes("loaded a tool") || lower.includes("skill")) {
    return <Wrench className={iconClass} aria-hidden="true" />
  }
  if (lower.includes("read files")) {
    return <Folder className={iconClass} aria-hidden="true" />
  }
  if (lower.includes("searched")) {
    return <Search className={iconClass} aria-hidden="true" />
  }
  if (
    lower.includes("viewed an image") ||
    lower.includes("viewed ") ||
    lower.includes("preview")
  ) {
    return <ImageIcon className={iconClass} aria-hidden="true" />
  }
  if (lower.includes("browser") || lower.includes("computer use")) {
    return <Monitor className={iconClass} aria-hidden="true" />
  }
  if (lower.includes("permission")) {
    return <Hand className={iconClass} aria-hidden="true" />
  }
  if (
    lower.includes("inspect") ||
    lower.includes("import") ||
    lower.includes("artifact session") ||
    lower.includes("integration")
  ) {
    return <LayoutGrid className={iconClass} aria-hidden="true" />
  }
  if (lower.includes("ran a command") || lower.includes("ran command")) {
    return <Terminal className={iconClass} aria-hidden="true" />
  }
  return <Folder className={iconClass} aria-hidden="true" />
}

function renderFileReadStep(
  step: FileReadStep,
  onOpenCodeFile: (file: string, line?: number | null) => void,
  onOpenDocPreview: (kind: WorkPreviewDocKind, pillLabel: string) => void
) {
  const isSkillStep = step.label.toLowerCase().includes("skill")

  return (
    <div
      key={step.id}
      data-slot="work-step-read"
      className="-ml-2 flex w-full items-center gap-2 rounded-[9px] px-2 py-1 text-[13px] leading-[1.4] text-muted-ink"
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
      <span>
        {step.label}{" "}
        {step.files.map((target, idx) => {
          const lower = target.file.toLowerCase()
          const isMarkdown = lower.endsWith(".md")
          const isExcel = lower.endsWith(".xlsx")
          const isSlide =
            lower.endsWith(".pptx") || lower.includes("slide")
          return (
            <React.Fragment key={`${step.id}-${target.path}-${target.line}`}>
              {idx > 0 && ", "}
              <button
                type="button"
                onClick={() => {
                  if (isSlide) {
                    onOpenDocPreview("slide", "Slide")
                  } else if (isMarkdown) {
                    onOpenDocPreview("markdown", target.file)
                  } else if (isExcel) {
                    onOpenDocPreview("excel", target.file)
                  } else {
                    onOpenCodeFile(target.file, target.line)
                  }
                }}
                className="cursor-pointer text-body underline decoration-hairline-strong underline-offset-[3px] transition-colors hover:text-ink hover:decoration-current focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {target.rangeLabel}
              </button>
            </React.Fragment>
          )
        })}
      </span>
    </div>
  )
}

function renderListOrPreviewStep(
  step: ListStep,
  onOpenDocPreview: (kind: WorkPreviewDocKind, pillLabel: string) => void
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
            {step.previews.map((thumb) => {
              if (thumb.kind === "slide") {
                return (
                  <button
                    key={thumb.id}
                    type="button"
                    data-testid={`work-slide-thumb-${thumb.id}`}
                    onClick={() => onOpenDocPreview("slide", thumb.pillLabel)}
                    style={{
                      backgroundColor: "rgb(255, 255, 255)",
                      color: "rgb(30, 41, 59)",
                    }}
                    className="flex h-[88px] w-[156px] shrink-0 cursor-pointer flex-col justify-between overflow-hidden rounded-[9px] border border-hairline px-3 py-2 text-left shadow-sm transition-all hover:-translate-y-px hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div>
                      <div
                        className="truncate text-[6px] font-medium uppercase"
                        style={{ color: "rgb(148, 163, 184)" }}
                      >
                        {thumb.badge || ".pptx"}
                      </div>
                      <div
                        className="mt-0.5 line-clamp-2 text-[9px] leading-tight font-bold"
                        style={{ color: "rgb(53, 88, 186)" }}
                      >
                        {thumb.label}
                      </div>
                    </div>
                    <div
                      className="my-1 h-px w-full"
                      style={{ backgroundColor: "rgb(203, 213, 225)" }}
                    />
                    <div
                      className="truncate text-[5.5px] font-medium"
                      style={{ color: "rgb(100, 116, 139)" }}
                    >
                      Open in Slide Studio
                    </div>
                  </button>
                )
              }

              return (
                <button
                  key={thumb.id}
                  type="button"
                  onClick={() => onOpenDocPreview(thumb.kind, thumb.pillLabel)}
                  className="flex h-[70px] w-[112px] shrink-0 cursor-pointer flex-col justify-between rounded-lg border border-premium bg-pane px-2 py-[7px] text-left transition-all hover:-translate-y-px hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-1 font-mono text-[10px] text-muted-ink">
                    {thumb.kind === "browser" && (
                      <Globe
                        className="size-[11px] shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                    )}
                    {thumb.kind === "excel" && (
                      <FileSpreadsheet
                        className="size-[11px] shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                    )}
                    {thumb.kind === "markdown" && (
                      <FileText
                        className="size-[11px] shrink-0 text-muted-ink"
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
              )
            })}
          </div>
        )}
      </div>
    )
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
        {step.text}
        {step.highlight ? (
          <>
            {" "}
            <strong className="font-semibold text-body">
              {step.highlight}
            </strong>
          </>
        ) : null}
      </span>
    </div>
  )
}

interface TraceGroupSectionProps {
  group: TraceGroup
  defaultOpen?: boolean
  defaultOpenShellSet: Set<string>
  onOpenCodeFile: (file: string, line?: number | null) => void
  onOpenDocPreview: (kind: WorkPreviewDocKind, pillLabel: string) => void
}

function TraceGroupSection({
  group,
  defaultOpen = true,
  defaultOpenShellSet,
  onOpenCodeFile,
  onOpenDocPreview,
}: TraceGroupSectionProps) {
  const [groupOpen, setGroupOpen] = React.useState(defaultOpen)
  const railId = `work-rail-${group.id}`
  const hasSteps = group.steps.length > 0

  const renderStep = (step: TraceStepItem) => {
    switch (step.kind) {
      case "command":
        return (
          <ShellCard
            key={step.id}
            step={step}
            defaultExpanded={defaultOpenShellSet.has(step.id)}
          />
        )
      case "read":
        return renderFileReadStep(step, onOpenCodeFile, onOpenDocPreview)
      case "list":
      case "search":
      case "previews":
        return renderListOrPreviewStep(step, onOpenDocPreview)
    }
  }

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
                : "opacity-0 group-hover/work-group:opacity-80"
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
        </div>
      )}
    </div>
  )
}

interface ThinkingDisclosureProps {
  text: string
  isActive?: boolean
  defaultOpen?: boolean
}

function ThinkingDisclosure({
  text,
  isActive = false,
  defaultOpen = false,
}: ThinkingDisclosureProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="work-reasoning"
      data-testid="work-reasoning"
      className="flex flex-col gap-1.5"
    >
      <CollapsibleTrigger
        type="button"
        data-slot="work-reasoning-toggle"
        data-testid="work-reasoning-toggle"
        aria-expanded={open}
        className="group/work-reasoning inline-flex cursor-pointer items-center gap-1.5 self-start rounded-lg py-0.5 pr-2 pl-0.5 text-[13px] font-normal text-muted-ink transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-ink transition-transform duration-150 group-hover/work-reasoning:text-ink",
            open && "rotate-90"
          )}
          aria-hidden="true"
        />
        <span className={cn(isActive && "animate-pulse")}>Thinking</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          data-slot="work-reasoning-body"
          data-testid="work-reasoning-body"
          className="ml-2 max-w-[70ch] border-l border-hairline py-0.5 pl-3.5 text-[13px] leading-[1.6] whitespace-pre-wrap text-muted-ink"
        >
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function WorkTrace({
  workedDuration,
  isLive = false,
  notes,
  groups,
  timeline,
  activeToolStatus,
  defaultExpanded,
  defaultOpenShellIds = [],
  onOpenCodeFile,
  onOpenDocPreview,
  className,
}: WorkTraceProps) {
  const [userExpanded, setUserExpanded] = React.useState<boolean | null>(null)
  const bodyId = React.useId()

  const hasTimeline = Boolean(timeline && timeline.length > 0)
  // Show live process while streaming; collapse to "Worked for Xs" once finished
  // unless the user clicks to inspect the steps.
  const expanded = userExpanded ?? defaultExpanded ?? Boolean(isLive)

  const defaultOpenShellSet = React.useMemo(
    () => new Set(defaultOpenShellIds),
    [defaultOpenShellIds]
  )

  const handleOpenCodeFile = React.useCallback(
    (file: string, line?: number | null) => {
      if (onOpenCodeFile) {
        onOpenCodeFile(file, line)
      } else {
        useAppStore.getState().openCodeFile(file, line ?? null)
      }
    },
    [onOpenCodeFile]
  )

  const handleOpenDocPreview = React.useCallback(
    (kind: WorkPreviewDocKind, pillLabel: string) => {
      if (onOpenDocPreview) {
        onOpenDocPreview(kind, pillLabel)
      } else {
        useAppStore.getState().openDocPreview(kind, pillLabel)
      }
    },
    [onOpenDocPreview]
  )

  const interleaveCount = Math.max(notes.length, groups.length)

  return (
    <div
      data-slot="work-trace"
      data-live={isLive ? "true" : "false"}
      className={cn("flex flex-col gap-2.5", className)}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setUserExpanded(!expanded)}
        title="Inspect execution steps and shell output"
        className={cn(
          "-ml-2 inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full border border-transparent py-1 pr-2.5 pl-2 text-[13.5px] font-medium text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink focus-visible:border-brand focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isLive && "text-ink"
        )}
      >
        {isLive && (
          <RayuProcessingMark animated className="size-[17px]" />
        )}
        <span className="tabular-nums">
          {isLive
            ? `Working · ${workedDuration}`
            : `Worked for ${workedDuration}`}
        </span>
        <ChevronRight
          className={cn(
            "size-[13px] text-muted-ink transition-transform duration-150",
            expanded && "rotate-90"
          )}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div
          id={bodyId}
          data-slot="work-body"
          className="flex flex-col gap-2.5 pb-1.5"
        >
          {hasTimeline && timeline ? (
            timeline.map((entry, idx) => {
              if (entry.type === "reasoning") {
                const isActiveReasoning = Boolean(
                  isLive && !activeToolStatus && idx === timeline.length - 1
                )
                return (
                  <ThinkingDisclosure
                    key={entry.id}
                    text={entry.text}
                    isActive={isActiveReasoning}
                  />
                )
              }
              if (entry.type === "note") {
                return (
                  <div
                    key={entry.id}
                    data-slot="work-note"
                    className="max-w-[70ch] text-sm leading-[1.6] text-ink"
                  >
                    <EditorialMarkdown content={entry.text} inline />
                  </div>
                )
              }
              const isImagePreviewGroup = entry.group.steps.some(
                (s) => s.kind === "previews"
              )
              return (
                <TraceGroupSection
                  key={entry.group.id}
                  group={entry.group}
                  defaultOpen={isImagePreviewGroup}
                  defaultOpenShellSet={defaultOpenShellSet}
                  onOpenCodeFile={handleOpenCodeFile}
                  onOpenDocPreview={handleOpenDocPreview}
                />
              )
            })
          ) : (
            Array.from({ length: interleaveCount }, (_, index) => {
              const note = notes[index]
              const group = groups[index]
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
                      defaultOpen
                      defaultOpenShellSet={defaultOpenShellSet}
                      onOpenCodeFile={handleOpenCodeFile}
                      onOpenDocPreview={handleOpenDocPreview}
                    />
                  )}
                </React.Fragment>
              )
            })
          )}

          {isLive && activeToolStatus ? (
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
          ) : isLive &&
            notes.length === 0 &&
            groups.length === 0 &&
            !hasTimeline ? (
            <div
              data-testid="work-thinking-indicator"
              className="py-0.5 pl-[25px] text-[12.5px] text-muted-ink"
            >
              Thinking...
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
