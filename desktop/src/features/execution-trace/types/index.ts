import type {
  ExecutionTurn,
  FileReadStep,
  InlineDiffCardData,
  InlineDiffHunkLine,
  ListStep,
  SessionSummary,
  ShellCommandStep,
  TraceGroup,
  TraceStepItem,
  TraceTimelineItem,
  TurnOutputArtifact,
} from "@/lib/ipc-client"

export type {
  ExecutionTurn,
  FileReadStep,
  InlineDiffCardData,
  InlineDiffHunkLine,
  ListStep,
  SessionSummary,
  ShellCommandStep,
  TraceGroup,
  TraceStepItem,
  TraceTimelineItem,
  TurnOutputArtifact,
}

export type CitationKind = "code" | "excel" | "markdown" | "browser" | "slide"

export interface CitationItem {
  label: string
  kind: CitationKind
  file: string
  line?: number
}

export interface AnswerBullet {
  id: string
  title: string
  body: string
  citations: CitationItem[]
}

export type DiffDecision = "pending" | "accepted" | "rejected"

export type LiveTraceEvent =
  | { type: "note"; text: string }
  | { type: "promote-note" }
  | { type: "tool-status"; label: string | null }
  | {
      type: "step"
      groupId?: string
      groupTitle?: string
      step: TraceStepItem
    }
  | { type: "artifact"; artifact: TurnOutputArtifact }
  | { type: "answer-delta"; delta: string }
  | { type: "summary-title"; title: string }
  | { type: "bullet"; bullet: AnswerBullet }
  | { type: "diff"; diffCard: InlineDiffCardData }
  | { type: "duration"; workedDuration: string }
  | {
      type: "complete"
      workedDuration: string
      credits?: string
      kvCachePct?: number
      timestamp?: string
    }
