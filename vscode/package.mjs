import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const vsce = join(dirname(require.resolve("@vscode/vsce/package.json")), "vsce");
const stageDir = fileURLToPath(new URL("./dist/extension/", import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(stageDir, "package.json"), "utf8"),
);

const extraArgs = process.argv.slice(2);
const hasExplicitOut = extraArgs.some(
  (arg) => arg === "--out" || arg === "-o" || arg.startsWith("--out="),
);

const defaultFileName = `${manifest.name || "rayucode"}-${manifest.version || "0.0.0"}.vsix`;
const output = resolve(
  fileURLToPath(new URL("./dist/", import.meta.url)),
  defaultFileName,
);

const vsceArgs = ["package", "--no-dependencies"];
if (!hasExplicitOut) {
  vsceArgs.push("--out", output);
}
vsceArgs.push(...extraArgs);

const result = spawnSync(process.execPath, [vsce, ...vsceArgs], {
  cwd: stageDir,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
