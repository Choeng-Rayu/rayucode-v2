---
name: RayuCode Desktop
status: binding
reference: prototype/
description: Calm, high-performance mission-control desktop workspace for RayuCode — Warm Graphite Dark default + Warm Paper Light, Rayu Green brand default + Ocean Blue user option, zero AI slop.
---

# RayuCode Desktop — Authoritative Design Contract (`DESIGN.md`)

> **Binding Rule for All Agents & Engineers:** `prototype/` is the frozen visual golden baseline, and `desktop/src/styles/globals.css` is the single source of truth for all colors, surfaces, borders, bevels, and theme/accent tokens. Change a token once in `globals.css` and every screen updates. **Never** write raw hex colors (`#...`), arbitrary Tailwind color classes (`bg-[#...]`), default shadcn zinc/slate palette classes, or UI emojis in TSX.

---

## 1. Themes & User-Selectable Accents (`desktop/src/styles/globals.css`)

### Warm Graphite Dark (Default — `:root`)
| Token | Value | Role |
| :--- | :--- | :--- |
| `--bg-chrome` | `#11110E` | Outer frame, left icon rail, top bar, sidebar |
| `--bg-canvas` | `#0C0C0A` | Deep warm inset main canvas |
| `--bg-pane` | `#161613` | Drawers, inspector panels, cards, diff cards |
| `--bg-shell` | `#141411` | Floating composer outer tray |
| `--bg-raised` | `#1B1B17` | Composer inner surface, controls (floating popovers use opaque `#1D1D1A`, rich hover cards `#232320`) |
| `--bg-inset` | `#10100D` | Code wells, Shell output cards, terminal, inline code pills |
| `--bg-hover` | `rgba(255, 255, 255, 0.06)` | Hover surface fill |
| `--bg-active` | `#262520` | Active nav pill, selected list option |
| `--border` | `#2A2924` | 1px structural hairline |
| `--border-soft` | `#22211D` | Subtle internal separator |
| `--border-strong` | `#3A3832` | Emphasized divider |
| `--border-premium` | `rgba(255, 255, 255, 0.11)` | Machined card/pill edge |
| `--border-premium-hi` | `rgba(255, 255, 255, 0.18)` | Floating popover/card edge |
| `--text-1` | `#ECEAE3` | Primary ink (warm cream-ivory) |
| `--text-2` | `#D4D0C5` | Body & conversation prose |
| `--text-3` | `#8F8B80` | Muted metadata, folders, timestamps, placeholders |
| `--text-4` | `#68645B` | Faint line numbers / empty states |

### Warm Paper Light (`[data-theme="light"]`)
| Token | Value | Role |
| :--- | :--- | :--- |
| `--bg-chrome` | `#F7F7F4` | Outer frame, rail, top bar |
| `--bg-canvas` | `#FFFFFF` | Pure crisp white main canvas |
| `--bg-pane` | `#FAFAF7` | Inspector panels & cards |
| `--bg-raised` | `#FFFFFF` | Composer & opaque popovers |
| `--bg-inset` | `#F4F4F0` | Code wells, Shell cards |
| `--bg-active` | `#ECEBE5` | Active row highlight |
| `--border` | `#E6E5E0` | 1px hairline |
| `--text-1` / `--text-2` / `--text-3` | `#26251E` / `#5A5852` / `#6F6C62` | Warm charcoal hierarchy |

### Accent Options (`localStorage: rayu-accent`, `data-accent`)
* **Rayu Green (Brand Default):**
  * Dark: `--accent: #3DBD84`, `--accent-bright: #52C993`, `--accent-ink: #06140C`, `--accent-text: #5FD19C`, `--effort-grad: linear-gradient(90deg, #1E9E6B 0%, #3DBD84 100%)`
  * Light: `--accent: #0F7B4F`, `--accent-bright: #0B6E45`, `--accent-ink: #FFFFFF`, `--accent-text: #0D7449`, `--effort-grad: linear-gradient(90deg, #0F7B4F 0%, #1F9A68 100%)`
* **Ocean Blue (`[data-accent="blue"]`):**
  * Dark: `--accent: #3B82F6`, `--accent-bright: #60A5FA`, `--accent-ink: #FFFFFF`, `--accent-text: #5EA6FF`, `--effort-grad: linear-gradient(90deg, #2563EB 0%, #4B9BFF 100%)`
  * Light: `--accent: #1D6FE2`, `--accent-bright: #1458B8`, `--accent-ink: #FFFFFF`, `--accent-text: #1A63CC`, `--effort-grad: linear-gradient(90deg, #1D6FE2 0%, #3B82F6 100%)`
* **Switchers:** Available in every top-right `⋯` menu (`Accent: Green / Blue`) and **Settings → Appearance**.

### Semantic & Specular Tokens
* `--danger: #CF2D56`, `--warn: #DCAE66` (dark) / `#9A6414` (light), `--info: #A9C4EA` (dark) / `#1E5A9E` (light).
* **Chromatic Semantic Layer (Warm Editorial IDE Palette — never monochrome, never neon slop):**
  * **Folders & Directories (`--folder`):** Warm Amber-Gold `#E0B366` (dark) / `#B4690E` (light) with subtle `--folder-soft` tint.
  * **Code / TypeScript / JS / Links (`--code-fn`):** Sky Blue `#A9C4EA` (dark) / `#1E5A9E` (light).
  * **Keywords / Commands / Brand Actions (`--code-kw`):** Rayu Emerald `#5FD19C` (dark) / `#0D7449` (light).
  * **Components / Types / Skills / Markdown (`--code-type`):** Soft Lavender `#C9B3E6` (dark) / `#6A3FA0` (light).
  * **Rust / Numbers / Presentations (`--code-num` / `--office-ppt`):** Warm Coral `#E9B9A2` (dark) / `#B04A2A` (light).
  * **Strings / JSON / Config (`--code-str`):** Warm Gold `#DCAE66` (dark) / `#9A6414` (light).
  * **Spreadsheets (`--office-excel`):** Emerald `#5FD19C` (dark) / `#0D7449` (light).
* Specular bevels (`--bevel-surface`, `--bevel-card`, `--bevel-primary`) give buttons, pills, popovers, and the double-bordered composer subtle tactile depth.

---

## 2. Typography & Motion
* **UI Sans:** `Inter, -apple-system, "SF Pro Text", "Segoe UI", sans-serif`
* **Monospace:** `"JetBrains Mono", "SF Mono", ui-monospace, monospace` with `font-variant-numeric: tabular-nums` for tokens, credits, durations, diffs, and line numbers.
* **Hero Italic Accent:** `"Instrument Serif", "New York", Georgia, serif` (used only on the welcome greeting emphasis word).
* **Motion:** `--dur: 150ms`, `--ease: cubic-bezier(0.2, 0.7, 0.2, 1)`; honor `prefers-reduced-motion`.

---

## 3. Locked Layout & Component Contracts (1:1 with `prototype/`)

1. **Shell Geometry (`prototype/css/layout.css`):**
   * Left sidebar total `296px`: `52px` slim `.cx-rail` + `244px` collapsible `.cx-pane` (`⇧⌘S`).
   * Top bar height: `46px` (`--topbar-h`).
   * **Left Icon Rail (Exact 6 Primary + 2 Bottom):**
     * Top 6: `Home`, `Swarm`, `Automations`, `Plugins`, `Changes`, `Telegram Remote` (live green dot `.rail-live-dot`).
     * Bottom 2: `Plan & Usage` popover (`#i-ring` two-arc ring + diamond) + `LK` Profile menu.
     * **No folder tree anywhere in v1.**
   * **Global Hover Tooltips:** Sleek pill tags (`.rayu-tip`) positioned right of the left rail, below top bars, and above canvas/composer controls (Radix `Tooltip` restyled to match).

2. **Floating Chat Composer (`prototype/index.html`, `agent-workspace.html`, `excel-session.html`):**
   * Width: `max-width: 732px` matching `.stream` inner width (`780px − 48px`) for exact 0px left/right edge alignment.
   * **No focus outline / green glow** on click or focus inside `.composer-shell` / `.composer-inner`.
   * **No file attachment chips** inside the composer.
   * **New Session (`Home`)** shows the compact project + checkout top tray (`rayucode-v2 ▾`, `Local Checkout ▾` — NO `Browser` or `Office/MD` tray buttons). **Active Chat** hides the top tray so only the single compact double-bordered composer box renders.
   * **2-Stage Model & Reasoning Effort Popover:**
     * Stage 1 (`Effort Card`, opaque `#1D1D1A` / `#FFFFFF`): left `#i-zap` fast toggle, centered accent effort level + clickable `<Model Name> ›`, right `#i-refresh` reset, bottom interactive **5-stop pill slider** (`Auto`, `Low`, `Medium`, `High`, `Max` — matching `vscode/shared/inferenceSettings.ts`) with smooth drag, accent fill, stop dots, and `34px` white circular thumb.
     * Stage 2 (`Select model` list): `Default / Recommended set of models` + real models supported by `rayucode-v2` (`crates/rayucode-provider-core/src/models.rs` + live daemon discovery), active rounded pill + right checkmark.
   * **Local Permissions Popover (`Shift+Tab` cycle):** Exact 5 modes from `vscode/shared/permissionModes.ts`: `Ask` (`Default`), `Auto-edit`, `Plan`, `Full Manage`, `Orchestrator`.

3. **Codex-Style AI Response & Execution Trace (`prototype/pages/agent-workspace.html`):**
   * **Zero AI slop:** No bulky `Thinking` boxes, no boxed `Tool calls` cards with rainbow pills, no Fox avatar + Done badge header rows inside active chat turns.
   * Quiet `Context automatically compacted` line, right-aligned compact user prompt bubble.
   * Collapsed disclosure `Worked for <dur> ›` (or pulsing `Working · Xs ⌄` while streaming) → expands interleaved short progress notes + collapsible `Read files, ran commands ⌄` groups on a `1px` hairline vertical rail → clickable single-line command rows expand inline dark-inset **`Shell`** cards (`$ command`, Copy button, scrollable mono output, right-aligned `✓ Success` / `× Exit N`).
   * Clean editorial prose with clickable inline code/file references (`.cite-link` in active accent — Rayu Green or Ocean Blue) that open the **Right-Sidebar Code Viewer** at the exact highlighted line.
   * End-of-response **Action Bar (`.turn-actions`):** `Copy`, `Fork from here` (opaque 2-line hover card: *"Starts a new session from this point. This one stays as it is."*), `Pin` (2-line hover card), relative timestamp (`2m ago`), and quiet credit / KV-cache telemetry.

4. **Dual-Mode Right Sidebar Top Bar (`.is-ctx-mode`):**
   * **Context Mode (`≡` active):** Center chat top bar stays calm (`<Title> ▾` only). Right sidebar header holds the right-aligned 6-icon strip (`[≡] >_ ± 🌐 📁 ⋯`) directly above `Environment` (with `⚙` gear), interactive `Context` (dotted-underline rows that expand inline token breakdowns for `MCP tools`, `Skills`, `Memory files`, `MCP server instructions`, `Custom agents`, plus `› MCP tools`, `› Memory files`, `› Custom agents`), `Connectors` (live `Show more` / `Show less`), `Outputs`, and `Changes` (`Create PR`).
   * **Document / Code / Browser / Excel Mode:** Center top bar shows the 6-icon strip on the right; right sidebar header displays the italicized active pill (`lookup.rs ×`, `Q4-Token-Cost-Model.xlsx ×`, `MIGRATION_PLAN.md ×`, `localhost:3000 ×`) + `⤢` Full View and `×` Close. Clicking `×` on the pill returns cleanly to Context Mode.

5. **Dedicated Operate Pages:**
   * **Swarm (`execution-runner.html`):** Grounded in `docs/SWARM_ARCHITECTURE.md` / `rayucode-swarm-core`. Single-line telemetry strip, inline `+ Spawn worker` bar, two-column Roster (`coordinator` root depth 0 + parallel workers) + Selected Worker Inspector (assigned todo lane, Codex trace + `Shell` cards, direct `Send DM` steering), tabbed `Message Board` / `Shared Plan (v3)` / `Worktrees`.
   * **Automations (`automations.html`):** Grounded in `rayucode-overnight-core`. Inline overnight launcher, running manifest + expandable event log, recurring schedules, morning reports.
   * **Plugins (`plugins.html`):** Customize sidebar (`Plugins`, `Skills`, `Memory`), interactive RayuCode Featured Showcase banner, live search + Installed sync, 16 real multi-color SVG brand logos.
   * **Changes (`changes.html`):** Flat changed-files list, syntax diffs, VS Code handoff, explicit `Create PR` approval guardrail.
   * **Telegram Remote (`telegram.html`):** Connected / Rayu Shared Bot QR / `@BotFather` token modes, live Pending Approvals Approve/Deny, remote uninstall safety toggle.
   * **Settings (`settings.html`):** Full-page shell with Account, Appearance (Dark/Light + Rayu Green / Ocean Blue), Models, Voice, Connections, Shortcuts.

---

## 4. Strict Anti-Slop Checklist (Enforced by `pnpm lint:design` & Code Review)
- [ ] Zero raw hex colors (`#...`) or `bg-[#...]` / `text-[#...]` inside `desktop/src/**/*.{ts,tsx}`.
- [ ] Zero default shadcn zinc/slate/gray/neutral classes (`bg-zinc-*`, `border-slate-*`, etc.).
- [ ] Zero UI emoji characters in TSX (`lucide-react` or official brand SVGs only).
- [ ] Every shadcn/Radix primitive checked via `node desktop/scripts/check-shadcn.mjs` before coding.
- [ ] Every visual change verified at `1440×934` in Dark (Rayu Green), Dark (Ocean Blue), and Light themes against `prototype/`.
