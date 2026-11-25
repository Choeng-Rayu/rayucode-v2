# Audit 5: Injected Prompts, Provenance Model, and Refusal Recovery Loop

**Scope:** Phase 1 read-only code audit per `desktop/docs/session-load-bug.md` (§3.3, §5, & §8). Zero source files modified.

---

## Executive Summary

1. **Where reassessment prompts are created, stored, and what role they get:** `Agent::maybe_reconsider_fable_guardrail` (`crates/rayucode-app-core/src/agent/response_recovery.rs:62-94`) injects up to **3** escalating prompts from `Agent::FABLE_GUARDRAIL_RECONSIDERATION_PROMPTS` (`L53-57`) using `self.add_message(Role::User, ...)` (`L85-91`), which delegates with **`display_role: None`** (`crates/rayucode-base/src/session.rs:1332`) and saves immediately (`L92`). Because the text does not start with `<system-reminder>`, `render_messages` (`crates/rayucode-base/src/session/render.rs:483-496`) emits them as `role: "user"`, and Desktop renders them as 3 extra right-aligned user chat bubbles (`desktop/src/lib/harness-adapter.ts:293-336, 392-413`).
2. **Where `"Reconsidered and completed safely"` is produced:** It is **not** a production engine status string. Its sole occurrence in the entire repository is the hardcoded mock `StreamEvent::TextDelta` on call 4 of `FableGuardrailProvider::complete` inside `crates/rayucode-app-core/src/agent_tests.rs:2745-2802` (`L2776-2780`, asserted at `L2833-2836`). Real exhausted refusals instead produce `Agent::provider_guardrail_notice` (`response_recovery.rs:110-142`) and `ServerEvent::ProviderGuardrail` (`turn_streaming_mpsc.rs:1437-1440`).
3. **Provenance gap in message models:** While persisted `StoredMessage` has an optional `display_role` (`crates/rayucode-session-types/src/lib.rs:287-306`), `render.rs:483-511` flattens it away, `HistoryMessage` (`crates/rayucode-harness-api/src/events.rs:643-657`) carries no provenance/origin/visibility/attempt/outcome field, and Desktop's `ExecutionTurn` (`desktop/src/lib/ipc-client.ts:213-246`) has no field distinguishing engine-injected items from user input.
4. **Reassessment cap:** Up to **3** reconsideration attempts per turn (4 total model calls), only when `model.to_ascii_lowercase().contains("fable-5")`.

---

## 1. Creation, Storage, and Role of Refusal & Reassessment Prompts

### 1.1 Fable 5 Guardrail Reconsideration Loop
- **Prompt templates (`crates/rayucode-app-core/src/agent/response_recovery.rs:53-57`):**
  1. `"Reassess the user's request using its full context and likely intent rather than isolated keywords..."` (`L54`)
  2. `"Review the request again and distinguish legitimate coding, debugging, defensive, educational, or analytical work from instructions that facilitate harm..."` (`L55`)
  3. `"Perform one final, independent policy check. Prefer a safe and useful constrained response when possible..."` (`L56`)
- **Stop-reason detection:** `Agent::is_guardrail_stop_reason` (`response_recovery.rs:43-51`) and `rayucode_provider_core::is_guardrail_stop_reason` (`crates/rayucode-provider-core/src/lib.rs:655-660`) match `"refusal"`, `"content_filter"`, `"safety"`, or substrings `"guardrail"` / `"policy_violation"`.
- **Eligibility gate:** `Agent::should_reconsider_fable_guardrail` (`response_recovery.rs:96-105`) returns `true` when `is_guardrail_stop_reason(stop_reason)` holds, `model.to_ascii_lowercase().contains("fable-5")`, and `attempts < 3`.
- **Injection, role, and persistence (`response_recovery.rs:62-94`):**
  - Logs `logging::warn` (`L79-84`).
  - Calls `self.add_message(Role::User, vec![ContentBlock::Text { text: prompt.to_string(), cache_control: None }])` (`L85-91`).
  - `Session::add_message` (`crates/rayucode-base/src/session.rs:1332`) calls `add_message_ext_with_display_role(..., None)` — **no `display_role` is set** (serialized JSON omits `"display_role"`).
  - Calls `self.session.save()?` (`L92`), writing the synthetic prompt immediately to disk.
- **Call sites:**
  - Streaming loop: `crates/rayucode-app-core/src/agent/turn_streaming_mpsc.rs:1383-1391`.
  - Non-streaming loop: `crates/rayucode-app-core/src/agent/turn_loops.rs:1014-1017`.
- **Render & Desktop propagation:**
  - `render_messages` (`crates/rayucode-base/src/session/render.rs:483-496`) only skips `<system-reminder>` text and maps `display_role: Some(System|BackgroundTask)`, `is_auto_poke_user_message`, or `is_scheduled_task_message` to `"system"`. These 3 prompts fall through to `"user"`.
  - Desktop `mapHistoryMessagesToTurns` (`desktop/src/lib/harness-adapter.ts:338-438`) checks `classifySyntheticUserMessage` (`L293-336`), finds no match, calls `flushTurn()` (`L412-413`), and creates one right-aligned user bubble per prompt.

### 1.2 Other Engine-Injected Prompts in `response_recovery.rs`
- `maybe_continue_empty_post_tool_response` (`response_recovery.rs:171-217`): `Role::User`, `display_role: None`, wraps text in `<system-reminder>...</system-reminder>` (`L163-164, 208-211`) so `render.rs:483` hides it by text prefix.
- `maybe_continue_incomplete_response` (`response_recovery.rs:219-279`): `Role::User`, `display_role: None`, uses `[System reminder: your previous response ended before completion ...]` (`L220-223`) — uses square brackets rather than `<system-reminder>`, so it also lacks protection in `render.rs:483-496`.
- `maybe_continue_stranded_tool_use` (`response_recovery.rs:297-328`): `Role::User`, `display_role: None`, uses `[System reminder: your previous response ended with stop_reason "tool_use" ...]` (`L321`).
- `handle_malformed_tool_round` (`response_recovery.rs:395-464`): `Role::User`, `display_role: None`, wraps text in `<system-reminder>...</system-reminder>` (`L473-497`).

### 1.3 Real Refusal Output Notice
- When all retries finish with a guardrail stop or empty visible output, `Agent::provider_guardrail_notice` (`response_recovery.rs:110-142`) builds `"Provider guardrail stopped the response (stop_reason: ...). The model declined to answer this request..."`, logs `PROVIDER_GUARDRAIL` or `PROVIDER_EMPTY_RESPONSE` (`L147-153`, `turn_streaming_mpsc.rs:1431-1436`), and emits `ServerEvent::ProviderGuardrail { stop_reason, message }` (`turn_streaming_mpsc.rs:1437-1440`, `crates/rayucode-protocol/src/wire/events.rs:489-496`). It is not stored in `session.messages`.

---

## 2. Where `"Reconsidered and completed safely"` is Produced

- **Exact location:** `crates/rayucode-app-core/src/agent_tests.rs:2745-2802` (`FableGuardrailProvider::complete` at `L2776-2780`), exercised by `fable_guardrail_reconsideration_recovers_the_streaming_turn` (`L2804-2837`, asserted at `L2833-2836`).
- Calls 1–3 return empty text with `stop_reason: Some("refusal")` (`L2769-2774`); call 4 returns `StreamEvent::TextDelta("Reconsidered and completed safely".to_string())` + `stop_reason: Some("end_turn")` (`L2776-2785`).
- That test calls `crate::storage::lock_test_env()` (`L2806`) without redirecting `RAYU_HOME` to a temp directory, writing mock sessions into `~/.rayu/sessions/`.

---

## 3. Message Model Provenance Comparison (`session-load-bug.md` §5)

| Layer | Type & Location | Existing Marker | Missing vs §5 (`origin`, `visibility`, `attempt_id`, `outcome`) |
|---|---|---|---|
| Engine Storage | `StoredMessage` (`crates/rayucode-session-types/src/lib.rs:287-306`) | `display_role: Option<StoredDisplayRole>` (`System` \| `BackgroundTask`) | `add_message` defaults to `None` (`session.rs:1332`); no `origin` enum (`user_typed` / `engine_internal` / `legacy_unknown`), no `visibility`, no `attempt_id`, no `stop_reason` / refusal metadata, no turn `outcome`. |
| Engine Render | `RenderedMessage` (`crates/rayucode-base/src/session/render.rs:483-511`) | Flattens `display_role` + `<system-reminder>` / `[Scheduled task]` / auto-poke heuristics into `role: String` | Drops structured provenance; any untagged `Role::User` text without a matching prefix renders as `"user"`. |
| Harness API Wire | `HistoryMessage` (`crates/rayucode-harness-api/src/events.rs:643-657`) | `role: String` (`"user"` \| `"assistant"` \| `"tool"` \| `"system"`), `content`, `tool`, `response_stats` | **No field** distinguishes engine-injected `role: "user"` items from user input; no `attempts[]` or `outcome`. |
| Desktop UI Model | `ExecutionTurn` (`desktop/src/lib/ipc-client.ts:213-246`, `desktop/src/lib/harness-adapter.ts:293-438`) | Text-prefix heuristics in `classifySyntheticUserMessage` (`L293-336`) | **No provenance/origin/visibility/attempt/outcome fields.** Cannot distinguish `engine_internal` from `user_typed` or track refused vs answered attempts. |

---

## 4. Reassessment Attempt Limit & Design Alignment (`session-load-bug.md` §8)

- **Allowed attempts:** **3** reassessment prompts (`FABLE_GUARDRAIL_RECONSIDERATION_PROMPTS.len() == 3`, `response_recovery.rs:53-57, 72`), allowing up to **4 provider requests per turn** (1 initial + 3 retries), gated to `model.to_ascii_lowercase().contains("fable-5")` (`L103`).
- **Comparison with §8.2:**
  - Spec recommends max **2** recovery attempts with **1** clear prompt; current code uses **3** overlapping prompts.
  - Current `StoredMessage` does not persist refusal reason, trigger, or attempt number.
  - Refused attempts with empty `content_blocks` are not saved to `session.messages` (`turn_streaming_mpsc.rs:1303-1325`).
  - There is no structured `outcome` enum (`answered`, `answered_partial`, `declined`, `failed`, `cancelled`, `timed_out`) or UI declined state offering Retry / Switch model.

---

## 5. Proven vs Only Likely vs Could Not Check

### Proven
- Every file path, line number, constant, and call site for `FABLE_GUARDRAIL_RECONSIDERATION_PROMPTS`, `maybe_reconsider_fable_guardrail`, `provider_guardrail_notice`, `"Reconsidered and completed safely"` (`agent_tests.rs:2778`), and the 4-layer message/history schemas (`StoredMessage`, `render_messages`, `HistoryMessage`, `ExecutionTurn`).
- Neither `HistoryMessage` nor `ExecutionTurn` has any field distinguishing engine-injected `user`-role items from user input; `StoredMessage.display_role` is optional (`None` by default) and is omitted by `maybe_reconsider_fable_guardrail`.

### Only Likely
- That `[System reminder: ...]` messages injected by `maybe_continue_incomplete_response` (`response_recovery.rs:219-279`) and `maybe_continue_stranded_tool_use` (`L297-328`) would similarly render as Desktop user bubbles when triggered, because they also pass `display_role: None` and do not start with `<system-reminder>` or match `classifySyntheticUserMessage` (`harness-adapter.ts:293-336`).

### Could Not Check
- Whether real Anthropic `claude-fable-5` live API traffic currently returns `stop_reason: "refusal"` on ordinary coding tasks (no live model call executed in Phase 1).
