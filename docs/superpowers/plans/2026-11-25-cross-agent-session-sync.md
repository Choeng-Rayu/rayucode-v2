# Implementation Plan: Cross-Agent Auto-Sync, Source Logos, and Source Filtering

Spec: `docs/superpowers/specs/2026-11-25-cross-agent-session-sync-design.md` (`APPROVED`)
Branch: `feat/cross-agent-session-sync`

## Task Breakdown & Parallel Lanes

### Phase 1: Rust Core, Harness API, TS SDK, and `packages/session-core` (Foundation)
1. **Rust Shared External Discovery (`crates/rayucode-base/src/import_discovery.rs` + `import.rs`)**
   - Extract parallel local discovery for Claude Code CLI (`~/.claude/projects/`), Claude Desktop Code tab (`Application Support/Claude/claude-code-sessions/`), Codex CLI (`~/.codex/sessions/`), Codex Desktop (`~/.codex/.codex-global-state.json` workspace roots + thread titles), Cursor, OpenCode, and Pi into `rayucode_base::import::discovery`.
   - Implement `list_external_sessions(scan_limit, source_filter)` and `list_external_projects(source_filter)` with deduplication against `~/.rayu/sessions/imported_<tool>_<id>` and `sync_stale = external_mtime_ms > imported_updated_at_ms`.
   - Implement `import_external_session_item(...)` supporting single/batch import, `force_resync`, and `fork_on_conflict` (never silently overwriting local Rayu turns added after import).
   - Unit tests in `crates/rayucode-base` covering Claude CLI/Desktop, Codex CLI/Desktop, dedup, `sync_stale`, and conflict fork.
2. **Harness API & Server (`crates/rayucode-harness-api` + `crates/rayucode-harness-api-server`)**
   - Bump `API_VERSION_MINOR` (`14` -> `15`) and advertise capability `"external_sessions"`.
   - Add optional backwards-compatible fields to `SessionInfo`: `source`, `external_session_id`, `external_path`, `external_project_name`, `imported`, `sync_stale`.
   - Extend `ApiRequest::ListSessions` with `include_external: bool` and `sources: Option<Vec<String>>`.
   - Add `ApiRequest::ListExternalProjects` (`ApiEvent::ExternalProjects`) and `ApiRequest::ImportExternalSessions` (`ApiEvent::ExternalSessionsImported`).
   - Update `schema_snapshot.rs` & `capability_coverage.rs` and add server integration tests.
   - Verify: `cargo test -p rayucode-base -p rayucode-harness-api -p rayucode-harness-api-server`.
3. **TypeScript SDK & `packages/session-core`**
   - Update `sdk/typescript/src/protocol.ts` and `sdk/typescript/src/client.ts` (`listSessions({ includeExternal, sources })`, `listExternalProjects`, `importExternalSessions`, new `SessionInfo` fields).
   - Extend `packages/session-core/src/client/sidebar-tree.ts` with `SessionSourceId`, `SessionSourceFilter`, `sourceFilter`, and `sourceCounts` (matching `"claude"` -> `claude_code | claude_desktop` and `"codex"` -> `codex | codex_desktop`).
   - Extend `packages/session-core/src/host/workspace-registry.ts` with atomic `importProjectGroup(rawPath, { name, sessionIds })`.
   - Verify: `npm run test:sdk && npm run test:session-core`.

### Phase 2: Desktop & VS Code Extension (Parallel Disjoint Lanes)
4. **Desktop (`desktop/`):**
   - Expose `listSessions({ includeExternal: true })`, `listExternalProjects`, and `importExternalSessions` through `desktop/electron/daemon-client.ts`, `ipc-schemas.ts`, `preload.cjs`, `main.ts`, and `desktop/src/lib/ipc-client.ts` (gracefully checking `"external_sessions"` capability).
   - Add monochrome SVG `AgentSourceBadge` component (`DESIGN.md` tokens, zero raw hex / emojis) for Rayu, Claude, Codex, Cursor, OpenCode, Pi.
   - Add sidebar source filter popover/bar (`All`, detected tools with logos + counts) in `sidebar-projects-pane.tsx`.
   - Lazy-import & conflict-safe re-sync when clicking an unimported or `syncStale` external session (with non-blocking copy banner if local Rayu turns diverged).
   - Add "Import from Tool" `Dialog` modal (`desktop/src/components/shell/import-sessions-dialog.tsx`): pick tool -> CLI selects individual sessions; Desktop offers "Import Whole Project" (`WorkspaceRegistry.importProjectGroup`) or individual sessions.
   - Verify: `cd desktop && pnpm verify`.
5. **VS Code Extension (`vscode/`):**
   - Expose `includeExternal`, `sessions.listExternalProjects`, and `sessions.importExternal` in `vscode/shared/vscodeProtocol.ts`, `vscode/host/runtime/sessionHubCore.ts`, `sessionHub.ts`, and `featureRouters.ts`.
   - Add matching monochrome SVG `AgentSourceBadge`, sidebar source filter bar/popover, lazy-import/re-sync on session click, and "Import from Tool" modal in `vscode/webview/src/`.
   - Verify: `npm run build:vscode && npm --workspace @rayu-dev/rayucode-vscode test && npm --workspace @rayu-dev/rayucode-vscode run lint:design`.

### Phase 3: CLI `/session` Interactive Source Filter Popup (Parallel with Phase 2!)
6. **CLI TUI (`crates/rayucode-tui/src/tui/session_picker/`):**
   - Add `SourceFilterState` (`selected_source: Option<SourceFilterGroup>`, `popup_open`, `popup_cursor`) in `session_picker/filter.rs`, `navigation.rs`, and `mod.rs`.
   - Render compact non-wrapping header filter chip `[Source: All ▾]` and clickable/keyboard-navigable source filter popup overlay (`All`, `Rayu`, `Claude`, `Codex`, `Cursor`, `OpenCode`, `Pi` with live counts) in `session_picker/render.rs`.
   - Add unit tests for popup open/close, keyboard + mouse selection, filtering results, and narrow-width non-wrapping rows.
   - Verify: `cargo test -p rayucode-tui session_picker`.
