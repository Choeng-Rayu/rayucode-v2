import type { ChangedFileDiff, ChangesState } from "@/lib/ipc-client"

export type InspectorConnectorStatus = "Linked" | "Reconnect"

export type InspectorOutputKind = "browser" | "markdown" | "excel" | "slide"

export type PreviewDocumentTab = "browser" | "excel" | "markdown" | "slide" | "diagram"

export interface ContextBreakdownSubItem {
  key: string
  tokens: string
}

export interface ContextBreakdownRow {
  id: string
  label: string
  tokensLabel: string
  pctLabel: string
  barWidthPct: number
  colorClass: string
  dotted?: boolean
  items?: ContextBreakdownSubItem[]
}

export interface ContextDisclosure {
  id: string
  label: string
  count: number
  items: string[]
}

export interface InspectorEnvironment {
  host: string
  project: string
  path: string
  branch: string
}

export interface InspectorContextSection {
  usedPctLabel: string
  tokensSummary: string
  rows: ContextBreakdownRow[]
  bufferRow: ContextBreakdownRow
  freeRow: ContextBreakdownRow
  disclosures: ContextDisclosure[]
}

export interface InspectorConnector {
  id: string
  glyph: string
  name: string
  status?: InspectorConnectorStatus
  primary: boolean
}

export interface InspectorOutput {
  id: string
  kind: InspectorOutputKind
  label: string
  pillLabel: string
}

export interface InspectorChangesSummary {
  additions: number
  deletions: number
  changedFilesCount: number
}

export interface InspectorCodeFile {
  pill: string
  path: string
  language: string
  startLine: number
  defaultLine: number
  lines: string[]
}

export interface InspectorTerminalLine {
  id: string
  prompt?: string
  command?: string
  output?: string
  isOk?: boolean
  isError?: boolean
}

export interface InspectorTaskItem {
  id: string
  title: string
  detail: string
  completed: boolean
  codeFile?: string
  codeLine?: number
}

export interface InspectorViewModel {
  environment: InspectorEnvironment
  context: InspectorContextSection
  connectors: InspectorConnector[]
  outputs: InspectorOutput[]
  changesSummary: InspectorChangesSummary
  codeFiles: Record<string, InspectorCodeFile>
  terminalLines: InspectorTerminalLine[]
  tasks: InspectorTaskItem[]
}

export type InspectorChangedFile = ChangedFileDiff
export type InspectorChangesState = ChangesState
