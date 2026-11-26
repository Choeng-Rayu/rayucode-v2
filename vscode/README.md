# RayuCode for VS Code

**RayuCode** brings the native Rust AI coding engine and multi-agent mission control directly into Visual Studio Code — right in your **Secondary Sidebar**, **Editor Tab Bar**, context menus, terminal, and Source Control view.

## Key Features

- **Native VS Code Workbench Placement:** Lives in the **Secondary Sidebar** alongside your code, with a one-click **RayuCode Fox** button in the Editor Tab Bar (`Ctrl+Alt+R` / `Cmd+Alt+R`), split-beside editor mode (`Ctrl+Alt+Shift+R` / `Cmd+Alt+Shift+R`), full **Mission Control Panel** (`Ctrl+Shift+R` / `Cmd+Shift+R`), Source Control Git actions, Diagnostic Quick Fixes, and Terminal error debugging.
- **Dual Form-Factor Workspace:** Seamlessly adapts between a compact docked sidebar and a full-width editor tab synchronized over a single Extension Host runtime (`SessionHub`).
- **Mid-Turn Queue & Steer:** Send follow-up prompts while an AI turn is actively streaming — **Steer** delivers a live soft-interrupt directly into the running turn without cancelling progress, or **Queue** messages to run automatically once the current turn finishes.
- **Agents & Personas Studio:** Configure your default subagent model (`/subagent-model`), per-role routing (`Swarm`, `Code Review`, `Acceptance Judge`, `Memory`, `Ambient`) in Global or Session scope, and design reusable specialist `[[agents.profiles]]` personas with model routes, reasoning effort, and delegation briefs synced live with `~/.rayu/config.toml`.
- **Real Telegram Remote Control:** Drive local RayuCode sessions from a private Telegram chat with scannable Hosted QR pairing, custom `@BotFather` bot tokens, live session switching, inline tool approval cards, test ping, and safety guardrails.
- **Swarm Mission Control:** Launch and monitor parallel multi-agent swarms across isolated git worktrees, inspect worker telemetry, steer individual workers via DM, review shared plans, and open worktrees in new VS Code windows.
- **Session-Scoped Background Processes:** Monitor long-running shell commands and background jobs for the active session with live ANSI output streaming, stall alerts, and one-click log opening (`Alt+Shift+B`).
- **Changes & Diff Review:** Review session edits or full Git diffs side-by-side with native `vscode.diff`, safe reverse-patch Keep/Undo, staging, commits, and PR creation.
- **Plugins, MCP & Skills:** Manage 7-layer Model Context Protocol (MCP) servers (with OAuth 2.1), `SKILL.md` skills, Memory Graph, and Automations (Overnight runs, cron schedules, Auto-Review, and Auto-Judge).
- **Signature Theme System:** Warm Graphite Dark & Warm Paper Light (auto-following VS Code polarity), optional **Match VS Code Theme**, High Contrast support, and selectable **Rayu Green** or **Ocean Blue** accents.

## Requirements

RayuCode for VS Code connects to the local **RayuCode Rust CLI (`rayu`)** daemon (`rayu api-bridge`).

1. Install the `rayu` CLI (macOS / Linux):
   ```sh
   curl -fsSL https://rayucode.com/install.sh | sh
   ```
   Or on Windows (PowerShell):
   ```powershell
   irm https://rayucode.com/install.ps1 | iex
   ```
2. Open a **trusted** local workspace folder in VS Code.
3. Click the **RayuCode Fox** icon in the Editor Tab Bar or Secondary Sidebar (or press `Cmd+Alt+R` / `Ctrl+Alt+R`).
4. With **RayuCode › Auto Start Bridge** enabled (default), the extension automatically connects to or starts `rayu --no-update api-bridge`. You can also configure **RayuCode › Binary Path** or **RayuCode › API Socket Path** in VS Code Settings.

## Commands & Keyboard Shortcuts

| Command | Shortcut | Description |
| :--- | :--- | :--- |
| `RayuCode: Open RayuCode` | `Cmd/Ctrl+Alt+R` | Focus RayuCode in your preferred location |
| `RayuCode: Open RayuCode Beside Editor` | `Cmd/Ctrl+Alt+Shift+R` | Open RayuCode split beside the active editor |
| `RayuCode: Open Mission Control Panel` | `Cmd/Ctrl+Shift+R` | Open or reveal the full-width Mission Control tab |
| `RayuCode: Add Selection to RayuCode Context` | `Cmd/Ctrl+Shift+L` | Attach the current editor selection to the composer |
| `RayuCode: Open Background Processes` | `Alt+Shift+B` | Open the active session's Background Process drawer |
| `RayuCode: Open Agents & Personas` | Command Palette | Configure subagent models, role routing, and personas |
| `RayuCode: Open Swarm Mission Control` | Command Palette | Coordinate multi-agent swarms and worktrees |
| `RayuCode: Open Changes & Diff Review` | Command Palette | Inspect session edits and workspace git diffs |
| `RayuCode: Open Remote Access` | Command Palette | Pair Telegram Remote or inspect Gateway access |
| `RayuCode: Open RayuCode Settings` | Command Palette | Configure providers, models, appearance, hooks, and Doctor |
| `RayuCode: Reload Daemon / Restart API Bridge` | Command Palette | Restart the local Rust daemon bridge connection |

## Extension Settings

- `rayucode.openLocation`: Default surface when launching RayuCode (`secondarySidebar`, `beside`, or `editorTab`).
- `rayucode.showEditorTitleIcon`: Toggle the RayuCode Fox icon in the Editor Tab Bar.
- `rayucode.contextActionsAutoSubmit`: Auto-submit contextual code/terminal actions or prefill for review.
- `rayucode.theme` & `rayucode.accent`: Choose `auto`, `dark`, `light`, or `vscode` theme and `green` or `blue` accent.
- `rayucode.defaultPermissionMode`: Choose `default`, `acceptEdits`, `plan`, `fullManage`, or `orchestrator`.
- `rayucode.binaryPath`, `rayucode.apiSocketPath`, `rayucode.autoStartBridge`: Configure local Rust engine discovery and auto-start.

## Links & Support

- **Website:** [https://rayucode.com](https://rayucode.com)
- **Source Repository:** [https://github.com/Choeng-Rayu/rayucode-v2](https://github.com/Choeng-Rayu/rayucode-v2)
- **Issues & Feedback:** [https://github.com/Choeng-Rayu/rayucode-v2/issues](https://github.com/Choeng-Rayu/rayucode-v2/issues)
