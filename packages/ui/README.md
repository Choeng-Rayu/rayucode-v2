# `@rayu-dev/rayucode-ui`

Shared React 18/19 + TypeScript component library, Harness API `v1.12` state engine, sanitized Markdown/code renderer, diff viewer, and dual theme token system powering **RayuCode Web (Next.js)** and **RayuCode VS Code Extension**.

## Exports

- `@rayu-dev/rayucode-ui`:
  - `RayucodeWorkspace`, `ChatTranscript`, `TurnCreditsFooter`, `ThinkingBlock`, `Composer`, `ModelSelector`, `AgentActivityBar`, `ToolCallCard`, `PermissionCard`, `DiffViewer`, `TodoListCard`, `SessionSidebar`, `SessionHeader`, `SettingsPanel`, `MarkdownRenderer`
  - `createWebSocketAdapter`, `createPostMessageAdapter`, `RayucodePlatformProvider`, `useRayucodePlatform`
  - `applyApiEvent`, `createInitialSessionState`, `hydrateHistoryMessages`, `renderSafeMarkdown`, `computeDiffRows`
- `@rayu-dev/rayucode-ui/tailwind-preset`: shared `rc-*` Tailwind theme colors, fonts, and radii
- `@rayu-dev/rayucode-ui/styles/tokens.css`: structural CSS cascade layers & spacing tokens
- `@rayu-dev/rayucode-ui/styles/themes/web.css`: Rayu Web dark/light CSS variables
- `@rayu-dev/rayucode-ui/styles/themes/vscode.css`: VS Code `--vscode-*` zero-hex mapping
- `@rayu-dev/rayucode-ui/styles/components.css`: shared layered component styles

## Commands

```bash
npm --workspace @rayu-dev/rayucode-ui run check
```

See [Shared Packages Developer Guide](../../docs/SHARED_PACKAGES_DEV.md) for architecture and extension rules.
