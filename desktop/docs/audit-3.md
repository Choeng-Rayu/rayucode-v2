# Audit 3: Lost Response, Injected Prompts, and Session State Reconstruction

**Scope:** Phase 1 read-only investigation per `desktop/docs/session-load-bug.md` (§3.1 & §4). Zero source files modified; zero files read outside the repository and `/tmp/rayu-audit/redacted/`; no live model calls executed.

**Inspected redacted session artifacts (`/tmp/rayu-audit/redacted/`):**
- `session_blossom_1795431758196_4f629defc979c2ce.json`
- `session_blossom_1795431758196_4f629defc979c2ce.bak`
- `session_orangutan_1795431257303_2f7f6b187491df82.json`
- `session_orangutan_1795431257303_2f7f6b187491df82.bak`
- `desktop-sessions.trimmed.json`

---

## Executive Summary

1. **Origin of `"do this ordinary coding task"`:** Neither `session_blossom_...` nor `session_orangutan_...` is a real user coding conversation. Both were created by two separate runs of the Rust unit test `fable_guardrail_reconsideration_recovers_the_streaming_turn` (`crates/rayucode-app-core/src/agent_tests.rs:2804-2837`), which ran `Agent::new(provider, registry)` against a mock provider without redirecting `RAYU_HOME` away from `~/.rayu` (`agent_tests.rs:2806`).
2. **Origin of `"Reconsidered and completed safely"`:** This string is **not** an engine status message. Its sole occurrence in the repository is the mock `StreamEvent::TextDelta` emitted on call 4 by `FableGuardrailProvider::complete` (`crates/rayucode-app-core/src/agent_tests.rs:2776-2780`, asserted at `L2834`) after calls 1–3 return mock `stop_reason: Some("refusal")` with empty text (`L2769-2774`).
3. **Real engine & UI bugs confirmed by these artifacts:**
   - **Unit-test session leakage:** `fable_guardrail_reconsideration_recovers_the_streaming_turn` (`agent_tests.rs:2804-2837`) writes live session JSON files into `~/.rayu/sessions/`, explaining why an ~11ms mock `claude-fable-5` session appeared in the Desktop sidebar and was later opened/resumed.
   - **Unmarked engine-injected prompts:** `Agent::maybe_reconsider_fable_guardrail` (`crates/rayucode-app-core/src/agent/response_recovery.rs:85-91`) appends the 3 reconsideration prompts using `self.add_message(Role::User, ...)` (`display_role: None`). As a result, `crates/rayucode-base/src/session/render.rs:487-496` emits them as `role: "user"` and `mapHistoryMessagesToTurns` (`desktop/src/lib/harness-adapter.ts:392-413`) splits one engine turn into 4 separate Desktop turns (3 user bubbles with empty answers + 1 bubble with `"Reconsidered and completed safely"`).
4. **Missing-response classification (`R1–R6`):** **Proven as R1 (for these session files, via unit-test mock)** — no coding-task answer text ever existed in the raw logs because the mock provider only ever emitted 3 empty refusals and `"Reconsidered and completed safely"`. **R4, R5, and R6** (as well as **R2** and **R3** for these session files) are **ruled out**.

---

## 1. Verification of Claims (a)–(d), Session Relationship, and Schema Differences

### Claim (a): Engine files contain 5 user messages and 1 assistant message whose text is only `"Reconsidered and completed safely"`
- **Confirmed for `blossom.json`, `blossom.bak`, and `orangutan.json`; `.bak` nuance for `orangutan.bak`:**
  - `session_blossom_1795431758196_4f629defc979c2ce.json`, `session_blossom_1795431758196_4f629defc979c2ce.bak`, and `session_orangutan_1795431257303_2f7f6b187491df82.json` all have `messages` length **6**:
    - `messages[0..=4]` (5 messages): `"role": "user"`.
    - `messages[5]` (1 message): `"role": "assistant"`, with single content block `messages[5].content[0]` = `{"type": "text", "text": "Reconsidered and completed safely"}`.
  - **Exception (`orangutan.bak`):** `session_orangutan_1795431257303_2f7f6b187491df82.bak` has only **2** messages (`messages[0]` system context, `messages[1]` `"do this ordinary coding task"`), `"status": "Active"`, and `"updated_at": "2026-11-23T10:54:17.304656Z"`.

**Messages in `session_blossom_1795431758196_4f629defc979c2ce.json` (total span 11.7 ms):**

| Index | Message ID | `role` | `display_role` | Timestamp | `content[0].text` preview |
|---|---|---|---|---|---|
| `messages[0]` | `message_1795431758197_13847447113904920028` | `user` | `"system"` | `2026-11-23T11:02:38.197136Z` | `<system-reminder>\n# Session Context...` |
| `messages[1]` | `message_1795431758197_5122065540534252134` | `user` | *omitted* | `2026-11-23T11:02:38.197749Z` | `do this ordinary coding task` |
| `messages[2]` | `message_1795431758201_17161590832042570094` | `user` | *omitted* | `2026-11-23T11:02:38.201870Z` | `Reassess the user's request using its full context...` |
| `messages[3]` | `message_1795431758204_2962682518442330133` | `user` | *omitted* | `2026-11-23T11:02:38.204197Z` | `Review the request again and distinguish legitimate...` |
| `messages[4]` | `message_1795431758206_7589780105152053226` | `user` | *omitted* | `2026-11-23T11:02:38.206500Z` | `Perform one final, independent policy check...` |
| `messages[5]` | `message_1795431758208_6317031329344023701` | `assistant` | *omitted* | `2026-11-23T11:02:38.208851Z` | `Reconsidered and completed safely` |

**Messages in `session_orangutan_1795431257303_2f7f6b187491df82.json` (total span 9.1 ms):**

| Index | Message ID | `role` | `display_role` | Timestamp | `content[0].text` preview |
|---|---|---|---|---|---|
| `messages[0]` | `message_1795431257303_12116932253489299839` | `user` | `"system"` | `2026-11-23T10:54:17.303937Z` | `<system-reminder>\n# Session Context...` |
| `messages[1]` | `message_1795431257304_1470836620345308234` | `user` | *omitted* | `2026-11-23T10:54:17.304643Z` | `do this ordinary coding task` |
| `messages[2]` | `message_1795431257307_627895583224074364` | `user` | *omitted* | `2026-11-23T10:54:17.307578Z` | `Reassess the user's request using its full context...` |
| `messages[3]` | `message_1795431257309_15580441031751626780` | `user` | *omitted* | `2026-11-23T10:54:17.309419Z` | `Review the request again and distinguish legitimate...` |
| `messages[4]` | `message_1795431257311_7674051547667290470` | `user` | *omitted* | `2026-11-23T10:54:17.311229Z` | `Perform one final, independent policy check...` |
| `messages[5]` | `message_1795431257313_707660267774450811` | `assistant` | *omitted* | `2026-11-23T10:54:17.313028Z` | `Reconsidered and completed safely` |

### Claim (b): Only message 0 has `display_role`, and messages 2–4 do not
- **Confirmed:** Across both sessions, only `messages[0]` carries `"display_role": "system"`.
- `messages[1]`, `messages[2]`, `messages[3]`, `messages[4]`, and `messages[5]` all omit `display_role` (`StoredMessage.display_role` uses `#[serde(default, skip_serializing_if = "Option::is_none")]` in `crates/rayucode-session-types/src/lib.rs:291-292`).

### Claim (c): Model `claude-fable-5` with effort `low` (`blossom`) or none (`orangutan`)
- **Confirmed:**
  - `blossom.json` / `blossom.bak`: `"provider_key": "claude"`, `"model": "claude-fable-5"`, `"reasoning_effort": "low"`.
  - `orangutan.json` / `orangutan.bak`: `"provider_key": "claude"`, `"model": "claude-fable-5"`, `"reasoning_effort"` key absent (`None`).

### Claim (d): Desktop store keeps separate `turns` with 4 turns pointing at this session
- **Confirmed (with `sessions: {}` detail):**
  - `desktop-sessions.trimmed.json` has `"sessions": {}` (0 session summary entries for this ID) and **4** turn entries under `"turns"` (`turns.35` through `turns.38`), all referencing `"sessionId": "session_blossom_1795431758196_4f629defc979c2ce"`:

| JSON Path | `id` | `userPrompt` | `answerIntro` | `groups` / `answerBullets` | `diffCard.id` |
|---|---|---|---|---|---|
| `turns.35` | `hist_session_blossom_1795431758196_4f629defc979c2ce_1` | `"do this ordinary coding task"` | `""` | `[]` / `[]` | `"diff_live_empty"` |
| `turns.36` | `hist_session_blossom_1795431758196_4f629defc979c2ce_2` | `"Reassess the user's request using its full context..."` | `""` | `[]` / `[]` | `"diff_live_empty"` |
| `turns.37` | `hist_session_blossom_1795431758196_4f629defc979c2ce_3` | `"Review the request again and distinguish..."` | `""` | `[]` / `[]` | `"diff_live_empty"` |
| `turns.38` | `hist_session_blossom_1795431758196_4f629defc979c2ce_4` | `"Perform one final, independent policy check..."` | `"Reconsidered and completed safely"` | `[]` / `[]` | `"diff_live_empty"` |

### Relationship between `blossom` and `orangutan`, Desktop Target, and Schema Differences
- **Origin & relationship:** Both sessions have `"parent_id": null` and identical `"working_dir": "/Users/lyyeakkhai/workspace/rayu/rayucode-v2/crates/rayucode-app-core"`. Neither is forked from the other; they are **two independent runs** of the same unit test 8m 21s apart:
  - `orangutan`: `created_at: "2026-11-23T10:54:17.303816Z"`, initial `env_snapshots[0].pid: 78870`.
  - `blossom`: `created_at: "2026-11-23T11:02:38.196843Z"`, initial `env_snapshots[0].pid: 92939`.
- **Which session Desktop references:** `desktop-sessions.trimmed.json` points exclusively to `session_blossom_1795431758196_4f629defc979c2ce`. Unlike `orangutan` (1 `env_snapshot`, never resumed), `blossom` has **7** `env_snapshots`: 1 `"create"` (`pid: 92939`) plus 6 `"resume"` snapshots across PIDs `10237`, `40694`, `55121`, and `57847` (`last_pid: 57847`, `last_active_at: "2026-11-24T10:40:43.908426Z"`, `updated_at: "2026-11-24T10:40:58.922432Z"`).
- **Schema & field comparison (`blossom.json` vs `orangutan.json`, and `.json` vs `.bak`):**
  - Top-level keys in `blossom.json` absent from `orangutan.json`: `"reasoning_effort"` (`"low"`), `"testing_build"` (`"self-dev"`).
  - Top-level keys in `orangutan.json` absent from `blossom.json`: **none** (`[]`). Notably, **both** files contain `"last_pid"` and `"last_active_at"` (`blossom`: `last_pid: 57847`, `last_active_at: "2026-11-24T10:40:43.908426Z"`; `orangutan`: `last_pid: 78870`, `last_active_at: "2026-11-23T10:54:17.303897Z"`).
  - Nested/value differences: `blossom.json` has `"is_canary": true` and 7 `env_snapshots` (`snap[2]` and `snap[3]` with `working_git` populated, `snap[2..6]` with `is_canary: true` and `testing_build: "self-dev"`); `orangutan.json` has `"is_canary": false` and 1 `env_snapshot` (`snap[0]`, `reason: "create"`).
  - `blossom.json` vs `blossom.bak`: identical except `"status"` (`"Closed"` vs `"Active"`) and `"updated_at"` (`"2026-11-24T10:40:58.922432Z"` vs `"2026-11-24T10:40:43.909934Z"`).
  - `orangutan.json` vs `orangutan.bak`: differ in `"status"` (`"Closed"` vs `"Active"`), `"updated_at"` (`"2026-11-23T12:30:46.196506Z"` vs `"2026-11-23T10:54:17.304656Z"`), and `"messages"` (6 vs 2).

---

## 2. Engine and Desktop Code Analysis

### 2.1 Where `display_role` is Set and Read
- **Schema definition:** `StoredMessage.display_role: Option<StoredDisplayRole>` (`crates/rayucode-session-types/src/lib.rs:286-299`) and `StoredDisplayRole::{System, BackgroundTask}` (`L301-306`).
- **Write helpers:**
  - `Session::add_message` (`crates/rayucode-base/src/session.rs:1332`) delegates with `display_role: None`.
  - `Session::add_message_with_display_role` (`session.rs:1344-1351`) and `add_message_ext_with_display_role` (`session.rs:1363-1377`) allow callers to attach `Some(StoredDisplayRole::System)` or `Some(StoredDisplayRole::BackgroundTask)`.
- **Why `messages[0]` has `"display_role": "system"`:** `Session::ensure_initial_session_context_message` (`crates/rayucode-base/src/session.rs:1016-1023`) explicitly calls `self.add_message_with_display_role(Role::User, ..., Some(StoredDisplayRole::System))`.
- **Other Rust write sites tagging synthetic/internal messages:**
  - `crates/rayucode-base/src/session.rs:1092-1099` (`append_fork_notice` → `System`)
  - `crates/rayucode-app-core/src/agent.rs:796-800, 865-872` (`System`)
  - `crates/rayucode-app-core/src/agent/messages.rs:235-242` (`System`)
  - `crates/rayucode-app-core/src/agent/turn_execution.rs:188, 256-263` (`System`)
  - `crates/rayucode-app-core/src/agent/interrupts.rs:12-17, 418-422` (`System` / `BackgroundTask`)
  - `crates/rayucode-app-core/src/ambient/runner.rs:430-432, 513-515` (`System`)
  - `crates/rayucode-app-core/src/server/live_turn.rs:160-169, 294, 451`
  - `crates/rayucode-tui/src/tui/app/local.rs:515-522, 575-582` (`BackgroundTask`)
  - `crates/rayucode-tui/src/tui/app/turn_system_reminder.rs:17-24` (`System`)
- **Rust read sites:**
  - `is_visible_conversation_message` (`crates/rayucode-base/src/session.rs:88-92`)
  - `render_messages` (`crates/rayucode-base/src/session/render.rs:74, 124, 487-496`)
  - `crates/rayucode-base/src/session/render/response_stats.rs:8`
  - `crates/rayucode-base/src/transcript_sample.rs:530`
  - `crates/rayucode-app-core/src/tool/session_search.rs:1714, 1741-1745`
  - `crates/rayucode-tui/src/tui/app/state_ui_messages.rs:31-33`
  - `crates/rayucode-tui/src/tui/session_picker/loading.rs:1013-1016, 1493-1533`
  - `crates/rayucode-harness-api-server/src/translate.rs:3285, 3689-3697`
- **Desktop (`desktop/src/`, `desktop/electron/`):** **Never reads `display_role`** (0 references). Desktop receives the rendered `role` string already mapped by `render.rs:487-496`.

### 2.2 Where Reassessment Prompts are Created and Stored
- **Prompt array:** `Agent::FABLE_GUARDRAIL_RECONSIDERATION_PROMPTS: [&'static str; 3]` in `crates/rayucode-app-core/src/agent/response_recovery.rs:53-57`:
  1. `"Reassess the user's request using its full context..."` (`L54`)
  2. `"Review the request again and distinguish legitimate coding..."` (`L55`)
  3. `"Perform one final, independent policy check..."` (`L56`)
- **Trigger conditions:**
  - `Agent::is_guardrail_stop_reason` (`response_recovery.rs:43-51`) returns `true` for `"refusal"`, `"content_filter"`, `"safety"`, or substrings `"guardrail"` / `"policy_violation"`.
  - `Agent::should_reconsider_fable_guardrail` (`response_recovery.rs:96-105`) triggers when `Self::is_guardrail_stop_reason(stop_reason) && model.to_ascii_lowercase().contains("fable-5") && attempts < max_attempts` (`max_attempts = 3`).
- **Creation & storage:** `Agent::maybe_reconsider_fable_guardrail` (`response_recovery.rs:62-94`) logs a warning (`L79-84`), appends the prompt with `self.add_message(Role::User, vec![ContentBlock::Text { text: prompt.to_string(), cache_control: None }])` (`L85-91`, leaving `display_role: None`), and immediately persists via `self.session.save()?` (`L92`).
- **Call sites:** Streaming loop at `crates/rayucode-app-core/src/agent/turn_streaming_mpsc.rs:1383-1391` and non-streaming loop at `crates/rayucode-app-core/src/agent/turn_loops.rs:1014-1017`.

### 2.3 Where `"Reconsidered and completed safely"` is Produced
- **Sole occurrence in repo:** `FableGuardrailProvider::complete` in `crates/rayucode-app-core/src/agent_tests.rs:2745-2802` (test `fable_guardrail_reconsideration_recovers_the_streaming_turn` at `L2804-2837`):
  - On calls `<= 3`: emits `StreamEvent::MessageEnd { stop_reason: Some("refusal".to_string()) }` with no text (`L2769-2774`).
  - On call `4`: emits `StreamEvent::TextDelta("Reconsidered and completed safely".to_string())` and `StreamEvent::MessageEnd { stop_reason: Some("end_turn".to_string()) }` (`L2776-2785`).
  - `L2833-2836` asserts `text.contains("Reconsidered and completed safely")`.
- **Real engine behavior when guardrail retries are exhausted without visible output:** `Agent::provider_guardrail_notice` (`response_recovery.rs:110-142`) formats `"Provider guardrail stopped the response (stop_reason: ...). The model declined to answer this request..."` and emits `ServerEvent::ProviderGuardrail` (`turn_streaming_mpsc.rs:1437-1440`), which is not stored in `session.messages`.

### 2.4 Where `.json` and `.bak` Files are Written (Incremental vs Turn-End Persistence)
- **Persistence is incremental throughout a turn (not only at turn end):**
  1. User prompt saved before calling the provider: `append_user_context_message_with_display_role` (`crates/rayucode-app-core/src/agent/turn_execution.rs:200-205, 310-314`).
  2. Each non-empty assistant response saved immediately after stream ends: `turn_streaming_mpsc.rs:1303-1325` (`L1320`). Refused attempts with empty `content_blocks` skip saving (`L1323-1325`).
  3. Each Fable reconsideration prompt saved immediately on injection: `response_recovery.rs:92`.
  4. Tool results and other mid-turn additions also call `self.session.save()?` (`turn_streaming_mpsc.rs:1371, 1472, 1884, 1897, 1948, 1959, 1973`).
- **Snapshot vs JSONL journal and `.bak` creation:**
  - `Session::save()` → `save_inner` (`crates/rayucode-base/src/session/persistence.rs:600-887`):
    - Initial save writes the full `.json` snapshot via `checkpoint_snapshot` (`persistence.rs:335-362`, calling `storage::write_json_fast` at `L356`).
    - Subsequent appends within `MAX_SESSION_JOURNAL_BYTES` write deltas to `<session>.jsonl` via `storage::append_json_line_fast` (`L768`) unless metadata changes require a snapshot (`metadata_needs_snapshot` at `L683-688`, e.g. `status` `Active` → `Closed` when `snapshot_bytes_before < METADATA_SNAPSHOT_MAX_BYTES`) or vectors shrink/full-dirty (`L689-697`).
    - When `checkpoint_snapshot` runs, `storage::write_json_fast(snapshot_path, self)` rewrites `.json` and deletes `.jsonl` (`L356-359`).
  - `storage::write_json_fast` → `write_bytes_inner` (`crates/rayucode-storage/src/lib.rs:545-649`) writes `<path>.tmp.<pid>.<nonce>`, computes `let bak_path = path.with_extension("bak")` (`L598`), hard-links the previous `.json` to `.bak` on Unix (`L610-614`), and atomically renames the temp file into `path` (`L628`).
  - This explains `orangutan.bak` (the initial 2-message `"Active"` snapshot written at `turn_execution.rs:314` before `messages[2..5]` were journaled into `.jsonl` and later checkpointed into `orangutan.json` when closed at `12:30:46Z`) and `blossom.bak` (the `"Active"` snapshot at `10:40:43.909934Z` right before the `"Closed"` checkpoint 15 seconds later).

---

## 3. How Desktop Builds Turns and Why This Session Has 4 Turns

1. **Engine rendering (`crates/rayucode-base/src/session/render.rs:483-496`):**
   - `messages[0]` is dropped because `is_internal_system_reminder(msg)` matches `<system-reminder>` (`L483-485`).
   - Because `messages[1..=4]` have `display_role: None` and do not match `is_auto_poke_user_message` or `is_scheduled_task_message`, all four emit `role: "user"` (`L487-496`).
   - `messages[5]` emits `role: "assistant"`.
2. **Desktop IPC & caching (`desktop/src/lib/ipc-client.ts:3552-3585`):**
   - `ipcClient.trace.listTurns(sessionId)` calls `bridge.harness.getHistory(sessionId)` (`L3570`) and maps messages via `mapHistoryMessagesToTurns` (`L3572`).
   - When `turns.length > 0`, it replaces matching entries in `runtimeTurns` and calls `persistRuntimeSessions()` (`L3573-3579`), writing them into `~/.rayu/desktop-sessions.json`.
   - Separately, `ipcClient.sessions.list()` (`ipc-client.ts:3288-3322`) fetches live daemon sessions via `bridge.harness.listSessions()` (`L3293`) without writing daemon-only sessions into `runtimeSessions`, which is why `desktop-sessions.trimmed.json` contains `"sessions": {}` alongside the 4 cached `turns`.
3. **Turn splitting (`desktop/src/lib/harness-adapter.ts:293-438`):**
   - `classifySyntheticUserMessage` (`L293-336`) only filters `[Imported tool result:...]`, `Base directory for this skill:`, and `<system-reminder|command-message|local-command-stdout|local-command-caveat>`.
   - None of the 3 Fable reconsideration prompts matches those patterns, so `mapHistoryMessagesToTurns` hits `flushTurn()` on each `msg.role === "user"` (`L412-413`):
     - `messages[1]` → starts Turn 1 (`turns.35`), flushed with `answerIntro: ""` when `messages[2]` arrives.
     - `messages[2]` → starts Turn 2 (`turns.36`), flushed with `answerIntro: ""` when `messages[3]` arrives.
     - `messages[3]` → starts Turn 3 (`turns.37`), flushed with `answerIntro: ""` when `messages[4]` arrives.
     - `messages[4]` + `messages[5]` → starts Turn 4 (`turns.38`), flushed at end of loop (`L436`) with `answerIntro: "Reconsidered and completed safely"`.

---

## 4. Engine Logs/Traces Location and Recording of `stop_reason` / Refusals

- **Where logs live (verified from code; `~/.rayu` was not read):**
  - `rayucode_storage::logs_dir()` (`crates/rayucode-storage/src/lib.rs:201-203`) returns `<rayu_dir>/logs`, where `rayu_dir()` (`L163-175`) checks `RAYU_HOME`, `RAYU_CONFIG_DIR`, and otherwise defaults to `~/.rayu` → default path `~/.rayu/logs/`.
  - `Logger::new` (`crates/rayucode-logging/src/lib.rs:216-231`) creates/appends daily files named `rayu-YYYY-MM-DD.log` (`L221-222`) using line format `[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] [srv:...|ses:...|prv:...|mod:...] <message>` (`L233-236`). `Debug` entries are gated on `RAYU_TRACE` (`L42-44`).
- **Whether `stop_reason` / refusal indicator is recorded:**
  - **In session `.json` files (`StoredMessage`):** **No.** `StoredMessage` (`crates/rayucode-session-types/src/lib.rs:287-299`) has no `stop_reason` or refusal field, and empty refused responses produce empty `content_blocks` so they are never added to `session.messages` (`turn_streaming_mpsc.rs:1303-1325`).
  - **In daily engine logs (`rayu-YYYY-MM-DD.log`):** **Yes.**
    - Every Fable reconsideration attempt logs `WARN`: `"Fable 5 guardrail stopped the response (stop_reason={:?}); trying reconsideration prompt {}/{}"` (`crates/rayucode-app-core/src/agent/response_recovery.rs:79-84`).
    - Exhausted/unrecovered guardrail stops log `WARN`: `"PROVIDER_GUARDRAIL: turn ended with no visible output (stop_reason={:?}, reasoning_chars={})"` (`turn_streaming_mpsc.rs:1431-1436`, label from `response_recovery.rs:147-153`), and also emit a transient `ServerEvent::ProviderGuardrail { stop_reason, message }` (`turn_streaming_mpsc.rs:1437-1440`) on the live stream.

---

## 5. Runbook Diff and Missing-Response Classification (`R1–R6`)

### 5.1 Three-View Comparison (`session-load-bug.md` §4)
- **Raw Log (`blossom.json` / `orangutan.json`):** Contains 6 messages (`[0]` system context, `[1]` `"do this ordinary coding task"`, `[2..4]` 3 reconsideration prompts, `[5]` `"Reconsidered and completed safely"`). No coding answer exists in the raw session files.
- **Restored State (`desktop-sessions.trimmed.json`):**
  - First divergence occurs at **`messages[2]`** (`message_1795431758201_17161590832042570094`): because `display_role` is `None`, `render.rs:487-496` renders it as `role: "user"` and `mapHistoryMessagesToTurns` (`harness-adapter.ts:412-413`) flushes Turn 1 (`turns.35`) with `answerIntro: ""` and promotes `messages[2]` into a second user prompt. The same split repeats at `messages[3]` and `messages[4]`.
  - `messages[5]` (`message_1795431758208_6317031329344023701`) is preserved verbatim in `turns.38.answerIntro`.
- **Live Replay:** **Not executed** (live model calls disallowed during Phase 1 audit). If the user wishes to run an isolated live reproduction against real `claude-fable-5`, it can be tested without touching `~/.rayu` or the shared daemon via:
  ```bash
  RAYU_HOME=/tmp/rayu-live-repro cargo run --bin rayu -- run --no-update --socket /tmp/rayu-live-repro.sock "do this ordinary coding task"
  ```

### 5.2 Classification (`R1–R6`)

| Code | Hypothesis (`session-load-bug.md` §3.1) | Verdict for this session | Proven Evidence |
|---|---|---|---|
| **R1** | Model never produced an answer; loop kept refusing | **Proven (via mock provider)** | No real model call ran and no coding answer was ever produced. `FableGuardrailProvider::complete` (`agent_tests.rs:2769-2786`) intentionally sent 3 empty `stop_reason: "refusal"` events followed by `"Reconsidered and completed safely"`. |
| **R2** | Earlier attempt answered, later attempt overwrote | **Ruled out** | `FableGuardrailProvider` sends zero text on calls 1–3; `orangutan.bak` holds only `messages[0..1]`. In engine code (`turn_streaming_mpsc.rs:1303-1325`), non-empty assistant messages are appended, never overwritten. |
| **R3** | Streamed live but never persisted | **Ruled out** | `agent_tests.rs:2820-2836` records only `"Reconsidered and completed safely"` as streamed `TextDelta`, and that exact string is persisted in `messages[5]`. |
| **R4** | Persisted in raw log, filtered out on restore | **Ruled out** | Neither `blossom.json`/`.bak` nor `orangutan.json`/`.bak` contains any coding answer; `messages[5]` appears intact in `turns.38.answerIntro`. |
| **R5** | Race during session switch replaced full load | **Ruled out (for missing answer)** | The raw files on disk already lack any coding answer, matching the restored `turns.35`–`turns.38`. |
| **R6** | Schema/migration dropped older messages on load | **Ruled out** | All 6 messages deserialize cleanly: `messages[0]` is intentionally filtered as `<system-reminder>` and `messages[1..5]` all appear in `desktop-sessions.trimmed.json`. |

---

## 6. Proven vs Only Likely vs Could Not Check

### Proven
- **Test-origin & literal string:** Both `orangutan` and `blossom` were produced by two runs of `fable_guardrail_reconsideration_recovers_the_streaming_turn` (`agent_tests.rs:2804-2837`), and `"Reconsidered and completed safely"` originates solely from its mock provider (`L2778`).
- **Claims (a)–(d):** Verified with exact message indexes and JSON paths across `/tmp/rayu-audit/redacted/*` (with `.bak` difference on `orangutan.bak` and `"sessions": {}` in `desktop-sessions.trimmed.json`).
- **Schema comparison:** Corrected that **both** `blossom.json` and `orangutan.json` include `last_pid` and `last_active_at`; only `reasoning_effort` and `testing_build` are extra keys in `blossom.json`.
- **Root cause of 3 phantom user turns:** `maybe_reconsider_fable_guardrail` (`response_recovery.rs:85-91`) uses `add_message(Role::User, ...)` (`display_role: None`), causing `render.rs:487-496` to emit `role: "user"` and `mapHistoryMessagesToTurns` (`harness-adapter.ts:392-413`) to create `turns.35`–`turns.38`.
- **Incremental save & `.bak` mechanism:** `Session::save()` (`persistence.rs:600-887`) checkpoints snapshots via `write_json_fast` (`storage/src/lib.rs:545-649`, hard-linking prior `.json` to `.bak`) and journals intermediate appends via `.jsonl`.
- **R1–R6 verdict for these files:** R4, R5, R6 (and R2, R3) are ruled out; missing coding answer fits R1 (mock only ever produced 3 refusals + mock completion text).

### Only Likely
- **Screenshot B identity:** Desktop Screenshot B almost certainly rendered `session_blossom_1795431758196_4f629defc979c2ce`, supported by `desktop-sessions.trimmed.json` pointing exclusively to `blossom` and `blossom` having 6 resume snapshots (one at `2026-11-24T09:58:42Z` = 16:58 +07:00), while `orangutan` was never resumed. However, `blossom.json` and `desktop-sessions.json` were modified afterward (`17:40` and `18:23`), so their exact byte state at `16:58` is inferred.
- **`orangutan.json` close timestamp (`12:30:46Z`):** Likely written by a daemon/CLI close sweep transitioning the leaked `"Active"` session to `"Closed"`, triggering `metadata_requires_snapshot` → `checkpoint_snapshot` (`persistence.rs:683-688`) and hard-linking the 2-message snapshot to `orangutan.bak`.

### Could Not Check
- Contents of `~/.rayu/logs/rayu-2026-11-23.log` and `rayu-2026-11-24.log` (not read per boundary restricting inspection to the repository and `/tmp/rayu-audit`).
- Whether live API requests to a real `claude-fable-5` endpoint trigger false guardrail refusals on ordinary coding tasks (no live model call executed).
- Exact state of the session and Desktop store files at `16:58` before subsequent saves at `17:40` and `18:23`.
- Whether additional leaked unit-test session files exist inside `~/.rayu/sessions/` (not inspected per boundary).
