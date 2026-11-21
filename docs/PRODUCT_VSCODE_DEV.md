# VS Code extension developer guide

The preview lives in [vscode/](../vscode). The [extension README](../vscode/README.md) covers starting the Rust bridge, configuring the socket, and installing the VSIX.

## Entry points

| Surface | Entry point | Responsibility |
|---|---|---|
| Extension Host | [harnessExtension.ts](../vscode/host/harnessExtension.ts) | VS Code commands, Webview lifecycle, workspace directory selection, clipboard, and typed replies |
| Session service | [harnessSession.ts](../vscode/host/harnessSession.ts) | SDK connection, workspace-owned session IDs, prompt acceptance, streaming and cancellation |
| Webview | [harnessApp.tsx](../vscode/webview/harnessApp.tsx) | Shared React components, the shared session reducer, and the postMessage adapter |
| Packaging | [build.mjs](../vscode/build.mjs) | Stage a CommonJS host, browser bundle, icons, and the extension manifest |

The original extension source from the TypeScript CLI remains in the repository as a reference for future editor features. Only the entry points above are built into this preview.

## Runtime contract

The Extension Host connects to the existing versioned Harness API through the Node SDK. The preview uses Harness v1.13 and negotiates the wire major and capabilities at connection time. The Webview uses browser-only SDK types and sends messages through the shared UI postMessage adapter. The host handles an explicit set of requests and supplies the working directory from the VS Code workspace.

A normal Harness prompt is acknowledged by the unsolicited `message_accepted` event. The host calls `RayucodeClient.sendMessage()` with `requireAccept: true` before acknowledging the Webview RPC. Streaming frames travel separately. The host checks the attached session for each operation and awaits a tool policy with an empty allowlist before each prompt. A failed or ambiguous send leaves the draft available. Reconnect fetches persisted history from Rust. Changes to the runtime socket close the old connection and invalidate pending attachments.

The preview leaves the Harness and daemon running when the editor closes. It uses the same credentials as the CLI. Tool approvals and structured user questions require additional runtime integration before their controls can be enabled in VS Code.

## Verification

```sh
npm run check:ts
npm run package:vscode
npm test --workspace @rayu-dev/rayucode-vscode
```

For editor smoke testing, install the VSIX in a dedicated VS Code profile and use a Rust daemon and bridge on temporary sockets and a temporary Rayu home. Exercise session creation, prompt acceptance, streamed text, stopping a live turn, and restoring the same session after a window reload. The extension must activate through its installed manifest.

Preserve the nonce-based Webview CSP, browser-only imports in the Webview bundle, and the Restricted Mode declaration in the manifest. Use shared styles with VS Code theme variables.
