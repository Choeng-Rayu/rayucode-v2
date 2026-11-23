# Spec 08 — Remote Access (Telegram Remote Bot + Cloud, SSH & Mobile Gateway)

> **Desktop Reference:** `desktop/src/features/telegram/components/telegram-view.tsx`.
> **Rust Engine Backing:** `src/cli/telegram.rs`, `crates/rayucode-app-core/src/telegram_remote.rs`, `crates/rayucode-app-core/src/server/telegram_bridge.rs`, `src/cli/cloud_*.rs` (26 cloud subcommands), `crates/rayucode-base/src/gateway.rs` (`:7643` WS gateway), `RuntimeCommand::{Telegram, Remote}`.
> **Owned Files (Wave 3F — Part 2):** `vscode/webview/src/features/remote/**`.

---

## 1. Unified Remote Architecture (Zero Rail Clutter)

One top-level Left Rail item (`Remote`, paper-plane `NavGlyph` with live green `.rail-live-dot` when Telegram or Gateway is active) housing 2 focused Radix `Tabs`:
1. **`Telegram Bot`** *(1:1 Desktop `TelegramView`)*
2. **`Cloud, SSH & Gateway`** *(Full Rust Cloud/SSH session handoff + `:7643` WebSocket Mobile Gateway)*

---

## 2. Tab 1 — Telegram Bot (1:1 Desktop `TelegramView`)

### Top Status Card (`rayu-card-bevel rounded-[14px] border border-hairline bg-pane p-4`)
- Live status badge (`Linked · @bot · Rayu account | BotFather` with pulsing green dot, OR `Disconnected`), Rust daemon online/offline indicator, and quick buttons (`[Send Test Ping]`, `[Drive Active Session]`, `[Disconnect]` / `[Reconnect]`).

### 3 Mode Tabs (Radix `Tabs`: `Connected` | `Rayu Shared Bot (QR)` | `@BotFather Token`)
1. **`Connected` Mode:**
   - Displays linked bot handle (`@rayucode_bot`), chat ID, active session binding, and **Live Pending Approvals Queue (`ApprovalRow` — exact Desktop markup)**:
     - Tool badge pill (`bash` amber `bg-warn-soft text-warn` / other hairline) + monospace command or action summary
     - Metadata: `Requested by ... · 12s ago · waiting on host or Telegram`
     - Actions: **`[× Deny]`** (`destructive`) and **`[✓ Approve]`** (`primary`) transitioning cleanly to `Approved via host` / `Denied` badges!
   - Compact Telegram Command Reference cheat sheet (`/sessions`, `/status`, `/cancel`, `/approve`, `/model`, `/new`).
2. **`Rayu Shared Bot (Hosted QR)` Mode:**
   - Renders crisp offline SVG **`PairingQrMatrix`** (`size-[184px] rounded-[14px] border border-premium bg-white p-3`, generated directly from Rust `pairing_url` with zero third-party QR web calls!).
   - Displays copyable deep link + spaced pairing code + live `10:00` TTL countdown + `[Regenerate QR]` button. Automatically transitions to `Connected` once linked!
3. **`@BotFather` Token Mode:**
   - Zod-validated form (`botToken` masked input with `Eye`/`EyeOff` toggle + optional `allowedChatId`).
   - **Security invariant:** Bot token is transmitted straight to Rust `RuntimeCommand::Telegram ["link_botfather", ...]` and **NEVER** written to VS Code settings, `globalState`, or webview storage.

### Remote Uninstall Safety Guardrail Card
- Distinct `border-danger/30 bg-danger-soft/30 rounded-[14px] p-4` card with `ShieldAlert` icon (`text-danger`), concise explanation (*"Allow linked Telegram chat to uninstall this managed Rayu CLI"*), and Radix `Switch` (`OFF` by default) wired to `telegram_remote::uninstall` — enabling requires an explicit confirmation `Dialog`!

---

## 3. Tab 2 — Cloud, SSH & Mobile WebSocket Gateway (`:7643`)

### Section A — WebSocket Mobile Gateway (`RuntimeCommand::Remote`)
- Gateway status card (`Enabled / Disabled`, bind address `bind_addr:port`, `dial_address`, restart-required notice when toggled — never auto-restarts server silently!).
- **`[Generate 5-Min Pairing Invite]`** (`RuntimeCommand::Remote ["pair"]`): renders offline SVG QR + spaced 6-digit code + `dial_address` + `uri` + 5-minute countdown.
- **Paired Devices List:** Device name, ID, `paired_at`, `last_seen`, and **`[Revoke]`** button (`RuntimeCommand::Remote ["revoke", id]`).

### Section B — Cloud & SSH Remote Execution (`rayu cloud` + SSH Transport)
- Displays remote Cloud / SSH sessions & configured environments discovered via the Rust daemon / host CLI bridge.
- Clean action bar for the active local VS Code session:
  - **`[Move Session to Cloud]`** / **`[Return Session Locally]`** (handoff preserving full transcript!)
  - **`[Attach Remote Session]`** / **`[Sync Cloud Environment]`**
  - Clean empty state if user has not configured Cloud/SSH hosts yet, with a single link to `Settings → Account & Providers`.

---

## 4. Compact Sidebar Adaptation (`< 560px`)
- QR matrix card stacks cleanly above pairing code & copy buttons (`flex-col items-center`).
- `ApprovalRow` stacks `[Deny]` `[Approve]` below the command well so nothing clips horizontally.
