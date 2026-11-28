export {
  BackgroundDockBar,
  type BackgroundDockBarProps,
} from "./components/BackgroundDockBar";
export {
  BackgroundProcessDrawer,
  type BackgroundProcessDrawerProps,
} from "./components/BackgroundProcessDrawer";
export {
  ProcessOutputTail,
  parseAnsiSegments,
  stripAnsiCodes,
  type AnsiSegment,
  type ProcessOutputTailProps,
} from "./components/ProcessOutputTail";
export {
  ProcessRow,
  resolveProcessFileBadgePath,
  type ProcessRowProps,
} from "./components/ProcessRow";
export {
  SwarmAgentProgressPane,
  computeSwarmAgentPercent,
  isSwarmAgentActive,
  type SwarmAgentProgressPaneProps,
} from "./components/SwarmAgentProgressPane";
export {
  DEFAULT_FOLLOW_POLL_MS,
  DEFAULT_OUTPUT_MAX_BYTES,
  STALL_THRESHOLD_SECS,
  __resetProcessesStateForTest,
  getProcessElapsedSeconds,
  getStallQuietSeconds,
  groupProcesses,
  isProcessActive,
  isProcessStalled,
  isSwarmAgentRunning,
  matchesProcessFilter,
  matchesProcessSearch,
  matchesSwarmAgentFilter,
  matchesSwarmAgentSearch,
  useProcessSecondTick,
  useProcesses,
  type ProcessFilterTab,
  type ProcessGroupSection,
  type ProcessScopeMode,
  type UseProcessesOptions,
} from "./hooks/useProcesses";
