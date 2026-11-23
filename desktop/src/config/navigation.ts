import type { AppRoute, RightTabId } from "@/lib/app-store"

export interface PrimaryNavItem {
  id: AppRoute
  label: string
  icon: "home" | "swarm" | "clock" | "plug" | "branch" | "telegram"
  hasLiveDot?: boolean
}

export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "swarm", label: "Swarm", icon: "swarm" },
  { id: "automations", label: "Automations", icon: "clock" },
  { id: "plugins", label: "Plugins", icon: "plug" },
  { id: "changes", label: "Changes", icon: "branch" },
  {
    id: "telegram",
    label: "Telegram Remote",
    icon: "telegram",
    hasLiveDot: true,
  },
]

export interface RightInspectorTabItem {
  id: RightTabId
  label: string
  pillLabel: string | null
  icon: "list" | "terminal" | "diff" | "globe" | "folder"
}

export const RIGHT_INSPECTOR_TABS: RightInspectorTabItem[] = [
  {
    id: "overview",
    label: "Environment & Context",
    pillLabel: null,
    icon: "list",
  },
  {
    id: "terminal",
    label: "CLI Terminal",
    pillLabel: "rayu daemon",
    icon: "terminal",
  },
  {
    id: "code",
    label: "Code & Changes",
    pillLabel: "lookup.rs",
    icon: "diff",
  },
  {
    id: "browser",
    label: "Open Browser",
    pillLabel: "localhost:3000",
    icon: "globe",
  },
  {
    id: "files",
    label: "Files · Microsoft & MD",
    pillLabel: "MIGRATION_PLAN.md",
    icon: "folder",
  },
]
