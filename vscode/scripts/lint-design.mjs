#!/usr/bin/env node
/**
 * RayuCode for VS Code — Single-Source Design Token, Boundary & Emoji Linter
 *
 * Adapted from desktop/scripts/lint-design.mjs for vscode/webview/src and vscode/shared:
 *   1. no-raw-hex-color: No raw hex colors (#RGB, #RRGGBB, #RRGGBBAA) outside CSS files
 *   2. no-arbitrary-tailwind-color: No arbitrary Tailwind color classes (bg-[#...], text-[rgb(...)], etc.)
 *   3. no-default-gray-palette: No default shadcn/Tailwind gray palettes (zinc, slate, neutral, stone, gray)
 *   4. no-emoji-in-ui: No literal UI emojis (\p{Extended_Pictographic}) in .ts/.tsx
 *      (ASCII-safe String.fromCodePoint(...) in ProjectIconPicker passes cleanly)
 *   5. no-node-builtins-in-webview: No Node built-in or vscode imports in webview/src or vscodeProtocol.ts
 *   6. no-cross-feature-deep-imports: Only import other features via @/features/<name> public barrel
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vscodeDir = path.resolve(__dirname, "..");
const webviewSrcDir = path.join(vscodeDir, "webview", "src");
const sharedDir = path.join(vscodeDir, "shared");

const LEGACY_SHARED_FILES = new Set([
  "accountChildProtocol.ts",
  "attachChannels.ts",
  "attachProtocol.ts",
  "commandProtocol.ts",
  "connectProtocol.ts",
  "contextMentions.ts",
  "engineExitCodes.ts",
  "inferenceSettings.ts",
  "loginProtocol.ts",
  "pairingProtocol.ts",
  "pastedPaths.ts",
  "permissionModes.ts",
  "planApproval.ts",
  "settingsChildProtocol.ts",
  "settingsProtocol.ts",
  "taskProjection.ts",
  "telegramConnectProtocol.ts",
  "toolStats.ts",
  "turnProgress.ts",
  "webviewProtocol.ts",
]);

const STYLE_RULES = [
  {
    id: "no-arbitrary-tailwind-color",
    regex:
      /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|decoration|accent|caret|shadow)-\[(?:#[^\]]+|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^\]]+\))\]/g,
    message:
      "Arbitrary Tailwind color class is banned. Use a semantic token from webview/src/styles/globals.css.",
  },
  {
    id: "no-raw-hex-color",
    regex: /(?<![A-Za-z0-9_-])#[0-9a-fA-F]{3,8}\b/g,
    message:
      "Raw hex color literal is banned in TS/TSX. Reference a CSS variable or Tailwind semantic token from globals.css (BrandLogo SVGs use rgb(...)).",
  },
  {
    id: "no-default-gray-palette",
    regex:
      /\b(?:bg|text|border|ring|divide|outline|from|to|via|fill|stroke)-(?:zinc|slate|neutral|stone|gray)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g,
    message:
      "Default Tailwind gray/zinc/slate/neutral/stone classes are banned. Use RayuCode warm tokens (bg-chrome, bg-canvas, bg-pane, bg-raised, text-ink, text-muted-ink, border-hairline, etc.).",
  },
  {
    id: "no-emoji-in-ui",
    regex: /\p{Extended_Pictographic}/gu,
    message:
      "Literal UI emojis are banned in RayuCode VS Code UI. Use crisp lucide-react icons or ASCII-safe String.fromCodePoint(...) in ProjectIconPicker.",
  },
];

const NODE_BUILTIN_REGEX =
  /\b(?:from\s+|import\s*\(|require\s*\()\s*["'](?:node:[a-z0-9_/-]+|fs|fs\/promises|path|path\/posix|path\/win32|child_process|os|crypto|net|tls|stream|http|https|url|util|zlib|buffer|events|worker_threads|vm|dns|dgram|readline|module|process|vscode)["']/g;

const CROSS_FEATURE_ALIAS_REGEX =
  /\bfrom\s+["']@\/features\/([a-z0-9-]+)\/(components|hooks|api|types|schemas|constants)(?:\/[^"']*)?["']/g;

const CROSS_FEATURE_RELATIVE_REGEX =
  /\bfrom\s+["'](?:\.\.\/)+([a-z0-9-]+)\/(components|hooks|api|types|schemas|constants)(?:\/[^"']*)?["']/g;

function walk(dir, opts = {}, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "styles" ||
        entry.name === "__tests__" ||
        entry.name === "node_modules" ||
        entry.name === "dist"
      ) {
        continue;
      }
      walk(full, opts, out);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      if (opts.skipLegacyShared && LEGACY_SHARED_FILES.has(entry.name)) {
        continue;
      }
      out.push(full);
    }
  }
  return out;
}

function stripBlockAndLineComments(source) {
  let inBlock = false;
  return source.split("\n").map((rawLine) => {
    let line = rawLine;
    if (inBlock) {
      const endIdx = line.indexOf("*/");
      if (endIdx === -1) return "";
      line = line.slice(endIdx + 2);
      inBlock = false;
    }
    let out = "";
    let i = 0;
    while (i < line.length) {
      if (line[i] === "/" && line[i + 1] === "/") {
        break;
      }
      if (line[i] === "/" && line[i + 1] === "*") {
        const endIdx = line.indexOf("*/", i + 2);
        if (endIdx === -1) {
          inBlock = true;
          break;
        }
        i = endIdx + 2;
        continue;
      }
      out += line[i];
      i += 1;
    }
    return out;
  });
}

function getOwningFeature(filePath) {
  const rel = path.relative(webviewSrcDir, filePath).split(path.sep);
  if (rel[0] === "features" && rel.length >= 2) {
    return rel[1];
  }
  return null;
}

function main() {
  const webviewFiles = walk(webviewSrcDir);
  const sharedFiles = walk(sharedDir, { skipLegacyShared: true });
  const files = [...webviewFiles, ...sharedFiles];
  const violations = [];

  for (const file of files) {
    const rel = path.relative(vscodeDir, file);
    const inWebview = file.startsWith(webviewSrcDir + path.sep);
    const isBrowserShared = path.basename(file) === "vscodeProtocol.ts";
    const owningFeature = inWebview ? getOwningFeature(file) : null;

    const rawSource = fs.readFileSync(file, "utf8");
    const rawLines = rawSource.split("\n");
    const strippedLines = stripBlockAndLineComments(rawSource);

    strippedLines.forEach((line, idx) => {
      const rawLine = rawLines[idx] ?? "";
      if (rawLine.includes("lint-design-ignore")) return;

      for (const rule of STYLE_RULES) {
        rule.regex.lastIndex = 0;
        const match = rule.regex.exec(line);
        if (match) {
          violations.push({
            file: rel,
            line: idx + 1,
            rule: rule.id,
            token: match[0],
            message: rule.message,
          });
        }
      }

      if (inWebview || isBrowserShared) {
        NODE_BUILTIN_REGEX.lastIndex = 0;
        const nodeMatch = NODE_BUILTIN_REGEX.exec(line);
        if (nodeMatch) {
          violations.push({
            file: rel,
            line: idx + 1,
            rule: "no-node-builtins-in-webview",
            token: nodeMatch[0],
            message:
              "Node built-in and vscode imports are forbidden in webview/src and vscodeProtocol.ts.",
          });
        }
      }

      if (inWebview) {
        CROSS_FEATURE_ALIAS_REGEX.lastIndex = 0;
        let featMatch;
        while ((featMatch = CROSS_FEATURE_ALIAS_REGEX.exec(line)) !== null) {
          const targetFeature = featMatch[1];
          if (targetFeature !== owningFeature) {
            violations.push({
              file: rel,
              line: idx + 1,
              rule: "no-cross-feature-deep-imports",
              token: featMatch[0],
              message: `Deep import into feature "${targetFeature}" is forbidden. Import from "@/features/${targetFeature}" public barrel instead.`,
            });
          }
        }

        if (owningFeature) {
          CROSS_FEATURE_RELATIVE_REGEX.lastIndex = 0;
          let relMatch;
          while ((relMatch = CROSS_FEATURE_RELATIVE_REGEX.exec(line)) !== null) {
            const targetFeature = relMatch[1];
            if (targetFeature !== owningFeature) {
              violations.push({
                file: rel,
                line: idx + 1,
                rule: "no-cross-feature-deep-imports",
                token: relMatch[0],
                message: `Relative deep import into feature "${targetFeature}" is forbidden. Import from "@/features/${targetFeature}" public barrel instead.`,
              });
            }
          }
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error(`lint:design failed with ${violations.length} violation(s):\n`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} [${v.rule}] "${v.token}"`);
      console.error(`    -> ${v.message}`);
    }
    process.exit(1);
  }

  console.log(
    `lint:design passed (${files.length} source file(s) checked, 0 violations).`,
  );
}

main();
