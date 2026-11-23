#!/usr/bin/env node
/**
 * Stages the compiled Rust `rayu` binary into `desktop/resources/bin/<os>-<arch>/`
 * so `electron-builder` bundles it as a self-contained sidecar for macOS, Windows, and Linux.
 *
 * Usage:
 *   node scripts/stage-rayu-binary.mjs [--target-os mac|win|linux] [--target-arch arm64|x64]
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(desktopDir, "..")

function mapPlatformToBuilderOs(platform) {
  if (platform === "darwin") return "mac"
  if (platform === "win32") return "win"
  return "linux"
}

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag)
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1]
  }
  return fallback
}

function main() {
  const targetOs = getArg("--target-os", mapPlatformToBuilderOs(process.platform))
  const targetArch = getArg("--target-arch", process.arch)
  const binName = targetOs === "win" ? "rayu.exe" : "rayu"

  const candidates = [
    process.env.RAYU_BINARY,
    path.join(repoRoot, "target", "release", binName),
    path.join(repoRoot, "target", "debug", binName),
  ].filter(Boolean)

  const sourcePath = candidates.find((p) => fs.existsSync(p))
  if (!sourcePath) {
    console.error(
      `Could not find compiled '${binName}'.\n` +
        `Build it first with: cargo build --release --bin rayu\n` +
        `Checked:\n  - ${candidates.join("\n  - ")}`
    )
    process.exit(1)
  }

  const destDir = path.join(
    desktopDir,
    "resources",
    "bin",
    `${targetOs}-${targetArch}`
  )
  fs.mkdirSync(destDir, { recursive: true })
  const destPath = path.join(destDir, binName)
  fs.copyFileSync(sourcePath, destPath)

  if (targetOs !== "win") {
    fs.chmodSync(destPath, 0o755)
  }

  const stat = fs.statSync(destPath)
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2)
  console.log(`Staged ${binName} (${sizeMb} MB) -> ${path.relative(desktopDir, destPath)}`)
}

main()
