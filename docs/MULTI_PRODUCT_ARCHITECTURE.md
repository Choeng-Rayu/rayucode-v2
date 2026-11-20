# RayuCode Multi-Product Architecture & Developer Overview

RayuCode is a multi-product AI coding platform built around **one shared Rust agent engine and daemon** (`rayu` + `rayucode-harness-api-bridge`), paired with **native Rust** for terminal and desktop apps and **shared React / TypeScript packages** for Web and VS Code.

## Product & Technology Matrix

| Product | UI Framework | Language | Core Integration | Developer Guide |
|---|---|---|---|---|
| **CLI & TUI** | **Ratatui** | Rust | Direct in-process + daemon Unix socket (`rayucode-app-core`, `rayucode-tui`) | [`PRODUCT_CLI_DEV.md`](./PRODUCT_CLI_DEV.md) |
| **Desktop App** | **Slint** | Rust | `crates/rayucode-sdk` (`RayucodeClient`, `AuthClient`, `rayu_credits`) | [`PRODUCT_DESKTOP_DEV.md`](./PRODUCT_DESKTOP_DEV.md) |
| **VS Code Extension** | **React + VS Code Webview** | TypeScript | Extension Host (`@rayu-dev/rayucode-sdk`) + Webview (`@rayu-dev/rayucode-ui`) | [`PRODUCT_VSCODE_DEV.md`](./PRODUCT_VSCODE_DEV.md) |
| **RayuCode Web** | **Next.js (App Router) + React** | TypeScript | Next.js / WS Bridge (`@rayu-dev/rayucode-sdk`) + Client UI (`@rayu-dev/rayucode-ui`) | [`PRODUCT_WEB_DEV.md`](./PRODUCT_WEB_DEV.md) |

---

## System Diagram: One Core, Four Surfaces

```text
                       ┌────────────────────────────────────┐
                       │   Shared Rust Core (rayucode-v2)   │
                       │                                    │
                       │  • rayu serve (multi-session daemon│
                       │  • Auth, Rayu Gateway, Live Models │
                       │  • Tool Execution, Swarm, MCP Pool │
                       │  • Canonical rayu_credits Engine   │
                       └──────────┬──────────────┬──────────┘
                                  │              │
                  Internal socket │              │ rayucode-harness-api-bridge
                   (rayu.sock)    │              │ (Protocol v1.12 NDJSON /rayu-api.sock)
                                  │              │
                        ┌─────────▼───┐    ┌─────┴──────────────────────────┐
                        │  1. CLI/TUI │    │        Shared Client SDKs       │
                        │   (Ratatui) │    ├────────────────┬───────────────┤
                        └─────────────┘    │  rayucode-sdk  │ @rayu-dev/    │
                                           │     (Rust)     │ rayucode-sdk  │
                                           └───────┬────────┴───┬───────┬───┘
                                                   │            │       │
                                       ┌───────────▼──┐    ┌────▼───┐ ┌─▼──────────┐
                                       │  2. Desktop  │    │3.VSCode│ │ 4. Web App │
                                       │ (Slint+Rust) │    │  Host  │ │ (Next.js)  │
                                       └──────────────┘    └────┬───┘ └─────┬──────┘
                                                                │           │
                                           ┌────────────────────▼───────────▼──┐
                                           │   Shared React UI (@rayu-dev/     │
                                           │   rayucode-ui + Tailwind + CSS)   │
                                           │   Chat, Composer, ModelSelector,  │
                                           │   DiffViewer, Markdown, Credits   │
                                           └───────────────────────────────────┘
```

---

## Repository Layout

### Inside `rayucode-v2` (Core Engine + Shared SDKs & Shared UI)
- `src/`, `crates/*` — Core Rust engine, Ratatui TUI, `rayu` binary, `rayucode-harness-api` (`v1.12`), `rayucode-harness-api-server` (`rayucode-harness-api-bridge`), `rayucode-sdk`.
- `sdk/typescript/` — `@rayu-dev/rayucode-sdk` (Node client + `@rayu-dev/rayucode-sdk/browser` zero-Node-builtin subpath).
- `packages/ui/` — `@rayu-dev/rayucode-ui` (shared React 19 UI components, `RayucodePlatformAdapter`, `sessionReducer`, sanitized Markdown, diff viewer, Tailwind preset, Web & VS Code theme CSS).
- `vscode/` — Baseline VS Code Extension source tree imported from `rayu-cli` ready to wire onto `@rayu-dev/rayucode-sdk` + `@rayu-dev/rayucode-ui`.

### Sibling Repositories (`/home/rayu/rayu/`)
- `../rayucode-desktop/` — Native Rust + Slint desktop repository (reusing framework-free harness/model crates from `../jcode-desktop` + `rayucode-v2/crates/rayucode-sdk`).
- `../rayucode-vscode/` — Standalone VS Code extension repository (or packaged VSIX release target from `rayucode-v2/vscode`).
- `../rayucode-web/` — Standalone Next.js agent web app (distinct from `../rayu-web`, which handles marketing, billing, Stripe/KHQR checkout, and account portal).

---

## Key Cross-Product Contracts (Do Not Duplicate Logic)

1. **Always go through the Harness API (`v1.12`) for non-TUI clients.**
   - Desktop (`rayucode-sdk`), VS Code (`@rayu-dev/rayucode-sdk`), and Web never re-implement LLM SSE loops, tool registries, or session storage in TypeScript.
   - Start or connect via `rayucode-harness-api-bridge` (`rayu api-bridge`, installed by `scripts/install_release.sh`).
2. **Preserve server-side provider & model ordering.**
   - `rayucode-v2` automatically prioritizes configured **Rayu Auth / `RAYU_API_KEY`** routes in exact live gateway `display_order` at the top of `runtime_info.routes`.
   - Frontend pickers (`ModelSelector`, Slint model list, TUI `/model`) must preserve backend route order rather than re-sorting alphabetically.
3. **Never duplicate Rayu credits formatting or accumulation.**
   - Micro-credit arithmetic and formatting (`"Credits: 443.76"`, `"<0.01"`, `"2.5k"`, hover tooltips) live canonically in `rayucode-message-types::rayu_credits` (re-exported by `rayucode-sdk`) and `sdk/typescript/src/rayuCredits.ts` (re-exported by `@rayu-dev/rayucode-sdk/browser`).
4. **Keep browser bundles free of Node builtins.**
   - React UI (`packages/ui`), VS Code Webviews, and Next.js Client Components import only `@rayu-dev/rayucode-sdk/browser` and communicate exclusively through `RayucodePlatformAdapter`.

---

## Quick Verification Before Any Multi-Product Change

```bash
# 1. Build & install CLI + rayucode-harness-api-bridge into ~/.local/bin/
umask 022 && CARGO_NET_OFFLINE=true bash scripts/install_release.sh --fast

# 2. Verify Rust <-> TypeScript protocol v1.12 schema parity
CARGO_NET_OFFLINE=true cargo test --offline -p rayucode-harness-api

# 3. Verify shared TypeScript SDK (incl. /browser) and shared React UI (@rayu-dev/rayucode-ui)
npm install
npm run check:ts
```

For deep dives on each shared package, see [`SHARED_PACKAGES_DEV.md`](./SHARED_PACKAGES_DEV.md).
