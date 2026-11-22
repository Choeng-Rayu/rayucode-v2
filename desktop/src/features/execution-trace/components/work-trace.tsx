import * as React from "react"
import {
  BookOpen,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Search,
} from "lucide-react"

import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import type {
  FileReadStep,
  ListStep,
  TraceGroup,
  TraceStepItem,
} from "../types"
import { EditorialMarkdown } from "./cite-link"
import { ShellCard } from "./shell-card"

export interface WorkTraceProps {
  workedDuration: string
  isLive?: boolean
  notes: string[]
  groups: TraceGroup[]
  defaultExpanded?: boolean
  defaultOpenShellIds?: string[]
  onOpenCodeFile?: (file: string, line?: number | null) => void
  onOpenDocPreview?: (
    kind: "browser" | "excel" | "markdown",
    pillLabel: string
  ) => void
  className?: string
}

function renderFileReadStep(
  step: FileReadStep,
  onOpenCodeFile: (file: string, line?: number | null) => void,
  onOpenDocPreview: (
    kind: "browser" | "excel" | "markdown",
    pillLabel: string
  ) => void
) {
  return (
    <div
      key={step.id}
      data-slot="work-step-read"
      className="-ml-2 flex w-full items-center gap-2 rounded-[9px] px-2 py-1 text-[13px] leading-[1.4] text-muted-ink"
    >
      <BookOpen
        className="size-3.5 shrink-0 text-muted-ink"
        aria-hidden="true"
      />
      <span>
        {step.label}{" "}
        {step.files.map((target, idx) => {
          const isMarkdown = target.file.toLowerCase().endsWith(".md")
          const isExcel = target.file.toLowerCase().endsWith(".xlsx")
          return (
            <React.Fragment key={`${step.id}-${target.path}-${target.line}`}>
              {idx > 0 && ", "}
              <button
                type="button"
                onClick={() => {
                  if (isMarkdown) {
                    onOpenDocPreview("markdown", target.file)
                  } else if (isExcel) {
                    onOpenDocPreview("excel", target.file)
                  } else {
                    onOpenCodeFile(target.file, target.line)
                  }
                }}
                className="cursor-pointer text-body underline decoration-hairline-strong underline-offset-[3px] transition-colors hover:text-brand-text hover:decoration-brand-text focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  onOpenDocPreview: (
    kind: "browser" | "excel" | "markdown",
    pillLabel: string
  ) => void
) {
  if (step.kind === "previews") {
    return (
      <div key={step.id} data-slot="work-step-previews" className="flex flex-col gap-1">
        <div className="-ml-2 flex w-full items-center gap-2 rounded-[9px] px-2 py-1 text-[13px] leading-[1.4] text-muted-ink">
          <ImageIcon
            className="size-3.5 shrink-0 text-muted-ink"
            aria-hidden="true"
          />
          <span>{step.text}</span>
        </div>
        {step.previews && step.previews.length > 0 && (
          <div className="flex items-stretch gap-2 overflow-x-auto pt-1 pb-0.5">
            {step.previews.map((thumb) => (
              <button
                key={thumb.id}
                type="button"
                onClick={() => onOpenDocPreview(thumb.kind, thumb.pillLabel)}
                className="flex h-[70px] w-[112px] shrink-0 cursor-pointer flex-col justify-between rounded-lg border border-premium bg-pane px-2 py-[7px] text-left transition-all hover:-translate-y-px hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1 font-mono text-[10px] text-muted-ink">
                  {thumb.kind === "browser" && (
                    <Globe
                      className="size-[11px] shrink-0 text-brand-text"
                      aria-hidden="true"
                    />
                  )}
                  {thumb.kind === "excel" && (
                    <FileSpreadsheet
                      className="size-[11px] shrink-0 text-brand-text"
                      aria-hidden="true"
                    />
                  )}
                  {thumb.kind === "markdown" && (
                    <FileText
                      className="size-[11px] shrink-0 text-brand-text"
                      aria-hidden="true"
                    />
                  )}
                  <span>{thumb.badge}</span>
                </span>
                <span className="flex flex-col gap-[3px]" aria-hidden="true">
                  <span className="block h-1 w-[78%] rounded-[2px] bg-brand-soft" />
                  <span className="block h-1 w-[54%] rounded-[2px] bg-active" />
                </span>
                <span className="truncate text-[10.5px] font-medium text-body">
                  {thumb.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const StepIcon = step.kind === "search" ? Search : Folder

  return (
    <div
      key={step.id}
      data-slot={`work-step-${step.kind}`}
      className="-ml-2 flex w-full items-center gap-2 rounded-[9px] px-2 py-1 text-[13px] leading-[1.4] text-muted-ink"
    >
      <StepIcon
        className="size-3.5 shrink-0 text-muted-ink"
        aria-hidden="true"
      />
      <span>
        {step.text}{" "}
        {step.highlight && (
          <strong className="font-semibold text-body">{step.highlight}</strong>
        )}
      </span>
    </div>
  )
}

interface TraceGroupSectionProps {
  group: TraceGroup
  defaultOpenShellSet: Set<string>
  onOpenCodeFile: (file: string, line?: number | null) => void
  onOpenDocPreview: (
    kind: "browser" | "excel" | "markdown",
    pillLabel: string
  ) => void
}

function TraceGroupSection({
  group,
  defaultOpenShellSet,
  onOpenCodeFile,
  onOpenDocPreview,
}: TraceGroupSectionProps) {
  const [groupOpen, setGroupOpen] = React.useState(true)
  const railId = `work-rail-${group.id}`

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
        className="inline-flex cursor-pointer items-center gap-2 self-start rounded-lg py-0.5 pr-2 pl-0.5 text-[13px] font-normal text-muted-ink transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpen
          className="size-[15px] shrink-0 text-muted-ink"
          aria-hidden="true"
        />
        <span>{group.title}</span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-ink transition-transform duration-150",
            groupOpen && "rotate-90"
          )}
          aria-hidden="true"
        />
      </button>

      {groupOpen && (
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

export function WorkTrace({
  workedDuration,
  isLive = false,
  notes,
  groups,
  defaultExpanded,
  defaultOpenShellIds = [],
  onOpenCodeFile,
  onOpenDocPreview,
  className,
}: WorkTraceProps) {
  const [userExpanded, setUserExpanded] = React.useState<boolean | null>(null)
  const bodyId = React.useId()

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
    (kind: "browser" | "excel" | "markdown", pillLabel: string) => {
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
          <span
            data-slot="work-live-dot"
            aria-hidden="true"
            className="size-1.5 rounded-full bg-brand-bright ring-3 ring-brand-soft animate-pulse"
          />
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
          className="flex flex-col gap-3 pb-1.5"
        >
          {Array.from({ length: interleaveCount }, (_, index) => {
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
                    defaultOpenShellSet={defaultOpenShellSet}
                    onOpenCodeFile={handleOpenCodeFile}
                    onOpenDocPreview={handleOpenDocPreview}
                  />
                )}
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
