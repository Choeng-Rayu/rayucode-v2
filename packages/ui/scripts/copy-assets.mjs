import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const cssFiles = [
  "styles/tokens.css",
  "styles/components.css",
  "styles/themes/web.css",
  "styles/themes/vscode.css",
];

for (const rel of cssFiles) {
  const src = path.join(root, "src", rel);
  const dst = path.join(root, "dist", rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
