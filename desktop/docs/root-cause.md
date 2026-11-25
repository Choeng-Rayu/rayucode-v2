Rayucode Desktop: Root-Cause Debugging, Architecture Decision, and Thinking-State Design
A focused companion to the main test playbook. It answers three questions: why the desktop feels disconnected from the Rust engine, whether the desktop architecture is wrong, and what the user should see while the agent is thinking. Date: November 24, 2026.
1. The problem, stated precisely
Observed by the team:
1.  The CLI feels native and complete. The desktop feels like a wrapper.
2.  The engine covers roughly 100 features. The desktop exposes what feels like 20.
3.  Some desktop values and behaviors are hardcoded.
4.  The displayed state (effort, tool calls, progress) does not match what the Rust runtime is doing.
5.  Responses feel slow and inconsistent, and bugs are hidden.
These are not five problems. They are most likely one problem seen from five sides: the desktop has its own model of the world instead of rendering the engine's.
2. Short answers (firm)
Is the desktop architecture wrong? A desktop that wraps the engine is not wrong. Serious agent products are built this way, with the engine exposed through a structured protocol that several front ends consume. What is wrong, most likely, is the contract between the two: the desktop owns state, owns feature lists, and owns some logic, so it can never keep up with the engine. My recommendation is to keep the wrapper shape and fix the contract: the engine runs as its own process, speaks one versioned protocol, and both the CLI and the desktop are thin clients of it. Do not rewrite the UI in a native Rust toolkit now. Section 5 gives the specific, measurable conditions under which a rewrite would be justified.
What should the user see while the agent is thinking? A truthful, engine-reported activity: what phase the agent is in, how long it has been there, what it is waiting for, and what the user can do. Never a fake progress animation. Section 6 defines the exact taxonomy.
What do we do first? Run the ten-experiment audit in section 4. It takes two to three days and tells you which of the causes below is real, with numbers.
3. Root-cause model: what could produce these symptoms
Treat these as hypotheses. Each one predicts a different signature, so you can tell them apart.
ID
Hypothesis
Predicted signature
H1
Two sources of truth. UI keeps its own session, settings and tool state
UI and engine disagree after reload, reconnect, or settings change
H2
Lossy protocol. The engine has many features but emits only a few structured events, so the desktop cannot see the rest
CLI shows things the desktop never receives; many engine outputs arrive as plain text
H3
Text scraping. The desktop parses the CLI's text output instead of structured events
Fragile display, ANSI artifacts, inconsistent tool blocks, breakage when wording changes
H4
Hardcoded UI assumptions. Model names, effort levels, tool names, commands and defaults are literals in the UI
New engine features never appear; UI shows values the engine does not use
H5
Duplicated logic. Retry, permission, context or compaction logic exists in both the UI layer and the engine, and behaves differently
Same task behaves differently in the CLI and the desktop
H6
Hand-built UI per feature. Each feature needs custom UI, so coverage is limited by developer time
Feature census shows steady 20 to 30% coverage
H7
Slow data path. Per-token IPC, full re-renders, main-thread parsing
Frame-time spikes during streaming; the engine trace is fast but the screen is late
H8
Engine lacks guaranteed terminal events. Errors, cancels or crashes do not emit a final event
Stuck spinners, tools stuck as running
Expectation: H1, H2 or H3, H4 and H6 together explain "feels like a wrapper, covers 20 of 100, some hardcoded, does not match." H7 explains "slow." H8 explains "stuck and inconsistent."
4. Investigation procedure: ten experiments
Run in order. Record every result in a table. Do not change any code during the audit.
#
Experiment
How
What the result means
E1
Feature census
List every engine command, setting, tool and event (from the Rust command definitions, slash-command registry, tool registry, config schema). List everything the desktop can reach. Compute coverage = reachable / total.
Gives the real number behind "20 of 100." Below 50% confirms H6
E2
Hardcode hunt
Search the UI source for literal model names, effort levels, permission modes, tool names, command names, default values, version strings, URLs. Count hits and classify each: should come from engine, or genuinely UI-only
Many "should come from engine" hits confirm H4
E3
Trace one feature end to end
Take effort. Follow it: control in UI, command sent, engine receives, value used in the provider request, event returned, value displayed. Log the value at every hop
The hop where the value changes or disappears is the bug. Repeat for model and permission mode
E4
CLI vs desktop equivalence
Same prompt, same scripted fake model, same repository, run through both. Diff the event logs and the final file state
Any difference confirms H5
E5
Protocol loss audit
Capture three streams for one session: raw engine output, events the UI received, events the UI reducer applied. Count dropped, unknown, duplicated and out-of-order events
Dropped or unknown events confirm H1 or H2. Text where structured events should be confirms H3
E6
Duplicated logic audit
Search the UI layer for retry, backoff, permission decisions, context building, compaction, token counting, file reading
Any hit is logic that must move to the engine (H5)
E7
Timing trace
Record the eight latency metrics from the main playbook on 20 tasks
Engine fast but screen late confirms H7. Engine slow means the problem is not the UI
E8
Honesty test under stall
Fake engine stops emitting for 60 seconds, then dies. Observe the UI
A spinner that never changes or a lie ("working") confirms H8 and shows what the activity semantics must handle
E9
Restore test
Run a session with parallel tools, close the app mid-turn, reopen. Compare live and restored state
Differences confirm H1 and a lossy persistence path
E10
Settings truth test
Change effort, model and permission mode at idle, mid-turn and mid-tool. Compare dropdown, engine-reported effective value and actual provider request
Mismatch confirms H1 and H4 and explains the "does not match the runtime" feeling
4.1 Decision matrix from the results
If the audit shows
Then
Mostly H1, H4, H6 (UI owns state and feature list)
Fix the contract: capability registry, snapshot, generated types, generic renderers (section 5.3)
H2 or H3 (engine emits little structure, or UI scrapes text)
The engine needs a structured event layer first. This is the most important engine change. Do it before any UI work
H5 (duplicated logic)
Move the logic into the engine. The UI must never decide behavior
H7 only
Optimize the data path (batching, virtualization, incremental parsing). No architecture change
All of the above are minor but budgets still fail on the webview
Only then consider changing the UI technology (section 5.4)
5. Architecture decision
5.1 Options
Option
Description
Verdict
A. Engine as separate process, thin clients (recommended)
The Rust engine runs as a local server or sidecar speaking a versioned protocol (for example JSON-RPC or stream-JSON over stdio or a local socket). The CLI and the desktop are both clients
Choose this
B. Engine embedded in the desktop process
Engine linked into the desktop app, called through in-process commands
Acceptable only if the protocol is still the same one the CLI uses; otherwise it recreates the two-contract problem
C. Native Rust UI rewrite
Replace the webview with a native toolkit
Not now. Large cost, does not fix state or feature-parity problems by itself
D. Keep the wrapper as it is
Patch bugs one by one
Reject. The bugs share a root cause and will keep returning
5.2 Why A
• Parity by construction. One protocol and one registry. A feature added to the engine is reachable from both clients.
• Testability. The engine can run headless. Every test in the playbook (conformance, replay, fault injection) needs this.
• Crash isolation. A UI crash does not kill a running agent, and an engine crash is reported honestly to the UI.
• Honest display. The UI renders what the engine reports, so it cannot disagree with it.
• Reuse. The same protocol can serve other front ends later, such as a web client, an IDE extension or an automation script.
5.3 The contract (what makes A work)
1.  Capability registry. Every command, setting, tool and event declares itself once in Rust, with schema, description, risk level and current effective value. Both clients read it.
2.  Generated types. TypeScript types come from the Rust definitions. Hand-written copies are forbidden.
3.  Events with seq, IDs and statuses. As defined in the main playbook, with guaranteed terminal events for every turn and every tool call.
4.  Snapshot plus deltas. The engine can always produce the full session state. The UI never reconstructs it.
5.  Effective values. The engine reports the model, effort and permission mode it is actually using at the start of every turn.
6.  Generic renderers. Schema-driven form, generic tool block, and a command palette listing every registry entry, so coverage is 100% before any custom design.
7.  No logic in the UI. Retry, permissions, context, compaction and persistence live in the engine.
8.  CI guards. Hardcode lint, parity matrix generated from the registry, CLI-versus-desktop equivalence test, generated-types check.
5.4 When a UI rewrite would be justified
Only if all of these are true after the contract is fixed and the data path is optimized:
• The conformance and equivalence tests pass, so correctness is no longer the issue.
• Measured on a low-end target machine, streaming smoothness stays under 45 fps or idle memory exceeds your budget even with batching, virtualization and incremental rendering.
• Profiling shows the cost is inherent to the webview (startup, memory, text layout), not to your code.
If these conditions are met, rewrite the rendering layer only. The engine, protocol, registry and tests stay unchanged, which is exactly why option A makes a later rewrite cheap.
5.5 Migration path (no big-bang)
1.  Define and freeze the protocol around what the engine already does. Add seq, IDs, statuses, effective values.
2.  Run the CLI on the same protocol (or generate the CLI's output from the same events). One contract, two clients.
3.  Introduce the desktop reducer over the protocol; delete UI-owned state one slice at a time (session, settings, tool calls, permissions).
4.  Add generic renderers and raise coverage to 100%, then hand-design the top 10 features.
5.  Delete hardcoded values and duplicated logic, protected by the lint.
6.  Remove text scraping if it exists.
Each step ships independently and is verified by the conformance test.
6. Thinking-state semantics: what the user sees while the agent works
The goal: at any moment, the user can answer "what is it doing, for how long, is it stuck, what can I do?" without guessing. The engine is the only author of this information.
6.1 Principles
1.  Truthful. Every status is derived from a real engine state. No fake progress bars, no rotating cute messages that do not reflect reality.
2.  One primary activity at a time per turn, plus optional secondary badges (context usage, effort, cost).
3.  Immediate. Something appears within 100 ms of sending, before any network call.
4.  Specific. "Reading 3 files" beats "Working." "Waiting for your approval" beats "Thinking."
5.  Distinguish who we are waiting for: the model, a tool, the network, or the user. These must look different, because the right user action differs.
6.  Time-aware. The longer it takes, the more information and control the user gets.
7.  Honest about trouble. Retrying, rate-limited, offline and stalled are first-class states, not hidden.
8.  Always interruptible. Stop is available in every active state.
9.  Engine emits kinds, UI maps text. The engine sends a semantic kind and structured detail; the UI turns it into localized text (including Khmer). No display strings in the engine.
6.2 Activity taxonomy
Kind
Engine trigger
User-facing label (English)
Detail shown
User can
queued
Message accepted, waiting for turn slot
Queued
Position, if any
Cancel
preparing_context
Building prompt: reading files, search, memory
Preparing context
"Reading 4 files", "Indexing project"
Stop
waiting_for_model
Request sent, no token yet
Waiting for the model
Model and effort, elapsed time
Stop
thinking
Reasoning stream active
Thinking
Elapsed time; reasoning summary if available
Stop, expand summary
responding
Text deltas arriving
Writing response
None (the text itself is the feedback)
Stop
planning
Plan mode output
Planning
Steps as they appear
Stop
tool_args
Tool arguments streaming
Preparing tool call
Tool name
Stop
awaiting_permission
Permission requested
Waiting for you
What is requested, risk level
Approve, deny, always allow
running_tool
Tool executing
Running: <verb> <target>
Command, file path, elapsed, live output
Stop, expand output
compacting
Context compaction
Summarizing earlier conversation
Tokens before and after when done
Stop
retrying
Provider or tool error with retry
Retrying (attempt 2 of 4)
Reason, countdown
Stop, retry now
rate_limited
429 or quota
Rate limited
Reset time or retry countdown
Stop, switch model
offline
Network unreachable
Offline
Auto-retry status
Stop
stalled
No engine events past threshold
No activity for 30 s
Last known activity and time
Stop, retry, view log
finalizing
Writing results, saving session
Finishing up
None
None (short)
error
Terminal failure
Failed
Reason, retryable flag
Retry, copy details
idle
Turn finished
(nothing)
Summary: duration, tokens, cost
Send next
Tool verbs for running_tool come from the tool registry: Reading, Searching, Editing, Writing, Running, Fetching, Testing. Every tool declares its verb and the argument to show as the target.
6.3 Event shape
activity_changed {
  turn_id, activity_id, seq,
  kind,                // one of the kinds above
  started_at,          // engine timestamp
  detail: { ... },     // structured: tool_id, path, command, attempt, retry_at, reason
  waiting_on,          // model | tool | network | user | none
  interruptible: bool
}
Rules:
• Exactly one activity is open per turn. Starting a new one closes the previous one.
• No activity may stay open after turn_finished. The conformance test enforces this.
• started_at comes from the engine so the elapsed timer is correct after a reload or reconnect.
• Parallel tools produce one running_tool primary with a count ("Running 3 tools") and individual statuses in the tool list.
6.4 Time thresholds
Elapsed in one activity
Display
0 to 100 ms
Immediate acknowledgement (input cleared, indicator on)
100 ms to 2 s
Activity label only, subtle animation
2 s to 10 s
Label plus elapsed timer and detail
10 s to 30 s
Add "still working" context: model, effort, tokens so far, what it is waiting on
Over 30 s with events flowing
Keep label; offer expanded log
No events for 15 s
Mark "waiting" with the last known state
No events for 30 s
Switch to stalled; offer Stop, Retry and View log
No events for 120 s and engine process unresponsive
Declare engine unresponsive; offer restart and preserve the session
Thresholds are configuration values, not magic numbers in UI code.
6.5 Showing the model's thinking
• Show thinking elapsed time always ("Thinking, 8 s"). After it ends, collapse to "Thought for 8 s."
• Show a reasoning summary only if the provider or engine supplies one. Collapsed by default, expandable.
• Never fabricate reasoning text and never present planned steps as completed work.
• Raw reasoning may contain sensitive material; make showing it an explicit setting and never include it in telemetry.
• Keep reasoning visually separate from the answer and from tool output.
6.6 Separating "working" from "waiting on you"
The single biggest source of confusion is a permission prompt that looks like the agent is still thinking.
• awaiting_permission gets a distinct color, icon, a persistent banner, and a desktop notification if the window is in the background.
• The turn timer pauses (or is shown separately) while waiting on the user.
• If the user ignores the prompt, show elapsed waiting time and a reminder after a configured period.
6.7 Failure semantics
• Retrying: show the reason ("Provider overloaded"), the attempt and the countdown. Silent retries look like freezes.
• Rate limited: show when it resets and offer an alternative model if configured.
• Offline: distinguish "network lost" from "provider down" when the engine can tell.
• Engine crashed: the UI shows that explicitly, offers restart, and restores the session from the log. No spinner without a live engine.
• Partial output kept: if a turn ends in error, keep what was produced, labeled as incomplete.
6.8 Anti-patterns to remove
• A generic spinner for every state.
• Rotating humorous words unrelated to real state.
• Progress bars with invented percentages.
• Showing the user's selected effort instead of the engine's effective effort.
• Timer that restarts on reload.
• Status text assembled in the UI from guesses about event order.
• Hiding retries.
• A permission prompt buried inside the scroll area.
6.9 Tests for the semantics
• Mapping completeness: every engine phase maps to exactly one kind; a test fails if the engine can be in a phase with no kind.
• Single primary activity: property test over random event streams; never zero (during a turn) and never more than one open.
• Closure: after turn_finished, error or cancel, no open activity remains.
• Honesty conformance: after every event, the displayed activity equals the engine's snapshot activity.
• Threshold tests: a fake engine that goes silent at 15 s, 30 s and 120 s produces the specified displays.
• Restore: reload mid-activity; the timer and label are correct.
• Parallel tools: three tools finishing in any order show consistent counts and final statuses.
• Localization: every kind has English and Khmer text; no UI string is built from the engine's raw message.
• Accessibility: status changes announced politely to screen readers, at most once per activity change, never per token.
7. Two-week execution plan
Days 1 to 3: audit
• Run E1 to E10. Write results into the table in section 4.
• Produce the coverage number, the hardcode list and the duplicated-logic list.
• Decide using the matrix in 4.1 and record it in the decision log (section 8).
Days 4 to 7: contract
• Registry and generated types.
• seq, IDs, statuses, effective values, guaranteed terminal events.
• activity_changed events with the taxonomy above.
• Snapshot and resync.
Days 8 to 10: UI over the contract
• Reducer that owns no session or settings state.
• Activity indicator rendering all kinds, with the time thresholds.
• Generic renderers; parity matrix generated in CI.
Days 11 to 14: lock it in
• Conformance test, equivalence test, hardcode lint, semantics tests.
• Remove duplicated logic and text scraping found in the audit.
• Re-run the audit; compare coverage, mismatches and latency to the baseline.
8. Decision log and acceptance criteria
Decision log (fill in after the audit)
Question
Evidence (experiment)
Decision
Date
Does the desktop own state the engine should own?
E3, E5, E9, E10


Does the engine emit enough structured events?
E5


Does the desktop scrape text?
E5


What is real feature coverage?
E1


How many hardcoded values must move?
E2


Is logic duplicated across CLI and desktop?
E4, E6


Is the data path the bottleneck?
E7


Does the UI lie when the engine stalls or dies?
E8


Is a UI technology change justified?
Section 5.4 conditions


Acceptance criteria
Criterion
Target
Desktop coverage of registry entries
100% (generic or custom), custom for top 10 by usage
UI-owned session or settings state
None
Hardcoded engine-derived values in UI
0 (lint enforced)
CLI versus desktop equivalence test
Identical event logs and file results
UI state versus engine snapshot after every event
Identical in conformance tests
Time to visible acknowledgement after send
Under 100 ms
Turns ending without a terminal event
0
Displays that contradict the engine under stall or crash
0
Every activity kind has English and Khmer text
100%
9. One-paragraph summary for the team
The desktop feels like a thin, partial wrapper because it keeps its own picture of the engine instead of rendering the engine's. We keep the wrapper shape and fix the contract: one versioned protocol and capability registry owned by the Rust engine, snapshot plus sequenced events, engine-reported effective settings and activities, generic renderers for full coverage, no logic or hardcoded engine facts in the UI, and tests that prove the UI equals the engine after every event. We audit first with ten experiments, and we only consider replacing the UI technology if measured budgets still fail after the contract and data path are fixed.
