---
name: RayuCode for VS Code
status: binding
stack: React 19 + TypeScript + Tailwind CSS v4 + Radix UI + Vite 6
description: Calm, high-performance dual-form-factor coding workspace for RayuCode inside VS Code — Rayu Signature Warm Graphite Dark & Warm Paper Light (auto-following VS Code polarity) + optional Match VS Code Theme & High Contrast, Rayu Green default + Ocean Blue accent, Quiet 3-Depth Trace, first-class Background Process Viewer, and 100% coverage of all 18 Rust engine subsystems & 45 tools.
---

# RayuCode for VS Code — Authoritative Design Contract (`VSCODE_DESIGN.md`)

> **Binding Rule for All Agents & Engineers:** `vscode/webview/src/styles/globals.css` is the single source of truth for all colors, surfaces, borders, bevels, and theme/accent tokens across both the Compact Docked Sidebar (`rayucode.chat`) and the Full Editor Mission-Control Panel (`rayucode.workspace`). Change a token once in `vscode/webview/src/styles/globals.css` and every screen updates.
>
> This extension is built strictly as pure **React 19 + TypeScript + Tailwind CSS v4 + Radix UI + Vite 6** with **zero static HTML prototypes**. **Never** write raw hex colors (`#...`), arbitrary Tailwind color classes (`bg-[#...]`), default shadcn zinc/slate/gray/neutral/stone classes, or raw UI emoji characters in `vscode/webview/src/**/*.{ts,tsx}` — all are mechanically rejected by `npm run lint:design --workspace @rayu-dev/rayucode-vscode`.

---

## 1. Visual Identity, Themes & Token Architecture (`vscode/webview/src/styles/globals.css`)

All surfaces, ink tiers, borders, specular bevels, chromatic syntax tokens, step pills, tech file badges, and diff gutters live in `vscode/webview/src/styles/globals.css` using Tailwind CSS v4 `@theme inline`.

### 1.1 Warm Graphite Dark (Rayu Signature Default — `:root`)

| Token | Value | Semantic Utility / Role |
| :--- | :--- | :--- |
| `--bg-chrome` | `#11110E` | `bg-chrome` — Outer frame, left icon rail, top bar, session pane |
| `--bg-canvas` | `#0C0C0A` | `bg-canvas` — Deep warm inset main canvas |
| `--bg-pane` | `#161613` | `bg-pane` — Drawers, inspector panels, cards, diff cards, dock bar |
| `--bg-shell` | `#141411` | `bg-shell` — Floating composer outer tray |
| `--bg-raised` | `#1B1B17` | `bg-raised` — Composer inner surface, elevated controls |
| `--bg-popover-solid` | `#1D1D1A` | `bg-popover-solid` — Opaque floating popovers, rich hover cards |
| `--bg-control` | `#24231F` | `bg-control` — Interactive segmented controls, secondary pills |
| `--bg-inset` | `#10100D` | `bg-inset` — Code wells, `ShellCard`, background process output tail, inline code pills |
| `--bg-hover` | `rgba(255, 255, 255, 0.06)` | `bg-hover` — Hover surface fill |
| `--bg-active` | `#262520` | `bg-active` — Active nav pill, selected list option, user prompt bubble |
| `--border` | `#2A2924` | `border-hairline` — 1px structural hairline |
| `--border-soft` | `#22211D` | `border-hairline-soft` — Subtle internal separator |
| `--border-strong` | `#3A3832` | `border-hairline-strong` — Emphasized divider |
| `--border-control` | `#35342E` | `border-control` — Interactive control hairline |
| `--border-premium` | `rgba(255, 255, 255, 0.11)` | `border-premium` — Machined card/pill edge |
| `--border-premium-hi` | `rgba(255, 255, 255, 0.18)` | `border-premium-hi` — Floating popover/card edge |
| `--text-1` | `#ECEAE3` | `text-ink` — Primary ink (warm cream-ivory) |
| `--text-2` | `#D4D0C5` | `text-body` — Body & conversation prose |
| `--text-3` | `#8F8B80` | `text-muted-ink` — Muted metadata, folders, timestamps, placeholders |
| `--text-4` | `#68645B` | `text-faint` — Faint line numbers / empty states |

### 1.2 Warm Paper Light (`[data-theme="light"]`)

| Token | Value | Role |
| :--- | :--- | :--- |
| `--bg-chrome` | `#F7F7F4` | Outer frame, rail, top bar |
| `--bg-canvas` | `#FFFFFF` | Pure crisp white main canvas |
| `--bg-pane` | `#FAFAF7` | Inspector panels, drawers & cards |
| `--bg-shell` | `#F7F7F4` | Floating composer outer tray |
| `--bg-raised` | `#FFFFFF` | Composer inner surface & opaque controls |
| `--bg-popover-solid` | `#FFFFFF` | Opaque floating popovers |
| `--bg-inset` | `#F4F4F0` | Code wells, `ShellCard`, output tails |
| `--bg-active` | `#ECEBE5` | Active row highlight |
| `--border` | `#E6E5E0` | 1px structural hairline |
| `--text-1` / `--text-2` / `--text-3` / `--text-4` | `#26251E` / `#5A5852` / `#6F6C62` / `#8E8B80` | Warm charcoal ink hierarchy |

### 1.3 VS Code Polarity, Match VS Code Theme & High Contrast

1. **Auto-Follow VS Code Polarity (`themeMode: "auto"` — Default):**
   - `vscode/webview/src/main.tsx` mounts a `MutationObserver` on `document.body.classList`:
     - `body.vscode-light` sets `document.documentElement.dataset.theme = "light"` (Warm Paper Light).
     - `body.vscode-dark` removes `data-theme` (Warm Graphite Dark).
     - `body.vscode-high-contrast` / `body.vscode-high-contrast-light` sets `document.documentElement.dataset.hc = "true"`, enforcing crisp `--vscode-contrastBorder` and `--vscode-foreground` high-contrast accessibility overrides.
2. **Match VS Code Theme (`[data-theme="vscode"]` — Optional Setting):**
   - Maps semantic surfaces directly to VS Code CSS variables:
     - `--bg-chrome: var(--vscode-sideBar-background)`
     - `--bg-canvas: var(--vscode-editor-background)`
     - `--bg-pane: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background))`
     - `--bg-raised: var(--vscode-input-background)`
     - `--bg-popover-solid: var(--vscode-editorWidget-background)`
     - `--bg-inset: var(--vscode-textCodeBlock-background)`
     - `--bg-active: var(--vscode-list-activeSelectionBackground)`
     - `--border: var(--vscode-panel-border)`
     - `--text-1: var(--vscode-foreground)`
     - `--text-2: var(--vscode-editor-foreground)`
     - `--text-3: var(--vscode-descriptionForeground)`

### 1.4 User-Selectable Accents (`globalState` synced via `data-accent="green" | "blue"`)

- **Rayu Green (Brand Default):**
  - Dark: `--accent: #3DBD84`, `--accent-bright: #52C993`, `--accent-ink: #06140C`, `--accent-text: #5FD19C`, `--effort-grad: linear-gradient(90deg, #1E9E6B 0%, #3DBD84 100%)`
  - Light: `--accent: #0F7B4F`, `--accent-bright: #0B6E45`, `--accent-ink: #FFFFFF`, `--accent-text: #0D7449`, `--effort-grad: linear-gradient(90deg, #0F7B4F 0%, #1F9A68 100%)`
- **Ocean Blue (`[data-accent="blue"]`):**
  - Dark: `--accent: #3B82F6`, `--accent-bright: #60A5FA`, `--accent-ink: #FFFFFF`, `--accent-text: #5EA6FF`, `--effort-grad: linear-gradient(90deg, #2563EB 0%, #4B9BFF 100%)`
  - Light: `--accent: #1D6FE2`, `--accent-bright: #1458B8`, `--accent-ink: #FFFFFF`, `--accent-text: #1A63CC`, `--effort-grad: linear-gradient(90deg, #1D6FE2 0%, #3B82F6 100%)`
- **Instant Multi-Surface Sync:** Switching theme or accent from **Settings -> Appearance**, the Profile menu, or the top-right `⋯` overflow menu updates both the Compact Sidebar and Full Editor Panel simultaneously through VS Code `globalState` (`rayucode.ui.appearanceSync`).

### 1.5 Semantic, Syntax & Specular Bevel Tokens

- Semantic status tokens: `--danger: #CF2D56`, `--warn: #DCAE66` (dark) / `#9A6414` (light), `--info: #A9C4EA` (dark) / `#1E5A9E` (light).
- Specular bevel utilities (`.rayu-surface-bevel`, `.rayu-card-bevel`, `.rayu-primary-bevel`, `.rayu-effort-bar`) provide subtle machined tactile depth on cards, buttons, floating popovers, and the double-bordered composer.
- Full chromatic syntax palette (`--code-kw`, `--code-str`, `--code-fn`, `--code-type`, `--code-num`, `--code-prop`, `--code-com`, `--folder`), diff gutters (`--diff-add-*`, `--diff-del-*`), and tech file badge tokens (`--tech-ts-*` through `--tech-sql-*`) live exclusively in `globals.css`.

---

## 2. Typography, Self-Hosted Fonts & Motion

- **CSP-Safe Self-Hosted Fonts:** `vscode/assets/fonts/{inter-latin,inter-latin-ext,jetbrains-mono-latin,jetbrains-mono-latin-ext}.woff2` are bundled into `dist/extension/media/fonts/` and resolved through `webview.asWebviewUri(...)` with zero external CDN requests.
- **Font Stacks:**
  - `--font-ui`: `"Inter", -apple-system, "SF Pro Text", "Segoe UI", sans-serif` (all chrome and controls)
  - `--font-ui-prose`: `"Inter", -apple-system, "SF Pro Text", "Segoe UI", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"` (applied **only** to user prompts, assistant Markdown prose, and terminal output so user/assistant content emojis render cleanly)
  - `--font-mono`: `"JetBrains Mono", var(--vscode-editor-font-family, "SF Mono", ui-monospace, monospace)` with `font-variant-numeric: tabular-nums` for tokens, credits, durations, diffs, and line numbers
  - `--font-serif`: `"Instrument Serif", "New York", Georgia, serif` (used **only** on the Home hero emphasis word *"next?"*)
- **Motion:** `--dur: 150ms`, `--ease: cubic-bezier(0.2, 0.7, 0.2, 1)`; strictly honors `prefers-reduced-motion` and the in-app Reduce Motion toggle.

---

## 3. Brand Logos, Symbols & Emoji Governance

| Asset / Component | Extension Path | Role |
| :--- | :--- | :--- |
| **Rayu Fox Hero Logo** | `vscode/assets/rayu-fox.png` | `HomePage` (`h-[74px]` Wide / `h-[48px]` Compact) and `AuthWelcomeScreen` via `mediaUrl("rayu-fox.png")`. |
| **Extension & Activity Bar Icons** | `vscode/assets/app-icon.png`, `vscode/assets/icon.svg` | Marketplace extension icon and monochrome VS Code Activity Bar icon. |
| **`RayuProcessingMark`** | `vscode/webview/src/components/ui/rayu-processing-mark.tsx` | Signature 8-dot orbital animated SVG (`rayu-dot-orbit`, `size-4 text-brand`) for live `WorkTrace`, optimistic `HomePage` turn start, `BackgroundDockBar`, and running Swarm rows. |
| **`TechFileBadge`** | `vscode/webview/src/components/ui/tech-file-badge.tsx` | `16px` rounded (`3.5px`) chromatic badges (`TS`, `TX`, `RS`, `PY`, `GO`, `{}`, `MD`, `#`, `<>`, `$`, `DB`, `YM`, `DK`, `CF`, Image/Excel/PPT). |
| **`NavGlyph` & `#i-ring`** | `vscode/webview/src/components/ui/rayu-symbols.tsx` | Custom 17px stroke navigation glyphs (`home`, `swarm`, `clock`, `plug`, `branch`, `telegram`) and 20px two-arc Plan & Usage ring with rotated center diamond. |
| **`BrandLogo` (32 Multi-Color SVGs)** | `vscode/webview/src/features/plugins/components/brand-logos.tsx` | 32 official multi-color brand tiles built with `rgb(...)` fills (zero hex literals) for MCP Connectors, Workspace Integrations, and Inspector Connectors. |
| **`ProjectIconPicker` & `ProjectIconGlyph`** | `vscode/webview/src/features/shell/components/ProjectIconPicker.tsx` | User-selectable workspace/project icons: **12 ASCII-safe native emoji presets** constructed via `String.fromCodePoint(...)` (zero raw emoji literals in source) + 10 Lucide icons × 6 semantic colors (`folder`, `brand`, `info`, `type`, `num`, `danger`). |
| **Zero Raw UI-Chrome Emojis** | `vscode/scripts/lint-design.mjs` | Enforced in CI: zero `\p{Extended_Pictographic}` literals in `vscode/webview/src/**/*.{ts,tsx}`, zero raw `#hex`, zero `bg-[#...]`, zero default Tailwind gray/zinc/slate/neutral/stone classes, zero `node:*` imports in webview code, and zero cross-feature deep imports. |

---

## 4. Dual Form-Factor Shell Geometry (`@container/app`)

The root container uses `className="@container/app flex h-screen w-screen overflow-hidden"` so the exact same React 19 application adapts fluidly between VS Code's narrow docked sidebar and a full-width editor tab.

### 4.1 Wide Editor Panel (`rayucode.workspace`, `@min-[960px]/app`)
- **Left Icon Rail (`52px`, `bg-chrome`):**
  - Top `46px` sidebar collapse trigger (`⇧⌘S`).
  - **Exact 6 primary destinations:** `Home`, `Swarm`, `Automations`, `Plugins`, `Changes`, `Remote` (live green `.rail-live-dot` when Telegram or Mobile Gateway is active).
  - **Exact 2 bottom controls:** `Plan & Usage` (`#i-ring` popover) + Profile dropdown (`Theme`, `Accent`, `Background Processes`, `Settings`, `Restart Bridge`, `Sign out`).
  - **No folder tree anywhere in v1.**
- **Collapsible Session & Projects Pane (`244px`, total left `296px`):**
  - `+ New session`, Search filter (`⌘K` with Rust cross-tool `session_search` toggle across Rayu, Claude, Codex, Cursor, OpenCode, Pi), and Organize/Sort menu.
  - Project groups with `ProjectIconGlyph` (`ProjectIconPicker`), single-line truncated session rows, status dots, `+A -R` diff badges, hover previews (`bg-popover-solid`), context menu (`Pin`, `Rename`, `Fork`, `Transfer`, `Archive`), and collapsible `Archived` section.
- **Main Stage (`bg-canvas`, `rounded-tl-[14px] border-t border-l border-hairline` when pane open):**
  - Slim `DaemonBanner` (`28px`, completely hidden when healthy).
  - `46px` `TopBar` (`⌘[` / `⌘]` history, `<Session Title ▾>`, and `SixIconStrip` when inspector is in Document Mode or closed).
- **Dual-Mode Right Inspector (`332px` Context Mode, drag-resizable `280px..calc(100%-320px)` with snap-clip `< 210px` + `Show chat session ⌘1` restore bar):**
  - **Context Mode (`≡`):** Right header holds the `SixIconStrip` (`[≡] Context`, `[>_] Terminal` opening native VS Code Integrated Terminal, `[±] Changes`, `[🌐] Preview`, `[📁] Files`, `[⋯] MoreOptionsMenu`) above `Environment`, interactive dotted-underline `Context` breakdown, `Connectors`, `Outputs & Todos` (`SidePanel`, `AppletRenderer`, `TodoSnapshot`), `Background Processes`, and `Changes`.
  - **Document / Code / Diff Mode:** Active file pill (`lookup.rs ×`) + `⤢ Open in VS Code Editor` + `Full view` + `× Close` returning to Context Mode.

### 4.2 Medium Split (`560px–959px`, `@min-[560px]/app` to `@max-[959px]/app`)
- `52px` Left Icon Rail remains docked.
- `SessionPane` (`244px`) and `RightInspectorHost` (`320px`) open as slide-over drawers with subtle backdrop dim so the center canvas always preserves `>= 500px`.

### 4.3 Compact Docked Sidebar (`rayucode.chat`, `< 560px`, `@max-[559px]/app`)
- **Zero permanent side rails** — 100% of sidebar width belongs to the active conversation or view.
- **Compact `40px` Top Chrome Bar:**
  - `[☰]` Slide-over Session & Projects Drawer (`⇧⌘S`)
  - `<Session Title ▾>` single-line truncated switcher
  - Compact icon cluster (`size-7 rounded-[7px]`): `[+]` New Session, `[Sw]` Swarm, `[Bg·N]` Background Processes (count badge shown only when `>= 1` task active/stalled), `[±]` Changes, `[≡]` Context Sheet, `[⤢]` **Pop out to Full Editor Mission Control** (opens `rayucode.workspace` synced to the exact same route and session), and `[⋯]` Overflow menu (`Automations`, `Plugins & MCP`, `Remote`, `Plan & Usage`, `Settings`, `Theme & Accent`, `Restart Bridge`).

---

## 5. Core Interaction & Page Contracts (10 Deep Specs)

Every page is specified at component level in `vscode/docs/pages/`:

| Spec | Page / Surface | Key Design & Engine Contract |
| :--- | :--- | :--- |
| **[00](docs/pages/00-vscode-design-system-and-shell.md)** | Design System, Logos, Symbols, Emojis & Dual Shell | Tailwind v4 tokens, VS Code polarity observer, Match VS Code + High Contrast, 32 `BrandLogo` SVGs, `ProjectIconPicker`, Compact/Medium/Wide shells, `AuthWelcomeScreen`. |
| **[01](docs/pages/01-home-and-composer.md)** | Home / New Session & Floating Chat Composer | `rayu-fox.png` + serif *"next?"*, double-bordered composer (`max-w-[732px]`, zero focus glow, zero file-chip wall), VS Code Editor Selection Pill, `@` file & `/` command/skill autocomplete, 2-stage Model & 5-stop Effort Popover, 5-mode `Shift+Tab` Permission Popover, Soft Interrupt steer, Voice mic. |
| **[02](docs/pages/02-chat-and-inspector.md)** | Active Chat, Quiet 3-Depth Trace & Right Inspector | Zero AI slop, Quiet 3-depth `WorkTrace` (`Worked for <dur> ›` -> hairline rail + auto-coalesced reads -> `ShellCard` / native `vscode.diff`), quiet renderers for all 45 Rust tools, `ApprovalCard` with `command-risk` tier, `ClarifyingQuestionCard`, `EditorialMarkdown` + `.cite-link` + `MermaidDiagramSvg` + `TurnActions`, Dual-Mode Right Inspector. |
| **[03](docs/pages/03-background-processes.md)** | Background Process Viewer (`bg` & `BackgroundTaskManager`) | Zero noise when idle; `BackgroundDockBar` (30px hairline above composer), `BackgroundProcessDrawer`, Stall Watchdog amber banner, `Alt+B` foreground-to-background handoff, bounded on-demand output tail, `Open Output File in VS Code`, graceful `Stop` & `Cleanup`. |
| **[04](docs/pages/04-swarm.md)** | Swarm Mission Control | `SwarmLaunchpad`, multi-swarm switcher, single-line telemetry strip with conflict jump, inline `SpawnWorkerBar`, `AgentRoster` + `AgentInspector` (reusing `WorkTrace` + `ShellCard`, todo lane, direct `Send DM`), `CoordinationLedger` (`Message Board`, `Shared Plan vN` proposals, `Worktrees` -> `Open in New VS Code Window`). |
| **[05](docs/pages/05-automations.md)** | Automations (Overnight, Schedules, Ambient, Quality) | 4 Radix tabs: `Overnight` (inline launcher, `RunStatusPulse`, expandable event log, `MorningHandoffReport` + native Markdown Preview), `Schedules`, `Ambient` (queued approvals), `Quality & Reports` (Auto-Review, Auto-Judge, `/review`, `/judge`, Productivity PNG report). |
| **[06](docs/pages/06-plugins-skills-memory.md)** | Plugins, 7-Layer MCP, Skills, Memory Graph & Workspace | Customize rail/tabs: 7-layer MCP discovery + OAuth 2.1 + shared pool + schema cache + 32 `BrandLogo` SVGs, `SKILL.md` create/open-in-editor, Jev + Semantic Memory Graph explorer, Gmail/Calendar/Browser/Companion status grid. |
| **[07](docs/pages/07-changes.md)** | Changes, Native `vscode.diff` & Create PR Guardrail | Flat changed-files list (no folder tree in v1), `Session Edits` vs `All Git Changes`, safe `reversePatch.ts` Keep/Undo, native `vscode.diff` beside, inline commit form, explicit `Create PR` confirmation guardrail dialog. |
| **[08](docs/pages/08-remote-telegram-cloud.md)** | Remote Access (Telegram Bot + Cloud, SSH & Gateway) | Unified `Remote` destination: `Telegram Bot` (Connected + `ApprovalRow`, offline SVG `PairingQrMatrix`, `@BotFather` token sent straight to Rust, Remote Uninstall safety switch) + `Cloud, SSH & Gateway` (`:7643` WS pairing QR/devices + Cloud/SSH session handoff). |
| **[09](docs/pages/09-settings.md)** | Settings (Full-Page Shell) | 7 sections covering Rayu Cloud account/usage analytics/plan ladder, 10 native + 45 OpenAI-compatible providers, Appearance (4 modes + 2 accents), Models & 5 per-role agent overrides, all 11 `[features]` + Codemode + Voice, Safety + 7 lifecycle hooks, Runtime/Bridge/Doctor/Self-Dev/Telemetry, and Shortcuts. |

---

## 6. 100% Rust Engine Coverage Contract

This extension connects directly to the 93-crate `rayucode-v2` Rust engine (`rayu serve` + `rayu api-bridge`, Harness API `v1.14`) and covers **all 18 subsystems** and **all 45 built-in tools** without inventing parallel state or hardcoding model lists:

1. **Sessions & Checkpoints** (`create`, `fork`, `transfer`, `rewind`, `rewind_undo`, `compact`, `context_cap`, `session_search`)
2. **Quiet Execution Trace & Tool Streaming** (all 45 built-in tools rendered via Rust `intent` strings + interactive Depth-2 surfaces)
3. **Permissions & Two-Stage Command-Risk Gate** (5 modes via `Shift+Tab` + `PermissionRequest.risk_tier`)
4. **Background Task Manager** (`BackgroundTool` `Alt+B`, `BackgroundProgress`, `RuntimeCommand::Background`, Stall Watchdog)
5. **Providers & Live Model Discovery** (10 native + 45 OpenAI-compatible + Azure + Google, live `RefreshModelList`, multi-account auth, Fast/Service Tier, KV-Cache TTL)
6. **Inference & Reasoning Effort** (`Auto`/`Low`/`Medium`/`High`/`Max`, capability-filtered via `vscode/shared/inferenceSettings.ts`)
7. **Swarm Multi-Agent Orchestration** (multi-swarm switcher, roster, DM steering, versioned plans, worktrees)
8. **Overnight Runs & Morning Handoffs** (launcher, live event logs, structured review reports)
9. **Recurring Schedules** (`schedule` tool + `RuntimeCommand::Schedules`)
10. **Ambient Autonomous Cycles** (wakeup status + queued permission approvals)
11. **Quality Gates & Productivity** (`autoreview`, `autojudge`, independent `/review`, `/judge`, productivity PNG reports)
12. **7-Layer MCP & OAuth 2.1** (stdio/HTTP/SSE, shared process pool, zero-cache-miss schema cache, 8k token budget)
13. **Skills (`SKILL.md`)** (project & global discovery, creation, endorsed catalog)
14. **Memory Graph** (Jev + semantic graph, extraction, link inspection, forget)
15. **Workspace Integrations** (Gmail, Google Calendar, Browser automation, Desktop Companion)
16. **Rich Interactive Outputs** (`SidePanel` Markdown/PDF, interactive React `AppletRenderer`, `TodoSnapshot`, Mermaid, KaTeX)
17. **Remote Access** (Telegram Shared Bot QR / `@BotFather` / live approvals / uninstall guardrail, `:7643` WS Mobile Gateway, Cloud & SSH handoff)
18. **System & Diagnostics** (all 11 `[features]`, Codemode sandbox, Voice dictation, 7 lifecycle hooks, Provider/Auth Doctor, Transport, Telemetry, Self-Dev)

---

## 7. Strict Anti-Slop & Quality Gates (Enforced by CI)

Every commit touching `vscode/` must pass these non-negotiable gates:

- [ ] **Zero raw hex colors** (`#...`) or arbitrary Tailwind color values (`bg-[#...]`, `text-[#...]`, `border-[#...]`) inside `vscode/webview/src/**/*.{ts,tsx}`.
- [ ] **Zero default shadcn/Tailwind gray classes** (`bg-zinc-*`, `text-slate-*`, `border-gray-*`, `bg-neutral-*`, `text-stone-*`).
- [ ] **Zero raw UI emoji characters** (`\p{Extended_Pictographic}`) inside `vscode/webview/src/**/*.{ts,tsx}` — use `lucide-react`, `NavGlyph`, `BrandLogo`, `TechFileBadge`, or ASCII-safe `String.fromCodePoint(...)` inside `ProjectIconPicker`.
- [ ] **Zero composer focus glow rings**, **zero composer file-chip walls**, **zero folder trees in v1**, and **zero AI-slop chat headers/thinking boxes**.
- [ ] **Feature-sliced isolation:** features under `vscode/webview/src/features/<name>/` import other features **only** through `@/features/<name>` barrels; zero `node:*` imports inside `vscode/webview/src/`.
- [ ] **Mandatory verification commands:**
  - `npm run typecheck --workspace @rayu-dev/rayucode-vscode`
  - `npm run lint:design --workspace @rayu-dev/rayucode-vscode`
  - `npm test --workspace @rayu-dev/rayucode-vscode`
  - `npm run build:vscode`
  - `npm run package:vscode`
- [ ] **Visual parity check:** Verify both **Compact Sidebar (`360px`)** and **Wide Editor Panel (`>= 1280px`)** in Warm Graphite Dark (Rayu Green & Ocean Blue), Warm Paper Light, and Match VS Code / High Contrast modes.
