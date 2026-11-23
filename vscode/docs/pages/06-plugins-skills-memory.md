# Spec 06 — Plugins, MCP Connectors, Skills, Memory Graph & Workspace Integrations

> **Desktop Reference:** `desktop/src/features/plugins/components/plugins-view.tsx`, `desktop/src/features/plugins/components/brand-logos.tsx`, `desktop/src/features/plugins/components/featured-showcase.tsx`, `desktop/src/features/plugins/components/plugin-detail-view.tsx`.
> **Rust Engine Backing:** `crates/rayucode-base/src/mcp/` (7-layer config, 3 transports, Shared Process Pool, Zero-Cache-Miss Schema Cache, OAuth 2.1, 8k token budget), `crates/rayucode-base/src/skill.rs`, `crates/rayucode-base/src/memory.rs`, `gmail`, `calendar`, `browser`, `rayucode-companion`, `RuntimeCommand::{Mcp, Skills, Memory}`.
> **Owned Files (Wave 3E — Part 2):** `vscode/webview/src/features/plugins/**`.

---

## 1. Layout Shell — Desktop Customize Sidebar + Compact Tabs

- **Wide (`>= 960px`):** `200px` left Customize sub-rail (`border-r border-hairline bg-chrome/40`) with 4 items (`Plugins & MCP`, `Skills`, `Memory`, `Workspace`) + scrollable main catalog/detail pane.
- **Compact (`< 560px`):** Clean 4-segment Radix `Tabs` bar across top + single-column cards.

---

## 2. Tab 1 — Plugins & 7-Layer MCP Connectors (Desktop Parity + Full Rust MCP Engine)

### Visual Hierarchy
1. **Header & Controls:** Title `Plugins & MCP`, live search input (`Search connectors, tools, or servers...`), filter tabs (`Configured (N)` | `Catalog` | `Connected`), **`[+ Add MCP Server]`** primary button, and **`[Reload All]`** icon button.
2. **Interactive `FeaturedShowcase` Banner (Catalog tab):** Direct port of Desktop's showcase card highlighting high-leverage IDE workflows (GitHub, Linear, Sentry, Context7 Docs, PostgreSQL, Playwright) with official multi-color **`BrandLogo`** tiles.
3. **Live Configured MCP Servers Section (Honest 7-Layer Rust Discovery):**
   - Remember: Rust ships **0 bundled MCP servers** and merges **7 config sources** (`~/.codex/config.toml` migration, `~/.rayu/config.json`, `~/.rayu/mcp.json`, `~/.claude.json`, `~/.claude/mcp.json`, ancestor `.mcp.json`, project `.rayu/mcp.json` / `.mcp.json` / `.claude/mcp.json`).
   - Each configured server card renders:
     - **`BrandLogo`** (`size="md"`, 32 multi-color SVGs ported 1:1 from `brand-logos.tsx`, graceful initials fallback for custom servers)
     - Server name + **Status Dot** (`Connected` green / `Cached (connect-on-call)` info / `Auth needed` warn / `Disabled` faint / `Error` danger)
     - Compact metadata pills (`text-[10.5px] font-mono`):
       - **Config Layer badge:** e.g. `workspace .mcp.json`, `~/.rayu/mcp.json`, `Claude import`
       - **Transport badge:** `stdio` | `streamable-http` | `sse`
       - **Pool mode:** `shared pool` (`shared: true`) | `per-session` (`shared: false`, e.g. Playwright)
       - **Schema cache:** `cached (14 tools)` (zero KV-cache miss!)
     - Action strip:
       - If OAuth 2.1 remote server & unauthenticated: **`[Sign In (OAuth)]`** (`rayu mcp login` flow opening browser) / when authenticated: **`[Logout]`**
       - **`[Test]`** (one-shot connect + tool count verify without opening browser!)
       - **`[Configure]`** (opens Desktop's `Save/Edit MCP Dialog`: server ID, `global ~/.rayu/mcp.json` vs `workspace .mcp.json`, `stdio` vs `streamable-http`/`sse`, command/args or URL, `KEY=VALUE` env lines, `shared` toggle, `timeout_secs`, `[Save]` / `[Remove]`)
       - Radix **`Switch`** (`enabled` / `disabled`)
       - Clicking card opens **`PluginDetailView`** listing all discovered `mcp__<server>__<tool>` definitions + adaptive 8k token budget note + **`[Open Config File in VS Code]`**!
4. **Curated Quick-Add Connector Catalog (32 Official Brand SVGs):**
   - Clearly labeled *"Templates — click Install to add to `~/.rayu/mcp.json` or workspace `.mcp.json`"*.
   - One-click install for zero-env servers (e.g. Context7, Playwright) or prefilled Configure Dialog for env-required servers (e.g. GitHub, Linear, Sentry, PostgreSQL, Supabase, Stripe, Figma, Cloudflare).

---

## 3. Tab 2 — Skills (`SKILL.md`)

- Header: `[+ Create Skill]` button (opens Desktop's Create Skill Dialog writing `.agents/skills/<name>/SKILL.md` and opening it directly in VS Code!) + `[Reload Global & Project Skills]` (`RuntimeCommand::Skills`).
- **Installed Skills List (`skills[]`):**
  - Each row: `Box` icon, skill name (`/skill-name` mono badge), 1-line description, `allowed_tools` count pill, active-in-session badge, and **`[Open SKILL.md]`** clicking directly into the VS Code Editor!
- **Endorsed Skills Catalog (`endorsed[]`):**
  - Category filter pill, synced `Installed` check badge (`registry.contains(name)`), description, and `[Install]` trigger.

---

## 4. Tab 3 — Memory Graph (Jev + Semantic Graph)

- **Top Control Strip (`rayu-card-bevel bg-pane rounded-xl p-3.5`):**
  - `Memory Enabled` Radix `Switch` (`RuntimeCommand::Memory on/off`)
  - `Persist Memory Injections` Radix `Switch` (`[features] persist_memory_injections`)
  - Live `pipeline_active` pulse badge (`RayuProcessingMark` when extracting)
  - **`[Extract Memory Now]`** (`RuntimeCommand::Memory extract`) + **`[+ Remember Fact]`** dialog.
- **Searchable Memory Explorer:**
  - Scope toggle (`Project` | `Global` | `All`) + search query + tag filter chips.
  - Each memory card: concise fact text, tag pills, confidence/recency timestamp (`tabular-nums`), expandable **`Related Graph Links`** (`memory related` / `link`), and `[Forget]` confirmation button.

---

## 5. Tab 4 — Workspace Integrations (Gmail, Calendar, Browser & Companion)

Clean 4-card status grid using `BrandLogo` (`gmail`, `icloud-calendar`/`google-drive`, `chrome-devtools`) and `lucide-react` icons:
1. **Gmail (`gmail` tool — 15 actions):** Google Workspace OAuth status (`Connected` / `Not connected`), `[Connect Google Workspace]` guided setup trigger, capability summary (search, threads, drafts, labels).
2. **Google Calendar (`calendar` tool — 7 actions):** Shared Google Workspace OAuth status, active calendar count, quick_add/event readiness.
3. **Browser Automation (`browser` tool — 17 actions):** Detected browsers (`chrome`, `chromium`, `firefox`, `edge`, `brave`, `safari`), current active handoff status, `[Open Browser Handoff]` trigger.
4. **Desktop Companion (`rayucode-companion`):** Running status dot, lid-close / keep-awake power override switch, native terminal/open bridge health.
