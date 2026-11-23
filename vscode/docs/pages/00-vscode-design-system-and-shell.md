# Spec 00 — `VSCODE_DESIGN.md` Design System, Logos, Symbols, Emojis & Responsive Shell

> **Authoritative Reference:** Mirrors `desktop/src/styles/globals.css`, `desktop/src/components/shell/AppShell.tsx`, `desktop/src/components/shell/LeftSidebar.tsx`, `desktop/src/components/shell/sidebar-projects-pane.tsx`, `desktop/src/components/shell/TopBar.tsx`, `desktop/src/components/shell/RightInspectorHost.tsx`, `desktop/src/components/shell/project-icon-picker.tsx`, and `desktop/src/components/shell/AuthWelcomeScreen.tsx`.
> **Target Output in Repo (Wave 0 & 2B):** `vscode/VSCODE_DESIGN.md`, `vscode/webview/src/styles/globals.css`, `vscode/webview/src/components/ui/*`, `vscode/webview/src/features/shell/*`.

---

## 1. Visual Identity & Token Architecture (`vscode/webview/src/styles/globals.css`)

1:1 port of Desktop's 683-line Tailwind v4 `@theme inline` design system, extended cleanly for VS Code Webviews:

### Themes & Polarity Resolution
1. **Warm Graphite Dark (Default `:root`):**
   - Surfaces: `--bg-chrome: #11110e`, `--bg-canvas: #0c0c0a`, `--bg-pane: #161613`, `--bg-shell: #141411`, `--bg-raised: #1b1b17`, `--bg-popover-solid: #1d1d1a`, `--bg-control: #24231f`, `--bg-inset: #10100d`, `--bg-hover: rgba(255,255,255,0.06)`, `--bg-active: #262520`.
   - Borders: `--border: #2a2924`, `--border-soft: #22211d`, `--border-strong: #3a3832`, `--border-control: #35342e`, `--border-premium: rgba(255,255,255,0.11)`, `--border-premium-hi: rgba(255,255,255,0.18)`.
   - Text: `--text-1: #eceae3` (`text-ink`), `--text-2: #d4d0c5` (`text-body`), `--text-3: #8f8b80` (`text-muted-ink`), `--text-4: #68645b` (`text-faint`).
   - Specular Bevels: `.rayu-surface-bevel`, `.rayu-card-bevel`, `.rayu-primary-bevel`, `.rayu-effort-bar`.
2. **Warm Paper Light (`[data-theme="light"]`):**
   - Surfaces: `--bg-chrome: #f7f7f4`, `--bg-canvas: #ffffff`, `--bg-pane: #fafaf7`, `--bg-shell: #f7f7f4`, `--bg-raised: #ffffff`, `--bg-popover-solid: #ffffff`, `--bg-inset: #f4f4f0`, `--bg-active: #ecebe5`.
   - Text: `--text-1: #26251e`, `--text-2: #5a5852`, `--text-3: #6f6c62`, `--text-4: #8e8b80`.
3. **Auto-Follow VS Code Polarity (`themeMode: "auto"` default):**
   - `main.tsx` mounts a `MutationObserver` on `document.body.classList`:
     - `vscode-light` -> sets `document.documentElement.dataset.theme = "light"`
     - `vscode-dark` -> removes `data-theme` (Warm Graphite Dark)
     - `vscode-high-contrast` / `vscode-high-contrast-light` -> sets `data-hc="true"` forcing crisp high-contrast `--vscode-contrastBorder` / `--vscode-foreground` overrides for accessibility.
4. **Match VS Code Theme (`[data-theme="vscode"]`, optional setting):**
   - Maps `--bg-chrome: var(--vscode-sideBar-background)`, `--bg-canvas: var(--vscode-editor-background)`, `--bg-pane: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background))`, `--bg-raised: var(--vscode-input-background)`, `--bg-popover-solid: var(--vscode-editorWidget-background)`, `--bg-inset: var(--vscode-textCodeBlock-background)`, `--bg-active: var(--vscode-list-activeSelectionBackground)`, `--border: var(--vscode-panel-border)`, `--text-1: var(--vscode-foreground)`, `--text-2: var(--vscode-editor-foreground)`, `--text-3: var(--vscode-descriptionForeground)`.
5. **Accents (`data-accent="green" | "blue"`):**
   - **Rayu Green (Default):** Dark `--accent: #3dbd84`, `--accent-bright: #52c993`, `--accent-ink: #06140c`, `--accent-text: #5fd19c`, `--effort-grad: linear-gradient(90deg, #1e9e6b 0%, #3dbd84 100%)`. Light `--accent: #0f7b4f`, `--accent-text: #0d7449`.
   - **Ocean Blue (`[data-accent="blue"]`):** Dark `--accent: #3b82f6`, `--accent-bright: #60a5fa`, `--accent-ink: #ffffff`, `--accent-text: #5ea6ff`. Light `--accent: #1d6fe2`, `--accent-text: #1a63cc`.
6. **Chromatic Syntax, Step Pills & Tech Badges:** Exact 1:1 port of Desktop's `--code-kw`, `--code-str`, `--code-fn`, `--code-type`, `--code-num`, `--code-prop`, `--code-com`, `--folder`, `--pk-*`/`--pf-*`, `--tech-ts-*`..`--tech-sql-*`, `--diff-add-*`/`--diff-del-*`.

### Typography & Self-Hosted Fonts (CSP-Safe)
- Copy `desktop/public/fonts/{inter-latin,inter-latin-ext,jetbrains-mono-latin,jetbrains-mono-latin-ext}.woff2` into `vscode/assets/fonts/` -> `dist/extension/media/fonts/`.
- Relative `@font-face` URLs resolve seamlessly inside VS Code's `webview.asWebviewUri(media)` base!
- Font stacks:
  - `--font-ui`: `"Inter", -apple-system, "SF Pro Text", "Segoe UI", sans-serif`
  - `--font-ui-prose`: `"Inter", -apple-system, "SF Pro Text", "Segoe UI", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"` (applied ONLY to user prompts, assistant Markdown, and terminal output so content emojis render cleanly!)
  - `--font-mono`: `"JetBrains Mono", var(--vscode-editor-font-family, "SF Mono", ui-monospace, monospace)` with `tabular-nums`.
  - `--font-serif`: `"Instrument Serif", "New York", Georgia, serif` (ONLY for Home greeting *"next?"*).

---

## 2. Brand Logos, Symbols & Emoji Governance

| Asset / Component | Source Reference | Usage in VS Code |
| :--- | :--- | :--- |
| **Rayu Fox Logo** | `vscode/assets/rayu-fox.png` (from `desktop/public/rayu-fox.png`) | Hero (`h-[74px]` in Wide, `h-[48px]` in Compact Sidebar) on `HomePage` & `AuthWelcomeScreen` via `mediaUrl("rayu-fox.png")`. |
| **App / Activity Bar Icon** | `vscode/assets/app-icon.png` + `vscode/assets/icon.svg` | Extension icon in Marketplace + monochrome Activity Bar icon. |
| **`RayuProcessingMark`** | `desktop/src/components/ui/rayu-processing-mark.tsx` | Signature **8-dot orbital animated SVG** (`rayu-dot-orbit`, `size-4 text-brand`) used on active `WorkTrace`, `HomePage` starting turn, `BackgroundDockBar`, and Swarm running rows. |
| **`TechFileBadge`** | `desktop/src/components/ui/tech-file-badge.tsx` | `16px` rounded `[3.5px]` chromatic badges (`TS`, `TX`, `RS`, `PY`, `GO`, `{}`, `MD`, `#`, `<>`, `$`, `DB`, `YM`, `DK`, `CF`, Image/Excel/PPT). |
| **`NavGlyph` & `#i-ring`** | `desktop/src/components/shell/LeftSidebar.tsx` | Custom 17px stroke glyphs (`home`, `swarm`, `clock`, `plug`, `branch`, `telegram`) + 20px two-arc Usage Ring with rotated center diamond. |
| **`BrandLogo` (32 SVGs)** | `desktop/src/features/plugins/components/brand-logos.tsx` | 32 official multi-color brand tiles (`rgb(...)`, zero hex) for MCP Connectors, Workspace Integrations, and Inspector Connectors. |
| **`ProjectIconPicker` & `ProjectIconGlyph`** | `desktop/src/components/shell/project-icon-picker.tsx` | **User-selectable workspace/project icons:** 12 ASCII-safe native Emoji presets (`String.fromCodePoint(...)`) + 10 Lucide icons × 6 semantic colors (`folder`, `brand`, `info`, `type`, `num`, `danger`). |
| **Zero UI-Chrome Emojis** | `vscode/scripts/lint-design.mjs` | Automated CI gate: zero `\p{Extended_Pictographic}` literals, zero raw `#hex`, zero `bg-[#...]`, zero `zinc\|slate\|gray\|neutral\|stone` classes, zero `node:*` imports in `vscode/webview/src/`, zero cross-feature deep imports. |

---

## 3. Dual Form-Factor Shell Geometry (`@container/app`)

Root wrapper sets `className="@container/app flex h-screen w-screen overflow-hidden"`.

### Mode A — Wide Editor Panel (`rayucode.workspace`, `@min-[960px]/app`)
Matches Desktop `AppShell.tsx` 1:1:
- **Left Icon Rail (`w-[52px] shrink-0 bg-chrome`):**
  - Top `46px`: Toggle sidebar button (`⇧⌘S`)
  - Exact 6 primary items (`size-9 rounded-[10px]`):
    1. `Home` (`home` filled glyph) — active on `home` | `workspace`
    2. `Swarm` (`swarm` 3-node triangle glyph) — live dot when workers running
    3. `Automations` (`clock` glyph) — live dot when overnight run active
    4. `Plugins` (`plug` glyph)
    5. `Changes` (`branch` glyph) — live count dot when uncommitted/session edits exist
    6. `Remote` (`telegram` paper-plane glyph) — green `.rail-live-dot` when Telegram linked + daemon online
  - `flex-1` spacer
  - Bottom 2 items:
    1. **Plan & Usage Popover (`#i-ring` SVG):** `w-[292px] rounded-2xl bg-popover shadow-bevel-card shadow-rayu-2` — `Usage source: <planName>`, `5-hour limit` + reset countdown, `Weekly limit` + reset countdown, `Credits` (`tabular-nums`), and `Manage usage` (routes to Settings) or `Sign in to Rayu Cloud`.
    2. **Profile Dropdown (`size-[38px]` avatar/initials):** User name/email, Theme switcher (`Auto / Dark / Light / VS Code`), Accent switcher (`Rayu Green / Ocean Blue`), `Background Processes`, `Settings`, `Restart Bridge`, `Sign out`.
- **Collapsible Session & Projects Pane (`w-[244px] shrink-0 bg-chrome`, total left `296px`):**
  - Port of `desktop/src/components/shell/sidebar-projects-pane.tsx`:
  - Header: `+ New session` button + Search filter trigger (`⌘K`, with toggle for Rust cross-tool `session_search` across Rayu, Claude, Codex, Cursor, OpenCode, Pi!) + Organize/Sort menu (`By project` / `Chronological`, `Updated` / `Manual`).
  - Workspace project groups with `ProjectIconGlyph` (custom emoji or colored Lucide icon via `ProjectIconPicker`), expand/collapse chevron, `+` new session in that folder.
  - Session rows: strictly single-line `truncate`, subtle status dot (`running` / `waiting` / `idle`), optional `+A -R` diff summary, right-click / `⋯` menu (`Pin`, `Rename`, `Fork`, `Transfer`, `Archive`), rich hover preview card (`bg-popover-solid`), and collapsible `Archived` footer.
- **Main Stage (`bg-canvas` with `rounded-tl-[14px] border-t border-l border-hairline` when left pane open):**
  - Slim `DaemonBanner` (28px, **hidden completely when healthy**; shows single concise status + `[Start Bridge]` / `[Reconnect]` only when starting/degraded).
  - `TopBar` (`h-[46px] border-b border-hairline`): Back (`⌘[`), Forward (`⌘]`), New Chat (when left collapsed), `<Session Title ▾>` dropdown (Rename, Fork, Transfer, Compact, Export Markdown), and `SixIconStrip` (shown here when right inspector is in Document Mode or collapsed).
  - Route content slot (`overflow-hidden` for Home/Chat, `overflow-y-auto` for Operate pages).
- **Dual-Mode Right Inspector (`RightInspectorHost`, `w-[332px]` in Context Mode, resizable `280px..calc(100%-320px)` with Codex-style snap-clip `< 210px` + `Show chat session ⌘1` restore bar):**
  - `RightSidebarTopBar` (`h-[46px]`):
    - Context Mode: right-aligned `SixIconStrip`: `[≡] Context`, `[>_] Terminal` (`⌘J` — opens/focuses native VS Code Integrated Terminal in session cwd!), `[±] Changes`, `[🌐] Preview` (VS Code Simple Browser / External URL), `[📁] Files`, `[⋯] MoreOptionsMenu` (`Background processes`, `Plan`, `Pop out / Dock`, `Accent / Theme`, `Keep awake` via Companion).
    - Document/Code/Diff Mode: background tab pills (`⌘1`/`⌘2`), active pill (`lookup.rs ×`), `⤢ Open in VS Code Editor`, `Full view`, `× Close` returning to Context Mode.

### Mode B — Medium Split (`@min-[560px]/app` to `@max-[959px]/app`)
- `52px` `IconRail` stays docked on the left.
- `SessionPane` (`244px`) and `RightInspectorHost` (`320px`) open as crisp slide-over drawers (`bg-chrome` / `bg-canvas` with backdrop dim) so the main content always gets `>= 500px`.

### Mode C — Compact Docked Sidebar (`rayucode.chat`, `@max-[559px]/app`, `320px–559px`)
- **No permanent left rail or left sidebar** — 100% of width belongs to the developer's active task!
- **Compact `40px` Top Chrome Bar (`border-b border-hairline bg-chrome px-2 flex items-center gap-1`):**
  - `[☰]` Slide-over Session & Projects Drawer (`⇧⌘S`)
  - `<Session Title ▾>` single-line truncated switcher + quick actions
  - Compact icon cluster (all `size-7 rounded-[7px]`, tooltips on hover):
    - `[+]` New Session
    - `[Sw]` Swarm (dot if running)
    - `[Bg]` Background Processes (displays tiny accent pill count ONLY when >= 1 task running/stalled!)
    - `[±]` Changes (dot if modified)
    - `[≡]` Context & Outputs Slide-over Sheet
    - `[⤢]` **Pop out to Full Editor Mission Control** (opens `rayucode.workspace` `WebviewPanel` synced to the exact same route & session!)
    - `[⋯]` Overflow `DropdownMenu`: `Automations`, `Plugins & MCP`, `Remote (Telegram / Cloud)`, `Plan & Usage`, `Settings`, `Theme & Accent`, `Restart Bridge`.
- **Auth Welcome Screen (`AuthWelcomeScreen`):** Adapts Desktop's choreographed `rayu-fox.png` entrance (`.rayu-auth-logo-enter`, `.rayu-auth-ambient-glow`) into a clean single-column scrollable card inside the `360px` sidebar (or centered showcase in Wide Editor Panel) with `Sign in with Browser`, `Paste API Key / Callback`, `Continue with Local BYOK Providers`, and optional Plan Ladder modal.

---

## 4. Shared React Component Contracts (`components/ui/*` & `features/shell/index.ts`)

Every Wave 3 feature worker imports ONLY from these public barrels:
- `@/components/ui/{button,dialog,dropdown-menu,popover,tooltip,tabs,switch,select,separator,scroll-area,skeleton,error-state,page-skeletons,section-error-boundary,rayu-processing-mark,tech-file-badge,mermaid-diagram,rayu-symbols}`
- `@/features/shell` (`AppShell`, `ProjectIconPicker`, `ProjectIconGlyph`, `useShellNavigation`)
- `@/lib/{rpc-client,stream-batcher,app-store,file-icon-theme,shiki-highlighter,query-client,utils,media-url}`
