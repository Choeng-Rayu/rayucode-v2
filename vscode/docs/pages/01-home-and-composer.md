# Spec 01 — Home / New Session & Floating Chat Composer

> **Desktop Reference:** `desktop/src/features/sessions/components/home-view.tsx`, `desktop/src/features/sessions/components/composer.tsx`, `desktop/src/features/sessions/components/model-effort-popover.tsx`, `desktop/src/features/sessions/components/permission-popover.tsx`, `vscode/shared/inferenceSettings.ts`, `vscode/shared/permissionModes.ts`.
> **Owned Files (Wave 3A):** `vscode/webview/src/features/composer/**`, `vscode/webview/src/features/chat/HomePage.tsx`.

---

## 1. Visual Layout — Desktop Parity + Compact Sidebar Adaptation

### Wide Editor Panel (`>= 960px`)
```text
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│                          [ rayu-fox.png ]                            │
│                             (74px tall)                              │
│                                                                      │
│            Good to see you, Rayu. What's next?  (italic serif)       │
│                  [ Sign in to Rayu Cloud ] (if signed out)           │
│                                                                      │
│     [ Review uncommitted changes ]  [ Trace failing test ]  [ Plan ] │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │  [rayucode-v2 ▾]  [git: dev ▾]            (Home top tray)    │   │
│   │  ┌────────────────────────────────────────────────────────┐  │   │
│   │  │ [TS harnessSession.ts:60-87 ×]  (Active Editor Pill)   │  │   │
│   │  │                                                        │  │   │
│   │  │ Message RayuCode… (@ files, / commands)                │  │   │
│   │  │                                                        │  │   │
│   │  │ [Claude Opus 5.5 Medium ▾]  [Ask ▾]     [Mic] [42%] [↑]│  │   │
│   │  └────────────────────────────────────────────────────────┘  │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                        max-w-[732px] centered                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Compact Docked Sidebar (`320px–559px`)
- Hero scales gracefully: `rayu-fox.png` (`h-[48px]`), heading `text-lg font-medium`, quick-start chips wrap cleanly (`gap-1.5 text-xs`).
- Composer stretches full width (`px-2.5 pb-2.5`) with `@container/composer` container queries **already proven in Desktop's `ModelEffortPopover` & `PermissionPopover`**:
  - `@max-[460px]/composer`: hides effort suffix inside model button (shows model name + chevron; effort visible in tooltip & popover).
  - `@max-[390px]/composer`: shows permission icon only (tooltip shows `Ask · ⇧Tab`).
  - `@max-[340px]/composer`: hides redundant chevrons to guarantee zero overflow even at `300px`!

---

## 2. Home View (`HomePage.tsx`) Exact Contracts

1. **Greeting Hero (1:1 with `desktop/src/features/sessions/components/home-view.tsx`):**
   - Official Rayu Fox image: `<img src={mediaUrl("rayu-fox.png")} alt="Rayu Code" className="h-[48px] @min-[640px]/app:h-[74px] w-auto object-contain select-none" />`.
   - Greeting typography: `text-xl @min-[640px]/app:text-2xl font-medium tracking-[-0.025em] text-ink` with `What's ` + `<em className="font-serif text-[1.08em] font-normal tracking-[-0.005em] text-brand-text italic">next?</em>`.
   - Quiet Sign-in pill (`border-premium bg-raised shadow-bevel-surface`) shown only when signed out of Rayu Cloud AND no BYOK provider is ready.
   - Quiet 3-chip workspace suggestions (clicking fills composer, never auto-sends unexpectedly).
2. **Optimistic Turn Transition (Zero Perceived Latency):**
   - Immediately on Submit (matching Desktop `home-view.tsx:174-216`):
     - Top `h-[1.5px] animate-pulse bg-brand` progress hairline appears.
     - User prompt bubble (`rounded-2xl bg-active/85 px-4 py-2.5 text-[14.5px] leading-[1.6]`) renders right-aligned.
     - `<RayuProcessingMark animated className="size-[17px]" />` + `Working · 1s` ticks live while Host runs `createSession` + `setPermissionMode` + `sendMessage(requireAccept: true)`.
     - If user clicks Stop before acceptance, cancels cleanly and restores the draft into `composerValue`!

---

## 3. Floating Chat Composer (`FloatingComposer.tsx`)

### Strict Visual & Anti-Slop Rules
- **Double-bordered shell:** Outer tray `.composer-shell` (`rounded-[18px] border border-premium bg-shell p-1.5 shadow-bevel-card`) wrapping inner `.composer-inner` (`rounded-[14px] border border-hairline bg-raised`).
- **NO focus outline / NO green focus glow** on `.composer-shell` or `.composer-inner` when clicking or typing inside the textarea.
- **NO cluttered file attachment chip wall** inside the composer (pasted/dropped screenshots attach cleanly as compact 40px thumbnail strips only when images are actually pasted; max 10 images, 10 MB each, PNG/JPEG/WebP/GIF).
- **Home vs. Active Chat Mode:**
  - `mode="home"`: displays compact top tray (`[ProjectIconGlyph] <workspaceName> ▾` multi-root folder picker + `[GitBranch] <branch> ▾` checkout badge — **NO** Browser or Office/MD buttons in top tray!).
  - `mode="chat"`: hides top tray completely so only the single compact double-bordered composer renders!
- **VS Code Native Editor Selection Pill (`EditorSelectionPill.tsx`):**
  - Automatically synced from Host `EditorBridge` (debounced 150ms).
  - When a file or line range is active in VS Code, renders ONE ultra-quiet inline pill above the textarea: `<TechFileBadge path={ctx.relativePath} />` + `harnessSession.ts:60-87` + `[×]` exclude button.
  - Submitting a prompt while included automatically attaches structured editor context (`system_reminder` or `@path#L60-87` reference) so the Rust agent knows the exact lines the user is looking at!

### `@` File Mention & `/` Command / Skill Autocomplete (`MentionSlashMenu.tsx`)
- Typing `@query` calls Host RPC `workspace.findFiles(sessionId, query)` (backed by Rust `ApiRequest::FindFiles`), displaying single-line rows with `<TechFileBadge />`, truncated relative path, keyboard navigation (`↑`/`↓`/`Enter`/`Tab`/`Esc`).
- Typing `/query` displays curated Rust `RuntimeCommand` + loaded `SKILL.md` skills (`RuntimeCommand::Skills`):
  - `/compact`, `/fork`, `/transfer`, `/clear`, `/rewind`, `/review`, `/judge`, `/swarm`, `/overnight`, `/bg`, `/fast`, `/memory`, `/skills`, `/mcp`, `/doctor`, plus every installed user skill (`/my-skill`).
  - Executing a runtime slash command dispatches directly to `ApiRequest::RuntimeCommand` (never wasted as an LLM prompt!).

---

## 4. 2-Stage Model & Reasoning Effort Popover (`ModelEffortPopover.tsx`)

Direct port of `desktop/src/features/sessions/components/model-effort-popover.tsx` wired to Rust `get_runtime_info`, `set_model`, `set_reasoning_effort`, `RuntimeCommand::Fast`, and `RuntimeCommand::RefreshModelList`:

- **Popover Container:** `rayu-card-bevel rounded-[18px] border border-premium-hi bg-popover-solid p-0 shadow-rayu-2`, `collisionPadding={8}`, responsive `w-[min(318px,calc(100vw-24px))]` so it NEVER overflows a 320px sidebar!
- **Stage 1 (`Effort Card`):**
  - 3-column header (`grid-cols-[32px_1fr_32px]`):
    - Left: `#i-zap` **Fast / Priority Service Tier Toggle** (`RuntimeCommand::Fast` — `priority` / `ultrafast` / `off`, highlighted `border-brand/40 bg-brand-soft text-brand-text` when active).
    - Center: Accent effort level (`text-[19px] font-semibold tracking-[-0.02em] text-brand-text`) + clickable `<Model Name> ›` pill switching to Stage 2 + subtle `account_label / auth_method` tag (`OAuth · work` or `API Key`).
    - Right: `#i-refresh` **Refresh Model Catalog** (`RuntimeCommand::RefreshModelList` — bypasses fresh cache per `AGENTS.md` provider discovery rules, spins while refreshing; plus secondary Reset-to-default action).
  - Description copy (`text-xs text-muted-ink text-center min-h-8`).
  - **5-Stop Interactive Pill Slider:** `Auto`, `Low`, `Medium`, `High`, `Max` (filtered by model capability via `inferenceSettings.ts`), smooth pointer drag + click stop dots + keyboard `ArrowLeft`/`ArrowRight`/`Home`/`End`, accent gradient fill (`.rayu-effort-bar`), and `34px` crisp white circular thumb (`shadow-rayu-1`).
- **Stage 2 (`Select Model` List):**
  - Header with `<` back button + search filter input (`Filter models & providers...`) + live refresh icon.
  - **Preserves exact backend route order** from Rust `get_runtime_info.routes` (Rayu Gateway live `display_order` first, never alphabetically re-sorted!).
  - Each row: model label, quiet provider/api-method badge, active rounded pill (`bg-active border-premium`) + right `Check` icon. Unavailable routes shown dimmed with `reason` detail.

---

## 5. 5-Mode Local Permissions Popover (`PermissionPopover.tsx`)

Direct port of `desktop/src/features/sessions/components/permission-popover.tsx`:
- Global `Shift+Tab` shortcut cycles through exact 5 modes (`permissionModes.ts`) and dispatches `set_permission_mode` to Rust Harness API v1.14:
  1. **Ask** (`default`, `Lock` icon, `Default` pill): *"Ask before running tools that change anything."*
  2. **Auto-edit** (`acceptEdits`, `Shield` icon): *"Apply file edits without asking. Still asks for commands."*
  3. **Plan** (`plan`, `Eye` icon): *"Investigate and write a plan without asking. Never changes your code."*
  4. **Full Manage** (`fullManage`, `ShieldAlert` icon): *"Run all non-interactive tools without asking."*
  5. **Orchestrator** (`orchestrator`, custom 3-node `Swarm` SVG): *"Full access for delegated workers; the main agent only coordinates."*
- Popover width responsive: `w-[min(356px,calc(100vw-24px))]`.
- If connected to an older v1.13 bridge without `"permissions"` capability, shows a quiet 1-line notice inside the popover explaining read-only fallback mode.

---

## 6. Streaming, Soft Interrupt & Voice Controls

- **Send / Queue / Stop Button (`size-8 rounded-full`):**
  - Idle with text: Primary accent `ArrowUp` (`.rayu-primary-bevel`).
  - Streaming with empty input: `Square` Stop button (`cancel`).
  - Streaming with text typed: `CornerDownLeft` **Queue / Steer** button calling `ApiRequest::SoftInterrupt` (with `Alt+Enter` for `urgent: true` steer between tool calls!).
- **Voice Mic Button (`VoiceMicButton.tsx`):** Rendered only when the Rust runtime advertises `rayucode-voice` capability; click/hold triggers push-to-talk dictation streaming into the composer textarea.
- **Context Micro-Gauge:** Quiet `tabular-nums` pill (`42%`) clicking straight into Right Inspector -> `ContextPanel`.
