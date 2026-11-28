# Changelog

## 3.0.3

### Added

- **Container-Responsive Layout Across All VS Code Pane Widths (`240px`–`1440px`):** Rebuilt Chat, Shell, TopBar, Composer, Settings, Agents & Personas, Swarm Mission Control, Plugins/MCP/Skills/Memory, Automations, Remote Access, and Background Processes around local CSS container queries (`@container`), viewport-bounded popovers/drawers, and progressive compact controls so every view fits cleanly from narrow Sidebars to full Editor Panels with zero horizontal overflow.
- **Unified File-Review Conflict Handling & Force Restore:** Shared mutation pipeline between inline diff cards and turn file summaries with per-file conflict detection, explicit confirmation for Force Restore, and automatic snapshot refresh after partial or uncertain results.

### Changed

- **AI Response Typography Parity:** Matched AI text responses (`agent-answer`, intermediate `work-note` prose, and Markdown paragraphs/lists/blockquotes/tables) to the user message font size (`14px`, `1.6` line height) while keeping thinking/reasoning and tool usage rows at their distinct compact sizes.
- **Settings Navigation Density:** Collapsed the Settings side rail below `760px` container width to prevent double-sidebar crowding alongside the workspace rail, with automatic active-tab scroll alignment in the compact strip.

### Fixed

- **File & Config Safety:** Required a Rust `file_changes` snapshot for agent Keep/Undo/Redo (removing the unsafe Git `HEAD` fallback that could revert manual or untracked edits), merged MCP config edits atomically while preserving unrelated fields and secrets, rejected malformed MCP JSON, and created skill files exclusively without overwriting existing files.
- **Strict Session Binding:** Bound queued messages, mid-turn drains, cancellations, permissions, citations, previews, and terminal actions to their originating session and workspace so switching focus never cross-routes actions.
- **Truthful UI Receipts & Live Model Catalog Sync:** Standardized mutation receipts (`requireOperation`) across Swarm, Automations, Settings, and Feedback to eliminate false-success updates, surfaced negotiated protocol version and capabilities truthfully, verified Changes commands route to native VS Code Source Control, and synchronized open Composer, Settings, and Agents model pickers with live catalog invalidation and explicit cache-bypassing refresh.

## 3.0.2

### Added

- **Zero-Setup Cross-Platform Engine Auto-Download & Auto-Update:** Single universal `.vsix` automatically downloads, SHA-256 verifies, and installs the matching `rayu` Rust binary (`linux` x64/arm64, `darwin` arm64/x64, `win32` x64/arm64) into versioned extension storage on VS Code startup (`onStartupFinished`), even before opening the RayuCode sidebar or editor panel.
- **Automatic Engine Release Updates:** Checks GitHub Releases on startup, immediately on VS Code Marketplace extension updates, and every 4 hours (`rayucode.autoUpdateEngine`), safely staging new versions alongside the running binary and restarting cleanly when idle.
- **Live Download & Install Progress UI:** Displays `"please wait"` status messages, MB progress, and percentage progress bars across VS Code Notifications, the Status Bar, `AuthWelcomeScreen`, `DaemonBanner`, and `RuntimeDoctorSection`, alongside a one-click **Install / Update Rayu Engine** command (`rayucode.updateEngine`).

### Fixed

- Enabled `rayu api-bridge` across Windows named pipes (`Cargo.toml`, `src/cli/*`), allowing fresh Windows installs to connect without Unix-only restrictions.
- Honored `RAYU_DEFERRED_AUTH_BOOTSTRAP=1` inside `Command::ApiBridge` so fresh unsigned-in computers can launch the bridge and complete onboarding in VS Code.
- Captured `api-bridge` startup stderr logs, added `windowsHide: true`, automatically upgraded legacy CLI binaries lacking `api-bridge`, and added a fatal-error cooldown to eliminate infinite `"Connecting to Rayu daemon..."` UI flicker.

## 3.0.1

### Changed

- Slim webview shell, inspector/changes panel cleanup, and Harness API v1.16 protocol sync.

## 3.0.0

### Added

- **Native Rust Engine Architecture (`rayu api-bridge`, Harness API v1.14):** Rebuilt the VS Code extension host and React 19 + Tailwind CSS v4 webview to connect directly to the `rayucode-v2` Rust daemon with auto-discovery and lockfile-guarded auto-start.
- **Dual Form-Factor Workbench Placement:** Dedicated Secondary Sidebar container (`rayucode.chat`), live RayuCode Fox button in the Editor Tab Bar, full Mission Control editor panel (`rayucode.workspace`), Explorer/Editor/Terminal/SCM context menus, and Diagnostic Quick Fixes.
- **Agents & Personas Studio (`rayucode.openAgents`):** Dedicated page to configure the default subagent model (`/subagent-model`), per-role model/persona routing (`swarm`, `review`, `judge`, `memory`, `ambient`) in Global or Session scope, and full `[[agents.profiles]]` CRUD with live `~/.rayu/config.toml` preview.
- **Real Telegram Remote Control:** Backed end-to-end by the Rust daemon with scannable ISO QR pairing for Rayu Hosted Bot, custom `@BotFather` token verification (direct chat link or 10-minute QR pairing), live session switcher, test ping, real-time pending tool approvals, and remote `/uninstall` guardrail.
- **Mid-Turn Queue & Steer:** Send messages while the assistant is streaming using live **Steer** (soft-interrupt without cancelling the turn) or **Queue** (auto-dispatch on turn completion).
- **Session-Scoped Background Processes, Swarm Mission Control, Automations, Plugins/MCP/Skills & Changes Review:** Full visual mission control synced with the local Rust engine and native VS Code diffs/terminals.

### Fixed

- Unified provider authentication and live model catalog discovery so authenticated providers immediately expose their models in the composer picker and settings.
- Scoped the Background Processes viewer strictly to the active chat session.
- Hardened external link and Simple Browser URI handling to strictly allow safe HTTP/HTTPS/mailto schemes.
- Replaced placeholder daemon version/latency/PID fallbacks in Runtime Doctor with truthful live status telemetry.

## 2.4.1

### Added

- A Settings tab (gear in the sidebar title bar, the Command Palette, or the Accounts
  menu) with General, Account, Integrations and About sections.
- Account details in the editor: profile, plan, credits, usage limits, this month's
  feature usage, and device management.
- A Rayu entry in VS Code's Accounts menu, and a credits status-bar item.
- Integrations: connect Telegram (shared bot by QR, or your own bot token), turn on
  Studio Remote or pair it with a QR code, and install Rayu's GitHub Actions workflows.
- Platform VSIX packages with a compiled engine and bundled ripgrep.
- A memory watchdog: an engine that reaches its limit is replaced, and the next message
  continues the same conversation.

### Changed

- The engine now starts in the permission mode you chose, so a
  `permissions.defaultMode` written for the terminal no longer overrides it.
- The Telegram connect panel moved from the chat into Settings → Integrations.
- Signing out of Rayucode clears the same caches as the CLI's `/logout` and keeps a
  configured API key.
- Icons are now VS Code codicons, and the panel's corner radii/focus/high-contrast
  styling follow the editor.
- Plan mode runs without asking, as Full Manage does, but never changes your code. It
  refuses file edits outside the plan file and commands that change files, git state
  or dependencies, and asks the model to write the change into the plan instead.
- A Telegram link made while a reply is running now attaches that conversation when the
  reply ends. Before, it waited until the engine next restarted.

### Fixed

- A crashed engine's replacement resumes the same conversation instead of starting over.
- Plan mode no longer lets edits through. Rayucode always starts its engine with
  bypass permissions available, and plan mode used to inherit them.

## 1.6.23

- Initial release of Rayucode Visual Studio Code extension.
- Native sidebar panel with streaming chat transcript and permission controls.
- Interactive file change review card for keeping/undoing modifications with editor diffs.
- Slash-command autocomplete and workspace file @-mention popover.
- Context window usage metrics in panel header.
- Model Context Protocol (MCP) server status reporting.
- Shared authentication with the Rayu CLI.
