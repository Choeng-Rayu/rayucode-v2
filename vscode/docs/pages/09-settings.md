# Spec 09 — Settings (Full-Page Shell Covering All Rust Engine Configuration)

> **Desktop Reference:** `desktop/src/features/settings/components/settings-view.tsx`, `desktop/src/features/settings/components/appearance-panel.tsx`.
> **Rust Engine Backing:** `RuntimeCommand::{Auth, Logout, Subscription, Agents, Fast, Cache, Transport, Telemetry, Features, Doctor, ServerReload}`, `set_api_key`, `clear_api_key`, `notify_auth_changed`, `rayucode-provider-metadata` (10 native + 45 OpenAI-compatible profiles + Azure + Google), `rayucode-config-types` (all 11 `[features]`), `rayucode-base/src/hooks.rs` (7 lifecycle hooks), `rayucode-voice`, `rayucode-provider-doctor`.
> **Owned Files (Wave 3F — Part 3):** `vscode/webview/src/features/settings/**`.

---

## 1. Shell Geometry — Desktop Parity + Compact Sidebar Adaptation

- **Wide Editor Panel (`>= 960px`):** Full-page `bg-chrome` layout with collapsible `w-[248px]` left Settings rail (exact Desktop `SettingsView`):
  - Top bar: `[← Back to workspace]` + `[Collapse sidebar]` + live search input (`Filter settings...`)
  - 3 grouped navigation categories (`Account`, `App`, `System`):
    - **Account:** `Account & Providers`
    - **App:** `Appearance`, `Models & Agents`, `Features & Voice`
    - **System:** `Safety & Hooks`, `Runtime, Bridge & Doctor`, `Shortcuts`
  - Scrollable content canvas (`bg-canvas rounded-tl-[14px] border-t border-l border-hairline px-8 py-6 max-w-[820px]`).
- **Compact Sidebar (`< 560px`):** Top bar (`[← Back]` + `Settings` + compact search) + horizontal scrollable category pill strip + single-column cards (`px-3.5 py-4`).

---

## 2. Detailed Section-by-Section Specifications

### Section 1 — Account & Providers (`Account` Group)
1. **Rayu Cloud Account & Usage Card (Exact Desktop Parity):**
   - Signed-in profile header (avatar/initials, display name, email, plan pill, `[Refresh]`, `[Sign out]` with safe confirmation).
   - Two sub-tabs (`Overview` | `Usage Analytics`):
     - **Overview:** `5-hour limit`, `Weekly limit`, `Monthly allowance` hairline progress bars (`tabular-nums` % left + reset countdowns), `Credits` + `Top-up balance`, **`Use all credits`** bypass switch (`bypass pacing windows`), and expandable **`Plan Ladder`** (`Free`, `Pro`, `Plus`, `Max`, `Team`, `Team Plus`, `Team Max`).
     - **Usage Analytics:** `7d / 30d` range + `Feature / Model` group selector, 6-category breakdown legend (`ANALYTICS_LEGEND` CSS vars), and `Top Sessions` credit table.
2. **All Providers & Multi-Account Readiness Table (10 Native + 45 OpenAI-Compatible + Azure + Google):**
   - Live readout from `RuntimeCommand::Auth` + `get_runtime_info`:
   - Filterable tabs: **`Native (10)`** (Rayu, Anthropic/Claude, OpenAI, Gemini, OpenRouter, GitHub Copilot, AWS Bedrock, Antigravity, Cursor, Grok Build) | **`OpenAI-Compatible (45)`** (searchable: DeepSeek, Groq, Mistral, Perplexity, Together, Fireworks, xAI, Cerebras, Moonshot/Kimi, MiniMax, Z.AI, Hugging Face, NVIDIA NIM, Ollama, LM Studio, Meta/Muse, etc.) | **`Enterprise & Workspace`** (Azure OpenAI, Google Workspace).
   - Per provider row: status badge (`Ready` / `Needs key` / `Expired` / `Env key`), credential source (`OAuth` / `API Key` / `Env`), active multi-account label if applicable, inline **`[Set API Key]`** (`set_api_key`), **`[Clear]`** (`clear_api_key`), and confirmed **`[Logout]`** (`RuntimeCommand::Logout <id> confirm`).

### Section 2 — Appearance (`App` Group — Direct Port of `AppearancePanel`)
- **Theme Mode Cards (4 visual preview swatches built with pure semantic tokens):**
  1. **Auto (Follow VS Code)** *(Default)* — Warm Graphite Dark when VS Code is dark, Warm Paper Light when VS Code is light.
  2. **Warm Graphite Dark** — Always Rayu Dark (`#11110E` / `#0C0C0A`).
  3. **Warm Paper Light** — Always Rayu Light (`#F7F7F4` / `#FFFFFF`).
  4. **Match VS Code Theme** — Inherits `--vscode-*` editor/sidebar variables directly.
- **Accent Swatches:** **Rayu Green** (default) | **Ocean Blue** — updates Sidebar, Full Editor Panel, and Status Bar instantaneously via VS Code `globalState`.
- **Density & Motion:** `Comfortable / Compact` row density + `Reduce Motion` override.

### Section 3 — Models & Agents (`App` Group)
- **Defaults & Performance:** Default Session Model picker, Default Reasoning Effort (`Auto`/`Low`/`Medium`/`High`/`Max`), **`Fast / Service Tier`** (`auto` / `priority` / `ultrafast` / `flex` via `RuntimeCommand::Fast`), and **`Anthropic KV-Cache TTL`** (`5m` / `1h` via `RuntimeCommand::Cache`).
- **Per-Role Agent Model Overrides (`RuntimeCommand::Agents`):**
  - Scope toggle (`This Session` | `Global Default`)
  - Clean 5-row override matrix: **`Swarm Workers`**, **`Code Review`**, **`Acceptance Judge`**, **`Memory Extraction`**, **`Ambient Cycles`** — each selectable to `inherit`, `default`, or any live discovered model!
- **Swarm Strict Allowlist Indicator:** Displays read-only notice if `agents.swarm_model_allowlist` is configured in `config.toml`.

### Section 4 — Features & Voice (`App` Group)
- **All 11 Runtime `[features]` Config Toggles (`RuntimeCommand::Features`):**
  - Clean grouped Radix `Switch` list: `memory`, `swarm`, `mermaid`, `auto_poke`, `todo_gate_digest`, `todo_gate_diagnostics`, `message_timestamps`, `persist_memory_injections`, `kv_cache_miss_notices`, `check_updates`, plus **`Update Channel`** `Select` (`stable` | `preview` | `main`).
- **Opt-In Engine Tool Gates:**
  - `Codemode (QuickJS Sandbox)` (`[tools] codemode`)
  - `Integration Tools Catalog` (`[sponsors] enabled`)
- **Streaming Voice Dictation (`rayucode-voice`):**
  - Runtime capability check, Microphone selector, Push-to-Talk hotkey hint, `Noise Suppression` & `Auto-send on silence` switches.

### Section 5 — Safety & Hooks (`System` Group)
- **Default Permission Mode:** `Ask`, `Auto-edit`, `Plan`, `Full Manage`, `Orchestrator`.
- **Two-Stage Command-Risk Gate Policy:** Quiet summary explaining `Safe` / `Bounded` / `Confirm` / `Hard-Deny` (`rayucode-command-risk`) protection for home/root/credentials.
- **All 7 Lifecycle Hooks Inventory (`crates/rayucode-base/src/hooks.rs`):**
  - Shows status (`Configured` / `Unset`) for `pre_tool` (sync gate), `post_tool` (async), `post_tool_feedback` (sync feedback), `turn_start`, `turn_end`, `session_start`, `session_end`, with **`[Open Hooks Config in VS Code]`** button.

### Section 6 — Runtime, Bridge & Doctor (`System` Group)
- **Live Bridge & Daemon Card:** Status dot, latency (`ms` via `Ping`), daemon/bridge version, negotiated Harness protocol (`v1.14`) + capability pills (`permissions`, `background_tasks`, `swarm_control`, `session_tools`, `user_questions`, `runtime_commands`, etc.).
- **Connection Settings (synced with VS Code Settings):** `rayucode.runtime.socketPath`, `rayucode.runtime.binaryPath`, `rayucode.runtime.autoStart` switch, `Provider Transport` (`auto` | `https` | `websocket` via `RuntimeCommand::Transport`), **`[Ping]`**, **`[Reconnect]`**, **`[Reload Daemon]`** (`ServerReload`), **`[Open Output Log]`**.
- **Diagnostics (`Doctor`):**
  - **`[Run Provider Doctor]`** & **`[Run Auth Doctor]`** (`RuntimeCommand::Doctor`) rendering clean structured pass/warn/fail diagnostic rows right inside Settings!
- **Contextual Self-Dev Card:** Shown ONLY when the open workspace is a RayuCode source checkout (`selfdev` / `desktop_selfdev` status + build/reload controls).
- **Privacy & Telemetry (`RuntimeCommand::Telemetry`):** 6 individual category switches (`content`, `usage`, `crashes`, `features`, `cost`, `accounts`) + `All` / `None` quick buttons (respects env opt-out lock).
- **Send Maintainer Feedback (`maintainer_feedback`):** Quiet modal for bug/suggestion/usability reports.

### Section 7 — Shortcuts (`System` Group)
- Clean 2-column keybinding table (`Shift+Tab` cycle permissions, `⇧⌘S` toggle session pane, `Alt+B` background running tool, `⌘J` VS Code terminal, `⌘K` search sessions, `⌘[`/`⌘]` nav history, `⌘1` restore clipped chat, `⌘↵` send / `Esc` stop) + **`[Customize in VS Code Keyboard Shortcuts]`** (`workbench.action.openGlobalKeybindings`).
