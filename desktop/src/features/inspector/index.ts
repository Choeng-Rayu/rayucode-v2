// Public barrel export for desktop/src/features/inspector
export {
  ContextPanel,
  type ContextPanelProps,
} from "./components/context-panel"
export { CodeViewer, type CodeViewerProps } from "./components/code-viewer"
export {
  TerminalPanel,
  type TerminalPanelProps,
} from "./components/terminal-panel"
export {
  DiffTabPanel,
  type DiffTabPanelProps,
} from "./components/diff-tab-panel"
export {
  FilesTabPanel,
  type FilesTabPanelProps,
} from "./components/files-tab-panel"
export {
  InspectorSidebar,
  type InspectorSidebarProps,
} from "./components/inspector-sidebar"

export {
  useCodeFile,
  useContextStats,
  useDiffDecisionMutation,
  useInspectorChanges,
  useInspectorState,
  usePrefetchCodeFile,
  type ContextBarSegment,
} from "./hooks/use-context-stats"

export {
  acceptInspectorDiff,
  codeFileQueryOptions,
  fetchCodeFile,
  fetchInspectorChanges,
  fetchInspectorState,
  inspectorChangesQueryOptions,
  inspectorKeys,
  inspectorStateQueryOptions,
  openFileInVSCode,
  rejectInspectorDiff,
  runInspectorTerminalCommand,
} from "./api/inspector-api"

export {
  contextBreakdownRowSchema,
  contextBreakdownSubItemSchema,
  contextDisclosureSchema,
  inspectorChangesSummarySchema,
  inspectorCodeFileSchema,
  inspectorConnectorSchema,
  inspectorEnvironmentSchema,
  inspectorOutputSchema,
  inspectorTaskItemSchema,
  inspectorTerminalLineSchema,
  inspectorViewModelSchema,
  terminalCommandInputSchema,
  type TerminalCommandInput,
} from "./schemas"

export type {
  ContextBreakdownRow,
  ContextBreakdownSubItem,
  ContextDisclosure,
  InspectorChangedFile,
  InspectorChangesState,
  InspectorChangesSummary,
  InspectorCodeFile,
  InspectorConnector,
  InspectorConnectorStatus,
  InspectorContextSection,
  InspectorEnvironment,
  InspectorOutput,
  InspectorOutputKind,
  InspectorTaskItem,
  InspectorTerminalLine,
  InspectorViewModel,
  PreviewDocumentTab,
} from "./types"
