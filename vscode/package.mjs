import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const vsce = join(dirname(require.resolve("@vscode/vsce/package.json")), "vsce");
const output = fileURLToPath(new URL("./dist/rayucode-vscode-preview.vsix", import.meta.url));
const result = spawnSync(process.execPath, [vsce, "package", "--no-dependencies", "--out", output], {
  cwd: fileURLToPath(new URL("./dist/extension/", import.meta.url)),
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
