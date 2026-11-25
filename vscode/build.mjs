import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { generateIconAssets } from "./scripts/generate-icon-assets.mjs";

const source = import.meta.dirname;
const stage = new URL("./dist/extension/", import.meta.url);
const media = new URL("media/", stage);
const manifest = JSON.parse(
  await readFile(new URL("./extension.manifest.json", import.meta.url), "utf8"),
);

await rm(stage, { recursive: true, force: true });
await mkdir(media, { recursive: true });

const reactEntryPath = fileURLToPath(
  new URL("./webview/src/main.tsx", import.meta.url),
);

async function buildWebview() {
  if (existsSync(reactEntryPath)) {
    const { build: viteBuild } = await import("vite");
    await viteBuild({
      configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
      logLevel: "warn",
    });
    return;
  }

  // Fallback before Wave 4 wires webview/src/main.tsx so build:vscode stays green mid-swarm.
  await esbuild({
    absWorkingDir: source,
    entryPoints: ["webview/harnessApp.tsx"],
    outfile: fileURLToPath(new URL("webview.js", media)),
    platform: "browser",
    format: "iife",
    target: "chrome132",
    bundle: true,
    jsx: "automatic",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
}

await Promise.all([
  esbuild({
    absWorkingDir: source,
    entryPoints: ["host/harnessExtension.ts"],
    outfile: fileURLToPath(new URL("extension.js", stage)),
    platform: "node",
    format: "cjs",
    target: "node22",
    bundle: true,
    external: ["vscode"],
    // The Node SDK resolves its optional runtime packages relative to import.meta.url.
    define: { "import.meta.url": "rayucodeModuleUrl" },
    banner: {
      js: "const rayucodeModuleUrl = require('node:url').pathToFileURL(__filename).href;",
    },
  }),
  buildWebview(),
  generateIconAssets(fileURLToPath(media)),
  cp(
    new URL("./assets/rayu-fox-icon.svg", import.meta.url),
    new URL("rayu-fox-icon.svg", media),
  ),
  cp(
    new URL("./assets/rayu-fox.png", import.meta.url),
    new URL("rayu-fox.png", media),
  ),
  cp(
    new URL("./assets/app-icon.png", import.meta.url),
    new URL("app-icon.png", media),
  ),
  cp(new URL("../LICENSE", import.meta.url), new URL("LICENSE", stage)),
  cp(new URL("./README.md", import.meta.url), new URL("README.md", stage)),
  writeFile(
    new URL("package.json", stage),
    JSON.stringify(manifest, null, 2) + "\n",
  ),
]);
