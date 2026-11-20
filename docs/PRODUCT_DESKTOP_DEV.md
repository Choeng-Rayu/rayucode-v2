# Product 2: Desktop App Developer Guide (Rust + Slint)

The RayuCode Desktop App lives in a dedicated sibling Rust repository (`../rayucode-desktop`) and pairs a **Slint** native UI with **`rayucode-sdk`** (`crates/rayucode-sdk`) so all agent turns, sessions, Rayu credits, and OS logins run natively in Rust on Linux, macOS, and Windows.

---

## Tech Stack & Reusable Crates

| Layer | Crate / Technology | Role | Source |
|---|---|---|---|
| **Desktop UI** | **Slint** (`slint` + `.slint` declarative views) | Native GPU-accelerated layout, transcript list, model picker, login sheet | `../rayucode-desktop/ui/*.slint` |
| **Desktop Controller** | `rayucode-desktop-slint` | Maps `RayucodeClient` / `AuthClient` async events into `slint::VecModel` via `slint::invoke_from_event_loop` | `../rayucode-desktop` |
| **Harness Bridge & Models** | Framework-free crates from `/home/rayu/rayu/jcode-desktop` | `desktop-harness` (sessions, remote targets, accounts), `desktop-model` (diff engine, PDF render, learning), `desktop-api`, `desktop-updater` | Reusable from `../jcode-desktop/crates/{jcode-desktop-harness,jcode-desktop-model,jcode-desktop-api,jcode-desktop-updater}` |
| **Agent & Auth SDK** | `rayucode-sdk` (`path = "../rayucode-v2/crates/rayucode-sdk"`) | `RayucodeClient`, `AuthClient`, SSH transport, `ResponseStats`, `rayu_credits` | [`crates/rayucode-sdk`](../crates/rayucode-sdk) |

> **Note on `../jcode-desktop`:** Inspection of `../jcode-desktop` shows its harness, model, updater, and API crates have **zero UI-framework dependency** and already connect to the SDK (`RayucodeClient`). Only its `*-ui` / `*-ui-core` crates depend on GPUI — so **Slint** replaces the GPUI view layer cleanly while reusing the battle-tested harness/model Rust logic!

---

## Connecting `rayucode-desktop` to `rayucode-v2`

In `../rayucode-desktop/Cargo.toml`:

```toml
[dependencies]
slint = "1"
rayucode-sdk = { path = "../rayucode-v2/crates/rayucode-sdk" }
rayucode-harness-api = { path = "../rayucode-v2/crates/rayucode-harness-api" }
```

Ensure `rayu` and `rayucode-harness-api-bridge` are installed from `rayucode-v2`:

```bash
cd /home/rayu/rayu/rayucode-v2
umask 022 && CARGO_NET_OFFLINE=true bash scripts/install_release.sh --fast
```

`RayucodeClient::connect(ConnectOptions::default())` connects to the shared daemon bridge (`~/.rayu/rayu-api.sock` or `XDG_RUNTIME_DIR/rayu-api.sock`), or `launch_instance(...)` starts an isolated app-owned daemon when running in embedded mode.

---

## Core SDK Integration Patterns for Slint

### 1. Streaming Session Events & Rayu Credits into Slint

```rust
use rayucode_sdk::{
    ApiEvent, ConnectOptions, RayuCreditsAccumulator, RayucodeClient,
    rayu_credits_label, rayu_credits_tooltip,
};

let client = RayucodeClient::connect(ConnectOptions::default())?;
let events = client.events(None); // Broadcast stream across open panels

std::thread::spawn(move || {
    let mut credits = RayuCreditsAccumulator::new();
    while let Some(event) = events.next() {
        match event {
            ApiEvent::TextDelta { session_id, text, .. } => {
                // Marshal onto Slint UI thread:
                // slint::invoke_from_event_loop(move || { ... });
            }
            ApiEvent::RayuCredits { session_id, turn_credits, .. } => {
                credits.sync_turn_total(turn_credits);
                let label = credits.formatted_label(true); // "Credits so far: ..."
                let tooltip = rayu_credits_tooltip(turn_credits);
                // Update Slint footer property for session_id
            }
            ApiEvent::TurnDone { session_id, .. } => {
                if let Some(total) = credits.total_credits() {
                    let final_label = rayu_credits_label(total, false); // "Credits: ..."
                }
                credits.reset();
            }
            _ => {}
        }
    }
});
```

### 2. Model Selector (Preserving Rayu-First Gateway Order)

Call `client.get_runtime_info(&session_id)` to populate the Slint `ModelPicker` model:
- `runtime.routes: Vec<ModelRouteInfo>` already orders configured **Rayu Auth / `RAYU_API_KEY`** models at the top in exact live gateway `display_order`.
- **Do not re-sort `runtime.routes` alphabetically** in Slint/Rust UI state.
- Call `client.set_model(&session_id, &route.model)` when the user selects a route.

### 3. Native Desktop Login (`AuthClient`)

Follow the full native login contract in [`DESKTOP_AUTH_SDK.md`](./DESKTOP_AUTH_SDK.md):
- Intercept `/login` before `send_message`.
- Populate providers with `AuthClient::providers()` and match selections using `resolve_provider()`.
- For `LoginMethod::ApiKey`, submit via `RayucodeClient::set_api_key(&provider.id, &key)` and immediately zero/clear the Slint `TextInput` buffer.
- For Rayu / OAuth / device flows, run `flow.start()`, `flow.wait_for_callback()`, and `flow.cancel()` on background threads and open `prompt.auth_url` with `rayucode-desktop-open` (never print raw URLs or secrets to chat).

---

## Development & Verification Checklist

1. Keep non-UI business logic (session store, diff parsing, credit accumulation, remote SSH managers) in Slint-free crates so tests run in ~1 second without opening GUI windows:
   ```bash
   cargo test --offline -p rayucode-desktop-harness
   cargo test --offline -p rayucode-desktop-model
   ```
2. Keep Slint `.slint` components focused on presentation bound to lightweight properties and `VecModel` rows.
3. Verify parity with CLI: open the same workspace session in both `rayu` and Desktop — messages, `/model` ordering, tool approvals, and `Credits: X.XX` footers should match identically.
