#!/usr/bin/env node
/**
 * RayuCode Desktop — Single-Source Design Token Linter
 *
 * Enforces DESIGN.md & desktop/src/styles/globals.css rules across src/ (.ts/.tsx):
 *   1. No raw hex colors (#RGB, #RRGGBB, #RRGGBBAA) in TSX/TS components
 *   2. No arbitrary Tailwind hex classes (bg-[#...], text-[#...], border-[#...], etc.)
 *   3. No default shadcn/Tailwind gray palettes (zinc, slate, neutral, stone, gray)
 *   4. No UI emojis in product components (use lucide-react icons or prototype SVG glyphs)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const srcDir = path.join(desktopDir, "src");

const RULES = [
  {
    id: "no-arbitrary-hex-class",
    regex: /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-\[#[^\]]+\]/g,
    message:
      "Arbitrary Tailwind hex color class is banned. Use a semantic token from src/styles/globals.css.",
  },
  {
    id: "no-raw-hex-literal",
    regex: /(?<![A-Za-z0-9_-])#[0-9a-fA-F]{3,8}\b/g,
    message:
      "Raw hex color literal is banned in src/**/*.{ts,tsx}. Reference a CSS variable or Tailwind semantic token from globals.css.",
  },
  {
    id: "no-default-gray-palette",
    regex: /\b(?:bg|text|border|ring|divide|outline)-(?:zinc|slate|neutral|stone|gray)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g,
    message:
      "Default Tailwind gray/zinc/slate/neutral/stone classes are banned. Use RayuCode warm tokens (bg-chrome, bg-canvas, bg-pane, bg-raised, text-ink, text-muted-ink, border-hairline, etc.).",
  },
  {
    id: "no-ui-emoji",
    regex: /\p{Extended_Pictographic}/gu,
    message:
      "UI emojis are banned in RayuCode Desktop. Use crisp 1.5px stroke lucide-react icons.",
  },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "styles" ||
        entry.name === "__tests__" ||
        entry.name === "node_modules"
      ) {
        continue;
      }
      walk(full, out);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(line) {
  return line.replace(/\/\/.*$/, "");
}

function main() {
  const files = walk(srcDir);
  const violations = [];

  for (const file of files) {
    const rel = path.relative(desktopDir, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((rawLine, idx) => {
      if (rawLine.includes("lint-design-ignore")) return;
      const line = stripComments(rawLine);
      for (const rule of RULES) {
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

  console.log(`lint:design passed (${files.length} source file(s) checked, 0 violations).`);
}

main();
