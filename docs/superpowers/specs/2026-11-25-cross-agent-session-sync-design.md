# Design Spec: Cross-Agent Auto-Sync, Source Logos, and Source Filtering (Desktop, VS Code, CLI)

Date: 2026-11-25
Branch: `feature/improve-chat-experience`
Status: DRAFT (Pending User Spec Review)

## 1. Goal & Problem Statement

Developers switch between RayuCode, Claude Code (CLI & Desktop), Codex (CLI & Desktop), Cursor, OpenCode, and Pi across the same codebases every day. Today:
- RayuCode CLI (`/session` / `/resume`) already scans external coding-agent transcripts on disk, but dumps everything into one mixed list with no interactive agent filter popup.
- RayuCode Desktop and the VS Code extension do not auto-fetch or sync external coding-agent chats at all, and have no way to adopt a whole Desktop project from Claude Desktop or Codex Desktop into RayuCode Projects.

**Target Experience:** Whenever a user opens RayuCode (Desktop, VS Code extension, or CLI), all chats across their coding agents and codebases auto-fetch and stay synchronized automatically. Every chat row clearly displays the logo of the coding agent it came from (Rayu, Claude, Codex, Cursor, OpenCode, Pi), and every surface provides a fast interactive source filter so users are never overwhelmed by one giant undifferentiated column.

## 2. Core Requirements

1. **Automatic Fetch & Live Sync on Open:**
   - Opening Desktop, VS Code, or CLI immediately discovers and displays local sessions from RayuCode plus installed external coding agents:
     - **Claude Code CLI** (`~/.claude/projects/*/sessions-index.json` + `*.jsonl`)
     - **Claude Desktop (Code tab)** (`~/Library/Application Support/Claude/claude-code-sessions/` on macOS, `%APPDATA%/Claude/claude-code-sessions/` on Windows, `~/.config/Claude/claude-code-sessions/` on Linux + `~/.claude/projects/`)
     - **Codex CLI & Codex Desktop** (`~/.codex/sessions/**/*.jsonl` + `~/.codex/.codex-global-state.json` workspace roots & thread titles)
     - **Cursor, OpenCode, Pi** (already parsed in `crates/rayucode-base/src/import.rs` and `crates/rayucode-import-core`)
   - Sidebar state (projects, pins, archives, synced external sessions) stays synchronized across Desktop and VS Code via `~/.rayu/workspaces.json` (`@rayu-dev/rayucode-session-core/host`) and the shared Rust daemon (`~/.rayu/sessions/`).
   - External transcript directories are re-scanned on window focus / manual refresh and debounced file changes so newly started Claude/Codex sessions appear automatically.

2. **Source Logo on Every Chat Row:**
   - **Desktop & VS Code:** Each sidebar chat row displays a crisp, monochrome-tinted SVG brand logo identifying its origin (**Rayu logo**, **Claude logo**, **Codex logo**, **Cursor**, **OpenCode**, **Pi**) with tooltip (`"Synced from Claude Code"`, `"Synced from Codex Desktop"`, etc.). Zero UI emojis; all icon colors use `globals.css` semantic tokens (`DESIGN.md` compliant).
   - **CLI (`/session`):** Each row displays a compact, fixed-width source label/badge that obeys the single-row non-wrapping TUI chrome rule (`AGENTS.md`).

3. **First-Class Interactive Source Filter Across All 3 Surfaces:**
   - **Desktop & VS Code Sidebar:** Compact source filter bar/popover at the top of the sidebar (`All`, plus icon+count toggles for each detected agent: `Rayu`, `Claude`, `Codex`, `Cursor`, `OpenCode`, `Pi`). Only tools with >=1 detected session (plus `Rayu`) appear so empty tools never clutter the bar. Combines cleanly with search and grouped/flat view modes.
   - **CLI (`/session` / `/resume`):** Add an interactive **Source Filter popup/modal** inside `crates/rayucode-tui/src/tui/session_picker/` (opened via shortcut key e.g. `Ctrl+F` / `Tab` or mouse click on the filter chip in the picker header). Users can click or arrow-select any coding agent (`All`, `Rayu`, `Claude`, `Codex`, `Cursor`, `OpenCode`, `Pi`) with live session counts per agent, immediately filtering the session list without typing search queries.

4. **Project Grouping vs. CLI Sessions + Optional "Import from Tool" Modal:**
   - **Automatic grouping:** External sessions whose `working_dir` matches an existing project in `~/.rayu/workspaces.json` (canonical `fs.realpath` match) appear inside that project group with their source logo. Sessions without a matching project appear in **Ungrouped / Recents**.
   - **Explicit "Import from Tool" modal (Desktop & VS Code):**
     - Triggered from the sidebar header (`Import`) or command/skill.
     - Step 1: Select tool (`Claude Code CLI`, `Claude Desktop`, `Codex CLI`, `Codex Desktop`, `Cursor`, `OpenCode`).
     - Step 2 (CLI sources): Multi-select sessions to import -> materialized into `~/.rayu/sessions/imported_<tool>_<id>` and opened into Recents (or matching project if one exists).
     - Step 2 (Desktop sources with Projects — Claude Desktop / Codex Desktop): Choose **"Import whole project"** (batch-imports all sessions in that project and registers/groups them together under one RayuCode Project in `~/.rayu/workspaces.json`) OR **"Import selected session(s)"**.

5. **Lazy Materialization, Deduplication & Conflict-Safe Re-Sync:**
   - **Zero duplicate rows:** If an external session has already been imported as `~/.rayu/sessions/imported_<tool>_<id>`, the daemon merges the external metadata onto that single session row (`imported: true`, keeping its `source` logo) and never shows both an external row and an imported Rayu row.
   - **Fast startup (lazy import):** Auto-fetched external sessions are listed from cheap index/header metadata without copying 500 JSONL files up front. Clicking an external session imports it on demand via Rust `ImportExternalSession` and immediately opens the full resumable transcript.
   - **Live re-sync when external tool continues:** The daemon computes `sync_stale = (external_file_mtime_ms > imported_session_updated_at_ms)`.
     - If `sync_stale` is true and the user has **not** added local Rayu turns after import, opening the session silently refreshes the imported snapshot so it stays up to date with Claude/Codex.
     - If the user **did** add local Rayu turns AND the external file also received newer turns, RayuCode preserves the user's local turns and shows a non-blocking banner (`"Newer messages detected in Codex · Open synced copy"`) to avoid silently overwriting local work.

## 3. Architecture & Component Boundaries

### 3.1 Thick Rust Core (`crates/rayucode-base`, `crates/rayucode-harness-api`, `crates/rayucode-harness-api-server`)

1. **Shared External Scanner (`crates/rayucode-base/src/import.rs`):**
   - Extract the parallel external session discovery currently in `crates/rayucode-tui/src/tui/session_picker/loading.rs` (`load_external_sessions`) into a shared `rayucode_base::import::discovery` module consumed by BOTH `crates/rayucode-tui` and `crates/rayucode-harness-api-server`.
   - Add Desktop project metadata readers:
     - Claude Desktop Code tab project metadata (`claude-code-sessions/` paired with `~/.claude/projects/` -> tags `source = "claude_desktop"` and `external_project_name`).
     - Codex Desktop workspace metadata (`~/.codex/.codex-global-state.json` `electron-saved-workspace-roots`, `active-workspace-roots`, `thread-titles` paired with `~/.codex/sessions/` -> tags `source = "codex_desktop"` and `external_project_name`).
   - Add `ExternalSessionRecord` and `ExternalProjectRecord` structs plus deduplication helper matching against `~/.rayu/sessions/imported_<tool>_<id>` and checking `sync_stale` via file `mtime` + an `imported_turn_count` marker stored in session metadata.

2. **Additive Backwards-Compatible Harness API (`crates/rayucode-harness-api` + `crates/rayucode-harness-api-server` + `sdk/typescript`):**
   - Extend `SessionInfo` with optional `#[serde(default, skip_serializing_if = "...")]` fields:
     - `source: Option<String>` (`"rayu" | "claude_code" | "claude_desktop" | "codex" | "codex_desktop" | "cursor" | "opencode" | "pi"`)
     - `external_session_id: Option<String>`
     - `external_path: Option<String>`
     - `external_project_name: Option<String>`
     - `imported: bool`
     - `sync_stale: bool`
   - Extend `ApiRequest::ListSessions`:
     - `include_external: bool` (defaults `false` for legacy clients; `true` for Desktop and VS Code)
     - `sources: Option<Vec<String>>` (optional server-side source filter)
   - Add `ApiRequest::ListExternalProjects { source: Option<String> }` -> replies with `ApiEvent::ExternalProjects { projects: Vec<ExternalProjectInfo> }`.
   - Add `ApiRequest::ImportExternalSessions { items: Vec<ImportExternalSessionItem>, force_resync: bool, fork_on_conflict: bool }` -> imports 1 or N sessions using existing `crate::import::import_*_from_path`, replies with `ApiEvent::ExternalSessionsImported { sessions: Vec<SessionInfo>, skipped: Vec<ImportSkipInfo> }`.
   - Advertise capability `"external_sessions"` in `Hello` handshake so clients gracefully hide/disable external sync against older daemons.

### 3.2 Shared TypeScript Session Core (`packages/session-core`)

- **`/client/sidebar-tree.ts`:**
  - Extend `SidebarSessionLike` with `source?: SessionSourceId`, `imported?: boolean`, `syncStale?: boolean`, `externalProjectName?: string`, `externalSessionId?: string`, `externalPath?: string`.
  - Add `sourceFilter?: SessionSourceFilter` (`"all" | "rayu" | "claude" | "codex" | "cursor" | "opencode" | "pi"`) to `DeriveSidebarTreeInput` — note that `"claude"` matches both `"claude_code"` and `"claude_desktop"`, and `"codex"` matches both `"codex"` and `"codex_desktop"` for simple top-level filtering, while individual row badges/tooltips distinguish CLI vs Desktop.
  - Return `sourceCounts: Record<SessionSourceFilter, number>` in `DerivedSidebarTree` so Desktop and VS Code render accurate filter counts with zero duplicated counting logic.
- **`/host/workspace-registry.ts`:**
  - Add `importProjectGroup(rawPath, { name, sessionIds })` helper that atomically registers/canonicalizes a workspace via `fs.realpath` and attaches all imported `sessionIds` in a single lock acquisition (used when importing a whole Claude Desktop / Codex Desktop project).

### 3.3 Desktop (`desktop/`) & VS Code (`vscode/`) Surfaces (Priority Phase)

- **Shared Brand Logo Component (per surface, monochrome SVG following `DESIGN.md` tokens):**
  - `AgentSourceBadge` renders compact 12px-14px SVG logos for Rayu, Claude, Codex, Cursor, OpenCode, Pi with accessible `aria-label` / tooltip. Zero raw hex literals, zero emojis.
- **Sidebar Source Filter UI:**
  - Filter trigger/pills in `desktop/src/components/shell/sidebar-projects-pane.tsx` and `vscode/webview/src/features/shell/components/SidebarProjectsPane.tsx` using installed Radix/shadcn `Popover` / `DropdownMenu` primitives (`node desktop/scripts/check-shadcn.mjs check popover dialog checkbox --json`).
- **Lazy Import & Re-Sync on Session Select:**
  - Clicking an unimported or `sync_stale` external session calls `sessions.importExternal(...)` through Electron IPC / VS Code RPC -> attaches to the returned canonical `imported_<tool>_<id>` session -> invalidates `["sessions"]` and `["chat", "history", sessionId]`.
- **"Import from Tool" Modal:**
  - Uses shadcn `Dialog` primitive: source selector (Claude CLI, Claude Desktop, Codex CLI, Codex Desktop, Cursor, OpenCode) -> lists discovered Projects (for Desktop sources, with "Import Whole Project" vs "Select Sessions") or Sessions (for CLI sources) -> runs batch import via Rust daemon + `WorkspaceRegistry.importProjectGroup` for whole-project imports.

### 3.4 CLI Surface (`crates/rayucode-tui/src/tui/session_picker/`)

- Consume the shared `rayucode_base::import::discovery` module (removing duplicate discovery code from `loading.rs` and gaining `claude_desktop` / `codex_desktop` tags).
- Add `SourceFilterState` (`active_sources`, `popup_open`, `popup_cursor`) to `session_picker/filter.rs` and `session_picker/navigation.rs`.
- Render a compact **Source Filter chip** in the picker header (e.g., `[Source: All ▾]` or `[Source: Codex (14) ▾]`) and an **interactive clickable & keyboard-navigable popup overlay** (`session_picker/render.rs`) listing `All`, `Rayu`, `Claude`, `Codex`, `Cursor`, `OpenCode`, `Pi` with live counts.
- Preserve single-row non-wrapping display-cell layout at narrow widths (`AGENTS.md` TUI rule).

## 4. Error Handling & Edge Cases

- **Missing external tool directories:** Silently return empty list for uninstalled tools (never surface ENOENT errors).
- **Malformed external JSONL lines:** Skip corrupt lines (existing behavior in `crates/rayucode-base/src/import.rs`) and continue scanning remaining sessions.
- **Older Rust daemon without `"external_sessions"` capability:** Desktop and VS Code check handshake capabilities and degrade gracefully to native Rayu sessions without throwing `UnknownRequest`.
- **Conflict on re-sync:** Never silently overwrite local Rayu messages added after import; default `fork_on_conflict: true` or surface banner offering synced copy.
- **Large session counts (500+ Claude/Codex files):** Respect `scan_limit` (default 200 most recent per tool) and use `sessions-index.json` / file-header peek so listing completes in <150ms.

## 5. Testing Strategy

- **Rust unit & integration tests (`cargo test -p rayucode-base -p rayucode-harness-api -p rayucode-harness-api-server -p rayucode-tui`):**
  - Discovery tests for Claude CLI, Claude Desktop, Codex CLI, Codex Desktop fixtures in temp dirs.
  - Deduplication test: already-imported `imported_codex_<id>` merges with external record (1 row, `imported: true`) and flips `sync_stale: true` when external `mtime` advances.
  - Conflict test: local Rayu turn added + external file advanced -> preserves local turns and flags conflict / forks safely.
  - Harness API round-trip tests for `ListSessions { include_external: true }`, `ListExternalProjects`, and `ImportExternalSessions`.
  - CLI `session_picker` tests for opening the filter popup, selecting `Codex` / `Claude` / `All`, mouse-click hit-testing, and narrow-width non-wrapping rows.
- **`packages/session-core` Vitest tests:**
  - `deriveSidebarTree` `sourceFilter` (`all`, `claude` matching CLI+Desktop, `codex` matching CLI+Desktop, `rayu`) and accurate `sourceCounts`.
  - `WorkspaceRegistry.importProjectGroup` atomic single-lock creation + session attachment.
- **Desktop & VS Code tests + verification gates:**
  - Component tests for `AgentSourceBadge`, source filter toggle, lazy import on click, and "Import from Tool" modal (CLI session mode vs Desktop whole-project mode).
  - Full gates: `cd desktop && pnpm verify`, `npm run build:vscode && npm --workspace @rayu-dev/rayucode-vscode test`, and `1440x934` visual verification screenshots in Dark Rayu Green, Dark Ocean Blue, and Light modes.

## 6. Phased Rollout Order

1. **Phase 1 (Rust Core + SDK + `packages/session-core`):** Shared scanner + Desktop project metadata + Harness API RPCs + TS SDK + `session-core` source filtering & `importProjectGroup`.
2. **Phase 2 (Desktop & VS Code Extension — ship first):** Auto-sync sidebar with tool logos, interactive source filter bar/popover, lazy import & conflict-safe re-sync on click, and "Import from Tool" modal (whole project vs individual sessions).
3. **Phase 3 (CLI `/session` Filter Popup):** Wire `crates/rayucode-tui/src/tui/session_picker/` to the shared scanner + add the clickable/keyboard source filter popup screen.
