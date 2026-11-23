#!/usr/bin/env node
/**
 * Dev-only macOS branding helper so `pnpm dev:electron` displays "RayuCode"
 * (and the official RayuCode icon) in the macOS Dock tooltip and menu bar
 * instead of the default "Electron" label.
 *
 * Packaged apps built via `electron-builder` already use `productName: RayuCode`.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

if (process.platform !== "darwin") {
  process.exit(0)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const electronAppDir = path.join(
  desktopDir,
  "node_modules",
  "electron",
  "dist",
  "Electron.app"
)
const infoPlist = path.join(electronAppDir, "Contents", "Info.plist")
const iconDest = path.join(electronAppDir, "Contents", "Resources", "electron.icns")
const iconSrc = path.join(desktopDir, "build", "icon.icns")

if (!fs.existsSync(infoPlist)) {
  process.exit(0)
}

try {
  execFileSync("plutil", ["-replace", "CFBundleName", "-string", "RayuCode", infoPlist])
  execFileSync("plutil", [
    "-replace",
    "CFBundleDisplayName",
    "-string",
    "RayuCode",
    infoPlist,
  ])
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, iconDest)
  }
  // Touch the .app bundle so macOS Dock / LaunchServices refreshes the tooltip & icon
  const now = new Date()
  fs.utimesSync(electronAppDir, now, now)
} catch {
  // Non-fatal in restricted environments
}
