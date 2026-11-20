# Product 3: VS Code Extension Developer Guide (React + Webview + Host)

The VS Code Extension delivers RayuCode inside Visual Studio Code while sharing its entire React chat UI, Markdown/code renderer, diff viewer, settings views, and Harness `v1.12` state logic with RayuCode Web via **`@rayu-dev/rayucode-ui`** and **`@rayu-dev/rayucode-sdk`**.

---

## Source Locations

- **Imported Baseline inside `rayucode-v2`**: [`vscode/`](../vscode) (copied from `rayu-cli/rayu/src/vscode`)
  - [`vscode/extension.manifest.json`](../vscode/extension.manifest.json) — extension manifest, commands, views (`rayucode.chat`, `rayucode.contextDrop`), and Rayu auth provider contribution
  - [`vscode/host/`](../vscode/host) — VS Code Extension Host modules (CommonJS Node + `vscode` API)
  - [`vscode/webview/`](../vscode/webview) — React Webview entrypoint and styles
  - [`vscode/assets/`](../vscode/assets) — Extension icons and assets
- **Shared Packages**:
  - [`packages/ui`](../packages/ui) (`@rayu-dev/rayucode-ui`)
  - [`sdk/typescript`](../sdk/typescript) (`@rayu-dev/rayucode-sdk` + `@rayu-dev/rayucode-sdk/browser`)

---

## Two-Process Architecture (Host vs. Webview)

VS Code splits every extension into two isolated processes. Keeping this boundary strict prevents Node bundling errors and security CSP violations:

```text
┌─────────────────────────────────────────────┐
│ VS Code Extension Host (Node, CommonJS)     │
│                                             │
│ • imports `vscode` API                      │
│ • imports `@rayu-dev/rayucode-sdk`          │
│   (`RayucodeClient.connect` / `launch`)     │
│ • Rayu AuthenticationProvider (Accounts menu│
│ • StatusBar credits, Context Drop, Diffs    │
└──────────────────────┬──────────────────────┘
                       │
      webview.postMessage / onDidReceiveMessage
   { type: "rayucode.harness.request" | ".frame" }
                       │
┌──────────────────────▼──────────────────────┐
│ VS Code Webview (Browser Sandbox)           │
│                                             │
│ • calls `acquireVsCodeApi()` ONCE in shell  │
│ • wraps it in `createPostMessageAdapter()`  │
│ • mounts `<RayucodeWorkspace />`            │
│   from `@rayu-dev/rayucode-ui`              │
│ • imports `@rayu-dev/rayucode-ui/           │
│   styles/themes/vscode.css` (--vscode-*)    │
└─────────────────────────────────────────────┘
```

### 1. Extension Host Rules (`dist/extension.js`)
- **Format must be CommonJS** (`"type": "commonjs"` in packaged `package.json`, `"main": "./extension.js"`), with `vscode` marked `--external:vscode`.
- **Replace the legacy `host/engine/*` Node/Bun process spawner** with `@rayu-dev/rayucode-sdk`:
  - **Shared mode (default for editor workflows)**: `RayucodeClient.connect()` talks to `~/.rayu/rayu-api.sock` (or starts `rayu api-bridge` automatically if needed) so terminal `rayu` and VS Code share the same sessions.
  - **Embedded mode**: `RayucodeClient.launch({ workingDir })` starts an isolated daemon instance.
- **Forward Harness frames safely**: Forward each incoming `ApiEvent` / reply from `RayucodeClient` to the mounted Webview via `{ type: "rayucode.harness.frame", frame }`, and translate Webview host actions:
  - `rayucode.host.openFile` -> `vscode.window.showTextDocument(...)`
  - `rayucode.host.openDiff` -> `vscode.commands.executeCommand("vscode.diff", ...)`
  - `rayucode.host.copyToClipboard` -> `vscode.env.clipboard.writeText(...)`
  - `rayucode.host.openExternal` -> `vscode.env.openExternal(vscode.Uri.parse(url))`

### 2. Webview Shell Integration (Using Shared Packages)
Never duplicate chat components inside the VS Code webview. Mount `@rayu-dev/rayucode-ui` like this:

```tsx
import "@rayu-dev/rayucode-ui/styles/tokens.css";
import "@rayu-dev/rayucode-ui/styles/themes/vscode.css";
import "@rayu-dev/rayucode-ui/styles/components.css";

import { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { createPostMessageAdapter, RayucodeWorkspace } from "@rayu-dev/rayucode-ui";

const vscode = acquireVsCodeApi();

function App() {
  const { adapter, dispose } = useMemo(
    () =>
      createPostMessageAdapter({
        bridge: {
          postMessage: (msg) => vscode.postMessage(msg),
          onMessage: (handler) => {
            const listener = (ev: MessageEvent) => handler(ev.data);
            window.addEventListener("message", listener);
            return () => window.removeEventListener("message", listener);
          },
        },
      }),
    [],
  );

  useEffect(() => dispose, [dispose]);
  return <RayucodeWorkspace adapter={adapter} showSidebar={false} />;
}

createRoot(document.getElementById("root")!).render(<App />);
```

---

## Mandatory Security & Theme Rules

1. **Zero Hardcoded Hex Colors in VS Code CSS**:
   - Always load `@rayu-dev/rayucode-ui/styles/themes/vscode.css`, which maps every `--rc-*` token exclusively to VS Code's `--vscode-*` CSS variables.
   - Automated test `packages/ui/test/boundary.test.ts` fails if any `#rgb`/`#rrggbb` hex literal enters `themes/vscode.css` or `components.css`, ensuring Light, Dark, High Contrast Dark, and High Contrast Light themes all work cleanly.
2. **Untrusted Workspaces**:
   - `capabilities.untrustedWorkspaces.supported` must remain `false` in `extension.manifest.json` because Rayu executes shell/file tools and loads project MCP servers.
3. **Zero Node Builtins in Webview Bundle**:
   - Build the webview with `platform: "browser"` / `target: "browser"`. `@rayu-dev/rayucode-ui` and `@rayu-dev/rayucode-sdk/browser` are guaranteed free of `node:*` imports.
4. **Sanitized Markdown**:
   - Keep VS Code Webview CSP strict (`script-src 'nonce-...'`); assistant/tool HTML passes through `renderSafeMarkdown()` (`xss` allowlist).

---

## Developing & Verifying Shared UI Changes for VS Code

```bash
cd /home/rayu/rayu/rayucode-v2
npm run check:ts
```

When packaging the sibling `../rayucode-vscode` (or staging `vscode/`), link `@rayu-dev/rayucode-sdk` and `@rayu-dev/rayucode-ui` via workspace/file protocol and verify `dist/webview.js` bundles cleanly for `browser` with zero Node polyfills.
