# RayuCode Desktop — Phase 1 Root-Cause Audit (`audit-2.md`)

- **Date:** 2026-11-24
- **Protocol:** Systematic Debugging — Phase 1 (Root Cause Investigation Only; zero source files modified)
- **Reference:** `desktop/docs/root-cause.md` (Sections 3, 4, and 8); Context: `desktop/docs/audit-1.md` (E1, E2, E3, E10)
- **Experiments Executed:** **E5** (Protocol Loss Audit), **E6** (Duplicated Logic Audit), **E9** (Session Save & Restore Audit)
- **Scope:** Desktop renderer (`desktop/src/`), Electron main/preload (`desktop/electron/`), SDK client (`desktop/node_modules/@rayu-dev/rayucode-sdk/dist/`), Harness API & Bridge (`crates/rayucode-harness-api`, `crates/rayucode-harness-api-server`), Internal daemon protocol (`crates/rayucode-protocol`), Core engine (`crates/rayucode-app-core`, `crates/rayucode-base`).

---

## Executive Summary

| Experiment | Core Measurement / Finding | Hypotheses Confirmed / Refined |
| :--- | :--- | :--- |
| **E5 — Protocol Loss Audit** | **Primary wire transport is structured NDJSON JSON frames** (`ServerFrame` / `ApiEvent`) over Unix socket via `@rayu-dev/rayucode-sdk` (`client.js:187-229`, `daemon-client.ts:390-407`), **not** CLI stdout scraping. However, **6 fragile text-scraping / regex-parsing sites** exist (including `harness-adapter.ts:499-529` scraping Rust `batch` text output, `harness-adapter.ts:293-336` scraping synthetic user messages, `daemon-client.ts` scraping error prose, `chat-stream.tsx:645-647` scraping permission descriptions, and Rust's bridge `background_progress.rs:42-167` scraping TUI markdown notifications). **Two-stage event loss:** (1) `translate.rs:1963-3348` drops **45 of 103 `ServerEvent` variants (`43.7%`)** (plus `TurnIdentity`, `seq`, `turn_id`, `started_at`, `ToolDone.tool_duration_ms`, `MessageEnd.stop_reason`, and `RetryRollback` metadata); (2) Desktop UI drops **19 streaming/push `ApiEvent`s**, treats **2** (`reasoning_delta`, `reasoning_done`) as no-ops, never requests **10** reply types, and only actively applies **12** streaming events + **13** RPC replies (with field-level drops and a `TurnStopped`+`TurnDone` double-completion bug). | **H2** (Confirmed at both bridge and UI consumption boundaries), **H1** (Confirmed), **H3** (Partially confirmed — localized to 6 regex/prose parsers), **H8** (Partially supported — unsolicited `error`, `text_replace`, `connection_phase`, `session_status` dropped; no `seq`/`turn_id`) |
| **E6 — Duplicated Logic Audit** | Found **21 distinct duplicated-logic subsystems** across all 5 audited domains (**retry**, **permissions**, **context**, **compaction**, **persistence**) plus a complete second agentic LLM/tool loop in Electron (`auth-bridge.ts:1075-1471`), all diverging in behavior from `crates/`. Critical divergences: Electron's `streamCloudChat` runs a separate Anthropic SSE loop with 4 duplicated workspace tools + 9 desktop tools and **zero permission enforcement**, **zero compaction**, hardcoded `max_tokens: 4096`, `maxRounds = 6`, and 45s/90s watchdogs; `storage-bridge.ts` + `ipc-client.ts` maintain parallel `desktop-sessions.json`, `desktop-settings.json`, `desktop-sidebar.json`, and local MCP/skill/memory scanners; `harness-adapter.ts:351-356, 1263-1274` miscomputes OpenAI `kvCachePct`; `workspace-bridge.ts:51-64` & `auth-bridge.ts:123-130` use symlink-vulnerable lexical path checks instead of Rust's `std::fs::canonicalize`. | **H5** (Strongly Confirmed), **H1** (Strongly Confirmed), **H4** (Confirmed) |
| **E9 — Session Save & Restore Audit** | Identified **14 concrete mechanisms** causing live state and restored state to diverge after mid-turn close (especially with parallel tools) or ordinary reopen: (1) Rust `turn_streaming_mpsc.rs:1819-1960` & `batch.rs:283-336` hold `ToolResult`s in memory and save only after the full tool loop completes, while Electron `launch.js:561-603` `SIGKILL`s the daemon group (or orphans it due to `rayuHome` vs `env.RAYU_HOME` mismatch in `daemon-client.ts:572-579` vs `launch.js:262`), losing finished parallel/sibling tools and producing `TOOL_OUTPUT_MISSING_TEXT` repairs (`agent.rs:1080-1150`); (2) `ipc-client.ts:3552-3559` returns stale `desktop-sessions.json` (`runtimeTurns`) without calling `getHistory` whenever ≥1 turn is cached; (3) Reopen resets `app-store.ts:363-376` to `home`, drops `SessionStatus`/`SessionRecovery`/pending permissions, and fabricates `"Live daemon turn"` if orphaned events arrive; (4) `mapHistoryMessagesToTurns` (`harness-adapter.ts:338-438`) ignores `HistoryMessage.tool` and `History.images`, marks failed tools `"Success"` (`exitCode: 0`), flattens phases/notes, resets `workedDuration` to `"1s"`, drops `"system"`/`"background_task"`/`"error"` rows, leaks reasoning text under `Full`/`Compact` (`render.rs:34-53`), and overwrites session permission mode with global `desiredPermissionMode` (`daemon-client.ts:791, 862`). | **H1** (Strongly Confirmed), **H2** (Confirmed for history/recovery gaps), **H4** (Confirmed), **H8** (Confirmed — no mid-turn tool checkpoints or snapshot/resync) |

---

## Experiment E5: Protocol Loss Audit

### Objective (`root-cause.md` §4)
Determine whether Desktop receives structured events from the Rust engine or parses text output, trace all events across the full pipeline (`ServerEvent` → Harness Bridge `ApiEvent` → Electron/SDK → UI reducer), and list every engine event the UI never handles, plus any dropped, duplicated, or out-of-order signals.

### 1. Core Question: Structured Events vs Text Scraping (**H2** vs **H3**)

**Primary wire transport is structured NDJSON, NOT CLI stdout scraping:**
- The Rust daemon (`crates/rayucode-protocol/src/wire/events.rs`) communicates with the `rayu api-bridge` process (`crates/rayucode-harness-api-server/src/translate.rs`), which emits newline-delimited JSON `ServerFrame { v, reply_to, ev, ... }` objects (`crates/rayucode-harness-api/src/lib.rs:82-91`) tagged by `"ev"` (`crates/rayucode-harness-api/src/events.rs:6-8`).
- `@rayu-dev/rayucode-sdk` (`desktop/node_modules/@rayu-dev/rayucode-sdk/dist/client.js:6, 187-230`) decodes NDJSON via `NdjsonDecoder`, resolves request/reply promises when `reply_to` matches, and emits stream events via `this.emit("event", frame)`.
- `RayuDaemonClient` (`desktop/electron/daemon-client.ts:390-407`) forwards raw frames via `"harness-event"` → `desktop/electron/main.ts:874-878` (`webContents.send("rayu:harness:event", frame)`) → `desktop/electron/preload.cjs:67-75` → `desktop/src/lib/ipc-client.ts:4911-4921` (`ipcClient.harness.onEvent`).
- Two renderer listeners consume those frames: `desktop/src/App.tsx:251-270` and `desktop/src/features/execution-trace/components/chat-stream.tsx:463-513`. `ChatStream` passes each frame to `mapHarnessFrameToLiveEvents` (`desktop/src/lib/harness-adapter.ts:859-1318`), batches mapped events in a `16ms` `setTimeout` via `createStreamBatcher` (`desktop/src/lib/stream-batcher.ts:9-50`, `use-live-trace.ts:9, 214-227`), and applies them in `applyTraceEvents` (`desktop/src/features/execution-trace/hooks/use-live-trace.ts:20-156`).
- Desktop never spawns an interactive `rayu` CLI TUI and never parses ANSI terminal escape codes.

**However, 6 concrete text-scraping / fragile prose-parsing sites exist because structured events are missing or dropped (`H3` localized hits):**

| # | Layer & File:Line | What Text Is Scraped | Why It Exists (Underlying Protocol Gap) |
| :-: | :--- | :--- | :--- |
| 1 | Renderer<br>`desktop/src/lib/harness-adapter.ts:499-529` (`splitBatchOutputSections`) | Strips `[batch timing:...]`, matches `/---\s*\[(\d+)\]\s*([^\n-]+?)\s*---/g`, and checks `/^error:/i` on `ToolDone.output` | `translate.rs:3333` drops `ServerEvent::BatchProgress`, and `ApiEvent::ToolDone` carries only flat `output: String` (`crates/rayucode-app-core/src/tool/batch.rs:346-367`). |
| 2 | Renderer<br>`desktop/src/lib/harness-adapter.ts:293-336` (`classifySyntheticUserMessage`) | Regex-matches `/^\[Imported tool result:[^\]]*\]\s*(.*)$/is`, `/Launching skill:\s*(.+)$/i`, `/^Base directory for this skill:\s*([^\n]+)/i`, and `/^<(?:system-reminder\|command-message\|local-command-stdout\|local-command-caveat)\b/i` on `HistoryMessage.content` | Restored history merges internal/imported context as `"user"` rows and Desktop fails to read `HistoryMessage.tool` (`events.rs:656`). |
| 3 | Renderer<br>`desktop/src/features/execution-trace/components/chat-stream.tsx:645-647` | Matches `/powerpoint\|presentation\|slide/i` against `PermissionRequest.toolName` and `description` | `PermissionRequest` has no structured artifact/preview hint; UI guesses from prose to auto-open Slide Studio. |
| 4 | Electron<br>`desktop/electron/daemon-client.ts:288, 704, 726, 737, 977, 994` | Regex-matches error strings (`/busy/i`, `/not support\|invalid_request\|busy\|unknown model/i`, `/not support\|reasoning effort\|invalid_request\|busy/i`, `/unknown_request\|unsupported\|not support\|file_changes/i`) | `ApiEvent::Error` only has 5 coarse `ErrorCode` variants (`events.rs:529-535`), lacking `Busy` or `Unsupported`, forcing string matching. |
| 5 | Rust Bridge<br>`crates/rayucode-harness-api-server/src/background_progress.rs:42-167` (called at `translate.rs:3124`) | Strips `**Background task progress** `, `**Background task** `, backticked IDs, ` · `, `[###---] `, `(reported\|parsed\|estimated)`, and `%` out of `ServerEvent::Notification.message` | The core daemon has no structured background-progress wire event, so even the Rust bridge scrapes TUI markdown prose. |
| 6 | Electron & Renderer<br>`desktop/electron/auth-bridge.ts:614-631, 1239-1359` & `desktop/src/lib/ipc-client.ts:5183-5205` | Manually splits SSE chunks on `/\r?\n\r?\n/` and `data:` prefixes | Direct Cloud fallback bypasses the Rust engine and re-implements Anthropic SSE framing in JS. |

---

### 2. Three-Stage Event Loss Pipeline

| Stage | Boundary | Total Variants | Forwarded / Handled | Dropped / Unreached | Key Structural Losses |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **0 → 1** | Daemon `ServerEvent` (`crates/rayucode-protocol/src/wire/events.rs:108-1166`) → Harness Bridge (`crates/rayucode-harness-api-server/src/translate.rs:1963-3348`) | **103** `ServerEvent` variants | **58** handled (translated to `ApiEvent` or consumed in bridge state) | **45** dropped (`_ => vec![]` at `translate.rs:3333`) | Strips `TurnIdentity { runtime_generation, turn_id }` (`ServerFrame` at `lib.rs:82-91` has no `seq`, `turn_id`, or `started_at`), `ToolDone.tool_duration_ms`, `MessageEnd.stop_reason`, `RetryRollback.{attempt,max}`, `Error.retry_after_secs`, and 13 `History` metadata fields. |
| **1 → 2** | Harness Bridge `ApiEvent` (`crates/rayucode-harness-api/src/events.rs:8-525`) → Electron & SDK (`client.js`, `daemon-client.ts`, `main.ts`) | **56** functional `ApiEvent` variants (excl. `Unknown`) | **56** forwarded on `rayu:harness:event` / `client.request()` | **10** request-reply variants never invoked by Desktop | Electron swallows `SetModel`/`SetReasoningEffort` errors (`main.ts:294, 307`, `daemon-client.ts:977, 994`) and omits `ReadFile` IPC exposure. |
| **2 → 3** | Electron IPC (`rayu:harness:event` + RPCs) → Desktop UI (`harness-adapter.ts`, `App.tsx`, `chat-stream.tsx`, `ipc-client.ts`) | **56** functional `ApiEvent` variants | **12** streaming applied + **13** RPC replies consumed (`25` total) | **19** streaming/push dropped (`default: return []`) + **2** explicit no-ops + **10** unrequested replies (**31 never handled**) | `TurnStopped` + `TurnDone` both emit `complete` (double-turn bug); `question_request` dropped despite `supportsUserResponse: true` (hang bug); `history` drops `images` and `msg.tool`; `runtime_info` drops `model` and `reasoning_effort`. |

---

### 3. Table A — Engine `ServerEvent` Variants Dropped by Harness Bridge (`translate.rs:3333`)

All **45** of **103** `ServerEvent` variants (`crates/rayucode-protocol/src/wire/events.rs:108-1166`) that fall into `_ => vec![]` (`translate.rs:3333`) and never reach any Harness API client (including Desktop):

| Category | Dropped `ServerEvent` Variants (`crates/rayucode-protocol/src/wire/events.rs` Line) | Impact on Desktop |
| :--- | :--- | :--- |
| **Live Progress & Tools (4)** | `BashProgress` (`L246`), `BatchProgress` (`L274`), `GeneratedImage` (`L262`), `StdinRequest` (`L1155`) | No live bash output streaming; no live parallel subcall progress (`batch` forces regex scraping of `ToolDone.output`); interactive stdin prompts invisible. |
| **Compaction & Memory (5)** | `Compaction` (`L526`), `CompactedHistory` (`L769`), `CompactionModeChanged` (`L921`), `MemoryInjected` (`L503`), `MemoryActivity` (`L522`) | Desktop never knows when background or emergency compaction occurs, cannot expand >64 compacted messages, and cannot show real memory injections. |
| **Swarm & Coordination (16)** | `Todos` (`L128`), `SwarmStatus` (`L394`), `SwarmPlan` (`L398`), `SwarmPlanProposal` (`L412`), `AgentModelsChanged` (`L169`), `CommContext` (`L974`), `CommMembers` (`L982`), `CommSwarms` (`L986`), `CommChannels` (`L990`), `CommSummaryResponse` (`L997`), `CommStatusResponse` (`L1005`), `CommReportResponse` (`L1012`), `CommPlanStatusResponse` (`L1020`), `CommAssignTaskResponse` (`L1024`), `CommTaskControlResponse` (`L1032`), `CommContextHistory` (`L1044`), `CommSpawnResponse` (`L1052`), `CommListModelsResponse` (`L1060`), `CommAwaitMembersResponse` (`L1077`) *(19 total incl. `Todos`/`Swarm*`/`AgentModelsChanged`)* | Swarm view (`SwarmView`) has zero protocol events for live swarm status, plans, member lists, or DMs — explaining why `ipc-client.ts:4180-4318` fabricates local `runtimeSwarm` mock state. |
| **Transport, Tier & Usage (6)** | `AccountUsage` (`L130`), `ConnectionType` (`L349`), `ServiceTierReported` (`L361`), `UpstreamProvider` (`L390`), `ServiceTierChanged` (`L898`), `TransportChanged` (`L911`) | Desktop cannot display live account quota snapshots, transport type (`websocket` vs `https/sse`), upstream provider routing, or service tier. |
| **Lifecycle, Reload & MCP (8)** | `PeerUserMessage` (`L569`), `McpStatus` (`L613`), `SessionCloseRequested` (`L628`), `Reloading` (`L815`), `ReloadProgress` (`L823`), `ResumeAllResult` (`L1112`), `DebugResponse` (`L609`), `ClientDebugRequest` (`L620`) | Desktop misses peer prompts in shared sessions, live MCP connection counts, daemon reload/restart progress, and forced session close notices. |
| **Companion / Shell / Voice (3)** | `Transcript` (`L962`), `VoiceActivity` (`L966`), `InputShellResult` (`L970`) | External dictation transcripts, companion voice state, and `!cmd` shell outputs are invisible. |

*(Exact count across the 6 rows above: `4 + 5 + 19 + 6 + 8 + 3 = 45` dropped `ServerEvent` variants.)*

**Additional field-level losses inside the 58 handled `ServerEvent`s in `translate.rs`:**
- **`TurnIdentity` (`events.rs:96-99, 111-125`):** Consumed by `turn_fence` (`translate.rs:1965-1998`) and **not emitted** on `ServerFrame` (`crates/rayucode-harness-api/src/lib.rs:82-91`), which has **no `seq`, no `turn_id`, and no `started_at`**.
- **`ToolDone.tool_duration_ms` (`events.rs:239`):** Omitted from `ApiEvent::ToolDone` (`translate.rs:2465-2471`).
- **`MessageEnd.stop_reason` (`events.rs:377`):** Omitted from `ApiEvent::TextDone` (`translate.rs:2411-2417`), hiding `max_tokens` output truncation.
- **`RetryRollback { attempt, max }` (`events.rs:386`):** `attempt` and `max` are discarded and replaced by empty `ApiEvent::TextReplace` (`translate.rs:2427-2432`).
- **`Error.retry_after_secs` (`events.rs:577`):** Dropped when building `ApiEvent::Error` (`translate.rs:3242-3245`).
- **`History` metadata (`events.rs:671-752` vs `translate.rs:2868-2925`):** `total_tokens`, `token_usage_totals`, `mcp_servers`, `skills`, `compaction_mode`, `connection_type`, `status_detail`, `upstream_provider`, `service_tier`, `subagent_model`, `autoreview_enabled`, `autojudge_enabled`, and `server_has_update` are all stripped.

---

### 4. Table B — All 56 Functional `ApiEvent` Variants & What Desktop UI Handles vs Drops

Complete accounting of all **56** functional `ApiEvent` variants in `crates/rayucode-harness-api/src/events.rs:8-525` (`12 + 2 + 19 + 13 + 10 = 56`):

#### B1. Streaming / Push `ApiEvent`s Never Handled by Desktop UI (`21` variants: `19` silently dropped + `2` no-ops)

| `ApiEvent` Variant (`ev`) | `events.rs` Line | Desktop UI Disposition & File:Line | Impact |
| :--- | :---: | :--- | :--- |
| `reasoning_delta` | L81 | **Explicit no-op** (`return []` at `harness-adapter.ts:901-904`) | Reasoning stream discarded; UI shows static `"Thinking..."` (`work-trace.tsx:526`). |
| `reasoning_done` | L84 | **Explicit no-op** (`return []` at `harness-adapter.ts:905-908`) | Reasoning duration discarded. |
| `text_done` | L65 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Assistant message boundaries lost (`message_id` also ignored on `text_delta`). |
| `text_replace` | L73 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | **CRITICAL:** Provider retry rollback (`retry_rollback`) & citation suffix fixes (`text_suffix_replace`) never retract streamed text, leaving duplicated/corrupt text in UI! |
| `side_pane_images` | L135 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Tool-produced or generated images never render live. |
| `side_panel_state` | L143 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Server-pushed Markdown side-panel pages never appear. |
| `applet_state` | L151 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Agent-mounted applets never appear. |
| `context_cap_changed` | L208 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Context budget UI stays hardcoded at `200k` (`ipc-client.ts:3843, 3855`). |
| `kv_cache_miss` | L219 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Harness-caused KV cache misses are completely invisible. |
| `soft_interrupt_injected` | L259 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Soft-interrupt/background-task injections mid-turn have no UI boundary. |
| `wake_requested` | L299 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | External wake notifications silently ignored. |
| `background_progress` | L313 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Background task progress bars never render. |
| `message_accepted` | L337 | **SDK-only** (`client.js:453`); **Dropped in UI** (`harness-adapter.ts:1315`) | UI cannot distinguish `"sent"` vs `"queued/acknowledged"`. |
| `question_request` | L339 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | **CRITICAL HANG BUG:** `daemon-client.ts:456, 582` sets `supportsUserResponse: true`, so `translate.rs:2164` forwards `question_request`, which Desktop drops — leaving `ask_user_question` blocked forever! |
| `question_closed` | L346 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | No question cleanup on cancel/timeout. |
| `permission_mode_changed` | L364 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | UI never learns the engine's effective permission mode (`audit-1.md` E3). |
| `session_recovery` | L373 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Interrupted-session reload recovery prompts never surface to the user. |
| `session_status` | L381 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | UI never learns if an attached session is `"running"`, `"idle"`, or `"cancelled"`. |
| `connection_phase` | L397 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | `connecting`, `waiting for response`, `retrying (2/4)` never appear; UI hides retries (`root-cause.md` §6.8). |
| `model_info` | L403 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | UI never learns active provider, model, effort, auth method, or account label. |
| `session_renamed` | L513 | **Dropped** (`default: return []` at `harness-adapter.ts:1315`) | Auto-generated or CLI-triggered session renames never update the Desktop sidebar/header live. |

#### B2. Request-Reply `ApiEvent`s Never Requested by Desktop UI (`10` variants)

`tools` (`events.rs:91`), `models` (`L426` — only in unused `daemon-client.ts:964` / `ipc-client.ts` never calls `models.list`), `soft_interrupts_cancelled` (`L280`), `background_tool_result` (`L288`), `file_content` (`L462` — `daemon-client.ts:1004` never exposed in `main.ts`/`preload.cjs`), `files` (`L471`), `text_matches` (`L477`), `file_status` (`L483`), `todo_state` (`L495`), `compacted` (`L506`).

#### B3. Handled Streaming Events (`12`) & Consumed RPC Replies (`13`) — With Partial/Buggy Handling

- **12 Handled Streaming Events (`harness-adapter.ts:886-1314`, `App.tsx:251-270`, `chat-stream.tsx:463-513`):**
  1. `text_delta` (`L887`): ignores `message_id`.
  2. `tool_start` (`L909`): computes ephemeral status label (`describeActiveTool`).
  3. `tool_input_delta` (`L932`): ignores empty-`call_id` legacy fallback (`events.rs:112-113`) when `!callId` (`L935`).
  4. `tool_exec` (`L943`): updates status label; promotes prior `answerIntro` to a `note`.
  5. `tool_call` (`L963`): handled internally by SDK `ToolCallbacks` (`client.js:212-215`) + promotes prior text to `note` in `harness-adapter.ts:963-979`.
  6. `tool_done` (`L980`): truncates output at 2400 chars (`L746`); scrapes `batch` text (`L1000-1081`); falls back 27 of 37 engine tools to `ShellCommandStep` (`L718-752`).
  7. `permission_request` (`L1236`, `App.tsx:252`): **drops `risk_tier`** (`events.rs:360`).
  8. `file_changes_state` (`L1256`, `App.tsx:259`): updates `sessionFileChangesBySession`.
  9. `token_usage` (`L1263`): **ignores `output`, `cache_creation_input`, and `effective_budget`** (`events.rs:180-190`); miscomputes OpenAI `kvCachePct` (`L1267-1272`).
  10. `rayu_credits` (`L1276`): **ignores `credits`, `billable_tokens`, `tokens_per_credit`**.
  11. `turn_stopped` (`L1285`, `App.tsx:267`): ignores `provider_stop_reason`; ignores `message` for all reasons except `reason === "failure"`; **emits `complete`**!
  12. `turn_done` (`L1284`, `App.tsx:267`): ignores `pending_soft_interrupts`; **emits `complete`**.
- **13 Consumed RPC Replies:** `hello_ok`, `ok`, `pong`, `sessions`, `attached`, `session_forked`, `file_change_diff`, `file_change_action_result`, `credential_updated`, `runtime_command_result` (discarded for `swarm` & `overnight` at `ipc-client.ts:4188-4190, 4206-4212, 4336-4341`), `error` (handled for correlated `reply_to` in SDK, **dropped when pushed unsolicited** on stream at `harness-adapter.ts:1315`), `history` (drops `images` at `ipc-client.ts:3572` and `messages[*].tool` at `harness-adapter.ts:35-46`), `runtime_info` (drops `provider`, `model`, `reasoning_effort`, `auth_method`, `account_label` at `ipc-client.ts:3500-3505`, and **dropped when pushed unsolicited** by `translate.rs:2845, 3108, 3114`).

**Critical Duplication & Ordering Defects Found:**
- **Double `complete` / bogus second turn on `turn_stopped`:** `events.rs:233-234` guarantees `TurnStopped` precedes `TurnDone` on abnormal stops (`translate.rs:2689-2701, 3250-3260`). Because `harness-adapter.ts:1284-1314` maps **both** `turn_stopped` and `turn_done` to `{ type: "complete" }`, `chat-stream.tsx:508-511` clears `activeLiveTurnRef.current = false` on `turn_stopped` and calls `recordTurn()`, and then when `turn_done` arrives immediately after, `chat-stream.tsx:498-504` sees `!activeLiveTurnRef.current`, starts a **second fake live turn** (`userPrompt: "Live daemon turn"`), and immediately completes and records it!
- **Dual `onEvent` subscribers without session filter in `App.tsx`:** `App.tsx:251-270` and `chat-stream.tsx:463-513` both listen to `ipcClient.harness.onEvent` and both mutate `pendingPermission` and `sessionFileChanges`; `App.tsx:252-258` does not even filter `frame.session_id` against `activeSessionId`.
- **Synthetic non-engine events:** `harness-adapter.ts:865, 895` handles `turn_start` and `promote_answer_to_note`, neither of which exists in Rust `ApiEvent` (`promote_answer_to_note` comes only from Electron's `auth-bridge.ts:1371`).

### E5 Hypothesis Assessment & Unverified Items
- **H2 (Lossy protocol):** **Confirmed** — 45/103 `ServerEvent`s dropped by `translate.rs` + 21/56 `ApiEvent`s dropped/no-op in UI + missing `seq`/`turn_id`/`started_at`.
- **H3 (Text scraping):** **Partially Confirmed (Localized)** — primary transport is structured NDJSON, not CLI stdout scraping, but 6 fragile text-parsing workarounds exist due to H2 gaps.
- **What could not be verified in E5:** Live 3-stream wire capture (daemon raw stream vs `rayu:harness:event` vs reducer output) during a running session with a scripted fake model, because Phase 1 disallows source instrumentation and running a scripted-provider capture harness.

---

## Experiment E6: Duplicated Logic Audit

### Objective (`root-cause.md` §4 & prompt)
Search the UI layer (`desktop/src/` and `desktop/electron/`, excluding tests) for logic that duplicates Rust engine logic across **retry/backoff**, **permissions**, **context building/token counting/file+git+extensions**, **compaction**, and **persistence**, and document behavioral divergences.

### Summary by Domain (`21` Duplicated Subsystems Found)

| Domain | Hits | Primary Desktop Files | Rust Engine Authority | Behavioral Divergence |
| :--- | :---: | :--- | :--- | :--- |
| **1. Retry / Backoff / Watchdog** | 4 | `auth-bridge.ts`, `daemon-client.ts`, `query-client.ts` | `network_retry.rs`, `provider-rayu-runtime`, `provider_control.rs` | Single 401 refresh + 45s/90s abort watchdog in Cloud loop vs OS-route-aware exponential backoff (`1s..30s`); client busy-retry queues regex-scrape `"busy"`. |
| **2. Permissions & Sandboxing** | 4 | `auth-bridge.ts`, `daemon-client.ts`, `use-sessions.ts`, `workspace-bridge.ts`, `ipc-client.ts` | `permission_gate.rs`, `requests.rs`, `translate/session_files.rs` | **Direct Cloud loop executes `run_command` & file tools with ZERO permission checks**; global `desiredPermissionMode` overwrites per-session engine state; lexical path check misses symlinks. |
| **3. Context, Tokens, Files, Git, MCP/Skills & Agent Loop** | 7 | `auth-bridge.ts`, `chat-stream.tsx`, `composer.tsx`, `storage-bridge.ts`, `workspace-bridge.ts`, `terminal-bridge.ts`, `git-bridge.ts`, `harness-adapter.ts`, `inspector-api.ts` | `turn_streaming_mpsc.rs`, `prompting.rs`, `compaction.rs`, `tool/mod.rs`, `tool/file_changes.rs`, `commands_dispatch.rs` | Full second LLM loop in Electron (`max_tokens: 4096`, `maxRounds: 6`, spoofs `"x-rayu-client": "cli"`); wrong OpenAI `kvCachePct` math; `bytes/4` token guesses & hardcoded `200k`; duplicate file/git/MCP/skill scanners. |
| **4. Compaction** | 2 | `storage-bridge.ts`, `settings-view.tsx`, `ipc-client.ts`, `auth-bridge.ts` | `agent/compaction.rs`, `turn_streaming_mpsc.rs` | `autoCompactContext` is local-only JSON never synced to `config.toml`; Cloud fallback has zero compaction or context-limit recovery. |
| **5. Persistence** | 5 | `storage-bridge.ts`, `ipc-client.ts`, `use-sessions.ts`, `app-store.ts`, `sidebar-projects-pane.tsx`, `auth-bridge.ts`, `daemon-client.ts` | `session/persistence.rs`, `config.rs`, `rayu/` | Parallel `desktop-sessions.json` (50/500 cap), `desktop-settings.json`, `desktop-sidebar.json` (pins/archives), `localStorage` inference keys, local mock Swarm/Automations/Telegram state, and parallel OAuth refresh rotation. |

### Itemized Duplicated Logic Inventory (with File:Line & Divergences)

#### 6.1 Retry, Backoff, Watchdog & Reconnect (`4` hits)
1. **Cloud SSE token-refresh retry & fixed timeouts (`desktop/electron/auth-bridge.ts:1175-1205, 1348`):** Retries HTTP `401` once after `refreshAccessToken()`, aborts on `45_000ms` connect / `90_000ms` stream stall watchdogs, and performs zero `429`/`5xx`/network backoff. Diverges from `crates/rayucode-app-core/src/network_retry.rs:14-120` (macOS `route -n monitor` / Linux `ip monitor`, exponential backoff `1s`→`30s`, `generate_204` connectivity probes) and `crates/rayucode-provider-rayu-runtime/src/lib.rs` (gateway retry + `RetryRollback`).
2. **Client-side busy-retry queues (`desktop/electron/daemon-client.ts:392-406, 703-706, 726-739`):** Regex-matches `/busy/i`, stores `pendingToolSync` and `pendingPermissionSync`, and retries on `turn_done`/`turn_stopped`. Duplicates Rust's `spawn_deferred_agent_mutation` (`crates/rayucode-app-core/src/server/provider_control.rs:674-732`) and is unnecessary for `set_permission_mode`, which runs lock-free in Rust (`client_lifecycle.rs:1026, 1047-1054`).
3. **Daemon socket probe/auto-launch fallback (`desktop/electron/daemon-client.ts:486-537, 638-655`):** Multi-path Unix socket dial + auto-launch orchestration outside Rust's server registry.
4. **TanStack Query retry policy (`desktop/src/lib/query-client.ts:10-15`):** Retries failed queries up to 2 times unless message matches `/validation|40[0-4]/i`, which can re-trigger `daemon-client.ts` methods that mutate attachment state (`ensureAttached` + `syncDesiredPermissionMode`).

#### 6.2 Permissions & Safety Gating (`4` hits)
1. **Complete permission bypass in Electron direct Cloud loop (`desktop/electron/auth-bridge.ts:252-322, 1368-1425`):** Executes `run_command` (`/bin/sh -lc`), `read_file`, `list_files`, `search_files`, and all 9 `DESKTOP_TOOL_DEFINITIONS` automatically without consulting `PermissionMode` or emitting `PermissionRequest`, contradicting Rust `crates/rayucode-app-core/src/tool/permission_gate.rs:354-447`.
2. **Permission mode catalog, translation, persistence & global override (`desktop/electron/daemon-client.ts:34-45, 304-306, 710-764, 926-948`, `desktop/src/features/sessions/hooks/use-sessions.ts:37, 60-78, 178-212`, `desktop/src/lib/ipc-client.ts:3486-3488`):** Hardcodes `MOCK_PERMISSION_MODES` (never queries engine), stores mode in `localStorage["rayu-permission-mode"]`, manually translates camelCase↔snake_case, and uses a single global `this.desiredPermissionMode` in Electron that **overwrites** each session's mode on attach (`daemon-client.ts:791, 862`).
3. **Workspace path sandboxing (`desktop/electron/auth-bridge.ts:123-130`, `desktop/electron/workspace-bridge.ts:51-64`):** `resolveSafeWorkspacePath` checks `path.resolve` lexically without resolving symlinks, whereas Rust `crates/rayucode-harness-api-server/src/translate/session_files.rs:42-91` (`safe_session_path`) resolves symlinks via `std::fs::canonicalize`.
4. **Local Telegram approval state (`desktop/src/lib/ipc-client.ts:4747-4761`):** `resolveApproval` updates `runtimeTelegram.approvals` in memory only, disconnected from Rust `telegram_remote`.

#### 6.3 Context, Token Counting, Agent Loop, Files, Git & Extensions (`7` hits)
1. **Second agentic LLM/tool loop in Electron (`desktop/electron/auth-bridge.ts:109-389, 1075-1471`):** Re-implements system prompt (`L1102-1111`), 4 workspace tools (`list_files`, `read_file`, `search_files`, `run_command`), hardcoded `max_tokens: 4096` (`L1146`), `maxRounds = 6` (`L1186`), and headers including `"x-rayu-client": "cli"` (`L1162`) — diverging completely from Rust `crates/rayucode-app-core/src/agent/{prompting.rs, turn_streaming_mpsc.rs}` and `tool/mod.rs`.
2. **Renderer conversation history builder (`desktop/src/features/execution-trace/components/chat-stream.tsx:551-559`, `desktop/src/lib/ipc-client.ts:3666-3678`):** Rebuilds `history: CloudChatMessage[]` from UI `ExecutionTurn`s by keeping only `userPrompt` and `answerIntro`, stripping all tool calls, tool outputs, notes, and prior images.
3. **Composer prompt & slash-token wrapping (`desktop/src/features/sessions/components/composer.tsx:1168-1199`):** Serializes `[Attached file: ...]`, `[Referenced RayuCode conversation: ...]`, and `/slash` commands as literal prompt text instead of dispatching engine slash commands (`crates/rayucode-tui/src/tui/app/commands_dispatch.rs`).
4. **Token counting, context budget & KV cache math:**
   - `desktop/electron/storage-bridge.ts:293-297, 427, 467`: `estimateTokensLabel` guesses tokens as `Math.round(bytes / 4)`.
   - `desktop/src/lib/ipc-client.ts:3841-3860` & `desktop/src/features/inspector/api/inspector-api.ts:27-160, 293-337`: hardcodes `"0 / 200k tokens"` / `"200k"` and prototype context breakdown rows instead of calling `RuntimeCommand::Context` or reading `TokenUsage.effective_budget` (`crates/rayucode-app-core/src/agent/compaction.rs:69-88`).
   - `desktop/src/lib/harness-adapter.ts:351-356, 1263-1274`: computes `kvCachePct = Math.min(99, Math.round((cacheRead / (input + cacheRead)) * 100))`. Per `crates/rayucode-harness-api/src/events.rs:177-178`, OpenAI includes `cache_read_input` inside `input`, so this formula double-counts `cacheRead` and under-reports cache hit ratio compared to Rust's `kv_cache_monitor`.
5. **Local MCP, Skills & Memory discovery (`desktop/electron/storage-bridge.ts:309-482, 493-616`):** Reads/writes `~/.rayu/mcp.json`, `.mcp.json`, `.claude/mcp.json` (commented `// mirrors Rust loader` at `L385`), parses `SKILL.md` frontmatter across 4 roots, and scans `CLAUDE.md`/`GEMINI.md`/`AGENTS.md`/`DESIGN.md`/`MEMORY.md` directly in Node instead of querying Rust `RuntimeCommand::{Mcp, Skills, Memory}`.
6. **Workspace file listing, reading, searching & shell execution (`desktop/electron/workspace-bridge.ts:87-115`, `desktop/electron/storage-bridge.ts:246-291`, `desktop/electron/auth-bridge.ts:132-277`, `desktop/electron/terminal-bridge.ts:19-96`):** Duplicates Rust's `ApiRequest::{ReadFile, FindFiles, SearchText, FileStatus}` (`crates/rayucode-harness-api-server/src/translate/session_files.rs:93-180`) and built-in tools (`read`, `agentgrep`, `bash`) with different ignore lists, limits (`maxFiles=250, maxDepth=4` vs `MAX_WALK_ENTRIES`), and timeouts (`12s` / `30s`).
7. **Git diff, stage, commit, worktree & PR engine (`desktop/electron/git-bridge.ts:1-607`):** Implements unified-diff parsing (`L93-161`), working-tree diffing (`L342-465`, capped at 40 files), staging/discard/commit, worktree creation in `~/.rayu/worktrees` (`L289-340`), and `gh pr create` (`L567-607`) independently of Rust's tracked `file_changes` engine (`crates/rayucode-app-core/src/tool/file_changes.rs`) and swarm worktree manager.

#### 6.4 Compaction (`2` hits)
1. **Local-only compaction preference & fake TOML display (`desktop/electron/storage-bridge.ts:10, 133`, `desktop/src/features/settings/components/settings-view.tsx:1354-1358, 1437`, `desktop/src/lib/ipc-client.ts:3845-3851`):** Toggles `autoCompactContext` in `desktop-settings.json` and renders `"Autocompact buffer"` / `auto_compact = ...`, but never reads/writes Rust `Config.compaction`, never invokes `ApiRequest::Compact`, and `translate.rs:3333` drops `ServerEvent::Compaction`.
2. **No compaction in Electron direct Cloud loop (`desktop/electron/auth-bridge.ts:1189-1438`):** Lacks background compaction, emergency hard compaction, and context-limit retry (`crates/rayucode-app-core/src/agent/compaction.rs:55-140`, `turn_streaming_mpsc.rs:103-132, 1327-1357`).

#### 6.5 Persistence (`5` hits)
1. **Parallel session & turn JSON store (`desktop/electron/storage-bridge.ts:24-27, 180-182, 204-224`, `desktop/src/lib/ipc-client.ts:3194-3197, 3228-3256, 3454-3480, 3552-3585, 3730-3772`):** Reads/writes `~/.rayu/desktop-sessions.json` (capped at 50 sessions / 500 turns) alongside Rust's canonical `~/.rayu/sessions/<id>.json` + `.jsonl` journal (`crates/rayucode-base/src/session/persistence.rs`).
2. **Parallel settings & inference persistence (`desktop/electron/storage-bridge.ts:7-22, 176-202`, `desktop/src/features/sessions/hooks/use-sessions.ts:35-37`, `desktop/src/lib/app-store.ts:306-328`):** Stores `desktop-settings.json` + `localStorage` keys instead of Rust `~/.config/rayucode/config.toml`.
3. **Parallel pin & archive persistence (`desktop/electron/storage-bridge.ts:119-128, 686-746`, `desktop/src/components/shell/sidebar-projects-pane.tsx:472-485, 538-560`):** Persists `pinnedChatIds` and `archivedChatIds` in `desktop-sidebar.json` instead of calling Rust `ApiRequest::{ArchiveSession, RestoreSession, SetSessionSaved}`.
4. **Parallel OAuth login, token rotation & credential symlinking (`desktop/electron/auth-bridge.ts:503-612, 681-756, 896-1060`, `desktop/electron/daemon-client.ts:126-201`):** Duplicates `rayu-auth.json` / `rayu.env` writes and `POST /cli/refresh` token rotation alongside the Rust daemon.
5. **Local-only Swarm, Automations, Telegram & `disabledSkills` state (`desktop/src/lib/ipc-client.ts:3198-3226, 4180-4379, 4735-4770`, `desktop/electron/storage-bridge.ts:397-398, 603-616`):** Stored strictly in Electron/renderer memory or `desktop-settings.json`.

### E6 Hypothesis Assessment & Unverified Items
- **H5 (Duplicated logic):** **Strongly Confirmed** across all 5 requested domains plus a second agent loop in Electron.
- **What could not be verified in E6:** Live wire behavior and token-refresh race frequency when `auth-bridge.ts` and the Rust daemon refresh `rayu-auth.json` concurrently, or live CLI-vs-Desktop output diffs (which belongs to E4).

---

## Experiment E9: Session Save & Restore Audit

### Objective (`root-cause.md` §4)
Read the session save and restore code across both Rust and Desktop (`crates/` + `desktop/`), trace what happens when running parallel tools and closing/reopening the app mid-turn, and explain every mechanism by which **live state** and **restored state** can differ.

### 1. Code Walkthrough: Save, Mid-Turn Close, and Restore Paths

#### A. Rust Engine Save & Parallel-Tool Persistence
1. **Snapshot + Append-Only JSONL Journal (`crates/rayucode-base/src/session/persistence.rs:29, 34-55, 600-800`):**
   - `Session::save_inner` acquires a shared read lock on `SAVES_IN_FLIGHT` (`L615-617`), appends deltas to `<id>.jsonl` (`L755-768`), or writes a full JSON snapshot (`checkpoint_snapshot` at `L335-362`, deleting `.jsonl`) when vectors shrunk, full-dirty flags are set, or journal exceeds `MAX_SESSION_JOURNAL_BYTES` (`L776-780`).
   - Shutdown (`drain_saves_for_shutdown` at `L34-55`) waits for in-flight saves; `load_from_path` (`L388-489`) applies idempotent `JournalReplayDedupe` (`L67-130`) and `salvage_glued_journal_entries` (`L141-169`).
2. **Mid-Turn Save Points (`crates/rayucode-app-core/src/agent/turn_streaming_mpsc.rs`):**
   - **Turn entry:** `_streaming_guard = StreamingGuard::new(...)` creates a streaming marker file (`L46`, inspected by crash recovery in `crates/rayucode-base/src/session/crash.rs:363-410`); user message is saved (`turn_execution.rs:60, 104`).
   - **After provider stream finishes:** `self.add_message_ext(Role::Assistant, content_blocks, None, token_usage)` (with text, reasoning, `ToolUse` calls, usage) + `self.session.save()?` (`turn_streaming_mpsc.rs:1318-1320`).
   - **During tool execution (`L1660-1960`):**
     - Each top-level tool executes in a `for` loop (`L1660-1956`), appending its `ContentBlock::ToolResult` in memory and setting `tool_results_dirty = true` (`L1819-1824, L1836-1845`).
     - **`self.session.save()?` is NOT called after each tool!** It is only called **once after the entire tool loop finishes** at `L1958-1960` (except on graceful reload at `L1884, L1897` or background handoff at `L1948`).
     - **Parallel `batch` tool (`crates/rayucode-app-core/src/tool/batch.rs:283-391`):** Runs 1–10 subcalls concurrently via `FuturesUnordered` (`L283-334`) entirely in memory, formats one aggregate text output (`L345-389`), and returns a single `ToolOutput`. **Zero per-subcall persistence exists.**
   - **Missing tool repair on resume (`crates/rayucode-app-core/src/agent.rs:1080-1150`):** `repair_missing_tool_outputs` detects persisted `ToolUse` blocks lacking a `ToolResult` and injects synthetic error `ToolResult`s (`TOOL_OUTPUT_MISSING_TEXT`, `is_error: Some(true)`).

#### B. Rust Engine Restore & History Rendering
- `Session::load_from_path` (`persistence.rs:388-489`) loads snapshot + journal.
- `crates/rayucode-app-core/src/server/client_session.rs:57-100, 1715-1764, 1975-2006` restores `Agent`, computes `was_interrupted`, emits `ModelChanged`, runs `handle_get_history`, and emits `Done`.
- `render_messages_and_images_with_compacted_history` (`crates/rayucode-base/src/session/render.rs:365-739`) transforms `StoredMessage`s into `RenderedMessage`s + `RenderedImage`s:
  - Truncates compacted prefix to `DEFAULT_VISIBLE_COMPACTED_HISTORY_MESSAGES = 64` (`L20, 147-229`) and emits a `"system"` banner (`L429-437`).
  - Formats persisted reasoning blocks into italic markdown when `display.reasoning_display` is `Full` or `Compact` (`L34-53, 625-627`).
  - Prepends `"Error: "` to `ToolResult`s with `is_error == Some(true)` (`L602-611`).
  - Merges error replay events (`L443-482`) and attaches `ResponseStats` (`crates/rayucode-base/src/session/render/response_stats.rs:24-97`), explicitly setting **`duration_secs: None`** (`L82`).
- `translate.rs:1772-1801, 2319-2381, 2802-2926` emits `Attached`, `SessionRecovery`, `SessionStatus`, `ModelInfo`, `SidePanelState`, `AppletState`, `FileChangesState`, and `ApiEvent::History`.

#### C. Desktop Save, Mid-Turn Close, and Restore
1. **Desktop Save:** `ChatStream` (`chat-stream.tsx:398-405`) persists a turn to `runtimeTurns` / `~/.rayu/desktop-sessions.json` **only inside `useLiveTrace.onComplete`** (`ipc-client.ts:3246-3256, 3737-3772`; `storage-bridge.ts:204-224` caps at 50 sessions / 500 turns). In-flight `liveTurn` lives only in React state (`use-live-trace.ts:187`).
2. **Desktop App Close Mid-Turn:**
   - `main.ts:991-995` calls `daemonClient.dispose()` (`daemon-client.ts:1225-1236`) synchronously in `before-quit`, which calls `void launched.close()` **without awaiting** (`client.js:1214-1220` → `launch.js:496-555`).
   - Node's synchronous `process.once("exit", reapOnExit)` (`launch.js:561-603`) sends `SIGTERM` to the bridge and `SIGKILL` to `-pid` of the daemon (`L580`), bypassing `SAVES_IN_FLIGHT` and `StreamingGuard`!
   - **Daemon Orphan Hazard (`daemon-client.ts:572-579` vs `launch.js:259-281`):** `launchAndConnect` passes `rayuHome: ~/.rayu/desktop-instance`, while overriding `env.RAYU_HOME: ~/.rayu`. `readDaemonPidSync` (`launch.js:262`) reads `servers.json` from `rayuHome` (`~/.rayu/desktop-instance/servers.json`), whereas the daemon writes `servers.json` to `env.RAYU_HOME` (`~/.rayu/servers.json`). If `servers.json` is absent in `desktop-instance`, `reapOnExit` finds `pid === undefined` and **leaves the daemon running orphaned in the background**!
3. **Desktop Reopen / Restore:**
   - `app-store.ts:363-376` always boots to `activeRoute: "home"`, `activeSessionId: null`, `isStreamActive: false`, `pendingPermission: null`.
   - When the user clicks a session, `ipcClient.trace.listTurns(sessionId)` (`ipc-client.ts:3552-3585`) checks `runtimeTurns` (from `desktop-sessions.json`) **first** (`L3554-3559`): **if `cachedTurns.length > 0`, it returns cached turns immediately and NEVER calls `bridge.harness.getHistory()`**.
   - Only when `runtimeTurns` has no turns for that session does it call `getHistory(sessionId)` and reconstruct turns via `mapHistoryMessagesToTurns` (`harness-adapter.ts:338-438`).

---

### 2. Live State vs Restored State: 14 Concrete Divergence Mechanisms

| # | Aspect | Live State (Before Close / During Turn) | Restored State (After Reopen) | Exact Code Cause & File:Line |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **In-flight text & reasoning before `TurnDone`** | Visible streaming text (`liveTurn.answerIntro`) and pulse indicator. | **Completely gone** on Desktop reopen; if daemon was `SIGKILL`ed before stream ended, missing from Rust `~/.rayu/sessions/` too. | Desktop saves only in `onComplete` (`chat-stream.tsx:398-405`); Rust saves assistant message only after provider stream ends (`turn_streaming_mpsc.rs:1320`); `reapOnExit` sends `SIGKILL` (`launch.js:580`). |
| **2** | **Parallel (`batch`) & sibling tool results mid-turn** | Subcalls finish in parallel; live `ToolStart`/`ToolExec` visible. | If killed mid-`batch` or mid-tool-loop, **finished sibling results vanish** and dangling `ToolUse`s become synthetic error results (`TOOL_OUTPUT_MISSING_TEXT`). | `batch.rs:283-391` runs subcalls in memory with 0 saves; `turn_streaming_mpsc.rs:1819-1960` saves only after the entire `for` loop (`L1958-1960`); `agent.rs:1080-1150` repairs missing outputs as errors. |
| **3** | **Local `desktop-sessions.json` shadowing daemon history** | Turn is active (or finishes headless in orphaned daemon, or runs in CLI/VS Code). | If session already had ≥1 completed turn in `desktop-sessions.json`, **new/post-close/CLI turns never appear**; older sessions/turns (>50 / >500) are silently evicted. | `ipc-client.ts:3554-3559` returns `cachedTurns` and skips `getHistory()`; `storage-bridge.ts:210-211, 219-220` slices `(0, 50)` / `(-500)`. |
| **4** | **Active turn status, timer & `SessionRecovery`** | Turn active, `Working · Xs` ticking from prompt start. | Boots to `home`, `isStreamActive: false`; if orphaned daemon still emits events, UI creates a bogus **`"Live daemon turn"`** with timer reset to `1s`. | `app-store.ts:363-376`; `harness-adapter.ts:1315` drops `SessionStatus` & `SessionRecovery`; `chat-stream.tsx:498-504` fabricates `"Live daemon turn"`. |
| **5** | **Pending permission prompts** | Blocking `PermissionRequest` banner shown; turn paused waiting on user. | **Banner disappears**; no pending prompt is rehydrated on attach. | `app-store.ts:374` resets `pendingPermission: null`; `translate.rs:2868-2925` does not replay pending permission requests. |
| **6** | **Tool card fidelity & parallel `batch` unpacking** | Typed `FileReadStep`, `ListStep`, `search`, Excel/Slide previews, `TurnOutputArtifact`, unpacked `batch` steps, 2400-char output. | **Every tool & every `batch` collapses to generic `"tool execution"`** `ShellCommandStep` with 1200-char output; `outputArtifact` lost. | `mapHistoryMessagesToTurns` (`harness-adapter.ts:35-46, 414-425`) omits `tool` from `HarnessHistoryMessageLike` and ignores `HistoryMessage.tool` (`events.rs:656`). |
| **7** | **Failed tool status (`exitCode` / `statusLabel`)** | Failed tool shows red `Failed`, `exitCode: 1`, `isFailed: true`. | **Shows green `Success` with `exitCode: 0`** even when Rust prepended `"Error: "`. | `render.rs:602-611` prepends `"Error: "`, while `harness-adapter.ts:415-425` hardcodes `exitCode: 0, statusLabel: "Success"`. |
| **8** | **Timeline order, narration notes & phase groups** | Interleaved `timeline` (`note` + `group` entries) with dynamic titles (`"Read files, ran commands"`). | `notes: []`, `timeline: undefined`, intermediate narration concatenated into `answerIntro`, single group `"Ran N tools"`. | `harness-adapter.ts:367-379` never builds `notes` or `timeline` from history rows. |
| **9** | **User & tool-result images** | Attached user images and tool screenshots visible in turn. | **All images missing** on daemon history restore. | `ipc-client.ts:3572` passes only `history.messages` to `mapHistoryMessagesToTurns`, discarding `history.images` (`events.rs:48`). |
| **10** | **Turn duration (`workedDuration`)** | Real wall-clock duration (e.g. `"42s"`, `"3m 12s"`). | **Always `"1s"`** for every daemon-restored turn. | `ResponseStats.duration_secs` is not persisted in Rust (`events.rs:625`, `response_stats.rs:82`), and `formatDurationSeconds(undefined)` returns `"1s"` (`harness-adapter.ts:89`). |
| **11** | **KV cache %, credits, timestamp & inline diff** | Live `kvCachePct` (init `94`), `credits` (init `"0.08 cr"`), `"Just now"`. | `kvCachePct` defaults to `94` if cache-read is 0 (and sums across rounds differently from last-call live); `credits` `"0.00 cr"` if absent; `timestamp: "History"`; `diffCard: EMPTY_DIFF`. | `harness-adapter.ts:350-385` vs `use-live-trace.ts:301-304` & `harness-adapter.ts:1263-1283`. |
| **12** | **System, background-task & error history rows** | Errors shown in answer/toast; compaction & background notices shown in CLI. | **Silently dropped** when restoring from daemon history. | `render.rs:429-496` emits `"system"`, `"background_task"`, `"error"`, whereas `harness-adapter.ts:392-434` handles only `user`/`tool`/`assistant`. |
| **13** | **Persisted reasoning visibility** | `reasoning_delta` discarded (`harness-adapter.ts:901-904`); reasoning never shown in `answerIntro`. | Under `Full`/`Compact` `reasoning_display`, **italic reasoning markdown leaks into restored `answerIntro`**! | `render.rs:34-53, 625-627` prepends `format_reasoning_markup` to restored assistant `content`. |
| **14** | **Session metadata, permission mode, compacted prefix & Cloud fallback** | Selected model, effort, permission mode, branch, live `ses_*` Cloud turns. | `sessions.list()` fabricates `claude-opus-5-5`/`Medium`/`main`/`kvWarmPct: 94`; attach overwrites session permission mode with global `desiredPermissionMode`; compacted history >64 msgs unreachable (`GetCompactedHistory` unbridged); `ses_*` Cloud fallback sessions exist only in `desktop-sessions.json` (never `~/.rayu/sessions/`). | `harness-adapter.ts:250-271`; `daemon-client.ts:791, 862`; `render.rs:20, 147-229`; `ipc-client.ts:3466, 3564`. |

### E9 Hypothesis Assessment & Unverified Items
- **H1 (Two sources of truth) & H2 (Lossy protocol) & H8 (No snapshot/resync or mid-turn checkpointing):** **Strongly Confirmed.** Both the local `desktop-sessions.json` shadowing cache and the lossy `ApiEvent::History` → `mapHistoryMessagesToTurns` mapping guarantee live and restored state diverge, while Rust's post-loop `session.save()` + Electron's `reapOnExit` `SIGKILL`/orphan bug lose parallel tool state mid-turn.
- **What could not be verified in E9:** Empirical live reproduction of closing Electron mid-`batch` and inspecting the exact on-disk `~/.rayu/sessions/<id>.json`, `.jsonl`, `servers.json`, and `~/.rayu/desktop-sessions.json` state (specifically confirming on macOS whether `launch.js:262`'s `rayuHome` vs `env.RAYU_HOME` mismatch orphans the daemon vs `SIGKILL`s it in the packaged/dev app).

---

## Cross-Experiment Hypothesis Scorecard (`H1`–`H8`, Updated with `audit-1.md` + `audit-2.md`)

| Hypothesis | Verdict After E1, E2, E3, E5, E6, E9, E10 | Supporting Experiments |
| :--- | :--- | :--- |
| **H1 — Two sources of truth** | **CONFIRMED** | E1, E2, E3, E5, E6, E9, E10 |
| **H2 — Lossy protocol** | **CONFIRMED** (`45/103` `ServerEvent`s dropped in `translate.rs` + `21/56` `ApiEvent`s dropped/no-op in UI + missing `seq`/`turn_id`/`started_at`/`duration_secs`) | E1, E5, E9 |
| **H3 — Text scraping** | **PARTIALLY CONFIRMED (Localized)** (Primary transport is NDJSON, not CLI stdout, but 6 regex/prose parsers exist as workarounds for H2 gaps) | E5 |
| **H4 — Hardcoded UI assumptions** | **CONFIRMED** | E1, E2, E3, E6, E9, E10 |
| **H5 — Duplicated logic** | **CONFIRMED** (21 duplicated subsystems across retry, permissions, context, compaction, persistence + second Electron Cloud agent loop) | E2, E3, E6, E10 |
| **H6 — Hand-built UI per feature** | **CONFIRMED** (`24.2%` curated contract / `6.7%` all engine surfaces) | E1 |
| **H7 — Slow data path** | **NOT TESTED** *(requires E7)* | — |
| **H8 — Engine lacks guaranteed terminal events / truthful stall-crash state** | **PARTIALLY CONFIRMED** (`TurnStopped`+`TurnDone` double-complete bug, unsolicited `error` dropped, `question_request` hang, `SIGKILL`/orphan mid-batch; full stall test pending E8) | E5, E9, E10 |

---

## Updated Decision Log (`root-cause.md` §8)

| Question | Evidence (Experiment) | Decision | Date |
| :--- | :--- | :--- | :--- |
| **Does the desktop own state the engine should own?** | E3, E5, E9, E10 | **Yes (confirmed).** Desktop owns model/effort/permission mode (`localStorage`), preferences (`desktop-settings.json`), session/turn caches (`desktop-sessions.json`), pins/archives (`desktop-sidebar.json`), and local Swarm/Automations/Telegram state, shadowing engine history and overwriting per-session mode on attach. Move all session/inference state to engine snapshots + sequenced deltas. | 2026-11-24 |
| **Does the engine emit enough structured events?** | E5 | **No — two-sided gap.** Engine internal protocol has 103 events, `translate.rs` drops 45 (including `BatchProgress`, `BashProgress`, `Compaction`, `Swarm*`, `Todos`, `Memory*`) and strips `seq`/`turn_id`/`started_at`/`tool_duration_ms`/`stop_reason`; meanwhile Desktop drops 21 of the 56 `ApiEvent`s the bridge *already* emits (including `text_replace`, `connection_phase`, `session_status`, `model_info`, `permission_mode_changed`, `question_request`, `session_recovery`). | 2026-11-24 |
| **Does the desktop scrape text?** | E5 | **Partially (6 targeted regex/prose parsers, not CLI stdout).** Primary wire transport is structured NDJSON, but Desktop regex-scrapes `batch` text output, synthetic user messages, permission descriptions, and error messages, and `translate.rs` scrapes TUI markdown for `BackgroundProgress`. | 2026-11-24 |
| **What is real feature coverage?** | E1 (`audit-1.md`) | **24.2% of curated Harness contract** (`44/182`) and **6.7% across all Rust engine surfaces** (`44/657`). **H6 confirmed.** | 2026-11-24 |
| **How many hardcoded values must move?** | E2 (`audit-1.md`) | **357 engine-derived production literals** (of 481 total hits across 8 categories). **H4 confirmed.** | 2026-11-24 |
| **Is logic duplicated across CLI and desktop?** | E6 *(E4 live diff pending)* | **Yes (confirmed by E6).** 21 duplicated logic areas across retry, permissions, context/tokens/files/git/extensions, compaction, and persistence, plus a full second agentic LLM/tool loop in `auth-bridge.ts`. | 2026-11-24 |
| **Is the data path the bottleneck?** | E7 | *(Pending E7)* | |
| **Does the UI lie when the engine stalls or dies?** | E8 | *(Pending E8 — preliminary E5/E9 evidence: drops `connection_phase`, `session_status`, unsolicited `error`, `text_replace`, `question_request`, and resets elapsed timer on reconnect.)* | |
| **Is a UI technology change justified?** | Section 5.4 conditions | *(Pending E4, E7, E8 and Section 5.4 measurements after contract fixes.)* | |

---

## Consolidated List: What Could Not Be Verified in Phase 1 (`audit-2.md`)

1. **Live 3-stream event capture (E5):** Capturing raw daemon `ServerEvent`s, Electron `rayu:harness:event` frames, and UI reducer outputs in a live session with a scripted fake model could not be run under Phase 1's no-source-modification rule; counts and drop points were verified statically across the full `events.rs` → `translate.rs` → `client.js` → `daemon-client.ts` → `harness-adapter.ts` → `chat-stream.tsx` → `use-live-trace.ts` chain.
2. **Live mid-turn parallel-tool crash & orphan reproduction (E9):** Empirically killing Electron mid-`batch` and inspecting disk files (`~/.rayu/sessions/<id>.json`, `.jsonl`, `servers.json`, `~/.rayu/desktop-sessions.json`) was not executed in Phase 1; in particular, whether `launch.js:262` (`rayuHome`) vs `daemon-client.ts:577` (`env.RAYU_HOME`) leaves an orphaned daemon on macOS during `before-quit` vs `SIGKILL`ing it was deduced statically from source and not observed in a live OS process table.
3. **Live Cloud fallback HTTP & concurrent OAuth refresh race (E6):** Live gateway network behavior for `auth-bridge.ts:1075-1471` (`streamCloudChat`) and concurrent refresh-token rotation against the Rust daemon could not be captured without credentials and instrumentation.
4. **CLI vs Desktop behavioral diff (E4) & StreamBatcher latency benchmarks (E7):** Outside this audit's scope (`E5`, `E6`, `E9`) and require live execution runs.
