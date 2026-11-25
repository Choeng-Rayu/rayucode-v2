Rayucode Desktop: Test, Debug and Improvement Playbook
Written from three seats: CTO (what to decide and measure), AI engineer (agent and model behavior), and software engineer (code, tests, tooling). Modeled on practices the Claude Code team has described publicly. Date: November 24, 2026.
1. The situation in one page
Rayucode is a Rust coding agent with 20k+ users. The new desktop UI has three reported problems:
1.  Chat experience is poor and tool-call display is inconsistent.
2.  Responses feel slow.
3.  The UI does not feel like it matches the Rust runtime (for example, effort and settings).
And one meta-problem: bugs are hidden and the app is hard to test.
Working diagnosis (hypotheses to confirm with data, not facts):
• UI state is derived from more than one place, so the UI and the engine drift apart.
• Streaming events are applied without ordering, IDs or status rules, so tool calls render differently depending on timing.
• Too much work happens per token (IPC per token, re-rendering the whole list, markdown re-parsing).
• The engine does not report what it actually used (model, effort, permissions), so the UI shows what the user selected, not what happened.
• There is no way to replay a bad session, so bugs cannot be reproduced.
Decision (firm): the Rust engine is the single source of truth. The UI sends commands and renders events. Everything below supports that decision.
2. Principles
1.  Deterministic UI. Same event log in, same screen out. Live view, reloaded view and replayed view must be identical.
2.  Engine owns state. The UI holds only view state (scroll position, expanded panels, a short-lived pending marker).
3.  Every item has an ID and a status. Messages, tool calls, permission prompts and errors all carry a stable ID and move through a defined state machine.
4.  Show what happened, not what was requested. Display the engine's effective model, effort and permission mode.
5.  Measure before optimizing. No performance work without a trace that shows where time goes.
6.  Every bug becomes a test. A bug is closed only when a replay file or test reproduces it and now passes.
7.  Run the real app. Unit tests are necessary but not sufficient. The strongest signal is driving the real desktop app through real user flows. The Claude Code team has described end-to-end verification as the priority for this reason: a flow either works or it does not.
8.  Fail loudly in development, gracefully in production. Unknown event, sequence gap or illegal state transition is a crash in dev builds and a logged resync in release builds.
3. Target architecture
3.1 Command and event protocol
Define the protocol as Rust types and generate the TypeScript types from them (ts-rs or specta). Never hand-write the UI types.
Commands (UI to engine): start_session, send_message, stop_turn, approve_tool, deny_tool, set_model, set_effort, set_permission_mode, resume_session, request_snapshot, compact_context.
Events (engine to UI), all carrying session_id, seq, ts:
• turn_started { turn_id, model, effort, permission_mode }
• assistant_text_delta { message_id, text }
• thinking_delta { message_id, text }
• tool_call_started { tool_id, name }
• tool_args_delta { tool_id, json_fragment }
• tool_call_ready { tool_id, args }
• permission_requested { tool_id, request_id }
• permission_resolved { request_id, decision }
• tool_output_delta { tool_id, stream, bytes }
• tool_call_finished { tool_id, status, exit_code, duration_ms }
• usage { input_tokens, output_tokens, cost }
• context_compacted { before, after }
• error { kind, retryable, message }
• turn_finished { turn_id, reason }
3.2 State machines
Tool call: announced -> args_streaming -> awaiting_permission -> running -> completed | failed | denied | cancelled | timed_out
Turn: idle -> starting -> streaming -> tool_phase -> streaming -> finished | cancelled | errored
Illegal transitions (for example completed -> running) are bugs. Encode the machines in Rust with enums so illegal states cannot be constructed, and mirror them in the UI reducer.
3.3 Sequencing, snapshot and resync
• Every event has a monotonically increasing seq per session.
• The UI tracks last_seq. A gap, a duplicate or a reorder triggers request_snapshot.
• The engine can always produce a full snapshot of the session (messages, tool calls with status, pending permissions, effective settings).
• On app start, window reload, reconnect or crash recovery the UI loads the snapshot, then applies deltas. This makes history restore match live view by construction.
3.4 Delta batching
Coalesce text and tool-output deltas in Rust into batches of roughly 16 to 50 ms before sending across IPC. Flush immediately on any non-delta event so ordering is preserved.
3.5 Persistence
Write the event log to disk (append-only, one file per session, with a schema version). This powers crash recovery, replay, bug reports and the regression suite.
4. Step 0: instrument before changing anything (days 1 to 3)
You cannot fix what you cannot see.
4.1 Tracing in the engine
Use tracing with spans for: turn, model request, first token, tool call, permission wait, tool execution, context build, compaction. Export to a local file, and optionally OpenTelemetry.
4.2 Latency breakdown (record these separately)
Metric
Meaning
Typical culprit if slow
T_submit_to_ack
Click to "something is happening" in the UI
UI blocking, no optimistic state
T_context_build
Time assembling the prompt
Reading too many files, slow repo scan
T_request_to_first_token
Model latency
Provider, effort level, prompt size
T_token_to_paint
Engine delta to pixels
IPC, re-render, markdown parsing
T_tool_start
Model asks for tool to tool running
Permission wait, process spawn
T_tool_run
Tool execution
Slow command, huge output
T_result_to_next_request
Tool finished to next model call
Serial work, large context re-send
T_turn_total
Whole turn
Sum of the above, plus number of loops
Most "too slow" complaints are one of these, and each has a different fix.
4.3 Dev overlay (turn on in your own builds)
Show live: engine seq vs UI seq, state hash from both sides, effective model/effort/permission mode, events per second, frame time, memory. Highlight any mismatch in red.
4.4 Session recorder
One-click "export session bundle": event log, app version, OS, settings, trace, redacted of secrets. Every bug report should attach one.
4.5 Baseline
Run 20 representative tasks and record all metrics above. This is your before-picture. Without it you cannot prove improvement.
5. Test strategy
A layered pyramid. Cheap and fast at the bottom, expensive and realistic at the top.
Layer 1: Engine unit and property tests (Rust)
• State machine tests: every legal transition, and assert every illegal one is rejected.
• proptest for the event stream: random chunk boundaries, random ordering of parallel tool calls, random cancel points. Invariant: final state is valid and no tool remains running after turn_finished.
• Partial JSON tool arguments: split at every byte offset, assert parsing only happens when complete.
• Cancellation safety: cancel at every await point, assert no leaked child processes, no orphan tasks, no stuck permission prompts.
• Timeouts: a tool that never returns ends as timed_out and the child process tree is killed.
• Output limits: a tool producing 10 MB or an infinite stream is truncated with a marker and the full output saved to disk.
• Concurrency: loom or stress tests on shared state; run with cargo test under thread sanitizer where possible.
• Use cargo nextest for speed, cargo llvm-cov for coverage gaps in the runtime.
Layer 2: Protocol contract tests
• Golden files: serialize every event type and compare against checked-in JSON. Any change is a deliberate, reviewed diff.
• Generated-types check in CI: regenerate TypeScript types and fail if the diff is not committed.
• Version skew: new UI with old engine and old UI with new engine. Define and test the behavior (refuse with a clear message, or degrade).
• Fuzz the deserializer with malformed and truncated events. It must never panic.
Layer 3: UI reducer tests
• Pure function: (state, event) -> state. Snapshot the state, not pixels.
• Same property tests as the engine: shuffle chunk boundaries, assert identical final state.
• Idempotency: applying the same event twice (same seq) changes nothing.
• Gap handling: missing seq triggers snapshot request, does not corrupt state.
• Unknown event type: dev build fails, release build logs and resyncs.
Layer 4: Conformance test (the one that finds "UI does not match engine")
Run the engine headless with a scripted fake model. Feed every emitted event to the real UI reducer. After every single event, assert UI state equals the engine's own snapshot. The first difference points at the exact event and field that drifted. Run this against:
• Hand-written nasty scripts (section 6).
• Recorded real sessions.
• Randomly generated scripts.
Layer 5: Replay harness
• Feed a recorded event log into the real UI at adjustable speed (1x, 10x, instant, with jitter).
• Visual assertions only on critical views (tool block, diff, permission prompt), using screenshot comparison with a tolerance, and only after the data layer is proven correct.
• Every production bug report with a session bundle becomes a replay test.
Layer 6: End-to-end tests and the verify loop
Drive the real desktop app (Tauri/WebDriver, Playwright for the webview, or platform UI automation). Keep about 10 to 20 flows, each describing something a user actually does:
1.  First launch, sign in, open a project, send a message, get a streamed answer.
2.  Ask for a file edit, review the diff, approve, verify the file on disk.
3.  Ask for a command, deny permission, agent recovers.
4.  Run a long command, stop it mid-run, session remains usable.
5.  Send a second message while the agent is running.
6.  Close the app mid-turn, reopen, session restored with no orphan spinner.
7.  Change effort and model mid-session, next turn shows effective values.
8.  Long session with compaction.
9.  Two sessions in parallel.
10.  Network drop and reconnect during streaming.
Use the approach Anthropic has described publicly: a verify skill that launches the app, runs the flows, reads the UI state (expose it as data attributes or a debug endpoint so tests assert on state, not on pixels), and reports pass or fail with screenshots. After three failed fix attempts the agent hands off to a human. Rayucode is itself a coding agent, so run it on its own repository this way.
Layer 7: Performance tests (budgets enforced in CI)
Scenario
Budget (starting point)
Click send to visible "working" indicator
under 100 ms
Streaming 1,000 tokens/sec
55+ fps, no dropped input
500-message session scroll
55+ fps
Open a 500-message session
under 1 s to interactive
Memory after 2-hour soak
growth under 10%
Idle CPU
under 1%
Tool output 10 MB
UI stays responsive
Record on a low-end machine, not only your dev laptop. Fail CI on regressions over 10%.
Layer 8: Soak and chaos
• 2 to 8 hour soak with scripted agent activity. Watch memory, file descriptors, threads, child processes.
• Chaos: kill the engine process, kill a tool process, drop the network, fill the disk, change system time, sleep and wake the laptop, revoke a file permission mid-run.
• Assertion for all: the UI reaches a coherent terminal state (error shown, no infinite spinner) and the session is resumable.
Layer 9: Agent quality evals (AI engineer)
UI bugs and agent bugs get confused. Separate them.
• Tool-call correctness: a fixed suite of tasks with expected tool sequences. Measure invalid JSON rate, wrong-tool rate, argument errors, retry rate.
• Task success evals: 30 to 100 small repo tasks with automatic pass/fail (tests pass, file content matches). Track success, number of turns, tokens, cost and wall time per task, per model and per effort setting.
• Effort mapping: verify each effort level maps to the intended provider parameters, and measure that higher effort actually changes behavior and latency. If the label and behavior disagree, users will feel the mismatch you described.
• Prompt regression: any change to system prompt or tool descriptions runs the eval suite before merge.
• Loop pathologies: repeated identical tool calls, endless retries, never-ending exploration. Add a loop detector and a max-iteration guard with a visible message.
• Context management: compaction quality (does the agent still know the task afterward?), large file handling, context overflow errors, token counting accuracy.
• Error recovery: provider 429, 500, overloaded, timeouts, truncated streams, malformed tool-call output. The agent should retry with backoff and the UI should say so.
• Cost and latency per task shown as a dashboard. A regression here is a bug.
Layer 10: Security and permissions
• Permission model tests: allow once, always allow, deny, deny with feedback, ignore the prompt, timeouts on prompts.
• Path safety: traversal (../), symlinks pointing outside the project, absolute paths, case-insensitive filesystems, Windows reserved names.
• Command safety: injection through filenames, environment variable leakage, commands that background themselves.
• Prompt injection: file contents or web content telling the agent to run commands or exfiltrate secrets. Verify the permission system still gates the action.
• Secrets: API keys never in logs, session bundles or telemetry. Test redaction.
• Updates: signed binaries and signed update payloads.
Layer 11: Platform, install and update
• macOS (Intel and Apple Silicon), Windows 10/11, major Linux distributions.
• Fresh install, upgrade from each of the last N versions, downgrade, interrupted update, corrupted config, missing permissions, proxy and corporate TLS, non-ASCII usernames and paths, paths with spaces, long paths on Windows, antivirus interference.
• Line endings (CRLF vs LF), file encodings, BOMs, case-only renames.
• High-DPI, multi-monitor, dark and light mode, system font scaling, RTL and Khmer text input and rendering.
Layer 12: Accessibility
• Full keyboard navigation, focus order, visible focus.
• Screen reader labels for tool status changes (announce "running", "completed", "failed" politely, without spamming per token).
• Contrast and reduced-motion support.
6. Master scenario list (hand-written nasty scripts for the fake engine)
Use this as a checklist. Each line becomes one scripted test.
Streaming and rendering
[ ] Text in 1-char chunks, and in one 1 MB chunk
[ ] Markdown split mid-token: code fence, bold, link, table row, list marker
[ ] Unclosed code fence at turn end
[ ] Message of 100k characters; single line of 1M characters
[ ] Emoji, ZWJ sequences, combining marks, RTL, Khmer, CJK, ANSI escape codes
[ ] HTML or script in model output (must be escaped)
[ ] Thinking stream interleaved with text
[ ] Auto-scroll pins only if user is at the bottom; scrolling up stops it; "jump to latest" appears
[ ] Layout does not jump when a block expands or collapses
[ ] Text selection and copy survive streaming updates
Tool calls
[ ] Two tools in parallel, results returned in reverse order
[ ] Result arrives before the UI processed the start event
[ ] Duplicate tool_id
[ ] Args streamed as partial JSON, invalid JSON at the end
[ ] Tool with empty args, giant args (1 MB), args containing unicode and escapes
[ ] Tool never returns; timeout
[ ] Tool outputs 10 MB, binary data, ANSI progress bars, carriage-return overwrites
[ ] Tool prints to stderr only; exit code non-zero but output looks fine
[ ] Failed vs denied vs cancelled vs timed out: four distinct displays
[ ] Same tool 50 times in one turn (grouping, performance)
[ ] Tool call during compaction
[ ] Reload mid-tool: status after restore is truthful
Permissions
[ ] Prompt appears while text is streaming
[ ] Two prompts at once
[ ] Approve after the turn was cancelled
[ ] Approve twice (double click)
[ ] App closed with pending prompt; reopen shows it or resolves it as cancelled
[ ] "Always allow" persists correctly and is revocable
Turn control
[ ] Stop during text, during args streaming, during tool run, during permission prompt, during compaction
[ ] Stop twice
[ ] Send message while running: queued or interrupts, as designed, and the UI says which
[ ] Edit and resend a previous message
[ ] Retry after error
[ ] Empty message, huge message, pasted image or file
Failures
[ ] Provider 429 with retry-after, 500, 529, timeout, connection reset mid-stream
[ ] Malformed event, unknown event type, truncated stream
[ ] Engine panic, engine killed, engine hangs
[ ] UI crash and restart during a turn
[ ] Disk full, log write fails
[ ] Clock jumps backward or forward
Settings and sync
[ ] Change effort idle, mid-turn, mid-tool; next turn shows effective value
[ ] Change model mid-session; context and cost display update
[ ] Change permission mode mid-turn
[ ] Two windows on the same session
[ ] Settings file edited externally while app runs
Files and diffs
[ ] Edit a file the user is also editing
[ ] File changed externally during agent run
[ ] Very large diff (10k lines), binary file, image, minified file, CRLF, trailing whitespace only
[ ] Rename, delete, permission denied, read-only file, symlink
[ ] Undo or revert an agent edit
Long sessions
[ ] 500 and 5,000 messages; virtualized list
[ ] Compaction: UI shows it and history stays consistent
[ ] 8-hour idle then resume (token expiry, sleeping connections)
7. Debug playbook: symptom to cause to confirmation to fix
Symptom
Likely causes
How to confirm
Fix
Tool blocks look different each time
Missing IDs, state inferred from event order, dual sources of truth
Replay the same log twice and diff UI state
Stable IDs, status state machine, reducer-only state
Tool stuck on "running" forever
tool_call_finished lost, engine task cancelled without event
Engine trace shows no finish span; sequence gap
Always emit terminal event in a Drop or finally path; resync on gap; timeout state
Tool shows twice
Duplicate event delivery, re-subscribe after reload
Duplicate seq or tool_id in log
Idempotent reducer keyed by ID and seq
Result attached to wrong tool
Matching by name or order instead of ID
Parallel tool test fails
Match only by tool_id
UI shows effort X, behavior looks like Y
UI displays selection, engine uses another or ignores it
Compare turn_started values to dropdown; check provider request
Display engine-reported values; test mapping
Slow to first visible response
Work before ack: context build, blocking IPC, sync file scan
Trace T_submit_to_ack and T_context_build
Immediate optimistic indicator; async context build; cache repo index
Slow token streaming, UI jank
IPC per token, full-list re-render, markdown reparse of entire message
Frame-time profile during stream
Batch deltas, update only the streaming message, incremental markdown, render per animation frame
Slow between tool result and next step
Re-sending huge context, serial work, no prompt caching
Trace T_result_to_next_request and request size
Prompt caching, trim tool output, parallelize independent tools
App slows over time
Unbounded message list, leaked listeners, retained huge outputs
Heap profile after soak
Virtualize list, cap retained output, unsubscribe on unmount
Reopen shows different history than live view
Live view uses deltas, restore uses lossy saved format
Compare live state hash to restored hash
Restore from the same event log or snapshot
Spinner never stops after error
Error path does not emit turn_finished
Inject error in fake engine
Every turn ends with turn_finished with a reason
Garbled or cut markdown
Parsing partial chunks as complete
Chunk-boundary property test
Incremental parser that tolerates open constructs
Random order of messages
Async tasks emitting without sequence
Gap or reorder in seq
Single event emitter task per session; sequence at the source
Works in dev, fails in release
Timing, IPC differences, path differences
Run E2E against the release build
Test the shipped artifact, not only dev mode
Works on my Mac only
Path, shell, encoding, line ending assumptions
Platform matrix run
Normalize paths, explicit shell selection, encoding tests
Engine and UI disagree after reconnect
No resync
Overlay shows hash mismatch
Snapshot on reconnect
Debug routine for any report: get the session bundle, replay it, find the first event where UI state and engine snapshot differ, write the failing test, fix, keep the test.
8. Latency optimization checklist
Work in this order, measuring after each step.
1.  Perceived latency first. Show "working" within 100 ms of click, before any network call. Show phase labels ("reading files", "waiting for model", "running command").
2.  Do not block the UI thread. Move markdown parsing, syntax highlighting and diffing to a worker or the engine.
3.  Batch IPC to 16 to 50 ms and render at most once per animation frame.
4.  Render only what changed. Memoize completed messages; only the streaming message updates.
5.  Incremental markdown for the streaming block; finalize once on completion.
6.  Virtualize the message list.
7.  Collapse large tool output by default, lazy-load the rest.
8.  Prompt caching for the stable prefix (system prompt, tool definitions, earlier turns).
9.  Parallelize independent tool calls and independent context reads.
10.  Cache the repository index and invalidate by file watcher.
11.  Trim tool results sent back to the model (long logs, huge files) with a head and tail plus a way to request more.
12.  Speculative prep: start building context while the user is still typing, if cheap.
13.  Effort and model routing: cheaper and faster model for simple steps (file search, summaries), stronger model for planning and edits, if evals show no quality loss.
14.  Startup time: lazy-load heavy views, avoid scanning the whole disk, defer telemetry init.
9. Telemetry and observability for 20k users
Because you cannot reproduce what you cannot see:
• Opt-in client telemetry with clear disclosure. No prompts, file contents or secrets.
• Events: app start time, crash, engine restart, sequence gap and resync count, turn latency breakdown, tool failure rate by tool, permission prompt outcomes, error kinds, version, OS.
• Crash reporting for both Rust (panic hook, minidumps) and the UI.
• Dashboards and alerts: crash-free sessions rate, resync rate (should be near zero), p50 and p95 for each latency metric, stuck-turn rate (turn running over N minutes without events).
• User feedback button that attaches the redacted session bundle.
10. Release engineering and quality gates
• CI on every PR: formatting, clippy, unit and property tests, protocol golden files, reducer tests, conformance test, a smoke E2E.
• Nightly: full E2E on all platforms, performance suite, soak test, eval suite across models.
• Release candidate: manual checklist (section 11) plus full matrix.
• Rings: internal team, then beta testers (small group), then 5%, 25%, 100% of users, with automatic halt if crash rate or resync rate rises.
• Feature flags and a remote kill switch for risky features.
• Rollback plan tested, including data migrations (session log schema versioning, forward and backward compatible).
• Changelog and known-issues list written for users.
11. Manual exploratory checklist (45 minutes, before each release)
Two people, different machines, trying to break it:
[ ] Use it for real work for 30 minutes without looking at a script.
[ ] Do the strange things: resize while streaming, switch tabs, sleep the laptop, unplug network, paste huge text, drag in files.
[ ] Rapid-fire inputs: click send, stop, send, stop.
[ ] Use keyboard only.
[ ] Use a non-English project path and Khmer text in prompts and files.
[ ] Compare live view to reopened view for the same session.
[ ] Compare shown effort, model and permission mode to what the engine log says.
[ ] Read the engine log: any warnings you did not expect?
12. Roadmap
Week 1: see and stabilize
• Add tracing, latency breakdown, dev overlay, session export.
• Record a baseline on 20 tasks.
• Define the protocol with seq, IDs and status enums; generate TypeScript types.
• Make turn_finished and tool_call_finished guaranteed terminal events.
Weeks 2 to 3: make it deterministic
• Snapshot and resync.
• UI reducer as a pure function, idempotent.
• Event log persistence, restore from log.
• Conformance test and fake engine with the nasty scripts from section 6.
• Delta batching and render throttling.
Weeks 4 to 6: verify like the pros
• 10 to 20 E2E flows driven against the real app, with exposed UI state.
• Verify loop run by Rayucode itself, with a three-attempt handoff to a human.
• Regression checklist where every bug adds an item and a replay file.
• Performance budgets in CI; virtualization; incremental markdown.
• Agent eval suite with per-model and per-effort results.
Weeks 7 to 10: harden
• Soak and chaos testing.
• Platform matrix, install and update tests.
• Security and permission tests, prompt-injection tests.
• Telemetry, crash reporting, rings and kill switch.
• Accessibility pass.
Ongoing
• Dogfood daily: build Rayucode with Rayucode.
• Weekly review of the top 10 stuck turns, resyncs and crashes from telemetry.
• Monthly review of eval results and latency trends.
13. Scorecard (how you know it is good)
Area
Target
Live vs restored session state
100% identical in replay tests
UI vs engine state mismatch
0 in conformance tests; resync rate under 0.1% of turns in production
Stuck turns (running over 10 min with no events)
under 0.1%
Crash-free sessions
99.9%+
Click to working indicator
under 100 ms
Streaming smoothness
55+ fps
Tool-call JSON error rate
trending down release over release
Eval task success
tracked per release, no unexplained drop
Bugs reproduced by replay file
90%+ of reports
Every closed bug has a test
100%
14. What to do tomorrow morning
1.  Add seq, IDs and status enums to the event protocol and make the engine report effective model, effort and permission mode at every turn_started.
2.  Add the dev overlay that shows engine state next to UI state.
3.  Record 20 real sessions as event logs.
4.  Write the conformance test and run it on those 20 sessions. Expect it to fail, and treat each failure as a found bug.
5.  Fix in order of how often each failure appears.
The first run of the conformance test will probably show you most of the hidden bugs you mentioned.
