# Shared Packages Developer Guide (`rayucode-sdk`, `@rayu-dev/rayucode-sdk`, `@rayu-dev/rayucode-ui`)

This guide explains how to develop, extend, and test the shared packages inside `rayucode-v2` that power CLI, Slint Desktop, VS Code Extension, and RayuCode Web.

---

## Package Overview

| Package | Path | Language / Target | Consumers |
|---|---|---|---|
| `rayucode-harness-api` | [`crates/rayucode-harness-api`](../crates/rayucode-harness-api) | Rust (wire schema v1.12) | Daemon bridge + Rust SDK + TS parity test |
| `rayucode-sdk` | [`crates/rayucode-sdk`](../crates/rayucode-sdk) | Rust (blocking + SSH + `AuthClient`) | **Slint Desktop App**, Rust tools |
| `@rayu-dev/rayucode-sdk` | [`sdk/typescript`](../sdk/typescript) | TypeScript (Node >= 20) | **VS Code Host**, **Next.js Server / WS Bridge** |
| `@rayu-dev/rayucode-sdk/browser` | [`sdk/typescript/src/browser.ts`](../sdk/typescript/src/browser.ts) | Pure TypeScript (zero Node builtins) | **`packages/ui`**, **VS Code Webview**, **Next.js Client** |
| `@rayu-dev/rayucode-ui` | [`packages/ui`](../packages/ui) | React 18/19 + TypeScript + CSS/Tailwind | **Next.js Web**, **VS Code Webview** |

---

## 1. Updating Protocol v1.12 (`rayucode-harness-api` <-> `@rayu-dev/rayucode-sdk`)

Schema drift is enforced automatically by unit tests on both sides (`typescript_sdk_lists_every_variant` in Rust and `test/schema-parity.test.ts` in TypeScript).

### Checklist when adding an `ApiRequest` or `ApiEvent` variant
1. Update the Rust enums in `crates/rayucode-harness-api/src/requests.rs` and `crates/rayucode-harness-api/src/events.rs`.
2. Bump `API_VERSION_MINOR` in both:
   - `crates/rayucode-harness-api/src/lib.rs`
   - `sdk/typescript/src/protocol.ts`
3. Mirror the TypeScript union variant and add its snake_case tag to `KNOWN_REQUEST_KINDS` / `KNOWN_EVENT_KINDS` in `sdk/typescript/src/protocol.ts`.
4. Translate internal daemon messages in `crates/rayucode-harness-api-server/src/translate.rs`.
5. If browser UI should react to the event, handle it in `packages/ui/src/state/sessionReducer.ts` (without importing Node builtins!).
6. Verify parity:
   ```bash
   CARGO_NET_OFFLINE=true cargo test --offline -p rayucode-harness-api
   npm --workspace @rayu-dev/rayucode-sdk run check
   ```

---

## 2. `@rayu-dev/rayucode-sdk/browser` Rule

Because Vite, esbuild, and Next.js client bundles reject `node:net`, `node:fs`, `node:child_process`, or `Buffer`:
- **`sdk/typescript/src/browser.ts`** must ONLY re-export browser-safe modules (`protocol.ts`, `rayuCredits.ts`, `errors.ts`).
- `sdk/typescript/test/browser.test.ts` walks the compiled `dist/browser.js` dependency graph and fails if any `node:*` import or `Buffer` reference slips in.

### Credits API Parity
Both `@rayu-dev/rayucode-sdk/browser` and Rust `rayucode_sdk` expose the exact same micro-credit (`1_000_000` per credit) formatting:
- TypeScript: `formatRayuCredits`, `rayuCreditsLabel`, `formatRayuCreditsExact`, `rayuCreditsTooltip`, `RayuCreditsAccumulator`
- Rust: `format_rayu_credits`, `rayu_credits_label`, `format_rayu_credits_exact`, `rayu_credits_tooltip`, `RayuCreditsAccumulator`

---

## 3. Extending `@rayu-dev/rayucode-ui` (`packages/ui`)

### Directory Map
```text
packages/ui/
  src/
    adapter/
      types.ts          # RayucodePlatformAdapter contract (web | vscode capabilities)
      transports.ts     # createWebSocketAdapter (Web), createPostMessageAdapter (VS Code)
      context.tsx       # <RayucodePlatformProvider> & useRayucodePlatform()
    state/
      sessionReducer.ts # Pure Harness v1.12 state machine (streams, tools, credits, todos, perms)
    markdown/
      renderMarkdown.ts # marked + highlight.js + xss allowlist sanitizer
    components/
      RayucodeWorkspace.tsx # Full drop-in workspace (Sidebar + Header + Transcript + Composer)
      ChatTranscript.tsx, TurnCreditsFooter.tsx, ThinkingBlock.tsx
      Composer.tsx, ModelSelector.tsx, AgentActivityBar.tsx
      ToolCallCard.tsx, PermissionCard.tsx, DiffViewer.tsx
      SessionSidebar.tsx, SessionHeader.tsx, SettingsPanel.tsx
      TodoListCard.tsx, MarkdownRenderer.tsx, Icons.tsx
    styles/
      tokens.css        # Cascade layers + spacing/radius/typography tokens (no colors)
      components.css    # Semantic --rc-* rules (zero hardcoded hex)
      themes/web.css    # Rayu Web light/dark tokens (#00d992 accent, #101010 dark bg)
      themes/vscode.css # VS Code --vscode-* variable mapping (zero hardcoded hex)
      tailwind.preset.ts# Shared Tailwind extend config (bg-rc-canvas, text-rc-accent, etc.)
  test/
    boundary.test.ts    # Ensures zero acquireVsCodeApi, zero Node builtins, zero hex in vscode.css
    session-reducer.test.ts
    components.test.ts  # SSR, XSS sanitization, TurnCreditsFooter, DiffViewer tests
```

### Design Rules for Shared Components
1. **Zero host globals inside `packages/ui`**:
   - Never call `acquireVsCodeApi()` or assume `window.WebSocket` inside components; route host actions through `useRayucodePlatform()` / `RayucodePlatformAdapter`.
   - `packages/ui/test/boundary.test.ts` fails CI if `acquireVsCodeApi` or `node:*` imports appear anywhere under `packages/ui/src/`.
2. **Zero hardcoded colors in `components.css` and `themes/vscode.css`**:
   - Always use semantic CSS custom properties (`var(--rc-bg)`, `var(--rc-fg)`, `var(--rc-accent)`, `var(--rc-border)`, etc.) so the exact same component CSS works in both VS Code High Contrast themes and Rayu Web dark/light themes.
3. **XSS-safe Markdown**:
   - All model and tool output rendered as HTML must pass through `renderSafeMarkdown()` in `packages/ui/src/markdown/renderMarkdown.ts`.

### Running Workspace TypeScript Checks

```bash
# From /home/rayu/rayu/rayucode-v2
npm run build:ts     # Build SDK + Shared UI + copy CSS assets to dist/styles
npm run check:ts     # Typecheck + run all 92 SDK tests + all 11 Shared UI tests
```
