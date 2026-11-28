# VS Code RPC Test Matrix

This appendix covers every method in the packaged extension’s typed webview contract. Each row gives one independently runnable test contract. Run it from the owning UI when mounted and directly against the registered router for contract-only methods. The links identify the current host implementation.

**React** means there is a production React source call site, including the dynamic MCP add/edit call. A source call site can belong to an unmounted component. **Host** means no React RPC call site was identified. Some Host rows are reached through a native editor message or another router method. The [audit report](VSCODE_RUST_ENGINE_AUDIT.md) tracks which pages and controls are mounted.

The target column describes current ownership. Unsupported and static results have an explicit product acceptance case. Run engine-owned cases against an isolated Rust bridge and verify observable engine state after each mutation. For host-owned cases, inspect the native API, Git index, or extension storage.

## Daemon lifecycle and engine installation

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 1 | [`daemon.status`](../host/runtime/featureRouters.ts#L1843) | React | BridgeManager state | Cold start, disconnect and recover. Check endpoint, source, progress and recovery state. |
| 2 | [`daemon.ping`](../host/runtime/featureRouters.ts#L1844) | React | Harness ping | Check correlated pong and latency, then a timeout and successful retry. |
| 3 | [`daemon.reconnect`](../host/runtime/featureRouters.ts#L1845) | React | SDK reconnect and pool | Drop the API connection mid-turn. Reattach the correct session without duplicate output or duplicate bridge. |
| 4 | [`daemon.restart`](../host/runtime/featureRouters.ts#L1846) | React | Bridge process control | Restart an owned bridge, then try an externally managed bridge. Check PID, handshake, ownership and failure message. |
| 5 | [`daemon.updateEngine`](../host/runtime/featureRouters.ts#L1847) | React | Managed installer and restart | Run a fixture release, SHA mismatch, offline update and busy deferral. Verify progress, rollback and executable identity. |
| 6 | [`daemon.reload`](../host/runtime/featureRouters.ts#L1851) | React | Runtime server_reload or process fallback | Reload during a fixture turn. Verify actual daemon and bridge identities, reattachment, and separate failures. |
| 7 | [`daemon.selfdev`](../host/runtime/featureRouters.ts#L1866) | React | Runtime info, build/reload unsupported | Test status, build and reload separately. Use authoritative status or an explicit unsupported result. |
| 8 | [`daemon.openOutputLog`](../host/runtime/featureRouters.ts#L1882) | React | Native Output panel | Open Runtime from Settings and status pill. Confirm relevant logs and redacted credentials. |

## Workspace ledger, editor search and Git branch

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 9 | [`workspace.listFolders`](../host/runtime/featureRouters.ts#L1890) | React | VS Code workspace | Open zero, one and two roots. Add/remove a folder and compare names, paths and branch in both surfaces. |
| 10 | [`workspace.ledger.get`](../host/runtime/featureRouters.ts#L1893) | React | Shared workspace registry | Load stored records, migrate old flags, accept external updates and preserve ordering across reload. |
| 11 | [`workspace.ledger.ensure`](../host/runtime/featureRouters.ts#L1925) | Host | Shared workspace registry | Ensure same path through aliases twice. Verify one ID and correct name/unhide. |
| 12 | [`workspace.ledger.remove`](../host/runtime/featureRouters.ts#L1934) | Host | Shared workspace registry | Remove one ledger row and reload. Its directory and Rust sessions stay accessible. |
| 13 | [`workspace.ledger.setPinned`](../host/runtime/featureRouters.ts#L1940) | Host | Shared workspace registry | Pin/unpin one of two sessions and reload. Compare membership and ordering. |
| 14 | [`workspace.ledger.setArchived`](../host/runtime/featureRouters.ts#L1950) | Host | Shared workspace registry | Archive/restore the target. Compare VS Code view with CLI and Harness at the intended ownership boundary. |
| 15 | [`workspace.ledger.setCollapsed`](../host/runtime/featureRouters.ts#L1963) | React | Shared workspace registry | Collapse two groups and reopen one. Verify persistence and independence. |
| 16 | [`workspace.ledger.attachSession`](../host/runtime/featureRouters.ts#L1972) | Host | Shared workspace registry | Attach the same session twice. Check one ledger membership and compare Rust cwd. |
| 17 | [`workspace.ledger.importProjectGroup`](../host/runtime/featureRouters.ts#L1981) | React | Shared registry after Rust import | Import selected external sessions by project. Verify canonical IDs, no duplicate rows and clear skips. |
| 18 | [`workspace.findFiles`](../host/runtime/featureRouters.ts#L1990) | React | Harness find_files, native search fallback | Search nested Unicode and duplicate names in roots A/B. Check limit, correct root, and honest fallback. |
| 19 | [`workspace.contextSnapshot`](../host/runtime/featureRouters.ts#L2005) | React | Runtime context | Use known token breakdown and model window. Compare totals and require an unavailable state on command failure. |
| 20 | [`workspace.setContextCap`](../host/runtime/featureRouters.ts#L2043) | Host | Harness set_context_cap | Set valid, invalid and missing-session caps. Verify readback and preservation of the previous valid cap. |
| 21 | [`workspace.compact`](../host/runtime/featureRouters.ts#L2055) | React | Harness compact | Compact long history and check compacted receipt and retained instructions. Test busy and rejected calls. |
| 22 | [`workspace.setProjectIcon`](../host/runtime/featureRouters.ts#L2067) | React | Host project metadata | Set icon/color and reset. Validate correct project and cross-surface persistence. |
| 23 | [`workspace.pickFiles`](../host/runtime/featureRouters.ts#L2071) | Host | Native file picker | Select multiple matching files and cancel. Check resolved paths and empty cancel. |
| 24 | [`workspace.listBranches`](../host/runtime/featureRouters.ts#L2078) | React | Native Git | List branches in second root, detached HEAD and non-Git workspace. |
| 25 | [`workspace.checkoutBranch`](../host/runtime/featureRouters.ts#L2080) | Host | Native Git | Switch fixture branch, then try conflicting dirty checkout. Verify actual branch and untouched dirty bytes. |

## Session lifecycle, history and interaction

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 26 | [`sessions.list`](../host/runtime/featureRouters.ts#L2086) | React | Harness list_sessions plus shared ledger | Seed 201+ sessions, archived and external entries. Verify limit/paging, source and offline state. |
| 27 | [`sessions.listExternalProjects`](../host/runtime/featureRouters.ts#L2102) | React | Harness list_external_projects | Seed external source roots and invalid/missing records. Verify project counts, source filter and old bridge. |
| 28 | [`sessions.importExternal`](../host/runtime/featureRouters.ts#L2112) | React | Harness import_external_sessions | Import, retry, force-resync and fork on conflict. Compare provenance, stable IDs, transcript and skip reasons. |
| 29 | [`sessions.search`](../host/runtime/featureRouters.ts#L2121) | React | Runtime session_search | Search phrase, Unicode, special characters and source scope. Compare native IDs, snippets and selection/attach. |
| 30 | [`sessions.create`](../host/runtime/featureRouters.ts#L2164) | React | Harness create_session plus settings | Submit draft once in root B. Check one session and acknowledged model, effort, permission and cwd before first turn. |
| 31 | [`sessions.attach`](../host/runtime/featureRouters.ts#L2168) | React | Harness attach_session and socket pool | Attach idle, busy, synthetic external and unknown sessions. Verify resolved ID, history, state and concurrency. |
| 32 | [`sessions.history`](../host/runtime/featureRouters.ts#L2172) | React | Harness get_history | Load 100+ turns with tools, images, stats and provenance. Verify order, error state and live/history deduplication. |
| 33 | [`sessions.rename`](../host/runtime/featureRouters.ts#L2173) | React | Harness rename_session | Rename to Unicode, reload and list through Rust. Verify same ID and error for nonexistent ID. |
| 34 | [`sessions.fork`](../host/runtime/featureRouters.ts#L2178) | React | Harness fork_session | Fork whole chat and at turn 1 of 3. Compare exact child history and unchanged parent. |
| 35 | [`sessions.transfer`](../host/runtime/featureRouters.ts#L2183) | Host | Harness transfer_session | Transfer a populated session. Check fresh ID, compact handoff, original unchanged and no phantom child on failure. |
| 36 | [`sessions.export`](../host/runtime/featureRouters.ts#L2188) | React | Harness get_history plus host formatting | Export Markdown and JSON. Verify exact session, formatting and structured tool history. |
| 37 | [`sessions.archive`](../host/runtime/featureRouters.ts#L2199) | React | Shared ledger vs Rust archive/restore | Archive and restore in VS Code, CLI and Harness. Require consistent state or an explicit local-only filter label. |
| 38 | [`sessions.pin`](../host/runtime/featureRouters.ts#L2203) | React | Shared workspace registry | Pin/unpin under search/filter. Verify persisted ordering and stable active session. |
| 39 | [`sessions.projectIcon`](../host/runtime/featureRouters.ts#L2207) | Host | Host project metadata alias | Set/reset via this RPC, compare workspace.setProjectIcon, check shared broadcast. |
| 40 | [`sessions.setPermissionMode`](../host/runtime/featureRouters.ts#L2211) | React | Harness set_permission_mode | Exercise every advertised mode idle and busy. Verify Rust mode, deferred result and rejected-mode rollback. |
| 41 | [`sessions.rewind`](../host/runtime/featureRouters.ts#L2213) | React | Harness rewind | Use second user ordinal with intervening tool rows. Verify history/files, invalid index, and session isolation. |
| 42 | [`sessions.rewindUndo`](../host/runtime/featureRouters.ts#L2245) | React | Harness rewind_undo | Undo a real rewind and compare history/files. Try no prior rewind and a conflicting new edit. |
| 43 | [`sessions.softInterrupt`](../host/runtime/featureRouters.ts#L2250) | React | Harness soft_interrupt | Inject text and images while A streams. Verify exactly one provider input and client ID in injected event. |
| 44 | [`sessions.cancelSoftInterrupts`](../host/runtime/featureRouters.ts#L2263) | React | Harness cancel_soft_interrupts | Cancel one of two pending IDs, all, and a delivered ID. Verify cancelled/not-queued and old bridge behavior. |
| 45 | [`sessions.respondPermission`](../host/runtime/featureRouters.ts#L2283) | React | Harness permission_response | Allow, allow always and deny a benign tool. Check request/session ID, engine result, duplicate and disconnect. |
| 46 | [`sessions.respondQuestion`](../host/runtime/featureRouters.ts#L2287) | React | Harness question_response | Answer single/multiple options, text/notes and decline. Verify wire shape, exact question ID and engine close across surfaces. |
| 47 | [`sessions.setModel`](../host/runtime/featureRouters.ts#L5627) | React | Harness set_model | Switch same bare name across providers/API methods. Assert engine readback, next-turn deferral and rejected change. |
| 48 | [`sessions.setEffort`](../host/runtime/featureRouters.ts#L5656) | React | Harness set_reasoning_effort | Apply every advertised effort, an unsupported provider and a busy next-turn change. Verify actual next request. |
| 49 | [`sessions.runtimeCommand`](../host/runtime/featureRouters.ts#L5678) | React | Harness runtime_command | Execute every advertised composer command with valid/invalid input. Assert typed result, session target and visible error. |

## Background processes

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 50 | [`background.list`](../host/runtime/featureRouters.ts#L2311) | React | Runtime background list plus cache | Seed running/completed tasks in A and B. Open drawer, switch and reload. Verify grouping and isolation. |
| 51 | [`background.status`](../host/runtime/featureRouters.ts#L2320) | React | Runtime background status | Inspect running, stalled, completed and unknown task. Assert correct task ID and scoped state. |
| 52 | [`background.output`](../host/runtime/featureRouters.ts#L2336) | React | Runtime background output | Verify ordered ANSI/Unicode stdout and stderr, byte limit, final tail and session isolation. |
| 53 | [`background.cancel`](../host/runtime/featureRouters.ts#L2374) | React | Runtime background cancel | Cancel a harmless long-running job, then retry. Verify correct child and truthful error. |
| 54 | [`background.cleanup`](../host/runtime/featureRouters.ts#L2387) | React | Runtime background cleanup plus cache | Clear completed A tasks while A still has a live task and B has a finished task. Verify counts and unaffected B. |
| 55 | [`background.backgroundTool`](../host/runtime/featureRouters.ts#L2405) | React | Harness background_tool | Background one tool. Assert real job ID, progress, old-bridge limitation and race with completion. |

## Swarm mission control

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 56 | [`swarm.status`](../host/runtime/featureRouters.ts#L2415) | React | Runtime swarm status | Seed two durable groups, choose one and compare roster/plan readback. Go offline and verify unavailable state. |
| 57 | [`swarm.list`](../host/runtime/featureRouters.ts#L2665) | React | Runtime swarm list | Switch between groups, reload and check IDs, order, zero vs unavailable. |
| 58 | [`swarm.setLabel`](../host/runtime/featureRouters.ts#L2704) | React | Unsupported host stub | Rename and verify persisted engine title or disabled action with original title intact. |
| 59 | [`swarm.spawn`](../host/runtime/featureRouters.ts#L2708) | React | Unsupported host stub | Run custom and each preset. Require real engine worker IDs/worktrees, report partial failure, and never show phantom members. |
| 60 | [`swarm.kill`](../host/runtime/featureRouters.ts#L2713) | React | Unsupported host stub | Pause/resume/stop one worker. Verify real worker state and isolation from another worker. |
| 61 | [`swarm.salvage`](../host/runtime/featureRouters.ts#L2718) | React | Unsupported host stub | Recover an interrupted worker and compare worktree/task ownership. Unknown worker leaves roster unchanged. |
| 62 | [`swarm.pauseAll`](../host/runtime/featureRouters.ts#L2722) | React | Unsupported host stub | Pause/resume a group and compare each member and separate group. Check partial rejection. |
| 63 | [`swarm.board`](../host/runtime/featureRouters.ts#L2726) | Host | Runtime swarm board | Load board messages and task/plan records for two groups. Check chronological engine IDs and scope. |
| 64 | [`swarm.planDecide`](../host/runtime/featureRouters.ts#L2777) | React | Unsupported host stub | Approve/reject real versioned proposals, including a stale proposal. Verify engine plan version and cache rollback. |
| 65 | [`swarm.worktreeOpen`](../host/runtime/featureRouters.ts#L2781) | React | VS Code window API | Open a real worktree, then missing path. Expect one new window and actionable failure. |
| 66 | [`swarm.dm`](../host/runtime/featureRouters.ts#L2785) | React | Unsupported host stub | DM one worker and steer all workers. Require engine receipts and no cached message on refusal. |
| 67 | [`swarm.peekSession`](../host/runtime/featureRouters.ts#L2789) | React | Harness peek_session and get_todo_state | Inspect workers without stealing focus or attachment. Check transcript/todos, polling, busy and unknown state. |

## Overnight, schedules, ambient and quality

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 68 | [`automations.overnight.list`](../host/runtime/featureRouters.ts#L2811) | React | Runtime overnight status | Load persisted/active/expired records. Verify IDs, progress and empty/unavailable behavior. |
| 69 | [`automations.overnight.start`](../host/runtime/featureRouters.ts#L2886) | React | Runtime overnight duration and mission | Start fixture, reject bad duration/duplicate start, verify real manifest and cwd. |
| 70 | [`automations.overnight.pause`](../host/runtime/featureRouters.ts#L2918) | React | Unsupported host stub | Pause and resume. Confirm engine transition or disabled control with unchanged cached state. |
| 71 | [`automations.overnight.runNow`](../host/runtime/featureRouters.ts#L2923) | React | Unsupported host stub | Trigger immediate execution. Verify engine receipt or unsupported and unchanged validation counts. |
| 72 | [`automations.overnight.cancel`](../host/runtime/featureRouters.ts#L2928) | React | Runtime overnight cancel | Cancel one of two jobs. Verify exact worker/manifest and unchanged row on failure. |
| 73 | [`automations.overnight.log`](../host/runtime/featureRouters.ts#L2933) | React | Runtime overnight log | Open exact run tail, verify final lines and handle missing log or invalid run ID. |
| 74 | [`automations.overnight.report`](../host/runtime/featureRouters.ts#L2963) | React | Runtime overnight report | Load real handoff and verify checks, files, links, report pending and missing. |
| 75 | [`automations.schedules.list`](../host/runtime/featureRouters.ts#L3022) | React | Runtime schedules list | Seed pending and completed entries. Compare timestamp, type, cwd and next run. |
| 76 | [`automations.schedules.create`](../host/runtime/featureRouters.ts#L3073) | React | Runtime schedules create | Create each exposed kind under fixture clock/timezone. Check saved ID/time/target and invalid form. |
| 77 | [`automations.schedules.toggle`](../host/runtime/featureRouters.ts#L3113) | React | Unsupported host stub | Toggle off/on and verify persistence and scheduler behavior or unchanged row on unsupported. |
| 78 | [`automations.schedules.runNow`](../host/runtime/featureRouters.ts#L3118) | React | Unsupported host stub | Trigger immediately and check actual engine occurrence or unchanged last-run time after rejection. |
| 79 | [`automations.schedules.cancel`](../host/runtime/featureRouters.ts#L3123) | React | Runtime schedules cancel | Cancel one ID and verify timer never fires, other schedules survive and failure keeps row. |
| 80 | [`automations.ambient.status`](../host/runtime/featureRouters.ts#L3130) | React | Runtime ambient status | Read off/on, pending/approved/denied and fixture inbox states. Validate engine counts vs unavailable. |
| 81 | [`automations.ambient.approvals`](../host/runtime/featureRouters.ts#L3166) | Host | Runtime ambient approvals | List pending/resolved fixture items with IDs/times. Compare to status, empty and unsupported states. |
| 82 | [`automations.ambient.decide`](../host/runtime/featureRouters.ts#L3172) | React | Runtime ambient decide | Approve or deny a fixture item. Verify persisted decision and unchanged card on stale ID. |
| 83 | [`automations.quality.status`](../host/runtime/featureRouters.ts#L3180) | React | Runtime autoreview and autojudge | Set different flag values and compare readback after external CLI change and reconnect. |
| 84 | [`automations.quality.setAutoReview`](../host/runtime/featureRouters.ts#L3192) | React | Runtime autoreview | Flip review only and verify effective state after reload. |
| 85 | [`automations.quality.setAutoJudge`](../host/runtime/featureRouters.ts#L3196) | React | Runtime autojudge | Flip judge only and verify effective state after reload. |
| 86 | [`automations.quality.runReview`](../host/runtime/featureRouters.ts#L3200) | React | Runtime review | Review a fixture diff. Verify real worker session ID, receipt and denied permission. |
| 87 | [`automations.quality.runJudge`](../host/runtime/featureRouters.ts#L3216) | React | Runtime judge | Judge fixture evidence. Verify real worker/result ID, target and failure handling. |
| 88 | [`automations.quality.productivity`](../host/runtime/featureRouters.ts#L3232) | React | Runtime productivity | Check each displayed range against seeded report data, timezone, missing artifact and native link. |

## Connectors, skills, memory and workspace integrations

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 89 | [`plugins.mcp.list`](../host/runtime/featureRouters.ts#L3266) | React | Runtime mcp status plus projection | Seed stdio, HTTP, disabled and auth-required connectors. Compare actual tools, health, source and empty state. |
| 90 | [`plugins.mcp.test`](../host/runtime/featureRouters.ts#L3373) | React | Runtime mcp test | Test healthy and failed local connectors. Verify connecting/result, diagnostics and target ID. |
| 91 | [`plugins.mcp.toggle`](../host/runtime/featureRouters.ts#L3395) | React | Runtime mcp toggle | Toggle connector and check actual tool visibility. Reject and roll back on failure. |
| 92 | [`plugins.mcp.reload`](../host/runtime/featureRouters.ts#L3403) | React | Runtime mcp reload | Change fixture connector tools on disk, reload and query engine. Test malformed config. |
| 93 | [`plugins.mcp.add`](../host/runtime/featureRouters.ts#L3408) | React | Host MCP config write plus engine reload attempt | Create stdio and HTTP in supported scopes. Verify validation, correct file, actual tools and reload failure. |
| 94 | [`plugins.mcp.edit`](../host/runtime/featureRouters.ts#L3513) | React | Host MCP entry replacement plus reload attempt | Change one connector. Preserve other entries/secret references, verify scope and engine readback. |
| 95 | [`plugins.mcp.remove`](../host/runtime/featureRouters.ts#L3520) | React | Host MCP config write plus reload attempt | Remove target connector. Preserve siblings and verify tools disappear after successful reload. |
| 96 | [`plugins.mcp.login`](../host/runtime/featureRouters.ts#L3578) | React | Unsupported host stub | Complete/cancel fixture OAuth or show disabled before opening. Verify connector auth state and no accidental credential write. |
| 97 | [`plugins.mcp.logout`](../host/runtime/featureRouters.ts#L3583) | React | Unsupported host stub | Disconnect fixture connector or show unsupported with original state. |
| 98 | [`plugins.mcp.oauth`](../host/runtime/featureRouters.ts#L3588) | React | Host connector status and unsupported OAuth actions | Check status against MCP list; start/complete are rejected. Verify native browser/copy separately through the relevant editor envelopes. |
| 99 | [`plugins.skills.list`](../host/runtime/featureRouters.ts#L3603) | React | Runtime skills | Seed user/project/duplicate skills. Check path and scope, add fresh skill and discover live. |
| 100 | [`plugins.skills.create`](../host/runtime/featureRouters.ts#L3631) | React | Host SKILL.md write | Create each scope, check file and discovery, and assert duplicate or invalid input preserves the existing file. |
| 101 | [`plugins.skills.install`](../host/runtime/featureRouters.ts#L3671) | React | Unsupported host stub | Install a fixture item to selected scope or gate before click. Verify real file/discovery and no false installed badge. |
| 102 | [`plugins.skills.reload`](../host/runtime/featureRouters.ts#L3674) | React | Runtime skills | Edit fixture skill then reload. Verify new content and slash picker refresh. |
| 103 | [`plugins.skills.run`](../host/runtime/featureRouters.ts#L3678) | React | Unsupported host stub | Run a skill and compare with chat invocation. Confirm one real prompt/engine action or visible unavailable state. |
| 104 | [`plugins.memory.status`](../host/runtime/featureRouters.ts#L3683) | React | Runtime memory status | Compare toggle/activity and facts with seeded Rust state. Distinguish no fact API from empty results. |
| 105 | [`plugins.memory.toggle`](../host/runtime/featureRouters.ts#L3709) | React | Runtime memory | Toggle target session and compare global defaults and another session. Rejected change must roll back. |
| 106 | [`plugins.memory.extract`](../host/runtime/featureRouters.ts#L3713) | React | Runtime memory extract | Try too-short then eligible transcript. Distinguish scheduled, completed and count unavailable. |
| 107 | [`plugins.memory.remember`](../host/runtime/featureRouters.ts#L3725) | React | Unsupported host stub | Remember one fixture fact and reload. Unsupported must preserve form and avoid a new graph node. |
| 108 | [`plugins.memory.recall`](../host/runtime/featureRouters.ts#L3731) | Host | Host filter over runtime memory status | Filter scope/tag/text in real facts. Distinguish unsupported fact retrieval from no match. |
| 109 | [`plugins.memory.search`](../host/runtime/featureRouters.ts#L3746) | Host | Alias of host recall | Search case, Unicode, empty query and facts owned by another session. |
| 110 | [`plugins.memory.forget`](../host/runtime/featureRouters.ts#L3748) | React | Unsupported host stub | Delete a fixture fact and re-list, or reject and keep fact and edges. |
| 111 | [`plugins.memory.tag`](../host/runtime/featureRouters.ts#L3752) | React | Unsupported host stub | Add/remove tag and re-list or reject with unchanged graph. |
| 112 | [`plugins.memory.link`](../host/runtime/featureRouters.ts#L3756) | React | Unsupported host stub | Link saved facts, reject invalid IDs and preserve graph on failure. |
| 113 | [`plugins.workspace.status`](../host/runtime/featureRouters.ts#L3760) | React | Static host response | Compare Gmail, Calendar, Browser and Companion to fixture status or show unsupported state. |
| 114 | [`plugins.workspace.trigger`](../host/runtime/featureRouters.ts#L3780) | React | Host integration stub | Run each exposed action in a fixture. Require one actual receipt or disable it with clear reason. |

## Changes and file review

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 115 | [`changes.status`](../host/runtime/featureRouters.ts#L3788) | Host | Native Git plus Harness get_file_changes | Mix staged, untracked, renamed, deleted, conflicting and manual edits in two repos. Verify scope and attribution. |
| 116 | [`changes.getSessionSummary`](../host/runtime/featureRouters.ts#L3884) | React | Harness get_file_changes or legacy Git | Mark known agent and manual edits. Verify latest turn, path identity and safe old-bridge behavior. |
| 117 | [`changes.diff`](../host/runtime/featureRouters.ts#L3943) | React | Harness get_file_change_diff or Git | Compare native and inline view for rename, deleted, binary, large and staged cases. |
| 118 | [`changes.stage`](../host/runtime/featureRouters.ts#L3979) | Host | Native Git index | Stage a file in B while A has a same-named file. Assert both indexes. |
| 119 | [`changes.unstage`](../host/runtime/featureRouters.ts#L3980) | Host | Native Git index | Unstage selected file in B. Verify untouched bytes, correct repo and unborn HEAD behavior. |
| 120 | [`changes.keep`](../host/runtime/featureRouters.ts#L3981) | React | Harness file_change_action keep or legacy host | Keep a pending file, verify engine decision/readback and unchanged bytes. Rejected state remains pending. |
| 121 | [`changes.undo`](../host/runtime/featureRouters.ts#L3994) | React | Harness file_change_action undo or legacy host | Undo agent edit with manual content present. Verify conflict, byte preservation, force scope and safe old-bridge path. |
| 122 | [`changes.redo`](../host/runtime/featureRouters.ts#L4024) | React | Harness file_change_action redo | Redo a previously undone change and verify bytes/snapshot. Test unsupported and stale baseline. |
| 123 | [`changes.keepAll`](../host/runtime/featureRouters.ts#L4038) | React | Harness file_change_action keep_all or legacy host | Keep pending files and verify each outcome and correct root/session. |
| 124 | [`changes.undoAll`](../host/runtime/featureRouters.ts#L4061) | React | Harness file_change_action undo_all or legacy host | Mix clean reversals, conflicts and untracked files. Verify actual per-file outcomes and preserved manual edits. |
| 125 | [`changes.redoAll`](../host/runtime/featureRouters.ts#L4098) | React | Harness file_change_action redo_all | Redo multiple files and compare snapshots, conflict records and old-bridge state. |
| 126 | [`changes.commit`](../host/runtime/featureRouters.ts#L4113) | Host | Native Git | Commit staged fixture contents only. Verify repo/hash, hook failure and cancellation. |
| 127 | [`changes.createPr`](../host/runtime/featureRouters.ts#L4114) | Host | Native GitHub CLI | Use fixture gh to assert explicit confirmation, base/head/body/draft and URL. Reject wrong root and cancellation without external effects. |

## Telegram, gateway and cloud

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 128 | [`remote.telegram.status`](../host/runtime/featureRouters.ts#L4119) | React | Runtime telegram status | Verify unlinked, pending, linked, offline, active target and approval counts against fixture integrations. |
| 129 | [`remote.telegram.linkHosted`](../host/runtime/featureRouters.ts#L4248) | React | Runtime telegram hosted pairing | Request a short-lived pairing code. Check QR/deep link, expiry, cancellation and final linked identity. |
| 130 | [`remote.telegram.linkBotfather`](../host/runtime/featureRouters.ts#L4292) | React | Runtime telegram self-hosted setup | Test invalid and fixture bot tokens, partial setup and success. Assert storage and redaction of token. |
| 131 | [`remote.telegram.disconnect`](../host/runtime/featureRouters.ts#L4344) | React | Runtime telegram disconnect | Disconnect each supported link mode. Verify engine stops routing, pending state and cancellation. |
| 132 | [`remote.telegram.testPing`](../host/runtime/featureRouters.ts#L4352) | React | Runtime telegram test | Ping a disposable link and check exact recipient and ack. Show failure when unlinked. |
| 133 | [`remote.telegram.driveSession`](../host/runtime/featureRouters.ts#L4366) | React | Runtime telegram session selection | Select A then B and send fixture remote input. Verify events appear only on selected session. |
| 134 | [`remote.telegram.uninstallToggle`](../host/runtime/featureRouters.ts#L4373) | React | Runtime telegram uninstall | Toggle setting and read back. Confirm normal link is unaffected and state reverts on denial. |
| 135 | [`remote.telegram.approvals`](../host/runtime/featureRouters.ts#L4384) | Host | Runtime telegram approvals | List session-scoped pending/resolved approvals and IDs. Compare to status and stale link behavior. |
| 136 | [`remote.telegram.decide`](../host/runtime/featureRouters.ts#L4388) | React | Runtime telegram decide | Allow/deny one approval while another is pending. Match engine event and reject duplicate/stale decision. |
| 137 | [`remote.infra.status`](../host/runtime/featureRouters.ts#L4396) | React | Runtime remote status | Verify SSH/cloud/gateway state, paired devices and remote sessions from live fixture; show disconnected honestly. |
| 138 | [`remote.gateway.toggle`](../host/runtime/featureRouters.ts#L4447) | React | Runtime remote gateway enable/disable | Toggle gateway and verify engine state after reconnect. Failure leaves existing state unchanged. |
| 139 | [`remote.gateway.pair`](../host/runtime/featureRouters.ts#L4463) | React | Runtime remote pair | Check URI/code/QR expiry and cancellation, then pair one fixture device and read actual membership. |
| 140 | [`remote.gateway.revoke`](../host/runtime/featureRouters.ts#L4487) | React | Runtime remote revoke | Revoke one paired device. Check connection is closed, device removed and second device unaffected. |
| 141 | [`remote.cloud.moveToCloud`](../host/runtime/featureRouters.ts#L4494) | React | Unsupported host stub | Move within a sandbox cloud fixture or show unavailable. Verify continuity, explicit failure and correct remote ID. |
| 142 | [`remote.cloud.returnLocal`](../host/runtime/featureRouters.ts#L4498) | React | Unsupported host stub | Return fixture session with context and workspace preserved or report unavailable with original cloud session untouched. |
| 143 | [`remote.cloud.attach`](../host/runtime/featureRouters.ts#L4502) | React | Unsupported host stub | Attach correct cloud ID and route live events only to it, or report unavailable without changing surface. |
| 144 | [`remote.cloud.syncEnv`](../host/runtime/featureRouters.ts#L4506) | React | Unsupported host stub | Sync only allowed fixture variables with redaction and repeatability, or render explicit unavailable state. |

## Account, providers, models and settings

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 145 | [`settings.account.get`](../host/runtime/featureRouters.ts#L4514) | React | Host Rayu auth plus runtime subscription | Load signed-out, API-key, OAuth, expired and offline states. Compare credits/pacing/session and providers. |
| 146 | [`settings.account.refresh`](../host/runtime/featureRouters.ts#L4691) | React | Host auth refresh | Force a fixture refresh. Preserve last valid credits and models on transient failure and update all surfaces. |
| 147 | [`settings.account.signInBrowser`](../host/runtime/featureRouters.ts#L4697) | React | Host OAuth | Exercise deep-link and loopback, CSRF handling, browser cancel, timeout and success; engine route becomes usable. |
| 148 | [`settings.account.cancelSignIn`](../host/runtime/featureRouters.ts#L4719) | React | Host OAuth | Cancel pending deep-link and loopback, then deliver stale callback. It cannot sign in or leave listener running. |
| 149 | [`settings.account.signInApiKey`](../host/runtime/featureRouters.ts#L4725) | React | Host auth and Harness set_api_key | Enter invalid then valid fixture key. Verify secure storage, engine readiness and no key in webview events/logs. |
| 150 | [`settings.account.completeCallback`](../host/runtime/featureRouters.ts#L4734) | React | Host OAuth callback | Use valid, wrong-state, invalid and replayed callbacks. Verify one exchange and synchronized host/engine state. |
| 151 | [`settings.account.signOut`](../host/runtime/featureRouters.ts#L4743) | React | Host auth plus engine logout/invalidation | Sign out in two surfaces during idle and offline; verify tokens/routes/credits and no token leakage. |
| 152 | [`settings.account.setBypassPacing`](../host/runtime/featureRouters.ts#L4751) | React | Host account service | Toggle fixture pacing, compare effective state after refresh and display refusal without stale success. |
| 153 | [`settings.analytics.get`](../host/runtime/featureRouters.ts#L4758) | React | Static zero host response | Seed known usage and test every range/group. Require matching data or explicitly unavailable, including real zero. |
| 154 | [`settings.providers.list`](../host/runtime/featureRouters.ts#L4765) | React | Runtime auth status plus host account | Show ready, needs-key, expired and build-disabled routes. Compare per-provider actual readiness and scope. |
| 155 | [`settings.providers.setApiKey`](../host/runtime/featureRouters.ts#L4886) | React | Harness set_api_key plus auth notification | Set a fixture key for an alias, verify canonical route, model/credential publication and redaction. |
| 156 | [`settings.providers.clearApiKey`](../host/runtime/featureRouters.ts#L4902) | React | Harness clear_api_key plus auth notification | Clear only target API key and refresh lists. Preserve unrelated accounts and handle storage failure. |
| 157 | [`settings.providers.logout`](../host/runtime/featureRouters.ts#L4917) | React | Host auth or runtime logout | Log out each auth type separately. Compare connected routes and remaining OAuth/API-key credentials. |
| 158 | [`settings.doctor.run`](../host/runtime/featureRouters.ts#L4932) | React | Runtime doctor and host state | Run each scope good/bad/offline. Verify typed checks, actual error, no secrets and links. |
| 159 | [`settings.models.get`](../host/runtime/featureRouters.ts#L4970) | React | Harness runtime_info, runtime agents/subagent_model and hosted catalog | Compare global/session routes, effort, auth badges and matching names with different providers. |
| 160 | [`settings.models.refresh`](../host/runtime/featureRouters.ts#L5156) | React | Runtime refresh_model_list plus host catalog | Discover arbitrary future model from provider schema; bypass fresh cache, retain last good on 401/5xx/bad JSON, publish to long-lived pickers. |
| 161 | [`settings.models.setFast`](../host/runtime/featureRouters.ts#L5197) | React | Runtime fast | Test every supported tier, model without support and global/session scope. Verify actual subsequent provider request and rollback. |
| 162 | [`settings.models.setCacheTtl`](../host/runtime/featureRouters.ts#L5207) | React | Runtime cache | Test both TTLs and unsupported provider. Compare canonical config, model requests and source shown after rollback. |
| 163 | [`settings.models.setTransport`](../host/runtime/featureRouters.ts#L5217) | React | Runtime transport | Switch transport, verify effective provider transport and config after reboot; reject unsupported values/route. |
| 164 | [`settings.models.setRoleOverride`](../host/runtime/featureRouters.ts#L5222) | React | Runtime agents role override | Set and clear each role in both scopes. Compare effective precedence and fresh worker route. |
| 165 | [`settings.agents.setSubagentModel`](../host/runtime/featureRouters.ts#L5235) | React | Runtime subagent_model | Set then clear global/session worker model. Verify actual next worker and preservation of unrelated roles. |
| 166 | [`settings.agents.upsertProfile`](../host/runtime/featureRouters.ts#L5255) | React | Runtime agents profile mutation | Create/edit in both scopes with valid and invalid models. Verify config/session and next worker. |
| 167 | [`settings.agents.deleteProfile`](../host/runtime/featureRouters.ts#L5297) | React | Runtime agents profile removal | Delete target scope only with confirmation. Verify fallback selection and failure state. |
| 168 | [`settings.features.get`](../host/runtime/featureRouters.ts#L5330) | React | Runtime features status plus host voice/telemetry | Read actual feature states and preference source. Test CLI changes and offline readability. |
| 169 | [`settings.features.set`](../host/runtime/featureRouters.ts#L5343) | React | Runtime features set | Toggle each exposed key in isolation, compare config/reload and engine capability. Reject bad names/values. |
| 170 | [`settings.voice.update`](../host/runtime/featureRouters.ts#L5357) | React | Host global state | Set enabled/device/noise/autosend, verify storage only. Gate dictation until actual start, transcript and stop are wired. |
| 171 | [`settings.telemetry.set`](../host/runtime/featureRouters.ts#L5376) | React | Runtime telemetry plus host mirror | Test every category and all/none. Verify engine config, visible state, rejected change and no accidental external telemetry. |
| 172 | [`settings.hooks.list`](../host/runtime/featureRouters.ts#L5417) | React | Runtime doctor hooks | Seed valid, disabled and invalid hooks. Verify scope, effective definitions and error state. |
| 173 | [`settings.hooks.openConfig`](../host/runtime/featureRouters.ts#L5447) | React | Native editor | Open actual config path, custom path and absent file. Verify correct file and useful error. |
| 174 | [`settings.permission.getDefault`](../host/runtime/featureRouters.ts#L5452) | React | Host configuration | Read configured default plus active session comparison under non-default active mode. |
| 175 | [`settings.permission.setDefault`](../host/runtime/featureRouters.ts#L5457) | React | Host configuration plus optional Harness set_permission_mode | Set every mode for future sessions; separately test apply-now, busy defer and engine rejection. |
| 176 | [`settings.shortcuts.list`](../host/runtime/featureRouters.ts#L5469) | React | Host catalog | Check shown command IDs and OS labels against manifest and effective user bindings. |
| 177 | [`settings.shortcuts.openKeybindings`](../host/runtime/featureRouters.ts#L5472) | React | Native editor command | Open keyboard shortcut UI in the correct workbench and verify filter/cancellation. |
| 178 | [`settings.runtime.get`](../host/runtime/featureRouters.ts#L5476) | React | Host VS Code settings | Resolve explicit paths, default socket, auto-start and current transport. Check machine scope. |
| 179 | [`settings.runtime.update`](../host/runtime/featureRouters.ts#L5486) | React | Host VS Code settings | Save valid/invalid socket and binary path and flip auto-start. Verify setting scope and connection uses updated values. |
| 180 | [`settings.feedback.submit`](../host/runtime/featureRouters.ts#L5490) | React | Unsupported host stub | Use a local submission fixture or show unsupported. A rejection must neither clear form nor show submitted. |

## Session inspector and todos

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 181 | [`inspector.sidePanel.get`](../host/runtime/featureRouters.ts#L5498) | Host | Host cache from Rust side_panel_state | Feed named pages for A/B and validate active page, refresh, late state and missing capability. |
| 182 | [`inspector.sidePanel.close`](../host/runtime/featureRouters.ts#L5500) | Host | Host cache only | Close one/all cached pages. Verify agreed close semantics across surfaces and a later engine update. |
| 183 | [`inspector.applet.get`](../host/runtime/featureRouters.ts#L5504) | Host | Host cache from Rust applet_state | Render registered/missing/updated applets, scoped by session and capability. |
| 184 | [`inspector.applet.action`](../host/runtime/featureRouters.ts#L5507) | Host | Harness applet_action | Dispatch structured action/payload to correct session/applet and confirm authoritative updated snapshot or rejection. |
| 185 | [`inspector.applet.close`](../host/runtime/featureRouters.ts#L5520) | Host | Harness close_applet | Close a named applet and await authoritative removal, including cross-surface and stale ID. |
| 186 | [`inspector.todos.get`](../host/runtime/featureRouters.ts#L5708) | React | Harness get_todo_state plus cache | Verify all four statuses, reopen/refresh after engine change and preserve session isolation. |

## Engine capabilities

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 187 | [`capabilities.get`](../host/runtime/featureRouters.ts#L5525) | React | Harness get_capabilities | Check curated commands, modes/features matched to current connection, unsupported v1.15 and offline separately. |

## Canonical configuration

| # | RPC | Caller | Current target | Test and expected result |
| ---: | --- | --- | --- | --- |
| 188 | [`config.get`](../host/runtime/featureRouters.ts#L5568) | React | Harness get_config | Read current sections/schema/path and validate CLI/Desktop changes. Compare v1.15 read-only view. |
| 189 | [`config.patch`](../host/runtime/featureRouters.ts#L5589) | React | Harness patch_config | Patch valid and invalid values, verify on-disk readback, per-field errors, restart hints and peer config_changed. |
