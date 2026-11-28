import type { AppRoute, RightTabId } from "@/lib/app-store"

export interface PrimaryNavItem {
  id: AppRoute
  label: string
  icon: "home" | "swarm" | "agents" | "clock" | "plug" | "branch" | "telegram"
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
  shortcut?: string
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
    label: "Terminal",
    shortcut: "⌘J",
    pillLabel: "Terminal",
    icon: "terminal",
  },
  {
    id: "diff",
    label: "Changes & Diff",
    pillLabel: "Changes",
    icon: "diff",
  },
  {
    id: "browser",
    label: "Preview",
    pillLabel: "localhost:3000",
    icon: "globe",
  },
  {
    id: "files",
    label: "Files",
    pillLabel: "Files",
    icon: "folder",
  },
]
