# VS Code RPC Test Matrix

This appendix covers every method in the packaged extension’s typed webview contract. Each row gives one independently runnable test contract. Run it from the owning UI when mounted and directly against the registered router for contract-only methods. The links identify the current host implementation.

**React** means there is a production React source call site, including the dynamic MCP add/edit call. A source call site can belong to an unmounted component. **Host** means no React RPC call site was identified. Some Host rows are reached through a native editor message or another router method. The [audit report](VSCODE_RUST_ENGINE_AUDIT.md) tracks which pages and controls are mounted.

The target column describes current ownership. Unsupported and static results have an explicit product acceptance case. Run engine-owned cases against an isolated Rust bridge and verify observable engine state after each mutation. For host-owned cases, inspect the native API, Git index, or extension storage.

## Repair verification status

Each row below has an observed disposition after Waves 1–5 verification. **Live verified** means the RPC was exercised end-to-end against the isolated source-built Rust binary (`./target/selfdev/rayu`) in [`vscode/test/liveRustContract.test.ts`](../test/liveRustContract.test.ts) with an independent second SDK verifier across two Git worktrees. **Focused regression** means deterministic host (`featureRouters.test.ts`, `sessionHub.test.ts`, `rayuHostAuthManager.test.ts`, `binaryInstaller.test.ts`, `reversePatch.test.ts`, `workbenchPlacement.test.ts`) and webview Vitest suites verify the repaired contract, error handling, and UI state transitions. **Host only** covers declared host RPCs without mounted React callers (validated by schema + host router tests). **Unavailable in package** means the host returns an explicit unsupported result and the UI control is gated via `operationAvailable(...)`.

## Daemon lifecycle and engine installation

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 1 | [`daemon.status`](../host/runtime/featureRouters.ts#L1990) | React | BridgeManager state | Cold start, disconnect and recover. Check endpoint, source, progress and recovery state. | Live verified |
| 2 | [`daemon.ping`](../host/runtime/featureRouters.ts#L1991) | React | Harness ping | Check correlated pong and latency, then a timeout and successful retry. | Live verified |
| 3 | [`daemon.reconnect`](../host/runtime/featureRouters.ts#L1992) | React | SDK reconnect and pool | Drop the API connection mid-turn. Reattach the correct session without duplicate output or duplicate bridge. | Focused regression |
| 4 | [`daemon.restart`](../host/runtime/featureRouters.ts#L1993) | React | Bridge process control | Restart an owned bridge, then try an externally managed bridge. Check PID, handshake, ownership and failure message. | Focused regression |
| 5 | [`daemon.updateEngine`](../host/runtime/featureRouters.ts#L1994) | React | Managed installer and restart | Run a fixture release, SHA mismatch, offline update and busy deferral. Verify progress, rollback and executable identity. | Focused regression |
| 6 | [`daemon.reload`](../host/runtime/featureRouters.ts#L1998) | React | Runtime server_reload or process fallback | Reload during a fixture turn. Verify actual daemon and bridge identities, reattachment, and separate failures. | Focused regression |
| 7 | [`daemon.selfdev`](../host/runtime/featureRouters.ts#L2013) | React | Runtime info, build/reload unsupported | Test status, build and reload separately. Use authoritative status or an explicit unsupported result. | Focused regression |
| 8 | [`daemon.openOutputLog`](../host/runtime/featureRouters.ts#L2029) | React | Native Output panel | Open Runtime from Settings and status pill. Confirm relevant logs and redacted credentials. | Focused regression |

## Workspace ledger, editor search and Git branch

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 9 | [`workspace.listFolders`](../host/runtime/featureRouters.ts#L2037) | React | VS Code workspace | Open zero, one and two roots. Add/remove a folder and compare names, paths and branch in both surfaces. | Live verified |
| 10 | [`workspace.ledger.get`](../host/runtime/featureRouters.ts#L2040) | React | Shared workspace registry | Load stored records, migrate old flags, accept external updates and preserve ordering across reload. | Live verified |
| 11 | [`workspace.ledger.ensure`](../host/runtime/featureRouters.ts#L2072) | Host | Shared workspace registry | Ensure same path through aliases twice. Verify one ID and correct name/unhide. | Live verified |
| 12 | [`workspace.ledger.remove`](../host/runtime/featureRouters.ts#L2081) | Host | Shared workspace registry | Remove one ledger row and reload. Its directory and Rust sessions stay accessible. | Host only |
| 13 | [`workspace.ledger.setPinned`](../host/runtime/featureRouters.ts#L2087) | Host | Shared workspace registry | Pin/unpin one of two sessions and reload. Compare membership and ordering. | Host only |
| 14 | [`workspace.ledger.setArchived`](../host/runtime/featureRouters.ts#L2097) | Host | Shared workspace registry | Archive/restore the target. Compare VS Code view with CLI and Harness at the intended ownership boundary. | Host only |
| 15 | [`workspace.ledger.setCollapsed`](../host/runtime/featureRouters.ts#L2110) | React | Shared workspace registry | Collapse two groups and reopen one. Verify persistence and independence. | Focused regression |
| 16 | [`workspace.ledger.attachSession`](../host/runtime/featureRouters.ts#L2119) | Host | Shared workspace registry | Attach the same session twice. Check one ledger membership and compare Rust cwd. | Host only |
| 17 | [`workspace.ledger.importProjectGroup`](../host/runtime/featureRouters.ts#L2128) | React | Shared registry after Rust import | Import selected external sessions by project. Verify canonical IDs, no duplicate rows and clear skips. | Focused regression |
| 18 | [`workspace.findFiles`](../host/runtime/featureRouters.ts#L2137) | React | Harness find_files, native search fallback | Search nested Unicode and duplicate names in roots A/B. Check limit, correct root, and honest fallback. | Live verified |
| 19 | [`workspace.contextSnapshot`](../host/runtime/featureRouters.ts#L2152) | React | Runtime context | Use known token breakdown and model window. Compare totals and require an unavailable state on command failure. | Live verified |
| 20 | [`workspace.setContextCap`](../host/runtime/featureRouters.ts#L2190) | Host | Harness set_context_cap | Set valid, invalid and missing-session caps. Verify readback and preservation of the previous valid cap. | Host only |
| 21 | [`workspace.compact`](../host/runtime/featureRouters.ts#L2202) | React | Harness compact | Compact long history and check compacted receipt and retained instructions. Test busy and rejected calls. | Focused regression |
| 22 | [`workspace.setProjectIcon`](../host/runtime/featureRouters.ts#L2214) | React | Host project metadata | Set icon/color and reset. Validate correct project and cross-surface persistence. | Focused regression |
| 23 | [`workspace.pickFiles`](../host/runtime/featureRouters.ts#L2218) | Host | Native file picker | Select multiple matching files and cancel. Check resolved paths and empty cancel. | Host only |
| 24 | [`workspace.listBranches`](../host/runtime/featureRouters.ts#L2225) | React | Native Git | List branches in second root, detached HEAD and non-Git workspace. | Live verified |
| 25 | [`workspace.checkoutBranch`](../host/runtime/featureRouters.ts#L2227) | Host | Native Git | Switch fixture branch, then try conflicting dirty checkout. Verify actual branch and untouched dirty bytes. | Host only |

## Session lifecycle, history and interaction

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 26 | [`sessions.list`](../host/runtime/featureRouters.ts#L2233) | React | Harness list_sessions plus shared ledger | Seed 201+ sessions, archived and external entries. Verify limit/paging, source and offline state. | Live verified |
| 27 | [`sessions.listExternalProjects`](../host/runtime/featureRouters.ts#L2237) | React | Harness list_external_projects | Seed external source roots and invalid/missing records. Verify project counts, source filter and old bridge. | Focused regression |
| 28 | [`sessions.importExternal`](../host/runtime/featureRouters.ts#L2247) | React | Harness import_external_sessions | Import, retry, force-resync and fork on conflict. Compare provenance, stable IDs, transcript and skip reasons. | Focused regression |
| 29 | [`sessions.search`](../host/runtime/featureRouters.ts#L2256) | React | Runtime session_search | Search phrase, Unicode, special characters and source scope. Compare native IDs, snippets and selection/attach. | Live verified |
| 30 | [`sessions.create`](../host/runtime/featureRouters.ts#L2299) | React | Harness create_session plus settings | Submit draft once in root B. Check one session and acknowledged model, effort, permission and cwd before first turn. | Live verified |
| 31 | [`sessions.attach`](../host/runtime/featureRouters.ts#L2307) | React | Harness attach_session and socket pool | Attach idle, busy, synthetic external and unknown sessions. Verify resolved ID, history, state and concurrency. | Live verified |
| 32 | [`sessions.history`](../host/runtime/featureRouters.ts#L2311) | React | Harness get_history | Load 100+ turns with tools, images, stats and provenance. Verify order, error state and live/history deduplication. | Live verified |
| 33 | [`sessions.rename`](../host/runtime/featureRouters.ts#L2312) | React | Harness rename_session | Rename to Unicode, reload and list through Rust. Verify same ID and error for nonexistent ID. | Live verified |
| 34 | [`sessions.fork`](../host/runtime/featureRouters.ts#L2317) | React | Harness fork_session | Fork whole chat and at turn 1 of 3. Compare exact child history and unchanged parent. | Live verified |
| 35 | [`sessions.transfer`](../host/runtime/featureRouters.ts#L2325) | Host | Harness transfer_session | Transfer a populated session. Check fresh ID, compact handoff, original unchanged and no phantom child on failure. | Host only |
| 36 | [`sessions.export`](../host/runtime/featureRouters.ts#L2330) | React | Harness get_history plus host formatting | Export Markdown and JSON. Verify exact session, formatting and structured tool history. | Live verified |
| 37 | [`sessions.archive`](../host/runtime/featureRouters.ts#L2341) | React | Shared ledger vs Rust archive/restore | Archive and restore in VS Code, CLI and Harness. Require consistent state or an explicit local-only filter label. | Live verified |
| 38 | [`sessions.pin`](../host/runtime/featureRouters.ts#L2345) | React | Shared workspace registry | Pin/unpin under search/filter. Verify persisted ordering and stable active session. | Live verified |
| 39 | [`sessions.projectIcon`](../host/runtime/featureRouters.ts#L2349) | Host | Host project metadata alias | Set/reset via this RPC, compare workspace.setProjectIcon, check shared broadcast. | Host only |
| 40 | [`sessions.setPermissionMode`](../host/runtime/featureRouters.ts#L2353) | React | Harness set_permission_mode | Exercise every advertised mode idle and busy. Verify Rust mode, deferred result and rejected-mode rollback. | Live verified |
| 41 | [`sessions.rewind`](../host/runtime/featureRouters.ts#L2355) | React | Harness rewind | Use second user ordinal with intervening tool rows. Verify history/files, invalid index, and session isolation. | Focused regression |
| 42 | [`sessions.rewindUndo`](../host/runtime/featureRouters.ts#L2387) | React | Harness rewind_undo | Undo a real rewind and compare history/files. Try no prior rewind and a conflicting new edit. | Focused regression |
| 43 | [`sessions.softInterrupt`](../host/runtime/featureRouters.ts#L2392) | React | Harness soft_interrupt | Inject text and images while A streams. Verify exactly one provider input and client ID in injected event. | Focused regression |
| 44 | [`sessions.cancelSoftInterrupts`](../host/runtime/featureRouters.ts#L2405) | React | Harness cancel_soft_interrupts | Cancel one of two pending IDs, all, and a delivered ID. Verify cancelled/not-queued and old bridge behavior. | Focused regression |
| 45 | [`sessions.respondPermission`](../host/runtime/featureRouters.ts#L2425) | React | Harness permission_response | Allow, allow always and deny a benign tool. Check request/session ID, engine result, duplicate and disconnect. | Focused regression |
| 46 | [`sessions.respondQuestion`](../host/runtime/featureRouters.ts#L2429) | React | Harness question_response | Answer single/multiple options, text/notes and decline. Verify wire shape, exact question ID and engine close across surfaces. | Focused regression |
| 47 | [`sessions.setModel`](../host/runtime/featureRouters.ts#L5502) | React | Harness set_model | Switch same bare name across providers/API methods. Assert engine readback, next-turn deferral and rejected change. | Focused regression |
| 48 | [`sessions.setEffort`](../host/runtime/featureRouters.ts#L5531) | React | Harness set_reasoning_effort | Apply every advertised effort, an unsupported provider and a busy next-turn change. Verify actual next request. | Focused regression |
| 49 | [`sessions.runtimeCommand`](../host/runtime/featureRouters.ts#L5553) | React | Harness runtime_command | Execute every advertised composer command with valid/invalid input. Assert typed result, session target and visible error. | Focused regression |

## Background processes

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 50 | [`background.list`](../host/runtime/featureRouters.ts#L2453) | React | Runtime background list plus cache | Seed running/completed tasks in A and B. Open drawer, switch and reload. Verify grouping and isolation. | Live verified |
| 51 | [`background.status`](../host/runtime/featureRouters.ts#L2462) | React | Runtime background status | Inspect running, stalled, completed and unknown task. Assert correct task ID and scoped state. | Focused regression |
| 52 | [`background.output`](../host/runtime/featureRouters.ts#L2478) | React | Runtime background output | Verify ordered ANSI/Unicode stdout and stderr, byte limit, final tail and session isolation. | Focused regression |
| 53 | [`background.cancel`](../host/runtime/featureRouters.ts#L2516) | React | Runtime background cancel | Cancel a harmless long-running job, then retry. Verify correct child and truthful error. | Focused regression |
| 54 | [`background.cleanup`](../host/runtime/featureRouters.ts#L2529) | React | Runtime background cleanup plus cache | Clear completed A tasks while A still has a live task and B has a finished task. Verify counts and unaffected B. | Focused regression |
| 55 | [`background.backgroundTool`](../host/runtime/featureRouters.ts#L2547) | React | Harness background_tool | Background one tool. Assert real job ID, progress, old-bridge limitation and race with completion. | Focused regression |

## Swarm mission control

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 56 | [`swarm.status`](../host/runtime/featureRouters.ts#L2557) | React | Runtime swarm status | Seed two durable groups, choose one and compare roster/plan readback. Go offline and verify unavailable state. | Live verified |
| 57 | [`swarm.list`](../host/runtime/featureRouters.ts#L2807) | React | Runtime swarm list | Switch between groups, reload and check IDs, order, zero vs unavailable. | Live verified |
| 58 | [`swarm.setLabel`](../host/runtime/featureRouters.ts#L2846) | React | Unsupported host stub | Rename and verify persisted engine title or disabled action with original title intact. | Unavailable in package |
| 59 | [`swarm.spawn`](../host/runtime/featureRouters.ts#L2850) | React | Unsupported host stub | Run custom and each preset. Require real engine worker IDs/worktrees, report partial failure, and never show phantom members. | Unavailable in package |
| 60 | [`swarm.kill`](../host/runtime/featureRouters.ts#L2855) | React | Unsupported host stub | Pause/resume/stop one worker. Verify real worker state and isolation from another worker. | Unavailable in package |
| 61 | [`swarm.salvage`](../host/runtime/featureRouters.ts#L2860) | React | Unsupported host stub | Recover an interrupted worker and compare worktree/task ownership. Unknown worker leaves roster unchanged. | Unavailable in package |
| 62 | [`swarm.pauseAll`](../host/runtime/featureRouters.ts#L2864) | React | Unsupported host stub | Pause/resume a group and compare each member and separate group. Check partial rejection. | Unavailable in package |
| 63 | [`swarm.board`](../host/runtime/featureRouters.ts#L2868) | Host | Runtime swarm board | Load board messages and task/plan records for two groups. Check chronological engine IDs and scope. | Host only |
| 64 | [`swarm.planDecide`](../host/runtime/featureRouters.ts#L2919) | React | Unsupported host stub | Approve/reject real versioned proposals, including a stale proposal. Verify engine plan version and cache rollback. | Unavailable in package |
| 65 | [`swarm.worktreeOpen`](../host/runtime/featureRouters.ts#L2923) | React | VS Code window API | Open a real worktree, then missing path. Expect one new window and actionable failure. | Focused regression |
| 66 | [`swarm.dm`](../host/runtime/featureRouters.ts#L2927) | React | Unsupported host stub | DM one worker and steer all workers. Require engine receipts and no cached message on refusal. | Unavailable in package |
| 67 | [`swarm.peekSession`](../host/runtime/featureRouters.ts#L2931) | React | Harness peek_session and get_todo_state | Inspect workers without stealing focus or attachment. Check transcript/todos, polling, busy and unknown state. | Focused regression |

## Overnight, schedules, ambient and quality

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 68 | [`automations.overnight.list`](../host/runtime/featureRouters.ts#L2953) | React | Runtime overnight status | Load persisted/active/expired records. Verify IDs, progress and empty/unavailable behavior. | Live verified |
| 69 | [`automations.overnight.start`](../host/runtime/featureRouters.ts#L3028) | React | Runtime overnight duration and mission | Start fixture, reject bad duration/duplicate start, verify real manifest and cwd. | Focused regression |
| 70 | [`automations.overnight.pause`](../host/runtime/featureRouters.ts#L3060) | React | Unsupported host stub | Pause and resume. Confirm engine transition or disabled control with unchanged cached state. | Unavailable in package |
| 71 | [`automations.overnight.runNow`](../host/runtime/featureRouters.ts#L3065) | React | Unsupported host stub | Trigger immediate execution. Verify engine receipt or unsupported and unchanged validation counts. | Unavailable in package |
| 72 | [`automations.overnight.cancel`](../host/runtime/featureRouters.ts#L3070) | React | Runtime overnight cancel | Cancel one of two jobs. Verify exact worker/manifest and unchanged row on failure. | Focused regression |
| 73 | [`automations.overnight.log`](../host/runtime/featureRouters.ts#L3075) | React | Runtime overnight log | Open exact run tail, verify final lines and handle missing log or invalid run ID. | Focused regression |
| 74 | [`automations.overnight.report`](../host/runtime/featureRouters.ts#L3105) | React | Runtime overnight report | Load real handoff and verify checks, files, links, report pending and missing. | Focused regression |
| 75 | [`automations.schedules.list`](../host/runtime/featureRouters.ts#L3164) | React | Runtime schedules list | Seed pending and completed entries. Compare timestamp, type, cwd and next run. | Live verified |
| 76 | [`automations.schedules.create`](../host/runtime/featureRouters.ts#L3215) | React | Runtime schedules create | Create each exposed kind under fixture clock/timezone. Check saved ID/time/target and invalid form. | Focused regression |
| 77 | [`automations.schedules.toggle`](../host/runtime/featureRouters.ts#L3255) | React | Unsupported host stub | Toggle off/on and verify persistence and scheduler behavior or unchanged row on unsupported. | Unavailable in package |
| 78 | [`automations.schedules.runNow`](../host/runtime/featureRouters.ts#L3260) | React | Unsupported host stub | Trigger immediately and check actual engine occurrence or unchanged last-run time after rejection. | Unavailable in package |
| 79 | [`automations.schedules.cancel`](../host/runtime/featureRouters.ts#L3265) | React | Runtime schedules cancel | Cancel one ID and verify timer never fires, other schedules survive and failure keeps row. | Focused regression |
| 80 | [`automations.ambient.status`](../host/runtime/featureRouters.ts#L3272) | React | Runtime ambient status | Read off/on, pending/approved/denied and fixture inbox states. Validate engine counts vs unavailable. | Live verified |
| 81 | [`automations.ambient.approvals`](../host/runtime/featureRouters.ts#L3308) | Host | Runtime ambient approvals | List pending/resolved fixture items with IDs/times. Compare to status, empty and unsupported states. | Host only |
| 82 | [`automations.ambient.decide`](../host/runtime/featureRouters.ts#L3314) | React | Runtime ambient decide | Approve or deny a fixture item. Verify persisted decision and unchanged card on stale ID. | Focused regression |
| 83 | [`automations.quality.status`](../host/runtime/featureRouters.ts#L3322) | React | Runtime autoreview and autojudge | Set different flag values and compare readback after external CLI change and reconnect. | Live verified |
| 84 | [`automations.quality.setAutoReview`](../host/runtime/featureRouters.ts#L3334) | React | Runtime autoreview | Flip review only and verify effective state after reload. | Focused regression |
| 85 | [`automations.quality.setAutoJudge`](../host/runtime/featureRouters.ts#L3338) | React | Runtime autojudge | Flip judge only and verify effective state after reload. | Focused regression |
| 86 | [`automations.quality.runReview`](../host/runtime/featureRouters.ts#L3342) | React | Runtime review | Review a fixture diff. Verify real worker session ID, receipt and denied permission. | Focused regression |
| 87 | [`automations.quality.runJudge`](../host/runtime/featureRouters.ts#L3358) | React | Runtime judge | Judge fixture evidence. Verify real worker/result ID, target and failure handling. | Focused regression |
| 88 | [`automations.quality.productivity`](../host/runtime/featureRouters.ts#L3374) | React | Runtime productivity | Check each displayed range against seeded report data, timezone, missing artifact and native link. | Focused regression |

## Connectors, skills, memory and workspace integrations

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 89 | [`plugins.mcp.list`](../host/runtime/featureRouters.ts#L3408) | React | Runtime mcp status plus projection | Seed stdio, HTTP, disabled and auth-required connectors. Compare actual tools, health, source and empty state. | Live verified |
| 90 | [`plugins.mcp.test`](../host/runtime/featureRouters.ts#L3515) | React | Runtime mcp test | Test healthy and failed local connectors. Verify connecting/result, diagnostics and target ID. | Focused regression |
| 91 | [`plugins.mcp.toggle`](../host/runtime/featureRouters.ts#L3537) | React | Runtime mcp toggle | Toggle connector and check actual tool visibility. Reject and roll back on failure. | Focused regression |
| 92 | [`plugins.mcp.reload`](../host/runtime/featureRouters.ts#L3545) | React | Runtime mcp reload | Change fixture connector tools on disk, reload and query engine. Test malformed config. | Focused regression |
| 93 | [`plugins.mcp.add`](../host/runtime/featureRouters.ts#L3550) | React | Host MCP config write plus engine reload attempt | Create stdio and HTTP in supported scopes. Verify validation, correct file, actual tools and reload failure. | Live verified |
| 94 | [`plugins.mcp.edit`](../host/runtime/featureRouters.ts#L3551) | React | Host MCP entry replacement plus reload attempt | Change one connector. Preserve other entries/secret references, verify scope and engine readback. | Live verified |
| 95 | [`plugins.mcp.remove`](../host/runtime/featureRouters.ts#L3552) | React | Host MCP config write plus reload attempt | Remove target connector. Preserve siblings and verify tools disappear after successful reload. | Live verified |
| 96 | [`plugins.mcp.login`](../host/runtime/featureRouters.ts#L3568) | React | Unsupported host stub | Complete/cancel fixture OAuth or show disabled before opening. Verify connector auth state and no accidental credential write. | Unavailable in package |
| 97 | [`plugins.mcp.logout`](../host/runtime/featureRouters.ts#L3573) | React | Unsupported host stub | Disconnect fixture connector or show unsupported with original state. | Unavailable in package |
| 98 | [`plugins.mcp.oauth`](../host/runtime/featureRouters.ts#L3578) | React | Host connector status and unsupported OAuth actions | Check status against MCP list; start/complete are rejected. Verify native browser/copy separately through the relevant editor envelopes. | Focused regression |
| 99 | [`plugins.skills.list`](../host/runtime/featureRouters.ts#L3593) | React | Runtime skills | Seed user/project/duplicate skills. Check path and scope, add fresh skill and discover live. | Live verified |
| 100 | [`plugins.skills.create`](../host/runtime/featureRouters.ts#L3621) | React | Host SKILL.md write | Create each scope, check file and discovery, and assert duplicate or invalid input preserves the existing file. | Live verified |
| 101 | [`plugins.skills.install`](../host/runtime/featureRouters.ts#L3666) | React | Unsupported host stub | Install a fixture item to selected scope or gate before click. Verify real file/discovery and no false installed badge. | Unavailable in package |
| 102 | [`plugins.skills.reload`](../host/runtime/featureRouters.ts#L3669) | React | Runtime skills | Edit fixture skill then reload. Verify new content and slash picker refresh. | Focused regression |
| 103 | [`plugins.skills.run`](../host/runtime/featureRouters.ts#L3673) | React | Unsupported host stub | Run a skill and compare with chat invocation. Confirm one real prompt/engine action or visible unavailable state. | Unavailable in package |
| 104 | [`plugins.memory.status`](../host/runtime/featureRouters.ts#L3678) | React | Runtime memory status | Compare toggle/activity and facts with seeded Rust state. Distinguish no fact API from empty results. | Live verified |
| 105 | [`plugins.memory.toggle`](../host/runtime/featureRouters.ts#L3704) | React | Runtime memory | Toggle target session and compare global defaults and another session. Rejected change must roll back. | Focused regression |
| 106 | [`plugins.memory.extract`](../host/runtime/featureRouters.ts#L3708) | React | Runtime memory extract | Try too-short then eligible transcript. Distinguish scheduled, completed and count unavailable. | Focused regression |
| 107 | [`plugins.memory.remember`](../host/runtime/featureRouters.ts#L3720) | React | Unsupported host stub | Remember one fixture fact and reload. Unsupported must preserve form and avoid a new graph node. | Unavailable in package |
| 108 | [`plugins.memory.recall`](../host/runtime/featureRouters.ts#L3726) | Host | Host filter over runtime memory status | Filter scope/tag/text in real facts. Distinguish unsupported fact retrieval from no match. | Host only |
| 109 | [`plugins.memory.search`](../host/runtime/featureRouters.ts#L3741) | Host | Alias of host recall | Search case, Unicode, empty query and facts owned by another session. | Host only |
| 110 | [`plugins.memory.forget`](../host/runtime/featureRouters.ts#L3743) | React | Unsupported host stub | Delete a fixture fact and re-list, or reject and keep fact and edges. | Unavailable in package |
| 111 | [`plugins.memory.tag`](../host/runtime/featureRouters.ts#L3747) | React | Unsupported host stub | Add/remove tag and re-list or reject with unchanged graph. | Unavailable in package |
| 112 | [`plugins.memory.link`](../host/runtime/featureRouters.ts#L3751) | React | Unsupported host stub | Link saved facts, reject invalid IDs and preserve graph on failure. | Unavailable in package |
| 113 | [`plugins.workspace.status`](../host/runtime/featureRouters.ts#L3755) | React | Static host response | Compare Gmail, Calendar, Browser and Companion to fixture status or show unsupported state. | Live verified |
| 114 | [`plugins.workspace.trigger`](../host/runtime/featureRouters.ts#L3776) | React | Host integration stub | Run each exposed action in a fixture. Require one actual receipt or disable it with clear reason. | Unavailable in package |

## Changes and file review

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 115 | [`changes.status`](../host/runtime/featureRouters.ts#L3784) | Host | Native Git plus Harness get_file_changes | Mix staged, untracked, renamed, deleted, conflicting and manual edits in two repos. Verify scope and attribution. | Host only |
| 116 | [`changes.getSessionSummary`](../host/runtime/featureRouters.ts#L3880) | React | Harness get_file_changes or read-only legacy Git | Mark known agent and manual edits. Verify latest turn, path identity and safe old-bridge behavior. | Live verified |
| 117 | [`changes.diff`](../host/runtime/featureRouters.ts#L3939) | React | Harness get_file_change_diff or Git | Compare native and inline view for rename, deleted, binary, large and staged cases. | Live verified |
| 118 | [`changes.stage`](../host/runtime/featureRouters.ts#L3980) | Host | Native Git index | Stage a file in B while A has a same-named file. Assert both indexes. | Host only |
| 119 | [`changes.unstage`](../host/runtime/featureRouters.ts#L3981) | Host | Native Git index | Unstage selected file in B. Verify untouched bytes, correct repo and unborn HEAD behavior. | Host only |
| 120 | [`changes.keep`](../host/runtime/featureRouters.ts#L3982) | React | Harness file_change_action keep | Keep a pending file, verify engine decision/readback and unchanged bytes. Rejected state remains pending. | Focused regression |
| 121 | [`changes.undo`](../host/runtime/featureRouters.ts#L3984) | React | Harness file_change_action undo | Undo agent edit with manual content present. Verify conflict, byte preservation, force scope and safe old-bridge path. | Focused regression |
| 122 | [`changes.redo`](../host/runtime/featureRouters.ts#L3986) | React | Harness file_change_action redo | Redo a previously undone change and verify bytes/snapshot. Test unsupported and stale baseline. | Focused regression |
| 123 | [`changes.keepAll`](../host/runtime/featureRouters.ts#L3988) | React | Harness file_change_action keep_all | Keep pending files and verify each outcome and correct root/session. | Focused regression |
| 124 | [`changes.undoAll`](../host/runtime/featureRouters.ts#L3990) | React | Harness file_change_action undo_all | Mix clean reversals, conflicts and untracked files. Verify actual per-file outcomes and preserved manual edits. | Focused regression |
| 125 | [`changes.redoAll`](../host/runtime/featureRouters.ts#L3992) | React | Harness file_change_action redo_all | Redo multiple files and compare snapshots, conflict records and old-bridge state. | Focused regression |
| 126 | [`changes.commit`](../host/runtime/featureRouters.ts#L3994) | Host | Native Git | Commit staged fixture contents only. Verify repo/hash, hook failure and cancellation. | Host only |
| 127 | [`changes.createPr`](../host/runtime/featureRouters.ts#L3995) | Host | Native GitHub CLI | Use fixture gh to assert explicit confirmation, base/head/body/draft and URL. Reject wrong root and cancellation without external effects. | Host only |

## Telegram, gateway and cloud

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 128 | [`remote.telegram.status`](../host/runtime/featureRouters.ts#L4000) | React | Runtime telegram status | Verify unlinked, pending, linked, offline, active target and approval counts against fixture integrations. | Live verified |
| 129 | [`remote.telegram.linkHosted`](../host/runtime/featureRouters.ts#L4129) | React | Runtime telegram hosted pairing | Request a short-lived pairing code. Check QR/deep link, expiry, cancellation and final linked identity. | Focused regression |
| 130 | [`remote.telegram.linkBotfather`](../host/runtime/featureRouters.ts#L4173) | React | Runtime telegram self-hosted setup | Test invalid and fixture bot tokens, partial setup and success. Assert storage and redaction of token. | Focused regression |
| 131 | [`remote.telegram.disconnect`](../host/runtime/featureRouters.ts#L4225) | React | Runtime telegram disconnect | Disconnect each supported link mode. Verify engine stops routing, pending state and cancellation. | Focused regression |
| 132 | [`remote.telegram.testPing`](../host/runtime/featureRouters.ts#L4233) | React | Runtime telegram test | Ping a disposable link and check exact recipient and ack. Show failure when unlinked. | Focused regression |
| 133 | [`remote.telegram.driveSession`](../host/runtime/featureRouters.ts#L4247) | React | Runtime telegram session selection | Select A then B and send fixture remote input. Verify events appear only on selected session. | Focused regression |
| 134 | [`remote.telegram.uninstallToggle`](../host/runtime/featureRouters.ts#L4254) | React | Runtime telegram uninstall | Toggle setting and read back. Confirm normal link is unaffected and state reverts on denial. | Focused regression |
| 135 | [`remote.telegram.approvals`](../host/runtime/featureRouters.ts#L4265) | Host | Runtime telegram approvals | List session-scoped pending/resolved approvals and IDs. Compare to status and stale link behavior. | Host only |
| 136 | [`remote.telegram.decide`](../host/runtime/featureRouters.ts#L4269) | React | Runtime telegram decide | Allow/deny one approval while another is pending. Match engine event and reject duplicate/stale decision. | Focused regression |
| 137 | [`remote.infra.status`](../host/runtime/featureRouters.ts#L4277) | React | Runtime remote status | Verify SSH/cloud/gateway state, paired devices and remote sessions from live fixture; show disconnected honestly. | Live verified |
| 138 | [`remote.gateway.toggle`](../host/runtime/featureRouters.ts#L4328) | React | Runtime remote gateway enable/disable | Toggle gateway and verify engine state after reconnect. Failure leaves existing state unchanged. | Focused regression |
| 139 | [`remote.gateway.pair`](../host/runtime/featureRouters.ts#L4344) | React | Runtime remote pair | Check URI/code/QR expiry and cancellation, then pair one fixture device and read actual membership. | Focused regression |
| 140 | [`remote.gateway.revoke`](../host/runtime/featureRouters.ts#L4368) | React | Runtime remote revoke | Revoke one paired device. Check connection is closed, device removed and second device unaffected. | Focused regression |
| 141 | [`remote.cloud.moveToCloud`](../host/runtime/featureRouters.ts#L4375) | React | Unsupported host stub | Move within a sandbox cloud fixture or show unavailable. Verify continuity, explicit failure and correct remote ID. | Unavailable in package |
| 142 | [`remote.cloud.returnLocal`](../host/runtime/featureRouters.ts#L4379) | React | Unsupported host stub | Return fixture session with context and workspace preserved or report unavailable with original cloud session untouched. | Unavailable in package |
| 143 | [`remote.cloud.attach`](../host/runtime/featureRouters.ts#L4383) | React | Unsupported host stub | Attach correct cloud ID and route live events only to it, or report unavailable without changing surface. | Unavailable in package |
| 144 | [`remote.cloud.syncEnv`](../host/runtime/featureRouters.ts#L4387) | React | Unsupported host stub | Sync only allowed fixture variables with redaction and repeatability, or render explicit unavailable state. | Unavailable in package |

## Account, providers, models and settings

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 145 | [`settings.account.get`](../host/runtime/featureRouters.ts#L4395) | React | Host Rayu auth plus runtime subscription | Load signed-out, API-key, OAuth, expired and offline states. Compare credits/pacing/session and providers. | Focused regression |
| 146 | [`settings.account.refresh`](../host/runtime/featureRouters.ts#L4572) | React | Host auth refresh | Force a fixture refresh. Preserve last valid credits and models on transient failure and update all surfaces. | Focused regression |
| 147 | [`settings.account.signInBrowser`](../host/runtime/featureRouters.ts#L4578) | React | Host OAuth | Exercise deep-link and loopback, CSRF handling, browser cancel, timeout and success; engine route becomes usable. | Focused regression |
| 148 | [`settings.account.cancelSignIn`](../host/runtime/featureRouters.ts#L4600) | React | Host OAuth | Cancel pending deep-link and loopback, then deliver stale callback. It cannot sign in or leave listener running. | Focused regression |
| 149 | [`settings.account.signInApiKey`](../host/runtime/featureRouters.ts#L4606) | React | Host auth and Harness set_api_key | Enter invalid then valid fixture key. Verify secure storage, engine readiness and no key in webview events/logs. | Focused regression |
| 150 | [`settings.account.completeCallback`](../host/runtime/featureRouters.ts#L4615) | React | Host OAuth callback | Use valid, wrong-state, invalid and replayed callbacks. Verify one exchange and synchronized host/engine state. | Focused regression |
| 151 | [`settings.account.signOut`](../host/runtime/featureRouters.ts#L4624) | React | Host auth plus engine logout/invalidation | Sign out in two surfaces during idle and offline; verify tokens/routes/credits and no token leakage. | Focused regression |
| 152 | [`settings.account.setBypassPacing`](../host/runtime/featureRouters.ts#L4632) | React | Host account service | Toggle fixture pacing, compare effective state after refresh and display refusal without stale success. | Focused regression |
| 153 | [`settings.analytics.get`](../host/runtime/featureRouters.ts#L4639) | React | Static zero host response | Seed known usage and test every range/group. Require matching data or explicitly unavailable, including real zero. | Live verified |
| 154 | [`settings.providers.list`](../host/runtime/featureRouters.ts#L4647) | React | Runtime auth status plus host account | Show ready, needs-key, expired and build-disabled routes. Compare per-provider actual readiness and scope. | Live verified |
| 155 | [`settings.providers.setApiKey`](../host/runtime/featureRouters.ts#L4768) | React | Harness set_api_key plus auth notification | Set a fixture key for an alias, verify canonical route, model/credential publication and redaction. | Focused regression |
| 156 | [`settings.providers.clearApiKey`](../host/runtime/featureRouters.ts#L4784) | React | Harness clear_api_key plus auth notification | Clear only target API key and refresh lists. Preserve unrelated accounts and handle storage failure. | Focused regression |
| 157 | [`settings.providers.logout`](../host/runtime/featureRouters.ts#L4799) | React | Host auth or runtime logout | Log out each auth type separately. Compare connected routes and remaining OAuth/API-key credentials. | Focused regression |
| 158 | [`settings.doctor.run`](../host/runtime/featureRouters.ts#L4814) | React | Runtime doctor and host state | Run each scope good/bad/offline. Verify typed checks, actual error, no secrets and links. | Live verified |
| 159 | [`settings.models.get`](../host/runtime/featureRouters.ts#L4852) | React | Harness runtime_info, runtime agents/subagent_model and hosted catalog | Compare global/session routes, effort, auth badges and matching names with different providers. | Live verified |
| 160 | [`settings.models.refresh`](../host/runtime/featureRouters.ts#L5038) | React | Runtime refresh_model_list plus host catalog | Discover arbitrary future model from provider schema; bypass fresh cache, retain last good on 401/5xx/bad JSON, publish to long-lived pickers. | Live verified |
| 161 | [`settings.models.setFast`](../host/runtime/featureRouters.ts#L5079) | React | Runtime fast | Test every supported tier, model without support and global/session scope. Verify actual subsequent provider request and rollback. | Focused regression |
| 162 | [`settings.models.setCacheTtl`](../host/runtime/featureRouters.ts#L5087) | React | Runtime cache | Test both TTLs and unsupported provider. Compare canonical config, model requests and source shown after rollback. | Live verified |
| 163 | [`settings.models.setTransport`](../host/runtime/featureRouters.ts#L5092) | React | Runtime transport | Switch transport, verify effective provider transport and config after reboot; reject unsupported values/route. | Focused regression |
| 164 | [`settings.models.setRoleOverride`](../host/runtime/featureRouters.ts#L5097) | React | Runtime agents role override | Set and clear each role in both scopes. Compare effective precedence and fresh worker route. | Focused regression |
| 165 | [`settings.agents.setSubagentModel`](../host/runtime/featureRouters.ts#L5110) | React | Runtime subagent_model | Set then clear global/session worker model. Verify actual next worker and preservation of unrelated roles. | Focused regression |
| 166 | [`settings.agents.upsertProfile`](../host/runtime/featureRouters.ts#L5130) | React | Runtime agents profile mutation | Create/edit in both scopes with valid and invalid models. Verify config/session and next worker. | Focused regression |
| 167 | [`settings.agents.deleteProfile`](../host/runtime/featureRouters.ts#L5172) | React | Runtime agents profile removal | Delete target scope only with confirmation. Verify fallback selection and failure state. | Focused regression |
| 168 | [`settings.features.get`](../host/runtime/featureRouters.ts#L5205) | React | Runtime features status plus host voice/telemetry | Read actual feature states and preference source. Test CLI changes and offline readability. | Live verified |
| 169 | [`settings.features.set`](../host/runtime/featureRouters.ts#L5218) | React | Runtime features set | Toggle each exposed key in isolation, compare config/reload and engine capability. Reject bad names/values. | Focused regression |
| 170 | [`settings.voice.update`](../host/runtime/featureRouters.ts#L5232) | React | Host global state | Set enabled/device/noise/autosend, verify storage only. Gate dictation until actual start, transcript and stop are wired. | Unavailable in package |
| 171 | [`settings.telemetry.set`](../host/runtime/featureRouters.ts#L5251) | React | Runtime telemetry plus host mirror | Test every category and all/none. Verify engine config, visible state, rejected change and no accidental external telemetry. | Focused regression |
| 172 | [`settings.hooks.list`](../host/runtime/featureRouters.ts#L5292) | React | Runtime doctor hooks | Seed valid, disabled and invalid hooks. Verify scope, effective definitions and error state. | Live verified |
| 173 | [`settings.hooks.openConfig`](../host/runtime/featureRouters.ts#L5322) | React | Native editor | Open actual config path, custom path and absent file. Verify correct file and useful error. | Focused regression |
| 174 | [`settings.permission.getDefault`](../host/runtime/featureRouters.ts#L5327) | React | Host configuration | Read configured default plus active session comparison under non-default active mode. | Live verified |
| 175 | [`settings.permission.setDefault`](../host/runtime/featureRouters.ts#L5332) | React | Host configuration plus optional Harness set_permission_mode | Set every mode for future sessions; separately test apply-now, busy defer and engine rejection. | Live verified |
| 176 | [`settings.shortcuts.list`](../host/runtime/featureRouters.ts#L5344) | React | Host catalog | Check shown command IDs and OS labels against manifest and effective user bindings. | Live verified |
| 177 | [`settings.shortcuts.openKeybindings`](../host/runtime/featureRouters.ts#L5347) | React | Native editor command | Open keyboard shortcut UI in the correct workbench and verify filter/cancellation. | Focused regression |
| 178 | [`settings.runtime.get`](../host/runtime/featureRouters.ts#L5351) | React | Host VS Code settings | Resolve explicit paths, default socket, auto-start and current transport. Check machine scope. | Live verified |
| 179 | [`settings.runtime.update`](../host/runtime/featureRouters.ts#L5361) | React | Host VS Code settings | Save valid/invalid socket and binary path and flip auto-start. Verify setting scope and connection uses updated values. | Focused regression |
| 180 | [`settings.feedback.submit`](../host/runtime/featureRouters.ts#L5365) | React | Unsupported host stub | Use a local submission fixture or show unsupported. A rejection must neither clear form nor show submitted. | Unavailable in package |

## Session inspector and todos

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 181 | [`inspector.sidePanel.get`](../host/runtime/featureRouters.ts#L5373) | Host | Host cache from Rust side_panel_state | Feed named pages for A/B and validate active page, refresh, late state and missing capability. | Host only |
| 182 | [`inspector.sidePanel.close`](../host/runtime/featureRouters.ts#L5375) | Host | Host cache only | Close one/all cached pages. Verify agreed close semantics across surfaces and a later engine update. | Host only |
| 183 | [`inspector.applet.get`](../host/runtime/featureRouters.ts#L5379) | Host | Host cache from Rust applet_state | Render registered/missing/updated applets, scoped by session and capability. | Host only |
| 184 | [`inspector.applet.action`](../host/runtime/featureRouters.ts#L5382) | Host | Harness applet_action | Dispatch structured action/payload to correct session/applet and confirm authoritative updated snapshot or rejection. | Host only |
| 185 | [`inspector.applet.close`](../host/runtime/featureRouters.ts#L5395) | Host | Harness close_applet | Close a named applet and await authoritative removal, including cross-surface and stale ID. | Host only |
| 186 | [`inspector.todos.get`](../host/runtime/featureRouters.ts#L5583) | React | Harness get_todo_state plus cache | Verify all four statuses, reopen/refresh after engine change and preserve session isolation. | Live verified |

## Engine capabilities

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 187 | [`capabilities.get`](../host/runtime/featureRouters.ts#L5400) | React | Harness get_capabilities | Check curated commands, modes/features matched to current connection, unsupported v1.15 and offline separately. | Live verified |

## Canonical configuration

| # | RPC | Caller | Current target | Test and expected result | Disposition |
| ---: | --- | --- | --- | --- | --- |
| 188 | [`config.get`](../host/runtime/featureRouters.ts#L5443) | React | Harness get_config | Read current sections/schema/path and validate CLI/Desktop changes. Compare v1.15 read-only view. | Live verified |
| 189 | [`config.patch`](../host/runtime/featureRouters.ts#L5464) | React | Harness patch_config | Patch valid and invalid values, verify on-disk readback, per-field errors, restart hints and peer config_changed. | Focused regression |
