# RayuCode Desktop — Design & Architecture Specification

**Date:** 2026-11-23  
**Status:** Approved  
**Repository:** `rayucode-v2` (Desktop workspace at `desktop/`, visual golden baseline at `prototype/`, shared Rust CLI engine in `crates/`)  
**Target Stack:** Electron + Vite + React 19 + TypeScript 5.7+ + Tailwind CSS v4 + shadcn/ui (Radix UI primitives) + TanStack Query v5 + Zustand + Zod + Shared Rust `rayu` CLI Daemon

---

## 1. Product Purpose & Core Architecture Principles

RayuCode Desktop is the flagship desktop command center for RayuCode (`rayucode.com`), wrapping the **single shared Rust `rayu` CLI/daemon** (`crates/rayucode-agent-runtime`, `crates/rayucode-swarm-core`, `crates/rayucode-overnight-core`, `crates/rayucode-provider-*`, `crates/rayucode-voice`, `crates/rayucode-storage`) in a fast, zero-AI-slop **Electron + React 19 + TypeScript** desktop interface.

### Non-Negotiable Constraints
1. **Single Coding Engine:** Zero duplicated agent logic in TypeScript. Electron Main connects to the shared local Rust `rayu` daemon (`~/.rayu/builds/shared-server/rayu` or bundled sidecar binary) over Unix socket / named pipe JSON-RPC via `@rayu-dev/rayucode-sdk`.
2. **1:1 Visual Parity with `prototype/`:** Every color token, radius, specular bevel, layout dimension, typography scale, and interaction flow in `desktop/` MUST match `prototype/` and the authoritative root `DESIGN.md`.
3. **Zero AI Slop:** No default shadcn zinc/slate cards, no rainbow tool badges, no emojis in UI chrome, no bloated avatar banners inside chat streams, no folder tree anywhere in v1, no file chips inside the composer, no focus outline glow on the chat composer.
4. **Change Once, Change Everywhere:** All colors, surfaces, borders, bevels, and theme/accent overrides live exclusively in `desktop/src/styles/globals.css` mapped into Tailwind v4 `@theme inline` and shadcn/ui semantic CSS variables. Raw hex colors (`#...`) and arbitrary Tailwind color utilities (`bg-[#...]`) are banned in feature TSX and enforced by `pnpm lint:design`.

---

## 2. Authoritative Design System (`DESIGN.md` & `desktop/src/styles/globals.css`)

### 2.1 Themes & User-Selectable Accents
- **Warm Graphite Dark (Default):**
  - Chrome / Outer Rail / Sidebar: `#11110E` (`--bg-chrome`)
  - Inset Canvas: `#0C0C0A` (`--bg-canvas`)
  - Pane / Drawer / Cards: `#161613` (`--bg-pane`)
  - Raised Composer / Popovers: `#1B1B17` (`--bg-raised`, solid `#1D1D1A` for floating popovers, `#232320` for rich hover cards)
  - Inset Code / Shell Wells: `#10100D` (`--bg-inset`)
  - Ink / Body / Muted / Faint: `#ECEAE3` / `#D4D0C5` / `#8F8B80` / `#68645B`
  - Hairlines & Machined Specular Bevels: `#2A2924`, `--border-premium: rgba(255,255,255,0.11)`, `--border-premium-hi: rgba(255,255,255,0.18)`, `--bevel-surface`, `--bevel-card`, `--bevel-primary`
- **Warm Paper Light (`[data-theme="light"]`):**
  - Chrome: `#F7F7F4`, Canvas: `#FFFFFF`, Pane: `#FAFAF7`, Inset: `#F4F4F0`, Ink: `#26251E`, Body: `#5A5852`, Muted: `#6F6C62`
- **Accent Theme Selector (`localStorage: rayu-accent`, `data-accent`):**
  - **Rayu Green (Brand Default):** Dark `#3DBD84` (`--accent`) / `#5FD19C` (`--accent-text`) / `#06140C` (`--accent-ink`); Light `#0F7B4F` / `#0D7449` / `#FFFFFF`
  - **Ocean Blue (`[data-accent="blue"]`):** Dark `#3B82F6` / `#5EA6FF` / `#FFFFFF`; Light `#1D6FE2` / `#1A63CC` / `#FFFFFF`
  - Accessible from both top-right `⋯` menus (`Accent: Green / Blue`) and **Settings → Appearance**.

### 2.2 Typography
- **UI Sans:** `Inter` (`-apple-system, "SF Pro Text", "Segoe UI", sans-serif`)
- **Code / Telemetry / Tabular Numbers:** `JetBrains Mono` (`font-variant-numeric: tabular-nums`)
- **Editorial Hero Italic:** `Instrument Serif` (welcome heading accent word only)

### 2.3 Locked Layout & Component Contracts
1. **Left Slim Icon Rail (`52px`) + Collapsible Session/View Pane (`244px`, total `296px`, `⇧⌘S`):**
   - Exactly **6 primary nav icons**: `Home`, `Swarm`, `Automations`, `Plugins`, `Changes`, `Telegram Remote` (with live green dot `.rail-live-dot`).
   - Exactly **2 bottom icons**: `Plan & Usage` popover (`#i-ring`) + `LK` Profile menu.
   - Global sleek pill hover tooltips (`Tooltip` primitive) positioned right of `.cx-rail`, below top bars, and above canvas/composer controls.
2. **Unified Chat Composer (`max-width: 732px`, pixel-aligned with `.stream`):**
   - On New Session (`Home`): project + checkout tray above inner composer box (`Browser` and `Office/MD` buttons removed).
   - During active chat: **single compact double-bordered composer only** (tray hidden), **zero file chips inside composer**, **zero focus glow ring**.
   - **2-Stage Model & Effort Popover:** Click `<Model> <Effort> ▾` → Stage 1 floating solid Effort Card (`#i-zap` fast toggle, accent effort label, clickable `<Model> ›`, `#i-refresh` reset, interactive 5-stop pill slider mapped 1:1 to `vscode/shared/inferenceSettings.ts`: `Auto`, `Low`, `Medium`, `High`, `Max`) → clicking `<Model> ›` opens Stage 2 `Select model` list (`Default / Recommended set of models` + real models discovered from `rayu` daemon / `crates/rayucode-provider-core/src/models.rs` with selected pill highlight + checkmark).
   - **Local Permissions Popover (`Shift+Tab` cycle):** Exact 5 modes from `vscode/shared/permissionModes.ts`: `Ask` (`Default`), `Auto-edit`, `Plan`, `Full Manage`, `Orchestrator`.
3. **Codex-Style AI Response & Execution Trace:**
   - Collapsed trigger `Worked for <dur> ›` (or live pulsing `Working · Xs ⌄`) → expands interleaved short progress notes + collapsible `Read files, ran commands ⌄` groups on a `1px` vertical rail → clickable single-line command rows open inline `Shell` cards (`$ command`, Copy button, mono stdout/stderr, `✓ Success` / `× Exit N`).
   - Clean editorial prose with clickable inline code/file references (colored in active accent — Rayu Green or Ocean Blue) that open the **Right-Sidebar Code Viewer** at the exact highlighted line.
   - End-of-response action row: **Copy**, **Fork from here** (2-line hover card: *"Starts a new session from this point. This one stays as it is."*), **Pin** (2-line hover card), relative timestamp (`2m ago`), and quiet credit/KV-cache telemetry.
4. **Dual-Mode Right Sidebar Top Bar (`46px`, `.is-ctx-mode`):**
   - **Context Mode (`≡` active):** Center top bar is calm (`<Title> ▾` only). Right sidebar header holds the right-aligned 6-icon strip (`[≡] >_ ± 🌐 📁 ⋯`) directly above `Environment` (with `⚙` gear), interactive `Context` (clickable dotted-underline token breakdowns for `MCP tools`, `Skills`, `Memory files`, `MCP server instructions`, `Custom agents`, plus expandable `› MCP tools`, `› Memory files`, `› Custom agents`), `Connectors` (live `Show more`/`Show less`), `Outputs`, and `Changes` (`Create PR`).
   - **Document / Code / Browser / Excel Mode:** Center top bar shows the 6-icon strip on the right; right sidebar header shows the italicized active pill (`lookup.rs ×`, `Q4-Token-Cost-Model.xlsx ×`, `MIGRATION_PLAN.md ×`, `localhost:3000 ×`) + `⤢` Full View and `×` Close. Clicking `×` on the pill returns cleanly to Context Mode.
5. **Dedicated Operate Pages:**
   - **Swarm:** Root `coordinator` (depth 0, `VersionedPlan`) + parallel workers roster (`rayucode-swarm-core`), inline `+ Spawn worker` bar, live selected-agent Codex trace & assigned todo lane, direct steering DM bar, tabbed `Message Board` / `Shared Plan` / `Worktrees`.
   - **Automations:** Live overnight manifest (`rayucode-overnight-core`), expandable event log, inline launcher, schedules, morning handoff reports.
   - **Plugins:** Customize sidebar (`Plugins`, `Skills`, `Memory`), interactive RayuCode Featured Showcase banner, live search + Installed sync, 16 official brand SVG connectors, Getting started checklist.
   - **Changes:** Flat changed-files list (no folder tree), syntax-highlighted diffs, VS Code handoff, explicit Create PR guardrail.
   - **Telegram Remote:** Connected / Rayu Shared Bot QR / `@BotFather` token modes, live Pending Approvals Approve/Deny, remote uninstall safety toggle.
   - **Settings:** Full-page shell with Account, Appearance (Dark/Light + Rayu Green / Ocean Blue), Models, Voice, Connections, Shortcuts.

---

## 3. Feature-Sliced Folder Architecture & Bundle Boundaries

```text
rayucode-v2/
├── DESIGN.md                              # Authoritative design contract (rewritten 1:1 from prototype/)
├── AGENTS.md                              # Binding repo + desktop + autonomous swarm rules
├── CLAUDE.md / GEMINI.md                  # Agent entrypoints pointing to DESIGN.md & AGENTS.md
├── .agents/rules/design-and-assets.md     # Always-on Antigravity sub-agent design & verification rule
├── scripts/dispatch-opencode.sh           # Autonomous worktree worker dispatcher with screenshot refs
├── .github/workflows/desktop-ci.yml       # Automated typecheck, lint, lint:design, vitest, build
├── crates/                                # Shared Rust coding engine (zero duplication)
├── sdk/typescript/                        # @rayu-dev/rayucode-sdk
├── packages/ui/                           # @rayu-dev/rayucode-ui
├── prototype/                             # Frozen HTML/CSS golden reference
└── desktop/                               # Electron + Vite + React 19 + TS + Tailwind v4
    ├── package.json                       # Standard agent scripts (verify, typecheck, lint, lint:design, test, build)
    ├── components.json                    # shadcn/ui registry config (Radix primitives -> src/components/ui)
    ├── eslint.config.mjs                  # ESLint 9 architectural & bundle-isolation guardrails
    ├── vitest.config.ts                   # Vitest + jsdom + Testing Library config
    ├── scripts/
    │   ├── check-shadcn.mjs               # Pre-flight CLI (list / check / ensure) for all sub-agents
    │   └── lint-design.mjs                # Enforces 0 raw hex, 0 bg-[#...], 0 UI emojis in TSX
    ├── electron/
    │   ├── main.ts                        # BrowserWindow, WebContentsView browser, menus, IPC registry
    │   ├── preload.ts                     # Strict contextBridge exposing typed window.rayu.* API
    │   ├── daemon-client.ts               # Unix socket / named pipe JSON-RPC client to shared Rust `rayu` daemon
    │   └── native-bridge.ts               # shell.openPath (.xlsx -> Excel), open in VS Code, safeStorage, notifications
    └── src/
        ├── main.tsx                       # React 19 root + ErrorBoundary + QueryClientProvider + Theme/Accent init
        ├── App.tsx                        # Memory router + persistent AppShell + <Suspense> lazy route views
        ├── styles/globals.css             # Single-source Tailwind v4 @theme + prototype tokens + Dark/Light + Green/Blue
        ├── config/                        # routes.ts, navigation.ts, constants.ts
        ├── lib/
        │   ├── utils.ts                   # cn() helper (clsx + tailwind-merge)
        │   ├── ipc-client.ts              # Typed window.rayu wrapper + mock-adapter fallback when running in Vite web preview
        │   ├── action-result.ts           # Unified ActionResult<T> discriminated union
        │   ├── query-client.ts            # Shared TanStack Query v5 defaults + deduplication
        │   ├── stream-batcher.ts          # 16-33ms rAF batcher for high-frequency daemon events
        │   ├── auth-placeholder.ts        # Clean auth stub (getAuthSession / getAuthHeaders) for plug-in later
        │   └── app-store.ts               # Minimal Zustand UI store (sidebar, right-pane mode, theme, accent)
        ├── components/
        │   ├── ui/                        # Restyled shadcn/Radix primitives + ErrorState + SectionErrorBoundary + Skeletons
        │   ├── providers/                 # AppProviders (QueryClient, QueryErrorResetBoundary, TooltipProvider, Toaster)
        │   └── shell/                     # IconRail, SessionPane, DualModeTopBar, UsagePopover, ProfileMenu, DaemonBanner
        └── features/                      # ISOLATED DOMAIN MODULES (1 feature = 1 swarm ownership boundary)
            ├── sessions/                  # Home, Active Chat, Composer, Model+Effort 5-stop slider, 5 Permission modes
            ├── execution-trace/           # Codex trace, vertical rail, inline Shell cards, Copy/Fork/Pin, code links
            ├── inspector/                 # Context breakdown, Connectors, Outputs, Changes, Shiki Code Viewer, xterm.js Terminal
            ├── previews/                  # WebContentsView Browser + Full-View chat, Excel .xlsx / Office Web Viewer, Markdown
            ├── swarm/                     # Coordinator + Workers roster, todo lanes, Spawn bar, DMs, Message Board, Plan v3, Worktrees
            ├── automations/               # Overnight runs, inline launcher, event logs, schedules, morning handoff
            ├── plugins/                   # Customize sidebar, Featured Showcase, Search + Installed sync, Skills, Memory
            ├── changes/                   # Flat changed-files list, syntax diffs, VS Code handoff, Create PR guardrail
            ├── telegram/                  # QR / BotFather pairing, Pending Approvals Approve/Deny, remote uninstall switch
            └── settings/                  # Full-page Settings (Account, Appearance Green/Blue + Dark/Light, Models, Voice, Shortcuts)
```

### Standard Feature Internal Contract
Every `desktop/src/features/<name>/` directory exposes ONLY its public `index.ts` barrel and contains:
- `__tests__/` — Vitest unit & schema/action tests
- `api/` — Typed IPC/repository adapters + TanStack Query v5 `queryOptions()` & mutation hooks (with seamless mock fallback when `window.rayu` is absent in standalone browser preview)
- `components/` — Feature UI components (using ONLY `globals.css` semantic tokens and `components/ui/*` primitives)
- `constants/` — Static labels, fallback metadata, demo fixtures clearly marked as synthetic
- `hooks/` — Domain React 19 hooks
- `schemas/` — Shared `Zod` validation schemas
- `types/` — TypeScript interfaces & DTOs
- `index.ts` — Public barrel export

### Heavy Library Bundle Isolation (Enforced by ESLint)
- `xterm` / `@xterm/xterm` may ONLY be imported inside `features/inspector/**` (lazy-loaded).
- `shiki` may ONLY be imported inside `features/inspector/**` and `features/changes/**` (lazy-loaded).
- Spreadsheet / OOXML helpers may ONLY be imported inside `features/previews/**` (lazy-loaded).
- Cross-feature deep imports (`@/features/<other>/components/*`, `@/features/<other>/api/*`) are forbidden by `no-restricted-imports`.

---

## 4. Error Handling, Preloading (`<Suspense>`) & 3-Layer Caching

1. **Resilient Error & Reload Boundaries:**
   - `<AppErrorBoundary>` wraps the Electron renderer root with a calm `DESIGN.md` recovery card and full window reload action.
   - `<SectionErrorBoundary>` (paired with TanStack Query's `QueryErrorResetBoundary`) wraps every independent region (Chat Stream, Right Sidebar, Swarm Inspector, Browser/Excel Pane, Settings) so a panel crash degrades only that panel with a `Reload section` button.
   - **Daemon Connection Banner (`<DaemonBanner>`):** Auto-reconnects with exponential backoff on daemon restart (`rayu self-dev --build`) without clearing composer input drafts.
   - **Shell / Tool Failures:** Rendered inline inside Codex `Shell` cards (`× Exit N`), never modal alert dialogs.
2. **Zero-CLS `<Suspense>` Preloading:**
   - Every lazy route & heavy panel has a layout-matched skeleton (`ChatSkeleton`, `ContextSkeleton`, `SwarmSkeleton`, `PluginsSkeleton`, `SettingsSkeleton`) built from restyled shadcn `Skeleton`.
3. **3-Layer Caching & Stream Performance (Zero Duplicate Fetches):**
   - **Layer 1 (TanStack Query v5 Client Cache):** `staleTime: 60_000` (sessions/context), `300_000` (model & plugin catalogs), `gcTime: 600_000`, `refetchOnWindowFocus: false`, smart retry (skip 4xx/validation errors), automatic in-flight deduplication.
   - **Layer 2 (Hover-Intent Prefetching):** Hovering sidebar sessions, Swarm roster agents, or nav icons calls `queryClient.prefetchQuery(...)` so clicks render instantaneously.
   - **Layer 3 (Zustand + `rAF` Push Stream Batching):** High-frequency Rust daemon push events (streaming tokens, shell `stdout`, swarm lifecycle updates) accumulate in a buffer and flush once per animation frame (`16–33ms`) into Zustand stores, paired with `@tanstack/react-virtual` for long streams/diffs.

---

## 5. Autonomous Swarm Execution, Verification Gates & CI/PR Protocol

### Mandatory Pre-Flight & Definition of Done (Every Agent & Sub-Agent)
1. **Read First:** Read root `DESIGN.md`, `desktop/src/styles/globals.css`, and the matching `prototype/*.html` reference before writing code.
2. **Pre-Flight shadcn Check:** Run `node desktop/scripts/check-shadcn.mjs check <primitives...> --json` before coding; reuse installed primitives or install missing ones via `ensure`.
3. **Automated Quality Gates (`cd desktop && pnpm verify`):**
   - `pnpm typecheck` (`tsc --noEmit` — 0 errors)
   - `pnpm lint` (ESLint 9 architectural + React Hooks rules — 0 errors)
   - `pnpm lint:design` (0 raw hex colors, 0 `bg-[#...]`, 0 UI emojis in `src/`)
   - `pnpm test` (Vitest unit & schema/hook tests passing)
   - `pnpm build` (Vite renderer + Electron main/preload TypeScript build green)
4. **Closed-Loop Screen Verification:**
   - Render owned route(s) at `1440×934` in **Dark (Rayu Green)**, **Dark (Ocean Blue)**, and **Light** modes into `.swarm-logs/verify/<task-id>-*.png` using headless Chrome / Playwright.
   - Visually compare side-by-side against `prototype/`, fix any token/alignment/spacing mismatch, and re-verify until matched.
5. **Autonomous Scoped Commits & PR Creation:**
   - Each swarm worker works on its isolated branch/worktree (`swarm/<task-id>`), stages **only owned files**, commits with conventional commits (`feat(desktop): ...`), pushes, and opens a PR targeting `main` verified by `.github/workflows/desktop-ci.yml`.

### 4 Conflict-Free Parallel Swarm Waves
- **Wave 0 (Sequential Foundation — 1–2 workers):** Update root `DESIGN.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/rules/design-and-assets.md`, `scripts/dispatch-opencode.sh`; scaffold `desktop/` (`package.json`, `vite.config.ts`, `tsconfig.json`, `components.json`, Tailwind v4 `globals.css`, `eslint.config.mjs`, `vitest.config.ts`, `scripts/check-shadcn.mjs`, `scripts/lint-design.mjs`, `.github/workflows/desktop-ci.yml`); install latest packages & restyled shadcn/Radix UI primitives; build `electron/*`, `src/lib/*`, `src/components/providers/*`, `src/components/shell/*`, and `src/App.tsx`.
- **Wave 1 (Parallel Core Chat & Inspector — 3 workers):** `w1-sessions` (`features/sessions`), `w1-trace` (`features/execution-trace`), `w1-inspector` (`features/inspector`).
- **Wave 2 (Parallel Previews & Orchestration — 3 workers):** `w2-previews` (`features/previews`), `w2-swarm` (`features/swarm`), `w2-automations` (`features/automations`).
- **Wave 3 (Parallel Operate Views & Final QA — 5 workers):** `w3-plugins` (`features/plugins`), `w3-changes` (`features/changes`), `w3-telegram` (`features/telegram`), `w3-settings` (`features/settings`), followed by `w3-qa-verifier` (full `pnpm verify` + cross-route Dark/Light/Green/Blue visual parity audit against `prototype/`).
