/**
 * Browser subpath contract tests (`@rayu-dev/rayucode-sdk/browser`).
 *
 * Ensures the browser entrypoint stays 100% free of Node.js builtin modules
 * and Node-only globals so Next.js Client Components and VS Code Webviews can
 * bundle it without shims or polyfills.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_VERSION_MAJOR,
  API_VERSION_MINOR,
  CAPABILITIES_CAPABILITY,
  CONFIG_CAPABILITY,
  FRAME_FIDELITY_CAPABILITY,
  HarnessError,
  KNOWN_EVENT_KINDS,
  KNOWN_PERMISSION_MODES,
  KNOWN_REQUEST_KINDS,
  KNOWN_RUNTIME_COMMANDS,
  RayuCreditsAccumulator,
  formatRayuCredits,
  formatRayuCreditsExact,
  rayuCreditsLabel,
  rayuCreditsTooltip,
} from "../dist/browser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../dist");

function collectReachableModules(entryFile: string): string[] {
  const visited = new Set<string>();
  const queue = [entryFile];
  const importRe = /(?:import|export)\s+(?:[^'"]*\s+from\s+)?["']([^"']+)["']/g;

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(importRe)) {
      const specifier = match[1];
      assert.ok(
        specifier.startsWith("."),
        `browser entrypoint must not import external or Node builtin module "${specifier}" (from ${path.relative(distDir, file)})`,
      );
      const resolved = path.resolve(path.dirname(file), specifier);
      assert.ok(fs.existsSync(resolved), `missing relative import target ${resolved}`);
      queue.push(resolved);
    }
  }
  return [...visited];
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("browser entrypoint graph has zero Node builtins or external dependencies", () => {
  const entry = path.join(distDir, "browser.js");
  const files = collectReachableModules(entry);
  assert.ok(files.length >= 4, "expected browser.js + protocol.js + rayuCredits.js + errors.js");

  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, "utf8"));
    assert.doesNotMatch(
      code,
      /\bnode:[a-z_]+|\brequire\s*\(/,
      `Node builtin reference found in ${path.relative(distDir, file)}`,
    );
    const dts = file.replace(/\.js$/, ".d.ts");
    if (fs.existsSync(dts)) {
      const dtsCode = stripComments(fs.readFileSync(dts, "utf8"));
      assert.doesNotMatch(
        dtsCode,
        /from\s+["']node:|\bBuffer\b/,
        `Node-only type found in ${path.relative(distDir, dts)}`,
      );
    }
  }
});

test("browser entrypoint exports protocol v1.16 metadata and rayu credits helpers", () => {
  assert.equal(API_VERSION_MAJOR, 1);
  assert.equal(API_VERSION_MINOR, 16);
  assert.equal(CAPABILITIES_CAPABILITY, "capabilities_v1");
  assert.equal(CONFIG_CAPABILITY, "config_v1");
  assert.equal(FRAME_FIDELITY_CAPABILITY, "frame_fidelity_v1");
  assert.ok(KNOWN_EVENT_KINDS.includes("rayu_credits"));
  assert.ok(KNOWN_EVENT_KINDS.includes("permission_mode_changed"));
  assert.ok(KNOWN_EVENT_KINDS.includes("capabilities"));
  assert.ok(KNOWN_EVENT_KINDS.includes("config_state"));
  assert.ok(KNOWN_EVENT_KINDS.includes("config_changed"));
  assert.ok(KNOWN_REQUEST_KINDS.includes("send_message"));
  assert.ok(KNOWN_REQUEST_KINDS.includes("set_permission_mode"));
  assert.ok(KNOWN_REQUEST_KINDS.includes("get_capabilities"));
  assert.ok(KNOWN_REQUEST_KINDS.includes("get_config"));
  assert.ok(KNOWN_REQUEST_KINDS.includes("patch_config"));
  assert.deepEqual(KNOWN_PERMISSION_MODES, [
    "default",
    "accept_edits",
    "plan",
    "full_manage",
    "orchestrator",
  ]);
  for (const cmd of [
    "background",
    "mcp",
    "telegram",
    "features",
    "doctor",
    "session_search",
    "schedules",
    "ambient",
  ] as const) {
    assert.ok(KNOWN_RUNTIME_COMMANDS.includes(cmd), `missing RuntimeCommand ${cmd}`);
  }

  const err = new HarnessError("session_not_found", "missing");
  assert.equal(err.code, "session_not_found");
  assert.equal(err.name, "HarnessError");

  const acc = new RayuCreditsAccumulator();
  assert.equal(acc.recordCredits(12.5), true);
  assert.equal(acc.recordCredits(1.25), true);
  assert.equal(acc.totalCredits, 13.75);
  assert.equal(formatRayuCredits(acc.totalCredits!), "13.75");
  assert.equal(formatRayuCreditsExact(acc.totalCredits!), "13.75");
  assert.equal(rayuCreditsLabel(acc.totalCredits!), "Credits: 13.75");
  assert.equal(acc.formattedLabel({ soFar: true }), "Credits so far: 13.75");
  assert.equal(
    rayuCreditsTooltip(acc.totalCredits!),
    "Rayu credits charged for this request: 13.75",
  );
});
