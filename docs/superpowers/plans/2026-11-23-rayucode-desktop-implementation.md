# RayuCode Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended for parallel Wave 1–3 execution) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the authoritative `DESIGN.md` + agent enforcement rules + Tailwind v4 single-source `globals.css`, and build the Electron + React 19 + TypeScript **RayuCode Desktop** application (`desktop/`) with 1:1 visual parity to `prototype/` and clean IPC integration with the shared Rust `rayu` CLI daemon.

**Architecture:** Thin Electron shell (`desktop/electron/*`) communicating via strict `Zod`-validated `contextBridge` IPC (`window.rayu.*`) with the existing Rust `rayu` daemon over Unix socket / JSON-RPC (with seamless typed mock-adapter fallback for browser/test runs). The React 19 frontend uses a feature-sliced layout (`desktop/src/features/*`) backed by TanStack Query v5 caching, `requestAnimationFrame`-batched Zustand push streams, `<SectionErrorBoundary>` recovery, and Tailwind v4 single-source tokens in `desktop/src/styles/globals.css`.

**Tech Stack:** Electron 35+, Vite 6+, React 19+, TypeScript 5.7+, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (Radix UI primitives), TanStack Query v5, Zustand v5, Zod v4, `@tanstack/react-virtual`, `lucide-react`, `sonner`, `shiki`, `@xterm/xterm`, `unified`/`remark`/`rehype`, ESLint 9, Vitest + Testing Library, Playwright.

## Global Constraints

- **Visual Golden Baseline:** Every view in `desktop/` MUST match `prototype/` and root `DESIGN.md` verbatim.
- **Single-Source Tokens (`desktop/src/styles/globals.css`):** Warm Graphite Dark default (`#11110E` chrome, `#0C0C0A` canvas, `#1B1B17` raised, `#ECEAE3` ink), Warm Paper Light (`[data-theme="light"]`: `#F7F7F4` chrome, `#FFFFFF` canvas, `#26251E` ink), Rayu Green default (`#3DBD84` dark / `#0F7B4F` light), Ocean Blue option (`[data-accent="blue"]`: `#3B82F6` dark / `#1D6FE2` light).
- **Zero AI Slop:** Zero raw hex colors (`#...`), zero arbitrary Tailwind colors (`bg-[#...]`), zero UI emojis in TSX, zero default shadcn zinc/slate cards, zero folder tree anywhere in v1, zero file chips inside the composer, zero focus glow on composer.
- **Feature Encapsulation:** `desktop/src/features/<name>/*` may only be imported through its public `index.ts` barrel (`no-restricted-imports`). Heavy libraries (`@xterm/xterm`, `shiki`) are restricted to `features/inspector` and `features/changes` and lazy-loaded via `React.lazy`.
- **Pre-Flight UI Check:** Every worker MUST run `node desktop/scripts/check-shadcn.mjs check <names...> --json` before coding and reuse installed `src/components/ui/*` primitives.
- **Mandatory Definition of Done per Task:** `cd desktop && pnpm typecheck && pnpm lint && pnpm lint:design && pnpm test && pnpm build` passes with 0 errors, plus headless visual verification into `.swarm-logs/verify/<task-id>-*.png` compared against `prototype/`.
- **Single Coding Engine:** Never duplicate LLM routing, tool execution, swarm state, or overnight scheduling in TypeScript; always call through `src/lib/ipc-client.ts` (`window.rayu.*`) with typed mock fallback only when running outside Electron.

---

## Wave Map (Parallel Execution Schedule)

| Wave | Mode | Tasks | Non-Overlapping Ownership |
| :--- | :--- | :--- | :--- |
| **Wave 0** | Sequential Foundation | Tasks 1–4 | Root `DESIGN.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/rules/design-and-assets.md`, `scripts/dispatch-opencode.sh`, `pnpm-workspace.yaml`, `.github/workflows/desktop-ci.yml`, `desktop/` config, `globals.css`, `check-shadcn.mjs`, `lint-design.mjs`, `components/ui/*`, `electron/*`, `src/lib/*`, `src/components/shell/*`, `src/App.tsx` |
| **Wave 1** | **3 Parallel Agents** | Tasks 5, 6, 7 | `w1-sessions` (`features/sessions`), `w1-trace` (`features/execution-trace`), `w1-inspector` (`features/inspector`) |
| **Wave 2** | **3 Parallel Agents** | Tasks 8, 9, 10 | `w2-previews` (`features/previews`), `w2-swarm` (`features/swarm`), `w2-automations` (`features/automations`) |
| **Wave 3** | **4 Parallel Agents + QA** | Tasks 11, 12, 13, 14, 15 | `w3-plugins` (`features/plugins`), `w3-changes` (`features/changes`), `w3-telegram` (`features/telegram`), `w3-settings` (`features/settings`), `w3-qa` (route wiring + E2E + Dark/Light/Green/Blue screenshot audit) |

---

## Wave 0 — Authoritative Design Contract, Guardrails & Desktop Foundation (Sequential)

### Task 1: Authoritative `DESIGN.md` & Multi-Agent Enforcement Rules

**Files:**
- Modify: `DESIGN.md` (replace outdated obsidian `#0B0E0D` spec with finalized Warm Graphite / Warm Paper / Rayu Green + Ocean Blue prototype contract)
- Modify: `AGENTS.md` (append Desktop Design System, `globals.css` Single-Source Rule, `check-shadcn.mjs` Pre-Flight, Standard Commands, and Autonomous Swarm Screen Verification Loop)
- Modify: `CLAUDE.md` (reference `@DESIGN.md` alongside `@AGENTS.md`)
- Create: `GEMINI.md`
- Create: `.agents/rules/design-and-assets.md`
- Create: `scripts/dispatch-opencode.sh`

**Interfaces:**
- Consumes: `prototype/css/tokens.css`, `prototype/css/components.css`, `prototype/index.html`, `prototype/pages/*.html`
- Produces: Binding rule documents read by every coordinator, sub-agent, and swarm worker.

- [ ] **Step 1: Rewrite root `DESIGN.md` 1:1 from `prototype/`**

Include exact token tables copied verbatim from `prototype/css/tokens.css`:
- Dark surfaces (`--bg-chrome: #11110E`, `--bg-canvas: #0C0C0A`, `--bg-pane: #161613`, `--bg-shell: #141411`, `--bg-raised: #1B1B17`, `--bg-inset: #10100D`, `--bg-active: #262520`)
- Light surfaces (`--bg-chrome: #F7F7F4`, `--bg-canvas: #FFFFFF`, `--bg-pane: #FAFAF7`, `--bg-inset: #F4F4F0`, `--bg-active: #ECEBE5`)
- Accents: Rayu Green default (`#3DBD84` / `#5FD19C` dark, `#0F7B4F` / `#0D7449` light) and Ocean Blue (`[data-accent="blue"]`: `#3B82F6` / `#5EA6FF` dark, `#1D6FE2` / `#1A63CC` light)
- Specular bevels (`--border-premium`, `--border-premium-hi`, `--bevel-surface`, `--bevel-card`, `--bevel-primary`)
- Component blueprints for all locked surfaces: Left 6-icon rail + 2 bottom icons, Composer (`max-width: 732px`, no chips, no focus ring), 2-stage Model & 5-stop Effort popover, 5 Local Permission modes, Codex execution trace + inline `Shell` cards + Copy/Fork/Pin footer, Dual-mode Context vs Document top bar, Swarm, Automations, Plugins, Changes, Telegram, Settings, Browser + Full-View, Excel `.xlsx`.
- Anti-slop banned list (no raw hex in TSX, no `bg-[#...]`, no UI emojis, no default shadcn styling, no folder tree in v1).

- [ ] **Step 2: Update `AGENTS.md`, `CLAUDE.md`, create `GEMINI.md` and `.agents/rules/design-and-assets.md`**

Add exact mandatory agent protocol sections:
1. Read `DESIGN.md` + `desktop/src/styles/globals.css` + target `prototype/*.html` before coding.
2. Run `node desktop/scripts/check-shadcn.mjs check <names...> --json` before implementing UI.
3. Standard commands table (`pnpm typecheck`, `pnpm lint`, `pnpm lint:design`, `pnpm test`, `pnpm build`, `pnpm verify`).
4. Autonomous Closed-Loop Screen Verification into `.swarm-logs/verify/<task-id>-*.png` at `1440×934` (Dark Green, Dark Blue, Light).
5. Scoped conventional commits (`git add <owned-files>`) and automated PR creation to `main`.

- [ ] **Step 3: Create executable `scripts/dispatch-opencode.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
TASK_ID="${1:?Usage: dispatch-opencode.sh <task-id> <model> <prompt-file> [ref-image...]}"
MODEL="${2:?model required}"
PROMPT_FILE="${3:?prompt file required}"
shift 3
mkdir -p .swarm-logs/verify
echo "[dispatch] task=${TASK_ID} model=${MODEL} prompt=${PROMPT_FILE} refs=$#"
opencode run --pure --auto -m "${MODEL}" -f "${PROMPT_FILE}" "$@"
```

Run: `chmod +x scripts/dispatch-opencode.sh`

- [ ] **Step 4: Verify rule files and commit**

Run: `ls -la DESIGN.md AGENTS.md CLAUDE.md GEMINI.md .agents/rules/design-and-assets.md scripts/dispatch-opencode.sh`
Expected: All 6 files exist, `scripts/dispatch-opencode.sh` is executable.

```bash
git add DESIGN.md AGENTS.md CLAUDE.md GEMINI.md .agents/rules/design-and-assets.md scripts/dispatch-opencode.sh
git commit -m "docs(design): add authoritative DESIGN.md and autonomous swarm agent rules"
```

---

### Task 2: Scaffold `desktop/` Workspace, Tailwind v4 Single-Source `globals.css`, Guardrails & CI

**Files:**
- Modify: `pnpm-workspace.yaml` (add `"desktop"`)
- Create: `desktop/package.json`
- Create: `desktop/tsconfig.json`, `desktop/tsconfig.electron.json`
- Create: `desktop/vite.config.ts`
- Create: `desktop/index.html`
- Create: `desktop/components.json`
- Create: `desktop/eslint.config.mjs`
- Create: `desktop/vitest.config.ts`
- Create: `desktop/src/styles/globals.css`
- Create: `desktop/scripts/check-shadcn.mjs`
- Create: `desktop/scripts/lint-design.mjs`
- Create: `.github/workflows/desktop-ci.yml`

**Interfaces:**
- Consumes: `prototype/css/tokens.css`, `DESIGN.md`
- Produces: Working `desktop/` build/lint/test/design-lint toolchain, Tailwind v4 semantic utilities (`bg-chrome`, `bg-canvas`, `bg-pane`, `bg-raised`, `bg-inset`, `bg-active`, `text-ink`, `text-body`, `text-muted`, `text-accent`, `border-hairline`, `border-premium`, `shadow-bevel-surface`, `shadow-bevel-card`), and `scripts/check-shadcn.mjs` CLI.

- [ ] **Step 1: Add `"desktop"` to `pnpm-workspace.yaml` and create `desktop/package.json`**

Include scripts:
```json
{
  "name": "@rayu-dev/rayucode-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite --port 5173",
    "dev:electron": "tsc -p tsconfig.electron.json && electron .",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.electron.json --noEmit",
    "lint": "eslint src electron",
    "lint:fix": "eslint --fix src electron",
    "lint:design": "node scripts/lint-design.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "build:renderer": "vite build",
    "build:electron": "tsc -p tsconfig.electron.json",
    "build": "pnpm build:renderer && pnpm build:electron",
    "verify": "pnpm typecheck && pnpm lint && pnpm lint:design && pnpm test && pnpm build"
  }
}
```

- [ ] **Step 2: Install latest production & dev packages in `desktop/`**

Run:
```bash
cd desktop && \
pnpm add react@latest react-dom@latest @tanstack/react-query@latest @tanstack/react-virtual@latest zustand@latest zod@latest lucide-react@latest clsx@latest tailwind-merge@latest class-variance-authority@latest sonner@latest radix-ui@latest shiki@latest @xterm/xterm@latest @xterm/addon-fit@latest unified@latest remark-parse@latest remark-gfm@latest remark-rehype@latest rehype-stringify@latest && \
pnpm add -D electron@latest vite@latest @vitejs/plugin-react@latest tailwindcss@latest @tailwindcss/vite@latest tw-animate-css@latest typescript@latest @types/react@latest @types/react-dom@latest @types/node@latest eslint@latest @eslint/js@latest typescript-eslint@latest eslint-plugin-react-hooks@latest vitest@latest @testing-library/react@latest @testing-library/jest-dom@latest jsdom@latest prettier@latest
```

- [ ] **Step 3: Create `desktop/src/styles/globals.css` (Single-Source Tailwind v4 Token Bridge)**

Map 100% of `prototype/css/tokens.css` variables directly into `@theme inline` + shadcn/ui variables (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--ring`), with `:root` (Warm Graphite Dark + Rayu Green), `[data-theme="light"]` (Warm Paper Light), `[data-accent="blue"]` (Ocean Blue Dark), and `[data-theme="light"][data-accent="blue"]` (Ocean Blue Light), plus `@source not` excluding `../prototype`, `../docs`, `../.swarm-logs`.

- [ ] **Step 4: Create `desktop/scripts/check-shadcn.mjs` & `desktop/scripts/lint-design.mjs`**

`check-shadcn.mjs`: supports `list [--json]`, `check <names...> [--json]` (exit 0 when all installed, exit 2 with missing list + exact install command), and `ensure <names...>` (installs only missing primitives via `pnpm dlx shadcn@latest add --yes`).

`lint-design.mjs`: scans `src/**/*.{ts,tsx}` (excluding `src/styles/**` and `**/__tests__/**`) and fails (exit 1) if it detects:
- raw hex color literals (`/#[0-9a-fA-F]{3,8}\b/`)
- arbitrary Tailwind color classes (`/(?:bg|text|border|ring|fill|stroke)-\[#[^\]]+\]/`)
- default shadcn zinc/slate palette classes (`/(?:bg|text|border)-(?:zinc|slate|neutral|stone|gray)-\d{2,3}/`)
- UI emoji glyphs (`/\p{Extended_Pictographic}/u`)

- [ ] **Step 5: Create `desktop/eslint.config.mjs` (ESLint 9 Architectural Guardrails)**

Enforce:
1. `no-restricted-imports` banning `@/features/*/*` (deep cross-feature imports — barrel `@/features/<name>` only).
2. `no-restricted-imports` banning `@xterm/xterm` outside `src/features/inspector/**` and `shiki` outside `src/features/{inspector,changes}/**`.
3. `@typescript-eslint/consistent-type-imports` (`prefer: "type-imports"`), `@typescript-eslint/no-unused-vars`, and `react-hooks/exhaustive-deps`.

- [ ] **Step 6: Create `desktop/vitest.config.ts` and `.github/workflows/desktop-ci.yml`**

`desktop-ci.yml` runs `pnpm --filter @rayu-dev/rayucode-desktop verify` on every push and PR touching `desktop/**`, `DESIGN.md`, or `pnpm-workspace.yaml`.

- [ ] **Step 7: Write smoke test for `lint-design.mjs` & `check-shadcn.mjs`, run verification, and commit**

Run: `cd desktop && node scripts/check-shadcn.mjs list --json && pnpm lint:design`
Expected: Valid JSON output from `check-shadcn.mjs` and exit 0 from `lint-design.mjs`.

```bash
git add pnpm-workspace.yaml desktop/ .github/workflows/desktop-ci.yml
git commit -m "feat(desktop): scaffold Electron + React 19 + Tailwind v4 globals.css and agent guardrails"
```

---

### Task 3: Install & Restyle shadcn/Radix Primitives + Error Boundaries, Skeletons & Core `src/lib/`

**Files:**
- Create: `desktop/src/lib/utils.ts`
- Create: `desktop/src/lib/action-result.ts`
- Create: `desktop/src/lib/auth-placeholder.ts`
- Create: `desktop/src/lib/query-client.ts`
- Create: `desktop/src/lib/stream-batcher.ts`
- Create: `desktop/src/lib/app-store.ts`
- Create: `desktop/src/lib/ipc-client.ts`
- Create: `desktop/src/lib/__tests__/stream-batcher.test.ts`
- Create: `desktop/src/lib/__tests__/app-store.test.ts`
- Create: `desktop/src/components/ui/{button,popover,dropdown-menu,tooltip,tabs,switch,select,dialog,scroll-area,skeleton,separator}.tsx`
- Create: `desktop/src/components/ui/error-state.tsx`
- Create: `desktop/src/components/ui/section-error-boundary.tsx`
- Create: `desktop/src/components/ui/page-skeletons.tsx`
- Create: `desktop/src/components/providers/app-providers.tsx`

**Interfaces:**
- Consumes: `desktop/src/styles/globals.css`, `window.rayu` (optional — falls back to mock adapter in browser/jsdom)
- Produces:
  - `ActionResult<T>` (`{ ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> }`)
  - `createQueryClient()` (`staleTime: 60_000`, `gcTime: 600_000`, `refetchOnWindowFocus: false`)
  - `createStreamBatcher<T>(onFlush: (items: T[]) => void): { push(item: T): void; flushNow(): void; dispose(): void }`
  - `useAppStore` (`theme: 'dark' | 'light'`, `accent: 'green' | 'blue'`, `activeRoute`, `leftCollapsed`, `rightCollapsed`, `rightMode: 'context' | 'document'`, `activeRightTab`, `activeDocPill`, `fullView`, `setTheme`, `setAccent`, `openRightTab`, `openCodeFile`, `closeDocumentToContext`)
  - `ipcClient` (`sessions`, `models`, `swarm`, `automations`, `plugins`, `changes`, `telegram`, `native`)
  - `<SectionErrorBoundary title="..."/>`, `<AppProviders/>`, `<ChatSkeleton/>`, `<ContextSkeleton/>`, `<SwarmSkeleton/>`, `<SettingsSkeleton/>`

- [ ] **Step 1: Write failing tests for `stream-batcher.ts` and `app-store.ts`**

```ts
// desktop/src/lib/__tests__/stream-batcher.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createStreamBatcher } from '../stream-batcher'

describe('createStreamBatcher', () => {
  it('coalesces multiple pushes within one frame into a single flush', () => {
    vi.useFakeTimers()
    const flushed: string[][] = []
    const batcher = createStreamBatcher<string>(items => flushed.push(items))
    batcher.push('a')
    batcher.push('b')
    batcher.push('c')
    expect(flushed).toHaveLength(0)
    vi.advanceTimersByTime(20)
    expect(flushed).toEqual([['a', 'b', 'c']])
    batcher.dispose()
    vi.useRealTimers()
  })
})
```

```ts
// desktop/src/lib/__tests__/app-store.test.ts
import { describe, expect, it } from 'vitest'
import { useAppStore } from '../app-store'

describe('useAppStore', () => {
  it('switches rightMode between context and document cleanly', () => {
    const s = useAppStore.getState()
    s.openCodeFile('lookup.rs', 21)
    expect(useAppStore.getState().rightMode).toBe('document')
    expect(useAppStore.getState().activeDocPill).toBe('lookup.rs')
    expect(useAppStore.getState().activeCodeLine).toBe(21)

    useAppStore.getState().closeDocumentToContext()
    expect(useAppStore.getState().rightMode).toBe('context')
    expect(useAppStore.getState().activeRightTab).toBe('overview')
  })
})
```

- [ ] **Step 2: Run Vitest to confirm both tests fail**

Run: `cd desktop && pnpm test`
Expected: FAIL (`Cannot find module '../stream-batcher'`).

- [ ] **Step 3: Implement `src/lib/*`, install & restyle shadcn/Radix `src/components/ui/*` primitives, and create `<SectionErrorBoundary>` + `<AppProviders>`**

Run: `cd desktop && node scripts/check-shadcn.mjs ensure button popover dropdown-menu tooltip tabs switch select dialog scroll-area skeleton separator`

Restyle every installed `src/components/ui/*` primitive to use `globals.css` semantic tokens (`bg-raised`, `border-premium`, `shadow-bevel-card`, `text-ink`, `text-muted`, zero `bg-zinc-*` or raw hex).

- [ ] **Step 4: Run full verification gates and commit**

Run: `cd desktop && pnpm verify`
Expected: `typecheck`, `lint`, `lint:design`, `test`, and `build` all pass.

```bash
git add desktop/src/lib desktop/src/components/ui desktop/src/components/providers
git commit -m "feat(desktop): add core lib stores, stream batcher, restyled shadcn/Radix UI and error boundaries"
```

---

### Task 4: Electron Main / Preload / Rust Daemon Bridge & Persistent App Shell

**Files:**
- Create: `desktop/electron/daemon-client.ts` (connects to `~/.rayu/builds/shared-server/rayu` Unix socket / JSON-RPC with reconnect backoff)
- Create: `desktop/electron/native-bridge.ts` (`shell.openPath` for `.xlsx` → native Microsoft Excel, `code <file:line>` for VS Code, `safeStorage`, OS notifications)
- Create: `desktop/electron/browser-view.ts` (`WebContentsView` docked browser bounds sync, zoom, device emulation, screenshot capture, DevTools toggle)
- Create: `desktop/electron/preload.ts` (`contextBridge.exposeInMainWorld('rayu', ...)` with strict Zod schemas)
- Create: `desktop/electron/main.ts` (`BrowserWindow` creation, IPC handler registry, native menu, daemon lifecycle)
- Create: `desktop/src/config/routes.ts` & `desktop/src/config/navigation.ts`
- Create: `desktop/src/components/shell/icon-rail.tsx` (exact 6 nav icons + live Telegram dot + Usage & Plan popover + Profile menu)
- Create: `desktop/src/components/shell/session-pane.tsx` (Projects, Recents, Getting Started checklist — zero folder tree)
- Create: `desktop/src/components/shell/dual-mode-top-bar.tsx` (Claude Code Context Mode vs Document/Code/Browser/Excel Mode)
- Create: `desktop/src/components/shell/daemon-banner.tsx` (non-blocking auto-reconnect banner)
- Create: `desktop/src/components/shell/app-shell.tsx`
- Create: `desktop/src/App.tsx` & `desktop/src/main.tsx`
- Test: `desktop/src/components/shell/__tests__/app-shell.test.tsx`

**Interfaces:**
- Consumes: `useAppStore`, `AppProviders`, `SectionErrorBoundary`, `components/ui/*`
- Produces: Persistent desktop window shell with lazy-loaded route slots for all 10 feature modules (`sessions`, `swarm`, `automations`, `plugins`, `changes`, `telegram`, `settings`) and right-sidebar slot (`inspector`, `previews`).

- [ ] **Step 1: Write failing test verifying exact 6-icon rail + dual-mode top bar switching**

```tsx
// desktop/src/components/shell/__tests__/app-shell.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IconRail } from '../icon-rail'
import { AppProviders } from '../../providers/app-providers'

describe('IconRail', () => {
  it('renders exactly the 6 primary RayuCode navigation items', () => {
    render(<AppProviders><IconRail /></AppProviders>)
    for (const label of ['Home', 'Swarm', 'Automations', 'Plugins', 'Changes', 'Telegram Remote']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm test src/components/shell/__tests__/app-shell.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `desktop/electron/*`, `src/components/shell/*`, `src/App.tsx`, and `src/main.tsx`**

Implement:
- `electron/main.ts` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `IconRail` with exact 6 nav items, Usage & Plan popover, Profile menu, and keyboard shortcut `⇧⌘S` sidebar toggle.
- `DualModeTopBar`: renders 6-icon strip directly inside right-sidebar top bar when `rightMode === 'context'` and moves it to center header with `<activeDocPill> ×` + `⤢` Full View + `×` Close when `rightMode === 'document'`.
- `App.tsx` wrapping every route and right-sidebar panel in `<SectionErrorBoundary>` + `<Suspense fallback={<...Skeleton />}>`.

- [ ] **Step 4: Run `pnpm verify` and commit Wave 0 Foundation**

Run: `cd desktop && pnpm verify`
Expected: 0 errors across `typecheck`, `lint`, `lint:design`, `test`, `build`.

```bash
git add desktop/electron desktop/src/config desktop/src/components/shell desktop/src/App.tsx desktop/src/main.tsx
git commit -m "feat(desktop): add Electron daemon bridge, preload IPC, and persistent dual-mode AppShell"
```

---

## Wave 1 — Core Chat, Execution Trace & Right Inspector (3 Parallel Subagents)

> **Parallelism rule:** Tasks 5, 6, and 7 touch strictly disjoint feature folders (`features/sessions/`, `features/execution-trace/`, `features/inspector/`) and run simultaneously in parallel!

### Task 5 (`w1-sessions`): Sessions, Home, Composer, 2-Stage Model & 5-Stop Effort Slider, 5 Local Permissions

**Files:**
- Create: `desktop/src/features/sessions/{types/index.ts,schemas/index.ts,constants/models.ts,api/sessions-api.ts,hooks/use-sessions.ts,components/home-view.tsx,components/composer.tsx,components/model-effort-popover.tsx,components/permission-popover.tsx,index.ts}`
- Test: `desktop/src/features/sessions/__tests__/model-effort-popover.test.tsx`

**Interfaces:**
- Consumes: `@/lib/app-store`, `@/lib/ipc-client`, `@/components/ui/{popover,tooltip,button}`
- Produces: `HomeView`, `SessionComposer`, `ModelEffortPopover`, `PermissionPopover`, `useSessionMessages`, `useModelCatalog`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check popover tooltip button --json`
- [ ] **Step 2: Write failing unit tests for 5-stop effort slider (`Auto / Low / Medium / High / Max`) & 5 permission modes (`Ask`, `Auto-edit`, `Plan`, `Full Manage`, `Orchestrator`)**
- [ ] **Step 3: Implement `features/sessions/` matching `prototype/index.html` & `prototype/pages/agent-workspace.html` 1:1**
  - Composer `max-width: 732px` aligned to `.stream`, zero file chips inside composer, zero focus glow ring.
  - Project/checkout tray shown ONLY on Home (`New session`) and hidden automatically once active chat begins.
  - 2-stage Model & Effort popover: solid opaque card, `#i-zap` fast toggle, `#i-refresh` reset, interactive 5-stop pill slider (click + drag) synced to `vscode/shared/inferenceSettings.ts`, flipping to `Select model` (`Default / Recommended set of models` + 19 real models from `crates/rayucode-provider-core/src/models.rs` and live daemon discovery).
  - Local Permissions popover + `Shift+Tab` keyboard cycling.
- [ ] **Step 4: Run `pnpm verify` + headless `1440×934` screenshot check (`.swarm-logs/verify/w1-sessions-*.png`) and commit**

---

### Task 6 (`w1-trace`): Codex-Style Execution Trace, Inline Shell Cards, Clickable Code Citations & Copy/Fork/Pin Footer

**Files:**
- Create: `desktop/src/features/execution-trace/{types/index.ts,schemas/index.ts,api/trace-api.ts,hooks/use-live-trace.ts,components/chat-stream.tsx,components/work-trace.tsx,components/shell-card.tsx,components/turn-actions.tsx,components/cite-link.tsx,index.ts}`
- Test: `desktop/src/features/execution-trace/__tests__/work-trace.test.tsx`

**Interfaces:**
- Consumes: `@/lib/app-store` (`openCodeFile`, `openRightTab`), `@/lib/stream-batcher`, `@/components/ui/{tooltip,button}`, `@tanstack/react-virtual`
- Produces: `ChatStream`, `WorkTrace`, `ShellCard`, `TurnActions`, `CiteLink`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check tooltip button scroll-area --json`
- [ ] **Step 2: Write failing tests for trace collapse/expand (`Worked for 1m 25s ›`), inline `Shell` card toggle + copy, clickable `CiteLink` calling `openCodeFile(file, line)`, and `TurnActions` (Copy / Fork / Pin)**
- [ ] **Step 3: Implement `features/execution-trace/` matching `prototype/pages/agent-workspace.html` 1:1**
  - Clean `Context automatically compacted` notice, compact user prompt bubble.
  - Collapsed `Worked for <dur> ›` (and live pulsing `Working · Xs ⌄` with shimmer) → vertical `1px` tool rail → clickable command rows expanding inline `Shell` cards (`$ command`, copy button, mono stdout, `✓ Success` / `× Exit N`).
  - Editorial answer with clickable `<CiteLink>` (respecting Rayu Green / Ocean Blue active accent) + inline Diff card (Accept / Reject / Undo / VS Code).
  - End-of-response `Copy`, `Fork from here` (2-line hover card: *"Starts a new session from this point. This one stays as it is."*), `Pin` (2-line hover card), relative timestamp, and quiet credit/KV-cache telemetry.
- [ ] **Step 4: Run `pnpm verify` + screenshot check (`.swarm-logs/verify/w1-trace-*.png`) and commit**

---

### Task 7 (`w1-inspector`): Right-Sidebar Context Inspector, Interactive Token Breakdowns, Shiki Code Viewer & `xterm.js` Terminal

**Files:**
- Create: `desktop/src/features/inspector/{types/index.ts,schemas/index.ts,api/inspector-api.ts,hooks/use-context-stats.ts,components/context-panel.tsx,components/code-viewer.tsx,components/terminal-panel.tsx,components/inspector-sidebar.tsx,index.ts}`
- Test: `desktop/src/features/inspector/__tests__/context-panel.test.tsx`

**Interfaces:**
- Consumes: `@/lib/app-store`, `@/lib/ipc-client`, `shiki` (lazy), `@xterm/xterm` + `@xterm/addon-fit` (lazy)
- Produces: `InspectorSidebar`, `ContextPanel`, `CodeViewer`, `TerminalPanel`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check scroll-area separator button --json`
- [ ] **Step 2: Write failing tests for dotted-underline Context breakdown toggles (`MCP tools`, `Skills`, `Memory files`, `MCP server instructions`, `Custom agents`), `Connectors` `Show more` / `Show less`, and `CodeViewer` line highlight**
- [ ] **Step 3: Implement `features/inspector/` matching Claude Code Context layout 1:1**
  - `Environment` with `⚙` settings gear button.
  - `Context` (`3% used · 28K / 1M`, multi-segment bar, clickable dotted-underline inline breakdown drawers, expandable `› MCP tools`, `› Memory files`, `› Custom agents`).
  - `Connectors` with live `Show more` / `Show less`, `Outputs` (clickable links to Browser/MD/Excel), and `Changes` (`Create PR`).
  - Lazy-loaded `CodeViewer` (`shiki`) highlighting `activeCodeLine` in active accent + `VS Code` handoff.
  - Lazy-loaded `TerminalPanel` (`@xterm/xterm` + `FitAddon`) attached to daemon PTY stream.
- [ ] **Step 4: Run `pnpm verify` + screenshot check (`.swarm-logs/verify/w1-inspector-*.png`) and commit**

---

## Wave 2 — Right-Sidebar Previews, Swarm & Automations (3 Parallel Subagents)

> **Parallelism rule:** Tasks 8, 9, and 10 touch strictly disjoint feature folders (`features/previews/`, `features/swarm/`, `features/automations/`) and run simultaneously in parallel!

### Task 8 (`w2-previews`): In-App Browser (`WebContentsView` + Full-View Floating Chat), Authentic Microsoft Excel & Markdown Preview

**Files:**
- Create: `desktop/src/features/previews/{types/index.ts,schemas/index.ts,api/previews-api.ts,hooks/use-browser-bounds.ts,components/browser-pane.tsx,components/floating-ask-chat.tsx,components/excel-pane.tsx,components/markdown-pane.tsx,index.ts}`
- Test: `desktop/src/features/previews/__tests__/excel-pane.test.tsx`

**Interfaces:**
- Consumes: `@/lib/app-store`, `@/lib/ipc-client` (`native.openInExcel`, `browser.*`), `@/components/ui/{dropdown-menu,tabs,button}`
- Produces: `BrowserPane`, `ExcelPane`, `MarkdownPane`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check dropdown-menu tabs button --json`
- [ ] **Step 2: Write failing tests for Excel live `SUM`/`AVERAGE` cell recalculation and Browser zoom/device-toolbar state**
- [ ] **Step 3: Implement `features/previews/` matching `prototype/pages/excel-session.html` & `prototype/pages/agent-workspace.html` Browser tab 1:1**
  - `BrowserPane`: syncs DOM bounding rect to Electron `WebContentsView`, full `⋯` dropdown (`Find`, `Print`, `Zoom - 100% + ↻`, `Device toolbar`, `Take screenshot`, cookies/downloads/settings), `⤢` Full View with `⤡ Exit full view` + floating bottom-right `Ask RayuCode` chat card.
  - `ExcelPane`: authentic `#107C41` Excel ribbon, `fx` formula bar, editable cells with live formula recalc, worksheet tabs, **Live Excel Web** (`view.officeapps.live.com/op/embed.aspx` loader), and **Open in Excel App** calling `window.rayu.native.openInExcel(path)`.
  - `MarkdownPane`: `unified`/`remark`/`rehype` Rendered vs Raw switcher.
- [ ] **Step 4: Run `pnpm verify` + screenshot check (`.swarm-logs/verify/w2-previews-*.png`) and commit**

---

### Task 9 (`w2-swarm`): Dedicated RayuCode Swarm Orchestration Surface (`rayucode-swarm-core`)

**Files:**
- Create: `desktop/src/features/swarm/{types/index.ts,schemas/index.ts,api/swarm-api.ts,hooks/use-swarm.ts,components/swarm-view.tsx,components/spawn-worker-bar.tsx,components/agent-roster.tsx,components/agent-inspector.tsx,components/coordination-ledger.tsx,index.ts}`
- Test: `desktop/src/features/swarm/__tests__/swarm-view.test.tsx`

**Interfaces:**
- Consumes: `@/lib/ipc-client`, `@/features/execution-trace` (`ShellCard`), `@/components/ui/{tabs,select,button}`
- Produces: `SwarmView`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check tabs select button --json`
- [ ] **Step 2: Write failing tests for agent roster selection, inline `+ Spawn worker` Zod validation + roster append, Stop/Resume toggle, and steering DM posting to Message Board**
- [ ] **Step 3: Implement `features/swarm/` matching `prototype/pages/execution-runner.html` & `docs/SWARM_ARCHITECTURE.md` 1:1**
  - Single-line telemetry strip, inline `+ Spawn worker` bar, two-column Roster (`coordinator` root depth 0 + parallel workers) + Selected Worker Inspector (prepopulated todo lane, Codex work rail + `ShellCard`, `Send DM` steering bar), and bottom tabbed `Message Board` / `Shared Plan (v3)` / `Worktrees`.
- [ ] **Step 4: Run `pnpm verify` + screenshot check (`.swarm-logs/verify/w2-swarm-*.png`) and commit**

---

### Task 10 (`w2-automations`): Automations & Overnight Runs (`rayucode-overnight-core`)

**Files:**
- Create: `desktop/src/features/automations/{types/index.ts,schemas/index.ts,api/automations-api.ts,hooks/use-automations.ts,components/automations-view.tsx,components/overnight-launcher.tsx,index.ts}`
- Test: `desktop/src/features/automations/__tests__/automations-view.test.tsx`

**Interfaces:**
- Consumes: `@/lib/ipc-client`, `@/components/ui/{select,switch,button}`
- Produces: `AutomationsView`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check select switch button --json`
- [ ] **Step 2: Write failing tests for launching an overnight mission via Zod schema and expanding the manifest event log**
- [ ] **Step 3: Implement `features/automations/` matching `prototype/pages/automations.html` 1:1**
- [ ] **Step 4: Run `pnpm verify` + screenshot check (`.swarm-logs/verify/w2-automations-*.png`) and commit**

---

## Wave 3 — Operate Views & Final Cross-Route Visual QA (4 Parallel Subagents + QA)

> **Parallelism rule:** Tasks 11, 12, 13, and 14 touch strictly disjoint feature folders (`features/plugins/`, `features/changes/`, `features/telegram/`, `features/settings/`) and run simultaneously; Task 15 runs once Waves 1–3 merge.

### Task 11 (`w3-plugins`): Plugins & Customize Directory + RayuCode Featured Showcase

**Files:**
- Create: `desktop/src/features/plugins/{types/index.ts,schemas/index.ts,constants/catalog.ts,api/plugins-api.ts,hooks/use-plugins.ts,components/plugins-view.tsx,components/featured-showcase.tsx,components/brand-logos.tsx,index.ts}`
- Test: `desktop/src/features/plugins/__tests__/plugins-view.test.tsx`

**Interfaces:**
- Consumes: `@/lib/ipc-client`, `@/components/ui/{button,tabs,scroll-area}`
- Produces: `PluginsView`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check button tabs scroll-area --json`
- [ ] **Step 2: Write failing tests for live plugin search filtering, Featured Showcase tile spotlight switching, and Install/Remove sync with sidebar `Installed` list**
- [ ] **Step 3: Implement `features/plugins/` matching `prototype/pages/plugins.html` 1:1 (Customize sidebar `Plugins / Skills / Memory`, RayuCode obsidian-emerald Featured Showcase banner, 16 real multi-color SVG brand icons)**
- [ ] **Step 4: Run `pnpm verify` + screenshot check (`.swarm-logs/verify/w3-plugins-*.png`) and commit**

---

### Task 12 (`w3-changes`): Flat Changed-Files Review & Explicit PR Guardrail

**Files:**
- Create: `desktop/src/features/changes/{types/index.ts,schemas/index.ts,api/changes-api.ts,hooks/use-changes.ts,components/changes-view.tsx,components/diff-panel.tsx,index.ts}`
- Test: `desktop/src/features/changes/__tests__/changes-view.test.tsx`

**Interfaces:**
- Consumes: `@/lib/ipc-client`, `shiki` (lazy), `@/components/ui/{button,scroll-area}`
- Produces: `ChangesView`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check button scroll-area --json`
- [ ] **Step 2: Write failing tests confirming flat file list (zero nested folder tree), file diff switching, and explicit approval guard on `Create PR`**
- [ ] **Step 3: Implement `features/changes/` matching `prototype/pages/changes.html` 1:1**
- [ ] **Step 4: Run `pnpm verify` + screenshot check (`.swarm-logs/verify/w3-changes-*.png`) and commit**

---

### Task 13 (`w3-telegram`): Telegram Remote Pairing & Live Tool Approvals

**Files:**
- Create: `desktop/src/features/telegram/{types/index.ts,schemas/index.ts,api/telegram-api.ts,hooks/use-telegram.ts,components/telegram-view.tsx,index.ts}`
- Test: `desktop/src/features/telegram/__tests__/telegram-view.test.tsx`

**Interfaces:**
- Consumes: `@/lib/ipc-client`, `@/components/ui/{tabs,switch,button}`
- Produces: `TelegramView`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check tabs switch button --json`
- [ ] **Step 2: Write failing tests for switching `Connected / Rayu Shared Bot QR / @BotFather token` modes and Approve/Deny actions in Pending Approvals**
- [ ] **Step 3: Implement `features/telegram/` matching `prototype/pages/telegram.html` & `vscode/webview/components/TelegramConnectPanel.tsx` 1:1**
- [ ] **Step 4: Run `pnpm verify` + screenshot check (`.swarm-logs/verify/w3-telegram-*.png`) and commit**

---

### Task 14 (`w3-settings`): Full-Page Settings (Account, Appearance Dark/Light + Rayu Green / Ocean Blue, Models, Voice, Shortcuts)

**Files:**
- Create: `desktop/src/features/settings/{types/index.ts,schemas/index.ts,api/settings-api.ts,hooks/use-settings.ts,components/settings-view.tsx,components/appearance-panel.tsx,index.ts}`
- Test: `desktop/src/features/settings/__tests__/appearance-panel.test.tsx`

**Interfaces:**
- Consumes: `@/lib/app-store` (`theme`, `accent`, `setTheme`, `setAccent`), `@/components/ui/{switch,select,button}`
- Produces: `SettingsView`

- [ ] **Step 1: Run pre-flight shadcn check**
  Run: `cd desktop && node scripts/check-shadcn.mjs check switch select button --json`
- [ ] **Step 2: Write failing tests confirming Dark/Light toggle and Rayu Green / Ocean Blue accent toggle update `document.documentElement` attributes and `localStorage`**
- [ ] **Step 3: Implement `features/settings/` matching `prototype/pages/settings.html` 1:1**
- [ ] **Step 4: Run `pnpm verify` + screenshot check (`.swarm-logs/verify/w3-settings-*.png`) and commit**

---

### Task 15 (`w3-qa`): Final Route Wiring, Full `pnpm verify` & Cross-Route Visual Parity Audit

**Files:**
- Modify: `desktop/src/App.tsx` (connect all 10 lazy-loaded feature views + hover prefetching)
- Create: `desktop/tests/e2e/desktop-parity.spec.ts` (Playwright visual & functional parity checks)

**Interfaces:**
- Consumes: Public barrel exports from all 10 `desktop/src/features/*/index.ts` modules.
- Produces: Verified, green desktop build ready for PR to `main`.

- [ ] **Step 1: Wire all 10 feature barrels into `desktop/src/App.tsx` with `<Suspense>` skeletons and `<SectionErrorBoundary>`**
- [ ] **Step 2: Run full quality gate**
  Run: `cd desktop && pnpm verify`
  Expected: `typecheck` (0 errors), `lint` (0 errors), `lint:design` (0 violations), `test` (100% pass), `build` (renderer + electron main green).
- [ ] **Step 3: Capture & visually inspect `1440×934` screenshots across Home, Active Chat (Trace collapsed / open / Shell card), Context Mode vs Document/Code Mode, Excel, Swarm, Automations, Plugins, Changes, Telegram, and Settings in Dark (Rayu Green), Dark (Ocean Blue), and Light themes into `.swarm-logs/verify/`**
- [ ] **Step 4: Commit and open PR to `main` after verifying CI checks**

```bash
git add desktop/src/App.tsx desktop/tests/
git commit -m "feat(desktop): wire all feature modules and verify visual parity with prototype"
```
