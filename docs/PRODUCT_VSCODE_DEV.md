# VS Code Extension Developer Guide

RayuCode for VS Code lives in [vscode/](../vscode). See [vscode/README.md](../vscode/README.md) for user installation and shortcuts, [vscode/VSCODE_DESIGN.md](../vscode/VSCODE_DESIGN.md) for the binding design token contract, and [vscode/docs/ARCHITECTURE.md](../vscode/docs/ARCHITECTURE.md) for the three-tier architecture.

## Architecture & Entry Points

| Layer | Entry Point | Build Tool | Responsibility |
| :--- | :--- | :--- | :--- |
| **Extension Host** | [vscode/host/harnessExtension.ts](../vscode/host/harnessExtension.ts) | `esbuild` (Node 22 CJS) | Extension activation, commands, status bar, `BridgeManager` auto-spawn, `SessionHub` multi-surface fanout, Zod RPC routers, `EditorBridge`, `GitChangesBridge`, and `WorkspacePanelManager` |
| **Shared Protocol** | [vscode/shared/vscodeProtocol.ts](../vscode/shared/vscodeProtocol.ts) | TypeScript (`zod` only) | Frozen browser-safe Host ↔ Webview message envelopes and typed RPC contracts across all 11 domains |
| **Webview App** | [vscode/webview/src/main.tsx](../vscode/webview/src/main.tsx) & [App.tsx](../vscode/webview/src/App.tsx) | Vite 6 + Tailwind CSS v4 (ESM) | React 19 dual-form-factor UI (`sidebar` & `editorPanel`), 11 feature-sliced modules, self-hosted Inter/JetBrains Mono fonts, and VS Code polarity observer |
| **Staging & VSIX** | [vscode/build.mjs](../vscode/build.mjs) & [vscode/package.mjs](../vscode/package.mjs) | Node + `@vscode/vsce` | Stages `dist/extension/{extension.js,media/*,package.json,README.md,LICENSE}` and packages `vscode/dist/rayucode-vscode-preview.vsix` |

## Runtime Contract (Harness API v1.14)

- **Bridge Auto-Discovery & Auto-Spawn:** `BridgeManager` (`vscode/host/runtime/bridgeManager.ts`) discovers `rayu` from `rayucode.binaryPath`, `RAYU_BINARY`, `~/.local/bin/rayu`, `~/.rayu/builds/{current,stable}/rayu`, or `PATH`, attaches to `rayu-api.sock`, or spawns `rayu --no-update api-bridge` under a lockfile guard when `rayucode.autoStartBridge` is enabled.
- **Single Connection, Dual Surfaces:** `SessionHub` (`vscode/host/runtime/sessionHub.ts`) holds one `@rayu-dev/rayucode-sdk` connection per window and broadcasts live Harness frames, background process snapshots, and appearance sync events to both the Compact Sidebar (`rayucode.chat`) and the Full Editor Panel (`rayucode.workspace`).
- **Interactive Tools & Permissions:** Sessions run with full interactive Rust tool execution, Harness API v1.14 `set_permission_mode`, `permission_response`, `question_response`, `BackgroundTool` (`Alt+B`), and `RuntimeCommand` routing.
- **Security & Secret Handling:** The webview runs under a strict nonce-based CSP (`default-src 'none'`, `connect-src 'none'`, self-hosted fonts/assets via `webview.cspSource`). Provider API keys and Telegram tokens are forwarded straight to the Rust daemon and are never persisted in VS Code state or `settings.json`. Untrusted workspaces are explicitly disabled (`untrustedWorkspaces.supported: false`).

## Developer Workflow

### 1. Standalone Webview Dev Preview (Vite + Mock Bridge)

Run the React 19 webview directly in your browser on `http://localhost:5174` using [vscode/index.html](../vscode/index.html) and `mock-vscode-bridge.ts`:

```sh
npm run dev:webview --workspace @rayu-dev/rayucode-vscode
```

### 2. Design Token & Architectural Boundary Linting

All colors, surfaces, borders, and syntax tokens must come from [vscode/webview/src/styles/globals.css](../vscode/webview/src/styles/globals.css). Run the automated design linter to enforce zero raw hex colors, zero arbitrary Tailwind color classes, zero default gray/zinc/slate/neutral/stone classes, zero raw UI emojis, zero Node built-ins in webview code, and zero cross-feature deep imports:

```sh
npm run lint:design --workspace @rayu-dev/rayucode-vscode
```

### 3. Typecheck & Tests (Host + Vitest Webview)

```sh
# Shared SDK & UI package checks
npm run check:ts

# VS Code TypeScript strict check
npm run typecheck --workspace @rayu-dev/rayucode-vscode

# Host unit tests (node:test via esbuild) + Webview integration tests (Vitest + Testing Library)
npm test --workspace @rayu-dev/rayucode-vscode
```

### 4. Rust Harness API Verification

When modifying Rust Harness API frames or runtime commands:

```sh
cargo test -p rayucode-harness-api -p rayucode-harness-api-server
cargo test -p rayucode-app-core --lib runtime_commands
```

### 5. Build & Package `.vsix`

```sh
# Build SDK, UI, Extension Host (esbuild), and React 19 Webview (Vite 6)
npm run build:vscode

# Build + package vscode/dist/rayucode-vscode-preview.vsix
npm run package:vscode
```

### 6. Smoke-Testing in VS Code

Launch an Extension Development Host against the staged directory:

```sh
code --extensionDevelopmentPath="$PWD/vscode/dist/extension" /path/to/trusted-workspace
```

Or install the generated VSIX into a dedicated VS Code profile:

```sh
code --profile rayu-dev --install-extension "$PWD/vscode/dist/rayucode-vscode-preview.vsix"
```

Verify both the Compact Sidebar (`rayucode.chat`) and the Full Editor Panel (`rayucode.workspace`) across Warm Graphite Dark (Rayu Green & Ocean Blue), Warm Paper Light, and Match VS Code Theme modes.
