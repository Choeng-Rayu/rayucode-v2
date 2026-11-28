# RayuCode Desktop–Rust Engine Function-by-Function Test Matrix

This matrix catalogs **every** Desktop screen/surface, **all 142** `ipcClient` functions, **all 110** Electron `ipcMain.handle` channels, **all 8** Electron push events, **all 27** `daemon:invoke` ops, **all 9** registered Desktop SDK tools (+ **4** cloud tools), **all 58** Rust `ApiRequest` variants, **all 62** `ApiEvent` variants, **all 37** `RuntimeCommand` variants, and **all 28** curated slash commands, with exact target disposition and pass/fail test oracle.

---

## Section A — Screen-by-Screen & Control-by-Control Acceptance Matrix (14 Surface Groups)

### A.1 Startup, Auth Welcome & Sign-In (`AuthWelcomeScreen.tsx`, `AuthSignInDialog.tsx`, `DaemonBanner.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Cold launch signed-out inspection | `App.tsx:294-319`, `daemon-client.ts:723` | `rayu api-bridge` (`allowSignedOut`) + `auth.getState` | Private daemon boots cleanly on Unix socket / Windows named pipe; PID tracked in effective `servers.json`; UI renders `AuthWelcomeScreen` without crash. |
| Welcome (`step="welcome"`) theme toggle | `AuthWelcomeScreen.tsx:370-371` | `settings.updatePreferences` | Toggles Dark/Light immediately via CSS tokens. |
| Welcome -> Browser OAuth (`handleBrowserLogin`, copy URL, cancel) | `AuthWelcomeScreen.tsx:430-494`, `AuthSignInDialog.tsx:51-70,228-274` | `auth.signInWithBrowser`, `auth.cancelSignIn`, `native.openExternal`, `daemon.getStatus` | Opens HTTPS browser URL, copies URL, cancels cleanly; on callback completes `rayu:auth:changed` and notifies daemon (`NotifyAuthChanged`). |
| Welcome -> Continue without signing in (`authBypassed`) | `AuthWelcomeScreen.tsx:527` | `allowSignedOut` private daemon | Enters workspace for read-only inspection (`capabilities`, `models`, `files`, `changes`); sending a chat prompt returns typed D5 auth error promptly and keeps composer draft intact. |
| Manual Key / Callback (`step="manual-key"`) + clipboard paste + show/hide secret | `AuthWelcomeScreen.tsx:538-713`, `AuthSignInDialog.tsx:89` | `auth.signInWithApiKey`, `auth.completeCallback` | Validates key/URL, saves credentials, clears auth gate without stale cached errors. |
| Choose Plan (`step="choose-plan"`) & Onboarding (`step="onboarding"`: theme, accent, permission, pick workspace) | `AuthWelcomeScreen.tsx:729-1004` | `settings.updatePreferences`, `workspace.pickFolder`, `workspace.setPath` | Persists theme (`dark`/`light`), accent (`green`/`blue`), default permission, and workspace folder. |
| Connect Account (`step="connect-account"`) + Sign Out | `AuthWelcomeScreen.tsx:1015-1115`, `AuthSignInDialog.tsx:106,173` | `auth.signOut`, `cloud.cancelStream` | Aborts active cloud/harness streams, clears creds, resets workspace session cleanly. |
| Reconnecting `DaemonBanner` | `DaemonBanner.tsx:9-10`, `App.tsx:311-319` | `daemon.getStatus`, `daemon.onStatusChange`, `daemon.launch` | Displays live reconnecting/error state when socket drops; recovers on reconnect. |

### A.2 App Shell, Icon Rail & Sidebar Projects/Threads (`AppShell.tsx`, `LeftSidebar.tsx`, `sidebar-projects-pane.tsx`, `create/edit-project-dialog.tsx`, `import-sessions-dialog.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Sidebar width & Top-6 Primary Nav (`Home`, `Swarm`, `Automations`, `Plugins`, `Changes`, `Telegram Remote`) + Settings (`Cmd+,`) | `globals.css:98`, `navigation.ts:10-22`, `LeftSidebar.tsx:470-484` | `useAppStore.setActiveRoute`, hover prefetch (`sidebar-projects-pane`, `use-swarm`, `use-automations`, `use-plugins`, `use-changes`, `use-telegram`) | `--sidebar-w: 296px`; rail slot #2 navigates to `swarm`; all 9 routes render inside `<SectionErrorBoundary>` + `<Suspense>` with zero-CLS skeletons; 0 phantom sessions created on hover/click. |
| Toggle sidebar (`aria-label="Toggle sidebar"`), Back/Forward (`Cmd+[` / `Cmd+]`, `LeftSidebar:966-993,1148-1175`) | `LeftSidebar.tsx:433`, `AppShell.tsx:122-131` | `useAppStore` (`toggleLeftSidebar`, `goBack`, `goForward`) | Collapses/restores sidebar cleanly; history back/forward works across routes. |
| Global shortcuts (`Cmd+1`, `Cmd+J`, `Cmd+;`, `Cmd+K` / `/` focus) | `AppShell.tsx:116-165` | `useAppStore.openRightTab`, `toggleRightSidebar` | Matches `Settings -> Shortcuts` 1:1; opens Terminal (`Cmd+J`), Context/Inspector, toggles sidebar (`Cmd+;`). |
| Plan & Usage limits strip (`aria-label="Plan & usage limits"`), Auth refresh, Mini & Pet toggle, External Docs/Changelog/Dashboard/About | `LeftSidebar.tsx:520-887` | `auth.refresh`, `settings.getState`, `settings.updatePreferences`, `native.openExternal` | Displays live usage/plan bars (or signed-out prompt), external links enforce `http:`/`https:`, toggle updates `showMiniPet`. |
| Search chats, Filter by agent source, Organize/Sort/Show menus, Sections create/collapse | `LeftSidebar.tsx:1207-1259`, `sidebar-projects-pane.tsx:1532-1869` | `sidebar.getState`, `sidebar.saveState`, `sidebar.onStateChange` | Persists sort/grouping/filters atomically via `storage:save-sidebar-state`; cross-window `sidebar-changed` stays in sync. |
| Create/Edit Project dialogs, Pin/Unpin, Move Up/Down, Assign Section, Reveal in Finder, Archive Project Chats, Remove Project, Start New Chat in Project | `sidebar-projects-pane.tsx:760-937,1309-1455`, `create-project-dialog.tsx`, `edit-project-dialog.tsx` | `workspace.pickFolder`, `workspace.ensure`, `workspace.setPath`, `native.revealInFinder`, `sessions.createSession`, `sessions.archive`, `sessions.restore` | Folder picker uses `realpath`; creating/opening project updates workspace atomically; archiving/undo restores exact sessions; zero unpinned data loss. |
| Import external sessions (`Claude Code`, `Claude Cowork`, etc.) | `import-sessions-dialog.tsx:59-155`, `GettingStartedCard.tsx:236,486` | `sessions.listExternalProjects`, `sessions.importExternal`, `workspace.importProjectGroup` | Discovers external projects, imports selected sessions idempotently without duplicate threads. |
| Thread row: Open, Rename inline, Pin/Unpin, Archive/Restore toast | `sidebar-projects-pane.tsx:950-1267` | `sessions.rename`, `sessions.archive`, `sessions.restore`, `workspace.setPath`, `trace.listTurns` | Switches workspace cleanly per chat; renames persist in Rust `RenameSession`; archive/restore round-trips cleanly. |
| Swarm workers quick-add / open in VS Code from sidebar | `LeftSidebar.tsx:1023-1126` | `swarm.getState` / `native.openInVSCode` | Reflects live swarm workers (no static fake workers) and opens real worktree paths in VS Code. |

### A.3 Top Bar & Right Inspector Header (`TopBar.tsx`, `RightInspectorHost.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Back / Forward / New chat (`aria-label="New chat"`), Session title badge, Open terminal, Open files & previews | `TopBar.tsx:371-520` | `useAppStore` (`setActiveSession(null)`, `setActiveRoute("home")`, `openRightTab`) | Returns cleanly to `HomeView`; opens `terminal` or `files` right pane. |
| More Actions menu (`Toggle Side Chat`, `Automations`, `Keep computer awake` switch, links) | `TopBar.tsx:111-227` | `native.setKeepAwake`, `useAppStore.toggleSideChat` | `Keep awake` calls `powerSaveBlocker` in Main and persists indicator; Side Chat toggles drawer. |
| 5 Right Inspector Icon Strip tabs (`overview`, `terminal`, `diff`, `browser`, `files`) + background document pills + Close document + Full View + Close right sidebar + drag-resize handle + Restore chat bar | `TopBar.tsx:235-307,538-692`, `RightInspectorHost.tsx:184-215` | `useAppStore` (`openRightTab`, `closeDocumentToContext`, `setFullView`, `toggleRightSidebar`, `setRightWidthPx`, `setChatCollapsedByRight`) | Dragging left beyond threshold collapses chat cleanly with Restore banner; double-click resets width; full view hides/restores chrome without unmount leaks. |

### A.4 Home View, Workspace Entry & Getting Started (`home-view.tsx`, `GettingStartedCard.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Getting Started checklist: Hide setup / Undo, Collapse, Mark done, Run item action (summarize/import) | `GettingStartedCard.tsx:121-486` | `sessions.getGettingStarted`, `sessions.toggleGettingStarted`, `sessions.importExternal` | Completion state persists across restarts; Undo restores card. |
| First-turn submit from `HomeView` / `ActiveWorkspaceStage` (`handleWorkspaceSubmit`) | `home-view.tsx:72-245`, `App.tsx:88-165` | `sessions.createSession`, `harness.setPermissionMode` (**awaited**), `harness.stagePromptEffort`, `trace.sendPrompt` | Permission mode selected in composer (`Auto-Approve`/`Ask`/`Plan`) is applied via awaited `SetPermissionMode` *before* `SendMessage`; failed send preserves draft & shows inline error without losing user input. |
| Welcome Auth Banner Sign-in CTA | `home-view.tsx:245` | `setAuthDialogOpen(true)` | Opens `AuthSignInDialog` directly from bypassed signed-out mode. |

### A.5 Composer, Model/Effort Picker, Permission Picker, Slash/Mention/Attachments, Sketch & Templates (`composer.tsx`, `model-effort-popover.tsx`, `permission-popover.tsx`, `sketch-dialog.tsx`, `template-carousel.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Project / Folder selector & New Folder, Git Branch checkout & Create Worktree | `composer.tsx:914,1248-1298,1945-2097` | `workspace.getInfo`, `workspace.listRecent`, `workspace.setPath`, `workspace.pickFolder`, `workspace.listBranches`, `workspace.checkoutBranch`, `workspace.createWorktree` | Dirty-tree `checkoutBranch` fails honestly (`ok: false`) with error toast instead of lying; `createWorktree` isolates branch/cwd. |
| Model & Effort popover (`ModelEffortPopover`: catalog list, search, refresh models, effort selector `low`/`medium`/`high`/`xhigh`/`max`) | `model-effort-popover.tsx`, `composer.tsx:1391-1430` | `models.list`, `models.refresh`, `harness.setModel`, `harness.setReasoningEffort` | Force refresh discovers new models from updated provider catalogs (including OpenAI/Gemini/Cursor/Antigravity) and preserves last-good list on network failure; model & effort stick across session reload. |
| Permission Mode popover (`PermissionPopover`) | `permission-popover.tsx`, `composer.tsx:1458` | `sessions.listPermissionModes`, `harness.setPermissionMode` | Syncs bidirectionally with Rust `PermissionModeChanged` events (`App.tsx`). |
| Plus (`+`) menu: Slash commands (`/compact`, `/model`, `/effort`, `/mode`, `/clear`, `/fork`, `/rewind`, `/review`, etc. — all 28 curated commands), Skills, Templates, Attach Files, Appshot, Sketch, Pet toggle | `composer.tsx:785-832,1080-1241,1363-1493,2394-3174` | `harness.getCapabilities`, `plugins.getState`, `templates.list`, `workspace.pickFiles`, `workspace.captureAppshot`, `harness.compact`, `harness.runtimeCommand` | Slash menu merges live `capabilities.slash_commands` + enabled local skills; combined file/image attachments respect size guard; keyboard `ArrowUp/Down/Enter/Esc` navigates menu accurately. |
| `@` File Mention autocomplete & Drag-and-Drop attachments + Attachment chips removal | `composer.tsx:637,2263-2353` | `workspace.listFiles` | Lists >250 workspace files accurately (ignoring `.git`/`node_modules`); handles spaces in filenames. |
| Sketch Dialog (Pen, Eraser, Colors, Stroke width 2/4/8, Undo, Clear, Attach PNG) | `sketch-dialog.tsx:167-285` | In-memory canvas -> PNG dataUrl attachment | Attaches rendered PNG to composer tray without UI lag. |
| Templates Carousel & Creator (`spreadsheet`, `presentation`, etc. save/delete/select) | `template-carousel.tsx:403-652`, `composer.tsx:1890,3386-3396` | `templates.list`, `templates.save`, `templates.remove` | Atomic JSON storage; saved template populates composer / Office tool flow cleanly. |
| Send / Steer / Queue / Abort / Stop buttons & Draft Recovery | `composer.tsx:1609-1851,2210-2232,3247-3349` | `trace.sendPrompt`, `trace.softInterrupt`, `trace.cancel` | Mid-turn steer/queue send concurrently with active turn ID tracking; Abort/Stop cancels active Rust turn (`Cancel`); any rejected/D5 error preserves draft text + attachments. |

### A.6 Execution Trace, Approvals, Clarifying Questions, Turn Actions & Inline Diff (`chat-stream.tsx`, `clarifying-question-card.tsx`, `turn-actions.tsx`, `inline-diff-card.tsx`, `work-trace.tsx`, `shell-card.tsx`, `cite-link.tsx`, `turn-file-summary-card.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Live streaming trace (`TextDelta/Done/Replace`, `ReasoningDelta/Done`, `ToolStart/InputDelta/Exec/Done`, `WorkTrace`, `ShellCard`, `CiteLink`) | `chat-stream.tsx:411-574`, `live-trace-store.ts` | `harness.onEvent` (`CreateStreamBatcher` 16–33ms), `trace.listTurns` | History reconciles with live turns without duplicating assistant bubbles; switching between 2 streaming sessions isolates streams cleanly. |
| Permission Request Banner (`Approve Once` / `Allow for Session` / `Deny`) | `chat-stream.tsx:574-619,928-950`, `App.tsx:323,397-403` | `trace.respondToPermission` (`ApiRequest::PermissionResponse`) | Strictly scoped per `sessionId + requestId`; approving unblocks Rust tool execution and clears only that request. |
| Clarifying Question Card (`QuestionRequestCard` options / custom answer / dismiss) | `clarifying-question-card.tsx`, `chat-stream.tsx` (wired Wave 3) | `ApiEvent::QuestionRequest`, `ApiEvent::QuestionClosed`, `ApiRequest::QuestionResponse` | Renders options cleanly inside `ChatStream`, submits exact selected answers to Rust daemon, and clears on `QuestionClosed`. |
| Steer/Queue banner pills (`Send as steer now`, `Send queued message now`, `Edit in composer`, `Cancel`) | `chat-stream.tsx:1030-1087` | `trace.softInterrupt`, `trace.cancelSoftInterrupts` | Promotes queued message, recalls into composer draft, or cancels pending soft interrupts in Rust daemon cleanly. |
| Turn Actions (`Copy`, `Fork from here`, `Pin/Unpin`) | `turn-actions.tsx:123-182` | `trace.forkTurn(sessionId, upToMessageId)`, `trace.togglePin`, `sessions.createSession` | **Exact fork**: forks conversation at the chosen turn's `upToMessageId` / `upToMessageIndex` (`exact_session_fork`), opening the forked thread truncated right after that message; Pin persists in sidebar/storage. |
| Inline Diff Card & Turn File Summary Card + `Open in VS Code` | `inline-diff-card.tsx`, `chat-stream.tsx:288-361` | `fileChanges.get`, `fileChanges.diff`, `native.openInVSCode` | Resolves workspace-relative paths safely and opens VS Code / right diff pane at exact line. |

### A.7 Right Inspector: Context, Files, Code Viewer, Diff Tab & Terminal (`context-panel.tsx`, `files-tab-panel.tsx`, `code-viewer.tsx`, `diff-tab-panel.tsx`, `terminal-panel.tsx`, `xterm-viewport.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Context Panel: Environment settings, Pick folder, Context token breakdown & disclosures (Tools/Skills/Memory/MCP), Connectors link, Outputs open preview, Changes summary -> Changes view | `context-panel.tsx:138-506`, `use-context-stats.ts` | `inspector.getState`, `workspace.pickFolder`, `todos.get`, `fileChanges.get` | Live context percentage reflects daemon `TokenUsage`; outputs open corresponding preview tab; empty session shows zero phantom metrics. |
| Files Tab: Directory tree expand/collapse, Search filter, Collapse all, Toggle tree, Toggle word wrap, Copy path, Open in VS Code, Ask about line (`SideChat` / Composer cite), Binary/Truncation handling | `files-tab-panel.tsx:213-730` | `workspace.listFiles`, `workspace.read` (via `inspector.getCodeFile`), `native.openInVSCode` | Symlink escape outside workspace fails closed; binary files render binary notice instead of garbled UTF-8; >256KB files show explicit truncation banner. |
| Code Viewer: Referenced code files list, Click line to jump, Copy path, Open in VS Code, Shiki syntax highlighting (dark/light/green/blue) | `code-viewer.tsx:174-265`, `shiki-highlighter.ts` | `inspector.getCodeFile`, `native.openInVSCode` | Shiki highlighter lazy-loads cleanly with dark/light theme sync and exact line highlight. |
| Diff Tab Panel: Session `fileChanges` vs Git changes, Split/Unified toggle, Mark viewed, Comment on line (sends to Composer/SideChat), Stage/Unstage toggle, Stage all, Commit staged, Discard, Open in VS Code | `diff-tab-panel.tsx:262-1225` | `changes.getState`, `changes.toggleStage`, `changes.stageAll`, `changes.commitStaged`, `changes.rejectFile` / `discardGitFile`, `fileChanges.diff`, `fileChanges.action` | Handles >40 changed files and special ` -> ` / Unicode filenames; `discard` preserves staged index when unstaged, or explicitly reverts; commit invalidates diff/commits cache. |
| Terminal Panel (`xterm.js`): New terminal tab, Close tab, Switch tab, Clear, Full view, Terminal actions menu, Real PTY create/write/resize/kill | `terminal-panel.tsx:187-606`, `xterm-viewport.tsx:200-252` | `terminal.hasLivePty`, `terminal.ptyCreate`, `terminal.ptyWrite`, `terminal.ptyResize`, `terminal.ptyKill`, `terminal.onPtyData`, `terminal.onPtyExit` | Real interactive PTY; UTF-8 multi-byte chars intact; closing tab or quitting Electron reaps Python wrapper + child process group cleanly (0 orphans). |

### A.8 Previews & Side Chat (`previews-host.tsx`, `browser-pane.tsx`, `excel-pane.tsx`, `slide-pane.tsx`, `diagram-pane.tsx`, `markdown-pane.tsx`, `floating-ask-chat.tsx`, `SideChatDrawer.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Browser Pane: Tabs add/close/select, URL bar (`localhost` HTTP preserved!), Back/Forward/Reload, Bookmarks, Inspect element, Find in page, Print, Zoom `-/+/reset`, Device mode (`desktop`/`tablet`/`mobile`), Appshot screenshot, CDP automation & `<webview>` security | `browser-pane.tsx:185-1398`, `browser-cdp.ts` | `previews.getState`, `browser.{navigate,snapshot,click,type,screenshot}`, `workspace.captureAppshot`, `main.ts` `will-attach-webview` | `localhost:3000` stays `http://`; `<webview>` blocks `nodeIntegration` & `file://` popups; CDP detaches cleanly on pane/tab close and refreshes stale AX refs cleanly. |
| Floating Ask Chat (`FloatingAskChat`) & Side Chat Drawer (`SideChatDrawer`) | `floating-ask-chat.tsx:78-210`, `SideChatDrawer.tsx:58-126` | `previews.sendBrowserQuestion` / `harness` session turn (no canned mock reply!) | Sends real question + page/selection context through Rust engine / ephemeral ask session and renders real streamed reply or explicit auth error. |
| Excel Pane: Open `.xlsx` picker, Formula bar + grid edit, Multi-sheet switch, Save `.xlsx` (non-destructive!), Toggle Web Viewer URL, Open in Excel | `excel-pane.tsx:298-775`, `office-bridge.ts` | `office.pickExcelFile`, `office.readExcel`, `office.writeExcel`, `previews.updateExcelCell`, `native.openInExcel` | Percent values (`0.15` displayed `15%`) save back as `0.15` (not `1500%`!); untouched sheets/charts/styles in existing workbooks preserved; shared formulas & Excel errors (`#REF!`) display accurately; missing workbook shows error instead of fake demo creation. |
| Slide Pane: Slide rail, Inline edit (`title`/`subtitle`/`body`), Presenter mode, Speaker notes, Zoom (`fit`/`75`/`100`/`125`), Export/Open in PowerPoint | `slide-pane.tsx:90-587`, `office-bridge.ts` | `office.createPowerPoint`, `native.openInPowerPoint` | `OpenInPowerPointPayloadSchema` preserves `filePath`, `metrics`, and `layout`; real `.pptx` generated and opened. |
| Diagram & Markdown Panes: Zoom `-/+/fit/reset`, Copy source, Export SVG, Mermaid render, On-this-page outline, Open in VS Code | `diagram-pane.tsx:184-295`, `markdown-pane.tsx:133-185` | Local SVG export / clipboard / `native.openInVSCode` | Valid SVG export & VS Code open; offline safe Mermaid rendering. |

### A.9 Swarm (`swarm-view.tsx`, `swarm-launchpad.tsx`, `agent-roster.tsx`, `agent-inspector.tsx`, `spawn-worker-bar.tsx`, `coordination-ledger.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Swarm Launchpad (`SwarmView`): Goal, Team preset, Model selector, Launch swarm, Templates, Custom `SpawnWorkerBar` (`name`, `role`, `model`, `scope`, `task`) | `swarm-launchpad.tsx:286-416`, `spawn-worker-bar.tsx:160-247`, `swarm-view.tsx:133-146` | `GlobalRuntimeCommand(Swarm, ...)` + `swarm.*` API + `capabilities.get` | **Zero fake workers**: reads real daemon swarm status (`swarm status|list|board`); spawns real workers via Rust `Swarm` command or surfaces explicit capability-gated banner when unsupported. Opening Swarm creates **0** phantom sessions. |
| Agent Roster & Inspector & Coordination Ledger: Select agent, Toggle Pause/Resume, Direct `@agent` DM, Read touched file, Open worktree in VS Code, Ledger tabs & Inspect diff | `agent-roster.tsx:98`, `agent-inspector.tsx:85-382`, `coordination-ledger.tsx:47-201` | `GlobalRuntimeCommand(Swarm)`, `native.openInVSCode`, `changes` / `inspector` | Real worker status & worktree inspection; pauses/DMs issue real engine commands or disable with explicit reason. |

### A.10 Agents & Personas (`agents-view.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Configuration Scope toggle (`Global` vs `Project`), Default Subagent Model, 4 Built-in Role Models (`explorer`, `reviewer`, `planner`, `fast`), Create/Edit/Delete Persona Dialog (presets, name, model route, reasoning effort, description/instructions), Refresh | `agents-view.tsx:445-1176`, `agents-bridge.ts` | `GlobalRuntimeCommand(Agents / SubagentModel)` (when global) or session `RuntimeCommand` (when project), `agents.*` | Opening Global Agents creates **0** phantom sessions; `--` argument guard before descriptions; model/profile CRUD reflects immediately in Rust config and UI query cache. |

### A.11 Automations (`automations-view.tsx`, `overnight-launcher.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Overnight Launcher (`prompt`, `repo`, `duration`, `maxAgents`, `permissions`, `handoffTime`), Toggle expand/Pause/Run Now/Cancel run, Enable/Run Now scheduled task, Navigate Morning Report -> `swarm`/`changes` | `overnight-launcher.tsx:98-264`, `automations-view.tsx:188-491` | `GlobalRuntimeCommand(Overnight / Schedules)` + `capabilities.get` | Backed strictly by real Rust `Overnight` and `Schedules` commands; if a schedule mutation (`toggle`/`pause`/`run-now`/`cancel`) is unsupported by the active daemon version, control displays explicit capability gate instead of mutating fake local state. Opening creates **0** phantom sessions. |

### A.12 Plugins & MCP Connectors (`plugins-view.tsx`, `plugin-detail-view.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Category tabs / Search plugins / Featured showcase carousel / Install or Configure / Manage menu / Toggle Skill / Create Skill Modal | `plugins-view.tsx:656-1472` | `plugins.*`, `extensions.*`, `storage-bridge` | Skills written atomically to `~/.rayu/skills/` or workspace skills dir; toggle persists cleanly. |
| Plugin Detail View & Custom MCP Modal: Scope (`workspace`/`user`/`global`), Transport (`stdio`/`sse`/`http`), URL/Command/Args/Headers/Timeout/Env, Save, Remove, Run Sample Prompt, Open `~/.rayu/mcp.json` in VS Code | `plugin-detail-view.tsx:100-767`, `plugins-view.tsx:1236-1400` | `extensions.upsert-mcp`, `extensions.remove-mcp`, `GlobalRuntimeCommand(Mcp, ["reload"])`, `sessions.createSession`, `native.openInVSCode` | Editing an MCP server URL preserves existing `headers`, `timeout`, and env secrets (`D3`); malformed `.mcp.json` blocks save with repairable syntax error & keeps original file bytes (`D4`); reload uses session-less `GlobalRuntimeCommand` (`D1`) and reports disk vs reload status separately. |

### A.13 Changes & Git Workflow (`changes-view.tsx`, `diff-panel.tsx`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Changed Files list (>40 files!), Diff view mode (`Unified`/`Split`), Stage/Unstage per file, Stage/Unstage All, Open in VS Code | `changes-view.tsx:78-388`, `diff-panel.tsx:335-636` | `git:changes` (`git status -z`), `changes.*`, `fileChanges.*`, `native.openInVSCode` | Repositories with 43+ modified/untracked files show all 43+ files (`totalChangedFiles`); files named `a -> b.rs`, spaces, Unicode, and renames parse cleanly (`D2`). |
| Review decision (`Accept`/`Reject`/`Pending`), Discard file, Commit Staged, Create PR modal | `changes-view.tsx:358-631`, `diff-panel.tsx:612-636`, `git-bridge.ts:492-607` | `fileChanges.action`, `git:discard-file`, `git:commit`, `git:create-pr` | Rejecting/discarding an unstaged change preserves staged index changes (`D2`); Commit + Create PR execute real git/`gh` commands and refresh diffs & commits. |

### A.14 Settings (`settings-view.tsx`, `appearance-panel.tsx`, `settings/schemas/index.ts`)
| Control / Flow | Source Location | Backend / Engine Binding | Acceptance Oracle |
|---|---|---|---|
| Navigation sidebar collapse/back/search + 6 Panels: `Appearance`, `Account`, `Models & Config`, `Voice`, `Connections`, `Shortcuts` | `settings-view.tsx:315-2117`, `appearance-panel.tsx:33-364` | `settings.getState`, `settings.updatePreferences`, `settings.setUseAllCredits`, `auth.*`, `daemon.*`, `harness.getConfig`, `harness.patchConfig`, `harness.runtimeCommand` | Opening Settings creates **0** sessions. Schema-driven fields patch `config.toml` via Rust `PatchConfig` with optimistic-revision conflict notice; Theme/Accent/Code Font/Font Size/Reduce Motion/Mini-Pet apply immediately; Daemon Reload triggers `GlobalRuntimeCommand(ServerReload)` and confirms active daemon status; Shortcuts table matches `AppShell` keybindings 1:1. |

---

## Section B — All 139 `ipcClient` Functions (`desktop/src/lib/ipc-client.ts`)

Legend for **Caller Surface**: `[UI]` = direct production React caller; `[Adp]` = invoked via feature API / adapter / hook; `[Tool/Pre]` = invoked via Preload/Main tool push, capability helper, or internal helper (15 helpers covered explicitly by unit/contract tests).

| # | Line | `ipcClient` Function | Electron IPC Channel / Mechanism | Caller Surface | Test / Verification Target |
|---|---|---|---|---|---|
| 1 | 4107 | `sessions.list` | `rayu:harness:list-sessions`, `rayu:storage:get-sessions` | `[UI][Adp]` | `daemon-client.test`, `rust-engine-acceptance` |
| 2 | 4177 | `sessions.listExternalProjects` | `rayu:harness:list-external-projects` | `[UI]` | `import-sessions-dialog`, `left-sidebar-projects.test` |
| 3 | 4203 | `sessions.importExternal` | `rayu:harness:import-external-sessions` | `[UI]` | `import-sessions-dialog`, `GettingStartedCard` |
| 4 | 4234 | `sessions.listProjects` | `rayu:harness:list-sessions`, `rayu:workspace:info` | `[UI][Adp]` | `left-sidebar-projects.test` |
| 5 | 4298 | `sessions.listRecents` | `rayu:harness:list-sessions`, `rayu:storage:get-sessions` | `[UI]` | `left-sidebar-projects.test` |
| 6 | 4327 | `sessions.getGettingStarted` | `rayu:storage:get-preferences` | `[UI]` | `GettingStartedCard` persistence test |
| 7 | 4331 | `sessions.toggleGettingStarted` | `rayu:storage:update-preferences` | `[UI]` | `GettingStartedCard` persistence test |
| 8 | 4347 | `sessions.createSession` | `rayu:harness:create-session` | `[UI][Adp]` | `App.tsx` home submit, `rust-engine-acceptance` |
| 9 | 4472 | `sessions.archive` | `rayu:harness:archive-session` | `[UI]` | `sidebar-projects-pane` archive flow |
| 10 | 4487 | `sessions.restore` | `rayu:harness:restore-session` | `[UI]` | `sidebar-projects-pane` undo archive |
| 11 | 4502 | `sessions.rename` | `rayu:harness:rename-session` | `[UI]` | `sidebar-projects-pane` inline rename |
| 12 | 4524 | `sessions.listPermissionModes` | Static + `harness.getCapabilities` | `[UI]` | `permission-popover` |
| 13 | 4530 | `models.list` | `rayu:daemon:invoke` (`models.list`) | `[UI]` | `model-effort-popover.test`, `settings-sync.test` |
| 14 | 4605 | `models.refresh` | `rayu:harness:runtime-command` (`refresh_model_list` global) | `[UI]` | `model-effort-popover.test` + 4 Rust provider tests |
| 15 | 4622 | `trace.listTurns` | `rayu:harness:get-history` | `[UI][Adp]` | `chat-stream-live.test`, `live-trace-persistence.test` |
| 16 | 4686 | `trace.sendPrompt` | `rayu:harness:send-message` / `rayu:cloud:stream-chat` | `[UI][Adp]` | `composer`, `HomeView`, D5 auth rejection + draft retention |
| 17 | 4865 | `trace.recordTurn` | `rayu:storage:save-sessions` | `[Adp]` | `live-trace-store` persistence |
| 18 | 4911 | `trace.togglePin` | `rayu:storage:save-sessions` | `[UI]` | `turn-actions` pin toggle |
| 19 | 4924 | `trace.forkTurn` | `rayu:harness:fork-session` | `[UI]` | `turn-actions` exact-boundary `upToMessageId` fork (`D16`) |
| 20 | 4945 | `trace.cancel` | `rayu:harness:cancel` | `[UI]` | `composer` stop/abort active turn |
| 21 | 4955 | `trace.softInterrupt` | `rayu:harness:soft-interrupt` | `[UI]` | `multi-session-steer-queue.test` |
| 22 | 4990 | `trace.cancelSoftInterrupts` | `rayu:harness:cancel-soft-interrupts` | `[UI]` | `chat-stream-live.test` queue cancel/edit |
| 23 | 5005 | `trace.respondToPermission` | `rayu:harness:permission-response` | `[UI]` | `chat-stream` per-session permission isolation (`D14`) |
| 24 | 5019 | `inspector.getState` | `rayu:daemon:invoke` (`models.runtimeInfo`, `fileChanges.get`, `todos.get`) + `rayu:extensions:list` | `[UI][Adp]` | `context-panel.test` |
| 25 | 5128 | `inspector.getCodeFile` | `rayu:workspace:read-file` | `[UI][Adp]` | `files-tab-panel`, `code-viewer` |
| 26 | 5155 | `inspector.runTerminalCommand` | `rayu:terminal:run` | `[Tool/Pre]` | Legacy command execution helper tested in `terminal-bridge.test` |
| 27 | 5180 | `workspace.getInfo` | `rayu:workspace:info` | `[UI]` | `composer`, `LeftSidebar`, `workspace-bridge.test` |
| 28 | 5189 | `workspace.pickFolder` | `rayu:workspace:pick-folder` | `[UI]` | `create-project-dialog`, `context-panel`, `composer` |
| 29 | 5194 | `workspace.pickFiles` | `rayu:workspace:pick-files` | `[UI]` | `composer` attachment picker |
| 30 | 5207 | `workspace.captureAppshot` | `rayu:workspace:capture-appshot` | `[UI]` | `composer`, `browser-pane` screenshot |
| 31 | 5212 | `workspace.setPath` | `rayu:workspace:set` | `[UI]` | `sidebar-projects-pane`, `composer` |
| 32 | 5217 | `workspace.ensure` | `rayu:workspace:ensure` | `[UI]` | `create-project-dialog` |
| 33 | 5253 | `workspace.importProjectGroup` | `rayu:workspace:import-project-group` | `[UI]` | `import-sessions-dialog` |
| 34 | 5270 | `workspace.listFiles` | `rayu:workspace:list-files` | `[UI][Adp]` | `composer` `@` mentions, `files-tab-panel`, >250 file test |
| 35 | 5281 | `workspace.listRecent` | `rayu:workspace:list-recent` | `[UI]` | `composer` recent workspace dropdown |
| 36 | 5292 | `workspace.listBranches` | `rayu:git:branches` | `[UI]` | `composer` branch selector |
| 37 | 5309 | `workspace.checkoutBranch` | `rayu:git:checkout` | `[UI]` | `composer` dirty-checkout error test (`D2`) |
| 38 | 5326 | `workspace.createWorktree` | `rayu:git:create-worktree` | `[UI]` | `composer` worktree creation (`D2`) |
| 39 | 5358 | `previews.getState` | `rayu:workspace:info` + store | `[UI][Adp]` | `excel-pane.test`, `browser-pane` |
| 40 | 5361 | `previews.updateExcelCell` | `rayu:office:write-excel` | `[UI][Adp]` | `excel-pane.test`, percent & sheet preservation (`D11`) |
| 41 | 5400 | `previews.sendBrowserQuestion` | Real Rust session / ephemeral side ask (`D17`) | `[UI][Adp]` | `floating-ask-chat` real turn test |
| 42 | 5422 | `swarm.getState` | `GlobalRuntimeCommand(Swarm)` + `capabilities.get` | `[UI][Adp]` | `swarm-view` 0-fake / 0-phantom-session test (`D1`, `D17`) |
| 43 | 5435 | `swarm.spawnWorker` | `GlobalRuntimeCommand(Swarm, ["spawn", ...])` | `[UI][Adp]` | `swarm-launchpad` / capability-gate test |
| 44 | 5524 | `swarm.toggleAgentState` | `GlobalRuntimeCommand(Swarm, ...)` | `[UI][Adp]` | `agent-inspector` capability-gate test |
| 45 | 5538 | `swarm.sendDm` | `GlobalRuntimeCommand(Swarm, ...)` / session | `[UI][Adp]` | `agent-inspector` direct message test |
| 46 | 5562 | `automations.getState` | `GlobalRuntimeCommand(Overnight)` + `GlobalRuntimeCommand(Schedules)` + `capabilities.get` | `[UI][Adp]` | `automations-view.test` (`D1`, `D17`) |
| 47 | 5565 | `automations.launchOvernight` | `GlobalRuntimeCommand(Overnight, ...)` | `[UI][Adp]` | `automations-view.test` |
| 48 | 5608 | `automations.toggleSchedule` | `GlobalRuntimeCommand(Schedules, ...)` / capability gate | `[UI][Adp]` | `automations-view.test` |
| 49 | 5623 | `plugins.getState` | `rayu:extensions:list` | `[UI][Adp]` | `plugins-view.test` |
| 50 | 5724 | `plugins.toggleInstall` | `rayu:storage:get-preferences` / `update-preferences` | `[UI][Adp]` | `plugins-view.test` |
| 51 | 5765 | `plugins.upsertMcp` | `rayu:extensions:upsert-mcp` | `[UI]` | `plugins-view.test`, `storage-bridge.test` (`D3`, `D4`) |
| 52 | 5779 | `plugins.removeMcp` | `rayu:extensions:remove-mcp` | `[UI]` | `storage-bridge.test` (`.mcp.json`, `~/.rayu/mcp.json`, `~/.mcp.json`) |
| 53 | 5789 | `plugins.createSkill` | `rayu:extensions:create-skill` | `[UI]` | `plugins-view` skill creation |
| 54 | 5800 | `plugins.toggleSkill` | `rayu:extensions:toggle-skill` | `[Tool/Pre][UI]` | Wire in `plugins-view` skill switch + `plugins-view.test` (`D19`) |
| 55 | 5814 | `plugins.setFeatured` | `rayu:storage:update-preferences` | `[UI][Adp]` | `plugins-view.test` |
| 56 | 5828 | `changes.getState` | `rayu:git:changes` + `fileChanges.get` | `[UI][Adp]` | `changes-view.test`, `git-bridge.test` (`D2`, >40 files) |
| 57 | 5852 | `changes.acceptFile` | `rayu:file-changes:action` | `[UI][Adp]` | `changes-view.test`, `diff-tab-panel` |
| 58 | 5874 | `changes.rejectFile` | `rayu:file-changes:action`, `rayu:git:discard-file` | `[UI][Adp]` | `git-bridge.test` staged-preserving discard (`D2`) |
| 59 | 5896 | `changes.toggleStage` | `rayu:git:toggle-stage` | `[UI][Adp]` | `changes-view.test` |
| 60 | 5911 | `changes.stageAll` | `rayu:git:stage-all` | `[UI][Adp]` | `changes-view.test` |
| 61 | 5919 | `changes.commitStaged` | `rayu:git:commit` | `[UI][Adp]` | `changes-view.test` |
| 62 | 5926 | `changes.createPullRequest` | `rayu:git:create-pr` | `[Tool/Pre][UI]` | Wire in `changes-view.tsx` PR modal + `changes-view.test` (`D19`) |
| 63 | 5938 | `changes.getCommits` | `rayu:git:commits` | `[UI][Adp]` | `diff-tab-panel`, `changes-view.test` |
| 63a | 6176 | `changes.getFileDiff` | `rayu:git:file-diff` | `[UI][Adp]` | `changes-view`, `wave3-engine-parity.test` lazy diff on deferred (>40) file |
| 64 | 5977 | `telegram.getState` | `rayu:telegram:state` (`GlobalRuntimeCommand`) | `[UI][Adp]` | `telegram-view.test` + `0 phantom chats` (`D1`) |
| 65 | 5987 | `telegram.setMode` | Local mode preference + `rayu:telegram:state` | `[UI][Adp]` | `telegram-view.test` |
| 66 | 5996 | `telegram.startHosted` | `rayu:telegram:start-hosted` | `[UI][Adp]` | `telegram-view.test` |
| 67 | 6024 | `telegram.connectBotToken` | `rayu:telegram:connect-bot-token` | `[UI][Adp]` | `telegram-view.test` |
| 68 | 6054 | `telegram.disconnect` | `rayu:telegram:disconnect` | `[UI][Adp]` | `telegram-view.test` |
| 69 | 6080 | `telegram.resolveApproval` | `rayu:telegram:resolve-approval` | `[UI][Adp]` | `telegram-view.test` |
| 70 | 6105 | `telegram.setRemoteUninstall` | `rayu:telegram:set-remote-uninstall` | `[UI][Adp]` | `telegram-view.test` |
| 71 | 6123 | `telegram.selectSession` | `rayu:telegram:select-session` | `[UI][Adp]` | `telegram-view.test` |
| 72 | 6143 | `telegram.sendTestPing` | `rayu:telegram:ping` | `[UI][Adp]` | `telegram-view.test` |
| 73 | 6168 | `settings.getState` | `rayu:storage:get-preferences` + `rayu:auth:state` + `rayu:daemon:status` + `harness.getConfig` | `[UI][Adp]` | `settings-sync.test`, `settings-view` |
| 74 | 6279 | `settings.updatePreferences` | `rayu:storage:update-preferences` | `[UI][Adp]` | `appearance-panel`, `LeftSidebar`, `AuthWelcomeScreen` |
| 75 | 6292 | `settings.setUseAllCredits` | `rayu:storage:update-preferences` / backend billing | `[UI][Adp]` | `settings-view` account billing toggle |
| 76 | 6306 | `harness.onEvent` | `rayu:harness:event` listener | `[UI]` | `App.tsx`, `chat-stream`, `harness-adapter.test` |
| 77 | 6317 | `harness.recordSyncedModel` | `harness-adapter` store | `[UI]` | `App.tsx:385`, `harness-adapter.test` |
| 78 | 6324 | `harness.recordSyncedEffort` | `harness-adapter` store | `[UI]` | `App.tsx:387`, `harness-adapter.test` |
| 79 | 6333 | `harness.stagePromptEffort` | `harness-adapter` store | `[UI]` | `home-view:158`, `App.tsx:129` |
| 80 | 6342 | `harness.setModel` | `rayu:harness:set-model` | `[UI]` | `composer`, `model-effort-popover.test` |
| 81 | 6357 | `harness.setReasoningEffort` | `rayu:harness:set-effort` | `[UI]` | `composer`, `model-effort-popover.test` |
| 82 | 6374 | `harness.compact` | `rayu:harness:compact` | `[UI]` | `composer` `/compact` |
| 83 | 6383 | `harness.runtimeCommand` | `rayu:harness:runtime-command` (routes global cmds cleanly!) | `[UI]` | `composer`, `settings-view` daemon reload (`D9`) |
| 83a | 6640 | `harness.globalRuntimeCommand` | `rayu:harness:global-runtime-command` | `[UI][Adp]` | `settings-view` `server_reload`, `telegram`, `agents`, 0 phantom chats (`D1`, `D19`) |
| 83b | 6651 | `harness.respondToQuestion` | `rayu:harness:question-response` | `[UI][Adp]` | `chat-stream` live `AskUserQuestion` card (`D15`, `wave3-engine-parity.test`) |
| 84 | 6394 | `harness.getCapabilities` | `rayu:harness:get-capabilities` | `[UI][Adp]` | `composer`, `swarm`, `automations`, `contract-coverage` |
| 85 | 6403 | `harness.getConfig` | `rayu:harness:get-config` | `[UI][Adp]` | `settings-view` Models/Config |
| 86 | 6410 | `harness.patchConfig` | `rayu:harness:patch-config` | `[UI][Adp]` | `settings-view` optimistic revision + conflict error |
| 87 | 6426 | `harness.setPermissionMode` | `rayu:harness:set-permission-mode` | `[UI]` | `App.tsx` awaited submit + `composer` + `permission-popover` |
| 88 | 6446 | `daemon.getStatus` | `rayu:daemon:status` | `[UI]` | `App.tsx:311`, `DaemonBanner`, `settings-view` |
| 89 | 6461 | `daemon.launch` | `rayu:daemon:launch` | `[UI]` | `settings-view:1916` |
| 90 | 6472 | `daemon.onStatusChange` | `rayu:daemon:status-changed` listener | `[UI]` | `App.tsx:316`, `DaemonBanner` |
| 91 | 6489 | `auth.getState` | `rayu:auth:state` | `[UI]` | `App.tsx:294`, `AuthWelcomeScreen` |
| 92 | 6507 | `auth.refresh` | `rayu:auth:refresh` | `[UI]` | `App.tsx:298`, `LeftSidebar:520` |
| 93 | 6527 | `auth.signInWithBrowser` | `rayu:auth:sign-in-browser` | `[UI]` | `AuthWelcomeScreen`, `AuthSignInDialog` |
| 94 | 6546 | `auth.cancelSignIn` | `rayu:auth:cancel-sign-in` | `[UI]` | `AuthWelcomeScreen`, `AuthSignInDialog` |
| 95 | 6562 | `auth.signInWithApiKey` | `rayu:auth:sign-in-apikey` | `[UI]` | `AuthWelcomeScreen`, `AuthSignInDialog` |
| 96 | 6581 | `auth.completeCallback` | `rayu:auth:complete-callback` | `[UI]` | `AuthWelcomeScreen`, `AuthSignInDialog` |
| 97 | 6603 | `auth.signOut` | `rayu:auth:sign-out` | `[UI]` | `LeftSidebar:367`, `settings-view:578`, `AuthSignInDialog` |
| 98 | 6624 | `auth.onAuthChange` | `rayu:auth:changed` listener | `[UI]` | `App.tsx:303` |
| 99 | 6652 | `cloud.streamChat` | `rayu:cloud:stream-chat` | `[Tool/Pre]` | Invoked internally by `trace.sendPrompt` when signed out + cloud fallback |
| 100 | 6700 | `cloud.cancelStream` | `rayu:cloud:cancel-stream` | `[Tool/Pre]` | Invoked internally by `trace.cancel` during cloud stream + `signOut` |
| 101 | 6716 | `native.openInExcel` | `rayu:native:open-excel` | `[UI][Adp]` | `excel-pane`, `native-bridge.test` |
| 102 | 6723 | `native.openInPowerPoint` | `rayu:native:open-powerpoint` | `[UI]` | `slide-pane`, `OpenInPowerPointPayloadSchema` fields intact |
| 103 | 6747 | `native.openInVSCode` | `rayu:native:open-vscode` | `[UI][Adp]` | `files-tab-panel`, `code-viewer`, `changes-view`, `LeftSidebar`, `native-bridge.test` |
| 104 | 6757 | `native.openExternal` | `rayu:native:open-external` | `[UI][Adp]` | `LeftSidebar`, `settings-view`, `plugin-detail`, `native-bridge.test` (`https:`/`http:` allowlist!) |
| 105 | 6767 | `native.revealInFinder` | `rayu:native:reveal-in-finder` | `[UI]` | `sidebar-projects-pane` project menu |
| 106 | 6774 | `native.setKeepAwake` | `rayu:native:keep-awake` | `[UI]` | `TopBar` More actions switch |
| 107 | 6786 | `templates.list` | `rayu:storage:get-templates` | `[UI]` | `composer` template carousel |
| 108 | 6808 | `templates.save` | `rayu:storage:save-template` | `[UI]` | `composer` `TemplateCreatorDialog` |
| 109 | 6859 | `templates.remove` | `rayu:storage:delete-template` | `[UI]` | `composer` template delete |
| 110 | 6881 | `sidebar.getState` | `rayu:storage:get-sidebar-state` | `[UI]` | `sidebar-projects-pane` |
| 111 | 6918 | `sidebar.saveState` | `rayu:storage:save-sidebar-state` | `[UI]` | `sidebar-projects-pane` |
| 112 | 6939 | `sidebar.onStateChange` | `rayu:storage:sidebar-changed` listener | `[UI]` | `sidebar-projects-pane` cross-window sync |
| 113 | 6949 | `terminal.hasLivePty` | Preload bridge presence check | `[UI]` | `terminal-panel` |
| 114 | 6958 | `terminal.ptyCreate` | `rayu:terminal:pty-create` | `[Tool/Pre][UI]` | `xterm-viewport.tsx` live PTY creation |
| 115 | 6970 | `terminal.ptyWrite` | `rayu:terminal:pty-write` | `[UI]` | `xterm-viewport`, `terminal-panel` |
| 116 | 6977 | `terminal.ptyResize` | `rayu:terminal:pty-resize` | `[UI]` | `xterm-viewport` |
| 117 | 6988 | `terminal.ptyKill` | `rayu:terminal:pty-kill` | `[UI]` | `xterm-viewport`, `terminal-panel` (`D12` pgroup reap) |
| 118 | 6995 | `terminal.onPtyData` | `rayu:terminal:pty-data` listener | `[UI]` | `xterm-viewport` UTF-8 decoder test (`D12`) |
| 119 | 7004 | `terminal.onPtyExit` | `rayu:terminal:pty-exit` listener | `[UI]` | `xterm-viewport` generation-safe exit (`D12`) |
| 120 | 7016 | `office.pickExcelFile` | `rayu:office:pick-excel` | `[UI]` | `excel-pane:298` |
| 121 | 7023 | `office.readExcel` | `rayu:office:read-excel` | `[Tool/Pre]` | `office-bridge.test` (`D11` formulas/errors/bounds) |
| 122 | 7030 | `office.writeExcel` | `rayu:office:write-excel` | `[UI]` | `excel-pane:314`, `office-bridge.test` (preserve sheets/percent) |
| 123 | 7045 | `office.createPowerPoint` | `rayu:office:create-pptx` | `[Tool/Pre]` | `office-bridge.test` + Slide export |
| 124 | 7074 | `desktop.onArtifact` | `rayu:desktop:artifact` listener | `[UI]` | `AppShell:76` live artifact preview focus |
| 125 | 7084 | `browser.navigate` | `rayu:browser:cdp-navigate` | `[Tool/Pre]` | `browser-cdp.test` (`localhost` HTTP preserved `D13`) |
| 126 | 7091 | `browser.snapshot` | `rayu:browser:cdp-snapshot` | `[Tool/Pre]` | `browser-cdp.test` |
| 127 | 7105 | `browser.click` | `rayu:browser:cdp-click` | `[Tool/Pre]` | `browser-cdp.test` stale ref recovery (`D13`) |
| 128 | 7112 | `browser.type` | `rayu:browser:cdp-type` | `[Tool/Pre]` | `browser-cdp.test` |
| 129 | 7119 | `browser.screenshot` | `rayu:browser:cdp-screenshot` | `[Tool/Pre]` | `browser-cdp.test` |
| 130 | 7132 | `browser.onEnsureOpen` | `rayu:browser:ensure-open` listener | `[UI]` | `AppShell:102` |
| 131 | 7142 | `fileChanges.get` | `rayu:file-changes:get` | `[UI][Tool/Pre]` | `chat-stream:502`, `changes-api` |
| 132 | 7165 | `fileChanges.diff` | `rayu:file-changes:diff` | `[UI]` | `diff-tab-panel:476` |
| 133 | 7225 | `fileChanges.action` | `rayu:file-changes:action` | `[UI][Adp]` | `changes-api:124`, `diff-tab-panel:521` |
| 134 | 7285 | `todos.get` | `rayu:todos:get` | `[UI][Tool/Pre]` | `chat-stream:528` |
| 135 | 7305 | `agents.getState` | `rayu:agents:state` | `[UI][Adp]` | `agents-view.test` (`0 phantom sessions` `D1`) |
| 136 | 7318 | `agents.setRoleModel` | `rayu:agents:set-role-model` | `[UI][Adp]` | `agents-view.test` |
| 137 | 7354 | `agents.setSubagentModel` | `rayu:agents:set-subagent-model` | `[UI][Adp]` | `agents-view.test` |
| 138 | 7381 | `agents.upsertProfile` | `rayu:agents:upsert-profile` | `[UI][Adp]` | `agents-view.test` (`--` description safety) |
| 139 | 7423 | `agents.deleteProfile` | `rayu:agents:delete-profile` | `[UI][Adp]` | `agents-view.test` |

---

## Section C — All 110 IPC Channels, 8 Push Events, 27 `daemon:invoke` Ops & Desktop SDK Tools

### C.1 All 110 `ipcMain.handle` Channels (`desktop/electron/main.ts` ↔ `preload.cjs`)

| Domain (#) | Channels (`rayu:*`) | Preload & Schema Guard (`ipc-schemas.ts`) | Verification Target |
|---|---|---|---|
| **Daemon (3)** | `rayu:daemon:status`, `rayu:daemon:launch`, `rayu:daemon:invoke` | Sender origin check + Zod payload schema | `daemon-client.test` |
| **Harness (26)** | `rayu:harness:list-sessions`, `rayu:harness:list-external-projects`, `rayu:harness:import-external-sessions`, `rayu:harness:create-session`, `rayu:harness:rename-session`, `rayu:harness:archive-session`, `rayu:harness:restore-session`, `rayu:harness:attach-session`, `rayu:harness:fork-session`, `rayu:harness:get-history`, `rayu:harness:send-message`, `rayu:harness:soft-interrupt`, `rayu:harness:cancel-soft-interrupts`, `rayu:harness:cancel`, `rayu:harness:permission-response`, `rayu:harness:question-response`, `rayu:harness:set-permission-mode`, `rayu:harness:runtime-info`, `rayu:harness:set-model`, `rayu:harness:set-effort`, `rayu:harness:compact`, `rayu:harness:get-capabilities`, `rayu:harness:get-config`, `rayu:harness:patch-config`, `rayu:harness:runtime-command`, `rayu:harness:global-runtime-command` | Attachment 20MB cap (`HarnessSendMessageSchema`), explicit `upToMessageId` fork, non-swallowed errors, `QuestionResponse` (`deny_unknown_fields`), global command isolation | `daemon-client.test`, `rust-engine-acceptance.test`, `wave3-engine-parity.test` |
| **FileChanges + Todos (4)** | `rayu:file-changes:get`, `rayu:file-changes:diff`, `rayu:file-changes:action`, `rayu:todos:get` | Session-scoped change tracking & todo state | `daemon-client.test`, `changes-view.test` |
| **Workspace (10)** | `rayu:workspace:info`, `rayu:workspace:set`, `rayu:workspace:ensure`, `rayu:workspace:import-project-group`, `rayu:workspace:pick-folder`, `rayu:workspace:pick-files`, `rayu:workspace:capture-appshot`, `rayu:workspace:read-file`, `rayu:workspace:list-files`, `rayu:workspace:list-recent` | `realpathSync` symlink containment, binary NUL detection, UTF-8 safe slice, >250 file listing | `workspace-bridge.test` |
| **Storage (9)** | `rayu:storage:get-preferences`, `rayu:storage:update-preferences`, `rayu:storage:get-sessions`, `rayu:storage:save-sessions`, `rayu:storage:get-templates`, `rayu:storage:save-template`, `rayu:storage:delete-template`, `rayu:storage:get-sidebar-state`, `rayu:storage:save-sidebar-state` (**9**!) | Atomic write (`temp + rename`), strict JSON error handling | `storage-bridge.test` |
| **Extensions (5)** | `rayu:extensions:list`, `rayu:extensions:upsert-mcp`, `rayu:extensions:remove-mcp`, `rayu:extensions:create-skill`, `rayu:extensions:toggle-skill` | `D3` partial patch + `revision`, `D4` malformed `.mcp.json` fail-closed, 3-scope removal, global MCP reload | `storage-bridge.test`, `plugins-view.test` |
| **Git (11)** | `rayu:git:changes`, `rayu:git:file-diff`, `rayu:git:toggle-stage`, `rayu:git:stage-all`, `rayu:git:discard-file`, `rayu:git:commit`, `rayu:git:create-pr`, `rayu:git:commits`, `rayu:git:branches`, `rayu:git:checkout`, `rayu:git:create-worktree` | `-z` NUL parser, uncapped count (>40), lazy `file-diff`, literal ` -> ` paths, staged-safe discard, fail on dirty checkout | `git-bridge.test`, `changes-view.test`, `wave3-engine-parity.test` |
| **Terminal (5)** | `rayu:terminal:run`, `rayu:terminal:pty-create`, `rayu:terminal:pty-write`, `rayu:terminal:pty-resize`, `rayu:terminal:pty-kill` | `StringDecoder`, `SIGTERM` + `killpg` + `waitpid` reap, Windows safety | `terminal-bridge.test` |
| **Auth (7)** | `rayu:auth:state`, `rayu:auth:refresh`, `rayu:auth:sign-in-browser`, `rayu:auth:cancel-sign-in`, `rayu:auth:sign-in-apikey`, `rayu:auth:complete-callback`, `rayu:auth:sign-out` | `signOut` aborts `activeStreams` & notifies daemon | `auth-bridge.test` |
| **Cloud (2)** | `rayu:cloud:stream-chat`, `rayu:cloud:cancel-stream` | Tool workspace `realpath` containment + `/bin/sh` safety | `auth-bridge.test` |
| **Native (6)** | `rayu:native:open-excel`, `rayu:native:open-powerpoint`, `rayu:native:open-vscode`, `rayu:native:open-external`, `rayu:native:reveal-in-finder`, `rayu:native:keep-awake` | `http:`/`https:` scheme allowlist (`openExternal`), no fake Excel synthesis, `filePath`/`metrics`/`layout` preserved | `native-bridge.test` |
| **Office (4)** | `rayu:office:pick-excel`, `rayu:office:read-excel`, `rayu:office:write-excel`, `rayu:office:create-pptx` | Load-and-patch preserve sheets/charts/styles, 100× percent fix | `office-bridge.test` |
| **Browser CDP (5)** | `rayu:browser:cdp-navigate`, `rayu:browser:cdp-snapshot`, `rayu:browser:cdp-click`, `rayu:browser:cdp-type`, `rayu:browser:cdp-screenshot` | `http://localhost` preserved, auto debugger detach, stale ref recovery | `browser-cdp.test` |
| **Telegram (8)** | `rayu:telegram:state`, `rayu:telegram:start-hosted`, `rayu:telegram:connect-bot-token`, `rayu:telegram:disconnect`, `rayu:telegram:resolve-approval`, `rayu:telegram:set-remote-uninstall`, `rayu:telegram:select-session`, `rayu:telegram:ping` | Global calls use `GlobalRuntimeCommand` (`0 phantom chats`) | `telegram-bridge.test`, `telegram-view.test` |
| **Agents (5)** | `rayu:agents:state`, `rayu:agents:set-role-model`, `rayu:agents:set-subagent-model`, `rayu:agents:upsert-profile`, `rayu:agents:delete-profile` | Global scope uses `GlobalRuntimeCommand`; `--` flag separator | `agents-bridge.test`, `agents-view.test` |

*(Count check: 3 Daemon + 26 Harness + 3 FileChanges + 1 Todos + 10 Workspace + 9 Storage + 5 Extensions + 11 Git + 5 Terminal + 7 Auth + 2 Cloud + 6 Native + 4 Office + 5 Browser + 8 Telegram + 5 Agents = **110 channels** exact.)*

### C.2 All 8 Push Events (`webContents.send`)
`rayu:daemon:status-changed` · `rayu:harness:event` · `rayu:terminal:pty-data` · `rayu:terminal:pty-exit` · `rayu:auth:changed` · `rayu:storage:sidebar-changed` · `rayu:desktop:artifact` · `rayu:browser:ensure-open`

### C.3 All 27 `rayu:daemon:invoke` Operations (`desktop/electron/daemon-client.ts`)
`sessions.list` · `sessions.create` · `sessions.attach` · `sessions.fork` · `sessions.history` · `sessions.send` · `sessions.softInterrupt` · `sessions.cancelSoftInterrupts` · `sessions.cancel` · `sessions.permission` · `sessions.questionResponse` · `sessions.setPermissionMode` · `sessions.compact` · `models.runtimeInfo` · `models.list` · `models.setModel` · `models.setEffort` · `capabilities.get` · `config.get` · `config.patch` · `runtime.command` · `runtime.globalCommand` · `fileChanges.get` · `fileChanges.diff` · `fileChanges.action` · `todos.get` · `previews.setBrowserBounds`

### C.4 Desktop SDK Tools (9) & Cloud Fallback Tools (4)
- **Registered Desktop SDK Tools (`desktop/electron/desktop-tools.ts:41-256`):** `read_excel`, `write_excel`, `create_powerpoint`, `list_templates`, `save_template`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`.
  - Required fixes verified: fix OpenAI/JSON-schema definitions (`write_excel` `headers.type` & `rows.items`, `save_template` `prompt_spec` in `required`), wire `AbortSignal`, scope template/office paths safely, preserve formulas without `=FORMULA` corruption.
- **Cloud Fallback Tools (`desktop/electron/auth-bridge.ts:326-387`):** `list_files`, `read_file`, `search_files`, `run_command`.

---

## Section D — Complete Rust Protocol & Command Disposition (`58 + 62 + 37 + 28`)

### D.1 All 58 `ApiRequest` Variants (`crates/rayucode-harness-api/src/requests.rs`)
**Legend:** `Used` = already wired end-to-end; `Newly wired` = wired by this plan; `Capability-gated` = gated when daemon lacks support / future panel; `CLI/Host-only` = owned intentionally by CLI/TUI/VS Code rather than Desktop renderer.

| Variant | Disposition | Desktop Consumer / Notes |
|---|---|---|
| `Hello` | `Used` | `RayucodeClient` handshake + `capabilities` |
| `ListSessions` | `Used` | `sessions.list`, `listProjects`, `listRecents` |
| `ListExternalProjects` | `Used` | `import-sessions-dialog` |
| `ImportExternalSessions` | `Used` | `import-sessions-dialog`, `GettingStartedCard` |
| `ArchiveSession` | `Used` | `sessions.archive` |
| `RestoreSession` | `Used` | `sessions.restore` |
| `SetRetentionPolicy` | `CLI/Host-only` | CLI daemon/config retention management |
| `CreateSession` | `Used` | `sessions.createSession` |
| `AttachSession` | `Used` | `DaemonClient.ensureAttached` |
| `ForkSession` | `Newly wired` | Updated with optional `up_to_message_index` / `up_to_message_id` (`D16`) |
| `TransferSession` | `CLI/Host-only` | CLI/remote session transfer |
| `DetachSession` | `Used` | `DaemonClient` multi-session switching / shutdown |
| `SendMessage` | `Used` | `trace.sendPrompt` (D5 pre-Ack auth/provider gate added) |
| `ConfigureTools` | `Used` | `DaemonClient` registers 9 `desktop-tools` |
| `ListTools` | `CLI/Host-only` | Host diagnostics |
| `ToolResult` | `Used` | `DaemonClient` returns desktop tool output to Rust |
| `Cancel` | `Used` | `trace.cancel` |
| `SoftInterrupt` | `Used` | `trace.softInterrupt` (steer/queue) |
| `GetHistory` | `Used` | `trace.listTurns` |
| `PeekSession` | `CLI/Host-only` | Headless/TUI session peek |
| `Clear` | `Used` | Composer `/clear` slash command -> clears active session history |
| `Rewind` | `Used` | Composer `/rewind` slash command (`D16` / `ui_state`) |
| `QuestionResponse` | `Newly wired` | `ClarifyingQuestionCard` -> `ipcClient.trace.respondToQuestion` (`D15`) |
| `PermissionResponse` | `Used` | `ChatStream` approval banner (`D14` per-session keyed) |
| `SetPermissionMode` | `Used` | `App.tsx` awaited submit + `composer` + `permission-popover` |
| `ListModels` | `Used` | `models.list` |
| `GetRuntimeInfo` | `Used` | `models.runtimeInfo`, `inspector.getState` |
| `RuntimeCommand` | `Used` | Session-scoped `RuntimeCommand` execution (+ new `GlobalRuntimeCommand` for session-less globals!) |
| `SetApiKey` | `Newly wired` | Synced alongside `auth-bridge.ts` API key sign-in (`D7`) |
| `ClearApiKey` | `Newly wired` | Synced alongside `auth-bridge.ts` sign-out (`D7`) |
| `NotifyAuthChanged` | `Used` | Triggered after Desktop browser/API-key/sign-out (`D7`) |
| `InvalidateUsage` | `Newly wired` | Triggered after manual `auth.refresh` in `LeftSidebar` / `Settings` |
| `ReadFile` | `CLI/Host-only` | Desktop reads workspace files safely via `workspace-bridge.ts` (future remote-daemon workspace read option) |
| `FindFiles` | `CLI/Host-only` | Desktop lists local workspace files via `workspace-bridge.ts` |
| `SearchText` | `CLI/Host-only` | Covered locally in Desktop workspace/inspector search |
| `FileStatus` | `CLI/Host-only` | Covered via `GetFileChanges` / `git-bridge` |
| `GetFileChanges` | `Used` | `fileChanges.get`, `changes.getState`, `inspector.getState` |
| `GetFileChangeDiff` | `Used` | `fileChanges.diff`, `diff-tab-panel` |
| `FileChangeAction` | `Used` | `fileChanges.action`, `changes.acceptFile`, `changes.rejectFile` |
| `GetTodoState` | `Used` | `todos.get`, `inspector.getState` |
| `AckTodoFollowUp` | `CLI/Host-only` | Engine internal/TUI ambient todo follow-up ack |
| `SetModel` | `Used` | `harness.setModel` |
| `SetContextCap` | `Capability-gated` | Settings/Composer context cap tuning (when supported by active provider) |
| `SetReasoningEffort` | `Used` | `harness.setReasoningEffort` |
| `Compact` | `Used` | `harness.compact` / `/compact` |
| `RenameSession` | `Used` | `sessions.rename` |
| `SetSessionEnv` | `CLI/Host-only` | CLI/VS Code per-session env override |
| `SetSessionSaved` | `CLI/Host-only` | `/save` CLI bookmark |
| `AppletAction` | `CLI/Host-only` | TUI interactive applet action |
| `CloseApplet` | `CLI/Host-only` | TUI interactive applet close |
| `RewindUndo` | `Capability-gated` | Undo rewind checkpoint when exposed in trace actions |
| `CancelSoftInterrupts` | `Used` | `trace.cancelSoftInterrupts` |
| `BackgroundTool` | `CLI/Host-only` | CLI/engine background tool move (`Ctrl+B`) |
| `GetCapabilities` | `Used` | `harness.getCapabilities` |
| `GetConfig` | `Used` | `harness.getConfig` (`settings-view`) |
| `PatchConfig` | `Used` | `harness.patchConfig` (`settings-view`) |
| `Ping` | `Used` | `DaemonClient` health check / `settings-view` Ping Daemon |
| `Unknown` | `CLI/Host-only` | Forward-compatibility wire fallback (`#[serde(other)]`) |

*(Also newly added in Wave 1: `GlobalRuntimeCommand` — `Newly wired` for `D1`, `D8`, `D9`, `D17`.)*

### D.2 All 62 `ApiEvent` Variants (`crates/rayucode-harness-api/src/events.rs`)
| Disposition | Count | Variants |
|---|---:|---|
| **`Used` (handled today)** | 44 | `HelloOk`, `Ok`, `RuntimeCommandResult`, `Error`, `Sessions`, `ExternalProjects`, `ExternalSessionsImported`, `Attached`, `History`, `Capabilities`, `ConfigState`, `Pong`, `TextDelta`, `TextDone`, `TextReplace`, `ReasoningDelta`, `ReasoningDone`, `Tools`, `ToolCall`, `ToolStart`, `ToolInputDelta`, `ToolExec`, `ToolDone`, `FileChangesState`, `FileChangeDiff`, `FileChangeActionResult`, `TokenUsage`, `TurnStopped`, `TurnDone`, `SoftInterruptInjected`, `SoftInterruptsCancelled`, `MessageAccepted`, `PermissionRequest`, `PermissionModeChanged`, `SessionStatus`, `ConnectionPhase`, `ModelInfo`, `Models`, `RuntimeInfo`, `CredentialUpdated`, `TodoState`, `Compacted`, `SessionRenamed`, `SessionRecovery` |
| **`Newly wired`** | 4 | `QuestionRequest` (`D15`), `QuestionClosed` (`D15`), `ConfigChanged` (global reload broadcast `D9`), `SessionForked` (exact boundary payload `D16`) |
| **`Capability-gated` / Telemetry** | 8 | `RayuCredits`, `ContextCapChanged`, `KvCacheMiss`, `BackgroundToolResult`, `WakeRequested`, `BackgroundProgress`, `SidePaneImages`, `SidePanelState` |
| **`CLI/Host-only` (explicit ignore / fallback)** | 6 | `AppletState`, `FileContent`, `Files`, `TextMatches`, `FileStatus`, `Unknown` |

*(44 + 4 + 8 + 6 = **62 variants** exact.)*

### D.3 All 37 `RuntimeCommand` Variants (`crates/rayucode-harness-api/src/runtime_commands.rs`)
| Command (Exact Variant) | Global Scope? | Disposition | Desktop Surface / Oracle |
|---|---|---|---|
| `Skills` | Yes | `Used` | Composer `/skills` & Plugins skill list (`0 phantom sessions`) |
| `Context` | Session | `Used` | Composer `/context` & Inspector Context |
| `Info` | Session | `Used` | Composer `/info` |
| `Cache` | Session | `Used` | Composer `/cache` |
| `Memory` | Yes | `Used` | Composer `/memory` (`0 phantom sessions` when global) |
| `Swarm` | Yes | `Newly wired` | Swarm view (`GlobalRuntimeCommand` `status|list|board`) + composer |
| `Agents` | Yes | `Used` | Agents & Personas view (`GlobalRuntimeCommand` when Global scope; Session when Project) |
| `SubagentModel` | Yes | `Used` | Agents & Personas default subagent model (`GlobalRuntimeCommand` when Global) |
| `Autoreview` | Session | `Used` | Composer `/autoreview` |
| `Autojudge` | Session | `Used` | Composer `/autojudge` |
| `Transport` | Session | `Used` | Composer `/transport` |
| `Fast` | Session | `Used` | Composer `/fast` |
| `Telemetry` | Yes | `CLI/Host-only` | CLI `/telemetry` diagnostics |
| `Subscription` | Yes | `Capability-gated` | Settings Account plan info |
| `Overnight` | Yes | `Newly wired` | Automations Overnight launcher/runs (`GlobalRuntimeCommand`) |
| `Productivity` | Yes | `CLI/Host-only` | CLI stats summary |
| `Initiatives` | Yes | `CLI/Host-only` | CLI initiatives viewer |
| `Premium` | Yes | `CLI/Host-only` | CLI premium status |
| `ProviderTestCoverage` | Yes | `CLI/Host-only` | Internal engineering diagnostic command |
| `RefreshModelList` | Yes | `Newly wired` | `models.refresh` + `/refresh-models` via `GlobalRuntimeCommand` (`D8`) |
| `Continue` | Session | `CLI/Host-only` | CLI session continuation shortcut |
| `ResumeAll` | Yes | `CLI/Host-only` | CLI multi-session resume |
| `Remote` | Session | `CLI/Host-only` | CLI remote tunnel |
| `ServerReload` | Yes | `Newly wired` | Settings Connections "Reload daemon config" via `GlobalRuntimeCommand` (`D9`) |
| `Review` | Session | `Used` | Composer `/review` |
| `Judge` | Session | `Used` | Composer `/judge` |
| `Subagent` | Session | `CLI/Host-only` | TUI subagent inspector |
| `Auth` | Yes | `CLI/Host-only` | CLI interactive auth (Desktop uses `auth.*` IPC + `NotifyAuthChanged`) |
| `Logout` | Yes | `CLI/Host-only` | CLI interactive logout (Desktop uses `auth.signOut`) |
| `Background` | Session | `Used` | Composer `/background` |
| `Mcp` | Yes | `Used` | Extensions MCP reload via `GlobalRuntimeCommand` + Composer `/mcp` (`0 phantom sessions`) |
| `Telegram` | Yes | `Used` | Telegram view state/start/pair/approvals/uninstall/ping via `GlobalRuntimeCommand` (`0 phantom sessions`) |
| `Features` | Yes | `Used` | Composer `/features` + Settings features |
| `Doctor` | Yes | `Used` | Composer `/doctor` + Settings diagnostics |
| `SessionSearch` | Yes | `Used` | Composer `/search` + Sidebar filter |
| `Schedules` | Yes | `Newly wired` | Automations Schedules list/create/toggle/cancel via `GlobalRuntimeCommand` |
| `Ambient` | Yes | `Capability-gated` | Settings/Automations ambient background mode when supported |

### D.4 All 28 Curated Slash Commands (`crates/rayucode-harness-api-server/src/capabilities.rs:30-301`)
`compact` · `effort` · `model` · `clear` · `fork` · `rewind` · `rename` · `save` · `mode` · `review` · `judge` · `context` · `cache` · `info` · `skills` · `memory` · `mcp` · `agents` · `autoreview` · `autojudge` · `background` · `doctor` · `features` · `refresh-models` · `fast` · `transport` · `schedules` · `search`

Every single curated slash command above is indexed in `composer.tsx` from `capabilities.slash_commands`, dispatched via dedicated IPC (`compact`, `model`, `effort`, `mode`, `fork`, `rename`) or `runtimeCommand`/`globalRuntimeCommand` (`context`, `cache`, `info`, `skills`, `memory`, `mcp`, `agents`, `autoreview`, `autojudge`, `background`, `doctor`, `features`, `refresh-models`, `fast`, `transport`, `schedules`, `search`, `review`, `judge`), or legacy control (`clear`, `rewind`, `save`), with verification in `composer-slash-skills.test.tsx` + `contract-coverage.test.ts`.
