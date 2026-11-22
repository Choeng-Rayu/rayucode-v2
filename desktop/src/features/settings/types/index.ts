import type {
  DaemonStatus,
  PermissionModeId,
  SettingsState,
} from "@/lib/ipc-client"

export type { DaemonStatus, PermissionModeId, SettingsState }

export type SettingsAccount = SettingsState["account"]
export type SettingsUsage = SettingsState["usage"]
export type SettingsPreferences = SettingsState["preferences"]

export type SettingsSectionId =
  | "account"
  | "appearance"
  | "models"
  | "voice"
  | "connections"
  | "shortcuts"

export type SettingsNavGroup = "Account" | "App" | "System"

export interface SettingsSectionMeta {
  id: SettingsSectionId
  label: string
  group: SettingsNavGroup
  description: string
  keywords: string
}

export type AccountUsageTabId = "overview" | "analytics"
export type AnalyticsRange = "7d" | "30d"
export type AnalyticsGroupBy = "feature" | "model" | "surface"

export type CodeFontFamily = "JetBrains Mono" | "SF Mono" | "Berkeley Mono"
export type FontScale = "compact" | "default" | "large"

export type UpdatePreferencesInput = Partial<SettingsPreferences>

export interface PlanLadderTier {
  id: string
  name: string
  price: string
  summary: string
  isCurrent?: boolean
}

export interface ConnectionServiceItem {
  id: string
  name: string
  description: string
  status: "connected" | "linked" | "active" | "disconnected"
  statusLabel: string
  actionLabel?: string
}

export interface KeyboardShortcutItem {
  id: string
  label: string
  description?: string
  keys: readonly string[]
}

export interface KeyboardShortcutGroup {
  id: string
  title: string
  items: readonly KeyboardShortcutItem[]
}
