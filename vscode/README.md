# RayuCode for VS Code

**RayuCode for VS Code** is a calm, high-performance dual-form-factor coding workspace powered directly by the 93-crate `rayucode-v2` Rust engine (`rayu serve` + `rayu api-bridge`, Harness API `v1.14`) with a React 19 + Tailwind CSS v4 + Radix UI + Vite 6 webview.

## Highlights

- **Dual Form Factor (`@container/app`):** Works seamlessly as both a **Compact Docked Sidebar** (`rayucode.chat`) and a **Full Editor Mission-Control Panel** (`rayucode.workspace`, `Cmd/Ctrl+Shift+R`), synchronized through a single Extension Host connection (`SessionHub`) with one-click pop-out.
- **Auto-Spawn Bridge Manager:** Automatically discovers `rayu` (`rayucode.binaryPath`, `RAYU_BINARY`, `~/.local/bin/rayu`, `~/.rayu/builds/current/rayu`, `PATH`), attaches to an active `rayu-api.sock`, or performs lockfile-guarded auto-spawn (`rayu --no-update api-bridge`) with exponential backoff reconnect and status bar telemetry.
- **Signature Theme System:** Warm Graphite Dark & Warm Paper Light (auto-following VS Code polarity via `MutationObserver`), optional **Match VS Code Theme**, High Contrast support, and user-selectable **Rayu Green** or **Ocean Blue** accents synced across all surfaces.
- **Quiet 3-Depth Execution Trace & 45 Rust Tools:** Auto-coalesced file reads, `ShellCard` with `Alt+B` background handoff, inline diff cards with native `vscode.diff` beside, two-stage `command-risk` approval cards, clarifying question cards, Shiki syntax highlighting, and clickable `.cite-link` file:line navigation.
- **First-Class Background Process Viewer:** Zero noise when idle; 30px `BackgroundDockBar`, resizable `BackgroundProcessDrawer` (`Alt+Shift+B`), Stall Watchdog alerts, bounded live ANSI output tail, and one-click `Open Output File in VS Code`.
- **Swarm Mission Control:** Multi-swarm switcher, launch presets, live telemetry & file-conflict jump, inline worker spawner, `AgentRoster` + `AgentInspector`, direct worker DM steering, versioned Shared Plan approvals, and isolated git worktrees (`Open in New VS Code Window`).
- **Automations:** Unattended Overnight runs & Morning Handoff reports (native Markdown Preview), recurring cron Schedules, Ambient autonomous cycle approvals, and Quality Gates (`Auto-Review`, `Auto-Judge`, `/review`, `/judge`, Productivity reports).
- **Plugins, 7-Layer MCP, Skills & Memory Graph:** 7-layer MCP discovery with OAuth 2.1, shared process pool & schema cache, `SKILL.md` authoring/execution, Jev + Semantic Memory Graph explorer, and Workspace integrations (Gmail, Calendar, Browser, Companion).
- **Changes Review & PR Guardrail:** Flat changed-files review (`Session Edits` vs `All Git Changes`), safe reverse-patch Keep/Undo, native `vscode.diff`, inline commit, and explicit `Create PR` confirmation dialog.
- **Remote Access & Full Settings:** Unified Telegram Bot (QR pairing, `@BotFather`, live approvals, uninstall guardrail) + Cloud/SSH/WebSocket Gateway, plus 7-section Settings covering Rayu Cloud account, 10 native + 45 OpenAI-compatible providers, reasoning effort & service tiers, all 11 `[features]`, 7 lifecycle hooks, and Engine/Auth Doctor.

## Quick Start & VSIX Installation

1. Install the RayuCode v2 Rust CLI (`rayu`) and ensure it is on `PATH` (or configure **RayuCode › Binary Path**).
2. Install the packaged VSIX via **Extensions → Install from VSIX...** or the CLI:

   ```sh
   code --install-extension vscode/dist/rayucode-vscode-preview.vsix
   ```

3. Open a **trusted** local workspace folder and click **RayuCode** in the Activity Bar (or press `Cmd+Shift+R` / `Ctrl+Shift+R` to open the Full Editor Mission-Control Panel).
4. With **RayuCode › Auto Start Bridge** enabled (default), the extension automatically connects to or spawns `rayu --no-update api-bridge`. You can also run `rayu --no-update api-bridge` manually or configure **RayuCode › API Socket Path**.

## Key Commands & Shortcuts

| Command | Shortcut | Description |
| :--- | :--- | :--- |
| `RayuCode: Open Mission Control Panel` | `Cmd/Ctrl+Shift+R` | Open or reveal the full-width editor tab |
| `RayuCode: Send Selection to RayuCode` | `Cmd/Ctrl+Shift+L` | Attach active editor selection to the composer |
| `RayuCode: Open Background Processes` | `Alt+Shift+B` | Open the Background Process Viewer drawer |
| `RayuCode: New Session` | Command Palette / Sidebar | Start a fresh session on the Home screen |
| `RayuCode: Open Swarm Mission Control` | Command Palette | Jump straight to Swarm Mission Control |
| `RayuCode: Open Changes & Diff Review` | Command Palette | Inspect session edits and workspace git diffs |
| `RayuCode: Open RayuCode Settings` | Command Palette | Configure providers, appearance, hooks, and Doctor |
| `RayuCode: Reload Daemon / Restart API Bridge` | Command Palette | Restart the local Rust bridge connection |

## Build & Package From Source

Requires Node.js 22+ from the repository root:

```sh
npm ci
npm run check:ts
npm run typecheck --workspace @rayu-dev/rayucode-vscode
npm run lint:design --workspace @rayu-dev/rayucode-vscode
npm test --workspace @rayu-dev/rayucode-vscode
npm run package:vscode
```

The packaged extension is written to `vscode/dist/rayucode-vscode-preview.vsix`. To launch an Extension Development Host directly from the staged build:

```sh
code --extensionDevelopmentPath="$PWD/vscode/dist/extension" /path/to/workspace
```

To iterate on the React 19 webview in a browser with the built-in mock VS Code bridge:

```sh
npm run dev:webview --workspace @rayu-dev/rayucode-vscode
```

See [vscode/VSCODE_DESIGN.md](./VSCODE_DESIGN.md), [vscode/docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), and [docs/PRODUCT_VSCODE_DEV.md](../docs/PRODUCT_VSCODE_DEV.md) for the full design contract, architecture, and developer workflow.
