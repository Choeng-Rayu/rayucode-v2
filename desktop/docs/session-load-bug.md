Rayucode Desktop: Session Load, Message Provenance and Response Integrity
Investigation and fix specification based on two screenshots of the session "do this ordinary coding task". It covers the 10-second session switch, the missing AI response, internal prompts shown as user messages, and the misleading "completed safely" status. Companion to the test playbook and the architecture document. Date: November 24, 2026.
1. Evidence
Screenshot A: switching to a session
• The chat area shows grey skeleton blocks for about 10 seconds.
• The right panel (environment, branch, changes +3205 −207, connectors) is already fully loaded.
• Context shows "0% · 0 / 200k tokens" while the chat has not loaded.
• The composer is enabled while the history is not loaded.
• The model label reads DeepSeek-V4.1-flash:lastest (probable typo, suggests a hand-built or hardcoded string).
Screenshot B: the same session after loading
• One genuine user message: "do this ordinary coding task".
• Three further right-aligned bubbles whose text is model-directed instructions ("Reassess the user's request…", "Review the request again…", "Perform one final, independent policy check…"). A person almost certainly did not type them.
• The only assistant text is "Reconsidered and completed safely".
• There is no answer to the coding task.
• Context still shows 0 / 200k tokens although a conversation exists.
2. Bug inventory
ID
Bug
Severity
Likely layer
B1
Session switch takes about 10 seconds
High
Engine load path, persistence, UI rendering
B2
The real AI response is missing after load
Critical (data loss from the user's view)
Persistence, retry loop, or restore filter
B3
Engine-internal prompts displayed as user messages
High
Message model has no provenance
B4
"Reconsidered and completed safely" claims success without a result
High (dishonest status)
Engine status strings
B5
An ordinary coding task triggered a refusal and reassessment loop
High
Agent policy, prompts, model behavior
B6
Context shows 0% for a non-empty session
Medium
Snapshot lacks usage; UI shows default as fact
B7
Composer usable before history exists; no loading state per panel
Medium
UI state handling
B8
Model label with a typo, suggesting hardcoded strings
Low (symptom of a larger issue)
UI hardcoding
B2 is the priority. A user who loses an answer stops trusting the app.
3. Root-cause hypotheses
These are hypotheses to confirm, not conclusions.
3.1 For the missing response (B2)
#
Hypothesis
Signature in the event log
R1
The model never produced an answer; the loop kept refusing
No assistant_text_delta with real content in any attempt
R2
An earlier attempt produced the answer and a later attempt overwrote it
Text exists in attempt 1, absent from the final stored message
R3
The answer was streamed but never persisted (persist happens only at turn_finished, and a failure or retry path skipped it)
Live view showed it; log has no committed message
R4
The answer was persisted but the restore path filters it (role confusion, hidden flag, dedupe by key)
Present in the raw log, absent in the restored state
R5
Race during session switch: a stale or partial load replaced the full one
Two load requests overlapping in the trace
R6
Schema or migration issue: older messages lack fields the loader requires and are skipped
Loader logs or silent catch around deserialization
3.2 For the slow switch (B1)
#
Hypothesis
Signature
S1
Whole event log replayed on every switch
Time grows with session size
S2
Engine attach or resume rebuilds state or spawns work per switch
Fixed cost even for tiny sessions
S3
History request queued behind other work (git diff, skills, memory, context count)
Trace shows waiting before the history read starts
S4
Full render of all messages, diffs and tool outputs
Main thread blocked after data arrives
S5
Serialization or IPC of large payloads
Large gap between engine send and UI receive
3.3 For the injected prompts and false status (B3, B4, B5)
The engine runs a refusal-recovery loop with escalating control prompts. Those prompts are stored in the same list and with the same role as real user input, and the final line is a hardcoded status string, not a result.
4. Investigation runbook for this exact session
Do this before changing code.
Step 1: Capture
Export the raw event log for the session (or copy the session file from disk). Keep an untouched copy.
Step 2: Reconstruct three views
1.  Raw log: every stored event in order.
2.  Restored state: what the reducer produces from loading it.
3.  Live replay: send the same task again against a fresh session and record what streams.
Step 3: Diff
Find the first event where the restored state differs from the raw log, and the first place where the live stream differs from the restored state.
Step 4: Classify the missing response
What you find
Conclusion
No answer text anywhere in the raw log
R1: the model never answered. Problem is policy and prompts (section 7)
Answer text in the raw log, absent after restore
R4 or R6: restore filter or loader bug
Answer text in attempt 1 only, replaced later
R2: retry loop overwrites
Answer shown live, absent in the raw log
R3: never persisted
Different results on repeated opens
R5: race
Step 5: Trace the switch
Add spans: click, load request sent, engine received, history read, serialized, delivered to UI, reducer applied, first paint, full paint. Run on a tiny session and on a large one. Fixed cost points to S2 or S3. Cost that scales with size points to S1, S4 or S5.
Step 6: Write the failing test
Turn the finding into a replay test (section 9) before fixing it.
5. Message model: provenance, attempts and outcomes
The root of B3 and B4 is that the data model cannot distinguish who or what produced an item.
5.1 Message fields
Message {
  id, session_id, turn_id, seq, created_at,
  role:        user | assistant | tool | system,
  origin:      user_typed | user_attachment | assistant_model | engine_internal | tool_output | legacy_unknown,
  visibility:  shown | collapsed | hidden,
  attempt_id:  nullable,   // groups content produced by one model attempt
  content, usage, model, effort
}
Rules:
• origin is set by the component that created the item and is never inferred from position or text.
• Engine-injected control prompts are origin: engine_internal, visibility: hidden by default, and shown only in a debug or "details" view.
• The UI renders user bubbles only for origin: user_typed and user_attachment.
• The model still receives hidden items. Visibility affects display, not what the model sees.
5.2 Attempts
A turn can have several attempts (initial, retry after error, reassessment after refusal).
Turnhow { id, attempts: [Attempt], outcome, final_attempt_id }
Attempt { id, reason: initial | retry_error | reassess_refusal | user_regenerate, status, messages[] }
Rules:
• An attempt is append-only. A later attempt never edits or deletes an earlier one.
• The UI displays the final attempt's answer and offers "show earlier attempts."
• If the final attempt has no answer but an earlier one did, the UI shows the earlier answer labeled as such. Never show nothing.
5.3 Turn outcomes (truthful status)
Outcome
Meaning
What the user sees
answered
Final attempt produced an answer
The answer
answered_partial
Answer cut off by error, limit or stop
The partial answer, labeled incomplete
declined
Model declined every attempt
"The model declined this request" with the reason if known, plus Retry and Switch model
failed
Technical failure
Error reason, retryable flag
cancelled
User stopped
What was produced so far
timed_out
No progress within limit
Last activity, Retry
The words "completed" and "safely" are never used as a turn result. A status like "Reconsidered and completed safely" is replaced by an outcome from this table. The conformance rule: answered requires at least one non-empty assistant message in the final attempt.
6. Session load pipeline specification
6.1 Design
1.  Engine keeps a session index and a snapshot per session: summary, status, effective model and effort, permission mode, pending permissions, context usage, last N messages, total message count, snapshot seq.
2.  Switch flow:
    ◦ UI immediately renders from an in-memory cache if present (target under 100 ms).
    ◦ UI sends load_session { session_id, request_id }.
    ◦ Engine replies with the snapshot (header plus last 30 to 50 messages).
    ◦ UI renders it, then streams older messages on scroll (load_history { before_seq, limit }).
3.  Request IDs: only the response matching the latest request_id for the currently selected session may update state. All others are dropped and, where possible, cancelled in the engine.
4.  Cache: keep the most recent 5 to 10 sessions in memory with their seq. On switch, render the cache, then fetch deltas since that seq.
5.  Prefetch on hover or keyboard focus of a session in the sidebar.
6.  Lazy heavy content: tool outputs and diffs load their body on expand. Messages carry header and size first.
7.  Virtualized list for the message view.
8.  Warm engine: switching must not spawn processes or rebuild context. Attach and resume costs are paid once.
6.2 Independent panels
Each right-panel section (environment, context, skills, memory files, connectors, outputs, changes) has its own loading, loaded and error states.
• None blocks the chat.
• None shows a default value as if it were real. Context shows "loading" or a placeholder until the engine reports the number.
• A slow git diff must never delay history.
6.3 Loading-state honesty
• Skeleton only for the first 300 ms, then real status: "Loading messages (50 of 480)."
• After 5 seconds, show a Retry action and the reason if known.
• While history is loading, the composer either queues the message visibly or is disabled with an explanation. It must not accept input silently into an unknown state.
6.4 Targets
Step
Target
Switch to a cached session
under 100 ms
Switch to an uncached session, first screen
under 300 ms
Full recent history ready
under 1 s
Ten rapid switches
no wrong-session flashes, no stale overwrites
2,000-message session open
first screen under 300 ms
7. Persistence integrity: how responses get lost and how to prevent it
7.1 Failure modes to eliminate
1.  Persisting only at turn end, so any error path skips it.
2.  Overwriting a message with a retry attempt.
3.  Deduplicating by a key that collides across attempts.
4.  Restore code that filters by role or flag and drops valid assistant content.
5.  Partial writes on crash, leaving a truncated log.
6.  Compaction that removes content without leaving a record.
7.  Schema changes without migration, so old records fail to parse and are skipped silently.
8.  Switch races where a stale response replaces a newer one.
7.2 Rules
• Append-only event log is the persistence format. The message list is derived from it. Nothing is edited in place.
• Write ahead of display: the engine persists an event before emitting it to the UI, or in the same atomic step, so the UI never shows something that was not stored.
• Incremental persistence: assistant text is flushed periodically during streaming (for example every second or every N bytes), not only at turn end.
• Atomic appends with checksums. On startup, detect and report a truncated tail and recover up to the last valid event.
• Versioned schema with migrations. An unparseable record is surfaced as an error entry ("1 message could not be read"), never silently skipped.
• Compaction is itself an event that records what was summarized, with a pointer to the original range. Originals are kept or archived, not deleted.
• Restore equality is an invariant: the state after restore equals the state the live UI showed. Enforced by test (section 9).
7.3 Migration for existing sessions
Existing sessions have no origin field.
• Mark old messages origin: legacy_unknown.
• Maintain a list of known control-prompt templates (the three seen in the screenshot and any others from the engine source). A one-time migration reclassifies exact or near-exact matches as engine_internal, visibility: hidden.
• Anything uncertain stays visible. Never hide something that might be a real user message.
• Keep the migration reversible and log how many items were reclassified.
8. Refusal and recovery loop design
8.1 Problems visible in the screenshot
• An ordinary coding task triggered a refusal path.
• The system retried with three successive control prompts instead of stopping or asking.
• The prompts themselves push in two directions (prefer to refuse only when necessary, but also do a final policy check), which makes smaller models inconsistent.
• The result was presented to the user as a success.
8.2 Design rules
1.  Cap and surface. Maximum attempts per turn (recommended: 2 recovery attempts). When the cap is reached, end with outcome declined and show it honestly.
2.  One clear recovery prompt, tested per model, not an escalating stack of overlapping instructions.
3.  Record why. Store the refusal text, the detected trigger, the model and the attempt number as structured data, visible in the details view.
4.  Give the user control. Retry, rephrase, switch model, or send anyway through a clearly labeled path where policy allows.
5.  Model-specific behavior. A fast, small model may refuse differently from a larger one. Track refusal rate per model and effort level.
6.  Never fabricate completion. If no answer exists, the outcome says so.
7.  Safety is not weakened by honesty. If a request is genuinely unsafe, the correct display is a clear refusal. The problem here is a false success message and lost content, not the existence of a safety check.
8.3 False-refusal evaluation
• Build a set of 100 ordinary coding tasks (refactor, debug, tests, scripts, file operations, reading code, running builds) that must never trigger refusal or reassessment.
• Include 20 borderline but legitimate security and systems tasks (reading logs, network debugging, writing a port scanner for your own machine, handling credentials in config) to check for over-refusal.
• Run per supported model and effort level on every release. Track false-refusal rate, attempts per turn and task success.
• Fail the release if the false-refusal rate on ordinary tasks rises above the agreed threshold (start with zero tolerance on the 100 ordinary tasks and review each failure).
8.4 Telemetry
Count refusals, reassessment attempts, outcomes by type, and the model used. Alert if declined outcomes on ordinary-category sessions rise.
9. Tests
Test
Assertion
Provenance rendering
Engine-injected prompts never render as user bubbles; they are hidden or collapsed in the details view
Role is never inferred
Changing message order or text content does not change how origin is displayed
Attempts are append-only
Script: attempt 1 produces an answer, attempt 2 is refused. Final display still contains attempt 1's answer
No empty success
A turn with no non-empty assistant message cannot end as answered
Outcome vocabulary
The strings "completed safely" or similar free-text statuses cannot be emitted; only outcomes from the enum
Restore equality
Live state, snapshot state and replayed-from-log state are identical, including attempts, usage and context count
Crash during streaming
Kill the engine mid-answer. On restart the partial text is present and marked incomplete
Truncated log tail
Corrupt the last record. Recovery reports it and keeps all earlier events
Unparseable record
A record with an unknown schema shows an explicit error entry, never disappears
Migration
Legacy sessions: known control prompts become hidden; unknown messages stay visible; counts logged
Switch race
Ten rapid switches with random delays; final screen always matches the selected session
Stale response dropped
A slow load for session A arriving after selecting B does not change the screen
Cache then refresh
Cached view renders under 100 ms, then updates with deltas without flicker
Large session budget
2,000-message session first screen under 300 ms in CI
Panel independence
Delaying git diff by 30 seconds does not delay chat history
No false defaults
Context shows loading, not 0%, until the engine reports a value
Composer during load
Message sent during loading is queued visibly or blocked with explanation
False-refusal eval
The 100-task ordinary set has zero refusals or reassessments per model
Hardcode lint
No model identifiers or labels are literals in the UI; the label comes from the engine's registry
10. Fix order
Day 1 to 2: diagnose
• Run the investigation runbook (section 4) on this session.
• Record whether the response was never produced, overwritten, unpersisted, filtered or raced.
• Add the trace spans for session switching.
Day 3 to 5: stop the data loss and the lies
• Add origin, visibility, attempt_id to the message model and migrate existing sessions.
• Make attempts append-only.
• Replace free-text status with the outcome enum; remove "completed safely".
• Incremental persistence and write-ahead ordering.
• Fix the restore path per the runbook finding.
Day 6 to 8: make switching fast
• Snapshot-first loading, message windowing, request IDs.
• In-memory cache and prefetch.
• Independent panel loading states, no false defaults.
• Composer behavior during load.
Day 9 to 10: contain the refusal loop
• Cap attempts, single recovery prompt, structured refusal records.
• Build and run the 100-task false-refusal evaluation on every supported model.
• UI for declined with Retry and Switch model.
Day 11 to 12: lock in
• All tests in section 9 in CI.
• Hardcode lint covering model labels.
• Re-run the original screenshots' scenario and confirm: instant switch, no injected bubbles, answer present or an honest declined state, correct context count.
11. Acceptance criteria
Criterion
Target
Responses lost after restore
0 in replay and soak tests
Engine-internal prompts shown as user messages
0
Turns reported as completed without an answer
0
Switch to uncached session, first screen
under 300 ms
Switch to cached session
under 100 ms
Wrong-session or stale overwrites under rapid switching
0
Context value shown before the engine reports it
never
False refusals on the ordinary-task evaluation
0 per supported model
Restore equals live state
100% in replay tests
Unparseable records silently dropped
0
12. Summary for the team
The screenshots show a data model that cannot tell a person's message from an engine instruction, a retry loop that can replace or lose the real answer, a status string that claims success without a result, and a session load path that blocks the chat behind work it should not wait for. The fix is structural: give every message an origin and visibility, make attempts append-only, report only truthful turn outcomes, persist before display and restore from the same log, load sessions snapshot-first with request IDs and a cache, show only values the engine has reported, and test the refusal behavior of each supported model against ordinary coding tasks. Start by diagnosing this exact session from its raw event log, because that tells us which of six causes lost the response.
