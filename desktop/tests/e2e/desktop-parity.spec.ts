/**
 * RayuCode Desktop — 1440×934 Closed-Loop Visual Parity E2E Specification
 *
 * Covers all 11 views across all 3 visual modes (33 screenshots total):
 * - Modes: dark-green, dark-blue, light-green
 * - Views: home, workspace, code-viewer, browser-fullview, excel-session,
 *          swarm, automations, plugins, changes, telegram, settings
 */

export const PARITY_VIEWPORT = { width: 1440, height: 934 } as const

export const PARITY_VISUAL_MODES = [
  { id: "dark-green", theme: "dark", accent: "green" },
  { id: "dark-blue", theme: "dark", accent: "blue" },
  { id: "light-green", theme: "light", accent: "green" },
] as const

export const PARITY_ROUTES = [
  "home",
  "workspace",
  "code-viewer",
  "browser-fullview",
  "excel-session",
  "swarm",
  "automations",
  "plugins",
  "changes",
  "telegram",
  "settings",
] as const
