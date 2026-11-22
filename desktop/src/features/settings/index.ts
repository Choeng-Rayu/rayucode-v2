export {
  SettingsView,
  type SettingsViewProps,
} from "./components/settings-view"
export {
  AppearancePanel,
  type AppearancePanelProps,
} from "./components/appearance-panel"

export {
  useDaemonStatus,
  usePingDaemon,
  useSettingsState,
  useToggleUseAllCredits,
  useUpdatePreferences,
} from "./hooks/use-settings"

export {
  daemonStatusQueryOptions,
  fetchDaemonStatus,
  fetchSettingsState,
  pingDaemon,
  setUseAllCreditsPreference,
  settingsQueryKeys,
  settingsQueryOptions,
  updateSettingsPreferences,
} from "./api/settings-api"

export {
  CODE_FONT_OPTIONS,
  CONNECTION_SERVICES,
  DEFAULT_MODEL_OPTIONS,
  KEYBOARD_SHORTCUT_GROUPS,
  KV_CACHE_TTL_OPTIONS,
  MICROPHONE_OPTIONS,
  PERMISSION_MODE_OPTIONS,
  PLAN_LADDER_TIERS,
  SETTINGS_SECTIONS,
  VOICE_MODEL_OPTIONS,
  daemonStatusSchema,
  permissionModeIdSchema,
  settingsAccountSchema,
  settingsPreferencesSchema,
  settingsStateSchema,
  settingsUsageSchema,
  updatePreferencesPatchSchema,
  type ValidatedDaemonStatus,
  type ValidatedPreferencesPatch,
  type ValidatedSettingsState,
} from "./schemas"

export type {
  AccountUsageTabId,
  AnalyticsGroupBy,
  AnalyticsRange,
  CodeFontFamily,
  ConnectionServiceItem,
  DaemonStatus,
  FontScale,
  KeyboardShortcutGroup,
  KeyboardShortcutItem,
  PermissionModeId,
  PlanLadderTier,
  SettingsAccount,
  SettingsNavGroup,
  SettingsPreferences,
  SettingsSectionId,
  SettingsSectionMeta,
  SettingsState,
  SettingsUsage,
  UpdatePreferencesInput,
} from "./types"
