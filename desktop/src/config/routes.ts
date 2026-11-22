import type { AppRoute } from "@/lib/app-store"

export interface RouteDefinition {
  id: AppRoute
  label: string
  title: string
  hasRightInspector: boolean
  isFullPageShell?: boolean
}

export const ROUTES: Record<AppRoute, RouteDefinition> = {
  home: {
    id: "home",
    label: "Home",
    title: "New session",
    hasRightInspector: true,
  },
  workspace: {
    id: "workspace",
    label: "Home",
    title: "Retire legacy session cache",
    hasRightInspector: true,
  },
  swarm: {
    id: "swarm",
    label: "Swarm",
    title: "Gateway retry & session shards",
    hasRightInspector: false,
  },
  automations: {
    id: "automations",
    label: "Automations",
    title: "Automations",
    hasRightInspector: false,
  },
  plugins: {
    id: "plugins",
    label: "Plugins",
    title: "Plugins",
    hasRightInspector: false,
  },
  changes: {
    id: "changes",
    label: "Changes",
    title: "feat/retire-session-cache",
    hasRightInspector: false,
  },
  telegram: {
    id: "telegram",
    label: "Telegram Remote",
    title: "Telegram Remote",
    hasRightInspector: false,
  },
  settings: {
    id: "settings",
    label: "Settings",
    title: "Settings",
    hasRightInspector: false,
    isFullPageShell: true,
  },
}
