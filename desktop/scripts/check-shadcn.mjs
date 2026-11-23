#!/usr/bin/env node
/**
 * RayuCode Desktop — Pre-Flight shadcn/ui Component Checker
 *
 * Usage:
 *   node scripts/check-shadcn.mjs list [--json]
 *   node scripts/check-shadcn.mjs check button popover tabs [--json]
 *   node scripts/check-shadcn.mjs ensure button popover tabs
 *
 * Exit codes:
 *   0 — All requested components are installed (or list succeeded)
 *   1 — Usage / runtime error
 *   2 — One or more requested components are missing
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const uiDir = path.join(desktopDir, "src", "components", "ui");
const componentsJsonPath = path.join(desktopDir, "components.json");

const RECOMMENDED_PRIMITIVES = [
  "button",
  "popover",
  "dropdown-menu",
  "tooltip",
  "tabs",
  "switch",
  "select",
  "dialog",
  "scroll-area",
  "skeleton",
  "separator",
];

function getInstalledComponents() {
  if (!fs.existsSync(uiDir)) return [];
  return fs
    .readdirSync(uiDir)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => f.replace(/\.(tsx|ts)$/, ""))
    .sort();
}

function normalizeName(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@shadcn\//, "")
    .replace(/\.(tsx|ts)$/, "");
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const cleanArgs = args.filter((a) => a !== "--json");
  const cmd = cleanArgs[0];

  if (!cmd || !["list", "check", "ensure"].includes(cmd)) {
    console.error(
      "Usage:\n" +
        "  node scripts/check-shadcn.mjs list [--json]\n" +
        "  node scripts/check-shadcn.mjs check <component...> [--json]\n" +
        "  node scripts/check-shadcn.mjs ensure <component...>"
    );
    process.exit(1);
  }

  const hasComponentsJson = fs.existsSync(componentsJsonPath);
  const installed = getInstalledComponents();
  const installedSet = new Set(installed);

  if (cmd === "list") {
    const missingRecommended = RECOMMENDED_PRIMITIVES.filter(
      (n) => !installedSet.has(n)
    );
    const payload = {
      componentsJson: hasComponentsJson,
      uiDir: path.relative(desktopDir, uiDir),
      installed,
      recommended: RECOMMENDED_PRIMITIVES,
      missingRecommended,
    };

    if (asJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`components.json: ${hasComponentsJson ? "present" : "MISSING"}`);
      console.log(`Installed (${installed.length}): ${installed.join(", ") || "(none)"}`);
      if (missingRecommended.length > 0) {
        console.log(
          `Missing recommended (${missingRecommended.length}): ${missingRecommended.join(", ")}`
        );
        console.log(
          `Install command: pnpm dlx shadcn@latest add --yes ${missingRecommended.join(" ")}`
        );
      } else {
        console.log("All recommended RayuCode primitives are installed.");
      }
    }
    process.exit(0);
  }

  const requested = cleanArgs.slice(1).map(normalizeName).filter(Boolean);
  if (requested.length === 0) {
    console.error(`Error: '${cmd}' requires at least one component name.`);
    process.exit(1);
  }

  const found = requested.filter((n) => installedSet.has(n));
  const missing = requested.filter((n) => !installedSet.has(n));
  const installCmd =
    missing.length > 0
      ? `pnpm dlx shadcn@latest add --yes ${missing.join(" ")}`
      : null;

  if (cmd === "check") {
    const payload = {
      ok: missing.length === 0,
      componentsJson: hasComponentsJson,
      found,
      missing,
      installCommand: installCmd,
    };
    if (asJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (missing.length === 0) {
      console.log(`OK — All installed: ${found.join(", ")}`);
    } else {
      console.error(`MISSING (${missing.length}): ${missing.join(", ")}`);
      console.error(`Run: ${installCmd}`);
    }
    process.exit(missing.length === 0 ? 0 : 2);
  }

  if (cmd === "ensure") {
    if (missing.length === 0) {
      console.log(`All requested components already installed: ${found.join(", ")}`);
      process.exit(0);
    }
    console.log(`Installing missing shadcn/ui primitives: ${missing.join(", ")}`);
    const res = spawnSync(
      "pnpm",
      ["dlx", "shadcn@latest", "add", "--yes", ...missing],
      {
        cwd: desktopDir,
        stdio: "inherit",
        shell: process.platform === "win32",
      }
    );
    process.exit(res.status ?? 1);
  }
}

main();
