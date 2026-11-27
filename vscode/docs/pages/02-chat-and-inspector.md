# Spec 02 — Active Chat, Quiet-Signal Execution Trace & Dual-Mode Right Inspector

> **Current behavior.** The packaged extension keeps execution trace, file review, and todos in Chat. The proposed right inspector below is design history. Side-panel and applet RPCs have no mounted Inspector UI in the current extension. Whole-session Fork is available from the session menu.

> **Desktop Reference:** `desktop/src/features/execution-trace/components/chat-stream.tsx`, `desktop/src/features/execution-trace/components/work-trace.tsx`, `desktop/src/features/execution-trace/components/shell-card.tsx`, `desktop/src/features/execution-trace/components/cite-link.tsx`, `desktop/src/features/execution-trace/components/inline-diff-card.tsx`, `desktop/src/features/execution-trace/components/turn-actions.tsx`, `desktop/src/features/sessions/components/clarifying-question-card.tsx`, `desktop/src/features/inspector/components/context-panel.tsx`, `desktop/src/features/inspector/components/inspector-sidebar.tsx`.
> **Owned Files (Wave 3B):** `vscode/webview/src/features/chat/**` (excl. `HomePage.tsx`), `vscode/webview/src/features/inspector/**`.

---

## 1. Quiet-Signal ("Less Message, High Clarity") Turn Anatomy

Every turn inside `ChatStream` (`mx-auto w-full max-w-[732px] px-4 @min-[640px]/app:px-6`) obeys strict visual quietness — **zero avatar rows, zero bulky "Thinking" accordions, zero stacked rainbow tool-call cards**:

1. **Compaction Notice (optional, 1 line):** `List` icon (`size-3.5 text-muted-ink`) + `Context automatically compacted`.
2. **User Prompt Bubble (`self-end max-w-[85%]`):**
   - Optional quiet editor ref pill (`bg-pane border-hairline rounded-[9px] text-xs`) with `<TechFileBadge />` + `file.ts:60-87`.
   - Optional attached image thumbnails (`h-24 rounded-xl border-hairline object-cover`).
   - Bubble: `rounded-2xl bg-active/85 px-4 py-2.5 text-[14px] leading-[1.6] text-ink whitespace-pre-wrap` (uses `--font-ui-prose` so user emojis render cleanly).
   - Hover action on historical user turns: quiet `Rewind to here` icon button (`ApiRequest::Rewind`) which displays a dismissible `Turn rewound · [Undo Rewind]` hairline toast/banner (`ApiRequest::RewindUndo`).
3. **3-Depth Progressive Disclosure Execution Trace (`WorkTrace.tsx`):**
   - **Depth 0 (Collapsed Default — ONE single line):**
     - Completed: `▸ Worked for 14s · 4 files · 2 cmds` (`text-[13px] text-muted-ink hover:text-ink`)
     - Streaming Live: `<RayuProcessingMark animated className="size-4" />` + `Working · 6s · Running cargo test ⌄` + inline quiet **`[Background]`** (`Alt+B`, calls `ApiRequest::BackgroundTool`) pill whenever a foreground shell/build command runs > 2s!
     - If `ConnectionPhase` is `retrying (2/4)` or `waiting for response`, replaces the trailing status phrase calmly without spawning extra banners.
   - **Depth 1 (Click to Expand):**
     - Interleaved concise progress notes (`EditorialMarkdown`) + collapsible `TraceGroup` sections (`Read files, ran commands ⌄`) on Desktop's exact `1px` hairline vertical rail (`ml-2 flex flex-col gap-1.5 border-l border-hairline py-0.5 pl-4`).
     - **Auto-Coalescing:** Consecutive `read` / `agentgrep` / `list` calls coalesce into one clean `Explored N files` row; every tool displays its Rust-supplied **`intent`** string as the single crisp line (raw JSON arguments remain hidden behind an optional `Payload ›` link).
   - **Depth 2 (Click Any Step Row):**
     - Shell command -> expands Desktop's exact **`ShellCard`** (`rounded-[12px] border border-hairline bg-inset shadow-bevel-surface`, `Shell` header, `✓ Success` / `× Exit N`, Copy button, `$ command`, scrollable `max-h-[210px]` mono output with `MoreHorizontal` expand toggle).
     - File read / search hit -> opens file directly at exact line in **native VS Code Editor** (`editorBridge.openFile(path, line)`), or Right Inspector `CodeViewer` if in Wide Editor Panel with inspector open.
     - File edit (`edit` / `write` / `apply_patch`) -> opens **native VS Code Diff (`vscode.diff`, `ViewColumn.Beside`)** OR expands compact `InlineDiffCard` (`Accept / Reject / Undo / Open in VS Code`).

---

## 2. Clean Quiet Renderers for All 45 Rust Built-In Tools

Every one of the 45 tools renders cleanly inside the Depth-1 rail using its `intent` string, with lightweight specialized cards only where interactive affordance adds real value:

| Tool Group | Rust Tool Names | Depth-1 Line & Depth-2 Interactive Surface |
| :--- | :--- | :--- |
| **Files & Search** | `read`, `agentgrep`, `session_search`, `conversation_search`, `rayu_docs` | Coalesced `Explored N files` / `Searched "query" (M hits)` with `<TechFileBadge />` links jumping straight to VS Code Editor (or opening matched past session on `session_search`). |
| **Edits** | `edit`, `write`, `apply_patch` | `Edited <TechFileBadge /> path  +42 -8` -> click opens native `vscode.diff` beside; optional `InlineDiffCard` with `Keep` / `Undo`. |
| **Execution** | `bash`, `bg` | `$ command  ✓ 1.8s` -> expands `ShellCard`; active long commands offer `[Background (Alt+B)]`; `bg` rows link straight into `BackgroundProcessDrawer`. |
| **Browser & Web** | `browser` (17 actions), `webfetch`, `websearch`, `open`, `macos_computer_use` | Compact 1-line `Globe`/`Monitor` step + thumbnail card if screenshot returned + `[Open URL]` / `[Handoff to Browser]` action. |
| **Codemode & Batch** | `codemode` (QuickJS), `batch` | `codemode`: expandable dark-inset JS script + structured return card. `batch`: nested sub-step checklist under one parent rail item (zero explosion of N separate cards!). |
| **UI & Interactive** | `ask_user_question`, `user_response`, `panel`, `side_panel`, `applet` | `ask_user_question` -> inline `ClarifyingQuestionCard`; `user_response` -> clean highlighted callout card; `panel`/`side_panel` -> opens in Right Inspector `Outputs` (`Markdown` / `PDF`); `applet` -> mounts interactive React `AppletRenderer` in Right Inspector `Outputs` dispatching `ApiRequest::AppletAction` / `CloseApplet`. |
| **Workspace & Meta** | `gmail`, `calendar`, `schedule`, `todo`, `memory`, `skill_manage`, `swarm`, `mcp*`, `integration_tools`, `selfdev`, `desktop_selfdev`, `maintainer_feedback` | Clean 1-line intent summary with domain icon (`Mail`, `Calendar`, `Clock`, `ListTodo`, `Brain`, `Box`, `Network`, `Plug`, `Wrench`) + contextual 1-click jump (e.g., clicking a `swarm` spawn step jumps to that worker in Swarm; clicking `schedule` opens Automations -> Schedules; clicking `memory` opens Plugins -> Memory). |

---

## 3. Inline Interactive Gates & Queued Interrupts

Rendered calmly at the bottom of the active turn ONLY when the Rust engine is actively waiting or steering:

1. **`ApprovalCard` (`PermissionRequest`):**
   - `rayu-card-bevel rounded-xl border border-premium-hi bg-pane p-3.5`
   - Header: `ShieldAlert` icon + Tool Name + **Rust `command-risk` badge** (`Safe` green / `Bounded` info / `Confirm` warn).
   - Body: exact command in `bg-inset` monospace or file path + summary.
   - Footer actions: `[Deny]` (`destructive`), `[Allow once]` (`default`), `[Allow for session]` (`primary`, maps to `allow_always`).
2. **`ClarifyingQuestionCard` (`QuestionRequest`):**
   - Port of Desktop's `clarifying-question-card.tsx` wired to `ApiRequest::QuestionResponse`. Supports single-select, multi-select, and custom free-text option.
3. **`SoftInterruptQueueStrip`:**
   - Quiet 1-line pill strip directly above Composer when user queues follow-up instructions mid-turn, showing queued prompt snippet + `[×]` cancel button calling `ApiRequest::CancelSoftInterrupts`.

---

## 4. Editorial Markdown, Citations & Turn Actions

- **`EditorialMarkdown` & `CiteLink` (`cite-link.tsx`):**
  - Parses Markdown via `unified` + `remark-parse` + `remark-gfm` (zero unsafe `dangerouslySetInnerHTML`!).
  - Inline code classified via Desktop's `classifyInlineCode()` (`folder`, `file-ts`, `file-rust`, `file-doc`, `file-data`, `command`, `component`, `symbol`).
  - Clickable `.cite-link` (`text-brand-text hover:underline`) opens the exact file & line natively in **VS Code Editor** (`ViewColumn.One` or active column) — or Right Inspector `CodeViewer` in Wide mode with `Open in VS Code` button.
  - Code blocks: instant `tokenizeCodeLine()` highlighting upgraded progressively via lazy `shiki`, with hover actions: **`Copy`**, **`Insert at Cursor`** (`editorBridge.insertAtCursor`), and **`Diff with Active Editor`**.
  - Mermaid fenced blocks render inline via Desktop's zero-bloat **`MermaidDiagramSvg`** (using `var(--accent)`, `var(--code-fn)`, `var(--code-type)` tokens!).
  - LaTeX math renders via lazy `katex`; inline `RenderedImage` assets render with click-to-zoom lightbox.
- **`TurnActions` (`turn-actions.tsx`):**
  - Exact Desktop row: `Copy` (`size-7 rounded-lg`), `Fork from here` (opaque 2-line hover card: *"Starts a new session from this point. This one stays as it is."* -> `ApiRequest::ForkSession`), `Pin` (`ApiRequest::SetSessionSaved`, 2-line hover card), relative timestamp (`2m ago`), and quiet `tabular-nums` credits (`RayuCreditsAccumulator`) + KV-cache hit `%` (with subtle `KvCacheMiss` tooltip if a `harness_caused` miss occurred).

---

## 5. Dual-Mode Right Inspector (`features/inspector/`)

- **Wide Panel:** Persistent `332px` right pane (drag-resizable with Codex snap-clip `< 210px`).
- **Compact Sidebar:** Full-height slide-over drawer toggled via `[≡]` in the compact top bar.

### Mode 1: Context Mode (`ContextPanel.tsx` — Exact 1:1 Desktop Layout + Rust Enhancements)
Sections separated by `divide-y divide-hairline-soft`, `px-[18px] py-4`:
1. **Environment (`⚙` gear -> Settings):** Host/daemon badge, active workspace folder (`Folder` + path + `Switch` multi-root folder picker), `GitBranch` name, active provider/model/transport.
2. **Context (`RuntimeCommand::Context` + `TokenUsage`):**
   - `usedPctLabel` + `tokensSummary` (`tabular-nums`) + multi-segment `h-[4px] gap-[2px]` progress bar.
   - Primary rows (`grid-cols-[10px_minmax(0,1fr)_auto_44px]`): **interactive dotted-underline triggers** (`border-b border-dotted`) for `MCP tools`, `Skills`, `Memory files`, `MCP server instructions`, `Custom agents`, expanding `bg-inset rounded-lg` item-level token tables!
   - `Buffer` & `Free space` rows + bottom `ChevronRight` disclosures (`MCP tools (N)`, `Memory files (N)`, `Custom agents (N)`).
   - Quiet action strip: **`Compact`** (`ApiRequest::Compact`), **`Transfer`** (`ApiRequest::TransferSession`), **`Cap`** (`ApiRequest::SetContextCap`), and Anthropic KV-Cache TTL pill (`5m / 1h`).
3. **Connectors (`RuntimeCommand::Mcp`):** Configured MCP servers with `BrandLogo size="sm"` + `Linked`/`Auth needed` status + `Show more` / `Show less`.
4. **Outputs & Todos:**
   - `SidePanelState` Markdown/PDF pages, interactive **`AppletRenderer`** (`AppletState`), and **`TodoSnapshot`** checklist (`get_todo_state`).
5. **Background Processes (Summary):** Compact list of active tasks with 1-click `[View all]` opening `BackgroundProcessDrawer`.
6. **Changes:** `FileDiff` + `+A −R` + `Inspect` + `[Create PR]` button routing to `ChangesView`.

### Mode 2: Document / Code / Diff / IDE Quick Actions
- `CodeViewer` (Shiki syntax highlighted with highlighted target line + **`Open in VS Code`** button)
- `DiffTabPanel` (Quick diff + **`Open Native vscode.diff`** button)
- `Terminal` tab icon (`⌘J`) directly focuses/creates a **native VS Code Integrated Terminal** in the session's `working_dir` (avoiding heavy duplicate `xterm.js` PTY overhead inside VS Code!).
- `Browser` tab icon opens URL in **VS Code Simple Browser** or external browser (`vscode.env.openExternal`) + displays latest Rust `browser` tool snapshot when active.
