import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const srcDir = path.join(pkgRoot, "src");
const distDir = path.join(pkgRoot, "dist");

function walkFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("packages/ui source has zero acquireVsCodeApi or Node builtin imports", () => {
  const files = walkFiles(srcDir, [".ts", ".tsx"]);
  assert.ok(files.length >= 15, "expected shared UI modules");
  for (const file of files) {
    const code = stripComments(fs.readFileSync(file, "utf8"));
    assert.doesNotMatch(
      code,
      /\bacquireVsCodeApi\b/,
      `acquireVsCodeApi must not appear in ${path.relative(pkgRoot, file)}`,
    );
    assert.doesNotMatch(
      code,
      /from\s+["']node:[a-z_]+["']/,
      `Node builtin import found in ${path.relative(pkgRoot, file)}`,
    );
  }
});

test("VS Code theme and shared component CSS contain zero hardcoded hex colours", () => {
  for (const rel of ["styles/themes/vscode.css", "styles/components.css"]) {
    const full = path.join(distDir, rel);
    assert.ok(fs.existsSync(full), `expected built stylesheet ${rel}`);
    const css = stripComments(fs.readFileSync(full, "utf8"));
    assert.doesNotMatch(
      css,
      /#[0-9a-fA-F]{3,8}\b/,
      `hardcoded hex colour found in ${rel}`,
    );
  }
});

test("all exported stylesheets are staged into dist/styles", () => {
  for (const rel of [
    "styles/tokens.css",
    "styles/components.css",
    "styles/themes/web.css",
    "styles/themes/vscode.css",
  ]) {
    assert.ok(fs.existsSync(path.join(distDir, rel)), `missing ${rel} in dist`);
  }
});
