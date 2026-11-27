export { HomeView, type HomeViewProps } from "./components/home-view"
export {
  SessionComposer,
  type SessionComposerProps,
} from "./components/composer"
export {
  ModelEffortPopover,
  type ModelEffortPopoverProps,
} from "./components/model-effort-popover"
export {
  PermissionPopover,
  type PermissionPopoverProps,
} from "./components/permission-popover"

export {
  useCapabilities,
  useCreateSession,
  useModelCatalog,
  usePermissionModes,
  usePersistedInferenceSettings,
  useSessions,
} from "./hooks/use-sessions"

export {
  capabilitiesQueryOptions,
  createSession,
  fetchCapabilities,
  fetchModels,
  fetchPermissionModes,
  fetchSessions,
  modelsQueryOptions,
  permissionModesQueryOptions,
  refreshModelsCatalog,
  sessionsQueryKeys,
  sessionsQueryOptions,
} from "./api/sessions-api"

export {
  DEFAULT_CHECKOUT,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_LABEL,
  DEFAULT_PERMISSION_MODE_ID,
  DEFAULT_PROJECT,
  FALLBACK_MODELS,
  FALLBACK_PERMISSION_MODES,
  HOME_CHECKOUTS,
  HOME_PROJECTS,
  QUICK_START_SUGGESTIONS,
  getEffortDescription,
  getPermissionMode,
  nextPermissionModeId,
} from "./constants/models"

export {
  createSessionInputSchema,
  modelOptionSchema,
  permissionModeIdSchema,
  permissionModeOptionSchema,
  reasoningEffortSchema,
  sessionSummarySchema,
  type ValidatedCreateSessionInput,
} from "./schemas"

export type {
  ComposerMode,
  ComposerSubmitPayload,
  CreateSessionInput,
  EffortStopConfig,
  GettingStartedItem,
  ModelOption,
  PermissionModeId,
  PermissionModeOption,
  ProjectGroup,
  QuickStartSuggestion,
  ReasoningEffort,
  SessionSummary,
  SlashCommandItem,
} from "./types"
