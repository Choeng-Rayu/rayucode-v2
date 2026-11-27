# Daemon, Harness API, and Session Runtime Map

Scope: `crates/rayucode-app-core`, `-harness-api`, `-harness-api-server`, `-transport`, `-storage`.
All anchors are `file:line` in this repo.

## 1. Two sockets, one daemon

The daemon listens on `runtime_dir()/rayu.sock` (`app-core/src/server/socket.rs:7,16`;
`runtime_dir` = `$RAYU_RUNTIME_DIR` → `$XDG_RUNTIME_DIR` → temp,
`storage/src/lib.rs:110`). It also binds a sibling `*-debug.sock`
(`socket.rs:75`) for introspection. Exclusivity is an `flock` on
`rayu-daemon.lock`, derived from the resolved socket identity so two spellings
of one path cannot start two daemons (`socket.rs:231,287,313`).

UI clients split in two:

- **TUI** connects to the daemon socket directly and speaks the legacy
  NDJSON `Request`/`ServerEvent` protocol (`tui/src/tui/backend.rs:420,482`;
  `protocol/src/wire.rs:59`; `protocol/src/lib.rs:1108,1125`).
- **Desktop/SDK** connect to `rayu-api.sock` (`harness-api/src/sockets.rs:67`,
  `RAYU_API_SOCKET`), which the bridge process translates frame-for-frame onto
  the daemon socket (`harness-api/src/sockets.rs:76`). Path resolution lives in
  the API crate so client and bridge can never disagree.

The stable API is NDJSON with `{v,id,...}` envelopes (`harness-api/src/lib.rs:73,84`),
major 1 / minor 16 (`lib.rs:67,69`). Transport is `UnixListener`/`UnixStream`
on Unix and named pipes on Windows behind one alias set
(`transport/src/lib.rs:1`; `transport/src/unix.rs:1`).

## 2. Bridge lifecycle

`run_bridge` takes an exclusive `flock` before unlinking a stale path, binds,
and chmods the socket `0600` so it is never more permissive than the daemon it
fronts (`harness-api-server/src/lib.rs:203,220,274`). Accept spawns one
translation task per client (`:284`). Each connection: `hello` handshake with
version window check (`:356,374`), capability probe via a throwaway `ping`
(`:67`), then a `biased` select loop preferring client requests over a busy
daemon's broadcast (`:486,495`). Requests translate at `translate.rs:359`,
events at `:2135`; only event kinds that touch the filesystem run under
`block_in_place` (`lib.rs:711`). Legacy kinds map to curated events
(`text_delta` `translate.rs:2605`, `tool_start` `:2669`, `done` `:2861`).
`run_bridge_stream` (`lib.rs:327`) serves the same translation over SSH stdio.

## 3. Daemon boot and connection lifecycle

`Server` holds sessions, swarm state, event ring, interrupt queues
(`app-core/src/server.rs:557`). `run` (`:2368`) takes the daemon lock, refuses
to replace a live listener (`:2386`), binds main + debug (`:2397,2398`), marks
fds close-on-exec, signals readiness (`:1189`), then spawns both accept loops
(`server/runtime.rs:155,187`). Each connection becomes one task
(`runtime.rs:266,333`) running `handle_client` (`client_lifecycle.rs:717`).

`handle_client` handles one-shot control requests inline (`Ping` keeps the
stream open for capability probes), then requires `Subscribe` with an absolute
`working_dir` before any stateful request. Subscribe registers the swarm
member and binds the working directory (`client_session.rs:650`). Each
connection gets a private unbounded channel plus a writer task that encodes
each event and tracks live tool state (`client_lifecycle.rs:1025,1032`);
`event_for_transport` (`:90`) filters by negotiated capability, flattening
`TurnEvent` wrappers for old clients.

## 4. Turn pipeline

`Message` → ack → `start_processing_message` (`client_processing.rs:202`) →
agent lock, `claim_server_turn`, then an owned live turn
(`server/live_turn.rs:111`) with a `TurnEventChannel` that fans events to the
attached client and falls back to the session bus (`server/state.rs:546`).
`Agent::run_turn` (`agent/turn_loops.rs:37`) per iteration: lease check, cancel
registry (`turn_cancel_registry.rs:53`), tool defs, split system prompt,
compaction, non-blocking memory injection, `provider.complete_split`, then
stream consumption with context-limit retry. Completion emits `TurnStopped`
(`live_turn.rs:235`). Cancellation goes through `cancel_processing_message`
(`client_processing.rs:537`).

## 5. Failover and provider control

Server-side failover exists for clients that cannot run the TUI countdown
(`server/turn_failover.rs:21`, max 3 attempts). `pick_failover_target` (`:48`)
requires `cross_provider_failover = Countdown`
(`config-types/src/update_policy.rs:59`), a pool-approved source
(`provider_control.rs:341`), and a failover-classified error; `apply` (`:120`)
switches route, resets the provider session, and emits `ModelChanged` +
`ConnectionPhase`. It wraps the reserved turn at `:181`.

`provider_control.rs` owns model/route/effort/tier/transport/compaction
switches and auth refresh with generation guards (`:531,924,1265,1300`).
Catalogs refresh every 30 min (`server/model_refresh.rs`) behind a 60 s
single-flight cache (`server/available_models_cache.rs:11`).
## 6. Account usage

`Request::AccountUsage` (`protocol/src/wire.rs:577`) is served from
`server/account_usage.rs:58`: a shared mutex coalesces concurrent clients into
one fetch (`:104`) and replies `ServerEvent::AccountUsage` (`:72`). Startup
publishes a snapshot file keyed by socket digest
(`base/src/usage/startup_snapshot.rs:68,211`) that TUI processes hydrate from
without a wire round trip. The stable API exposes no `account_usage` request;
usage arrives as `ModelUsage` on model info (`harness-api/src/events.rs:690`).

## 7. Disk layout (`~/.rayu`, `RAYU_HOME`-sandboxable, `storage/src/lib.rs:163`)

- `sessions/<id>.json` snapshot + `<id>.journal.jsonl` append-only journal
  (`base/src/session/storage_paths.rs:7,25,30,39`). Saves append journal lines
  (`persistence.rs:768`), checkpoint to snapshot past 512 KiB
  (`session.rs:292`; `persistence.rs:776,335`), replay on load (`:491`); a
  migration lease blocks writes (`:635`).
- `session-metadata-v1.sqlite3` resume index (`recent_session_index.rs:64,131`).
- `active_pids/`, `streaming_pids/`, `internal_pids/` presence markers
  (`storage/src/active_pids.rs:20,28,60,270`).
- `session_leases/<id>.json` migration epochs (`storage/src/session_lease.rs:75,117`).
- `state/swarm/<id>.json` durable swarm plans (`server/swarm_persistence.rs:145,166`)
  under `durable_state_dir` = `~/.rayu/state` (`storage/src/lib.rs:215`).
- `logs/` (`storage/src/lib.rs:201`); JSON writes are tmp+rename, `write_json_fast`
  skips fsync (`:534,545`), reads fall back to `.bak` (`:661`).

## 8. Reload and build channels

Reload writes a marker (`server/reload_state.rs:13`) and state (`:101`), then
execs the replacement after unlinking the socket pair and detaching stdio
(`server/reload.rs:15,255`). Channels under `~/.rayu/builds`
(`build-support/src/storage_helpers.rs:7`): `versions/<hash>` (`:44`), `stable`
(`:52`), `current` (`:57`), `shared-server` (`:62`), with
`current-version`/`shared-server-version` markers (`:84,89`). `shared-server`
advances only while tracking stable (`build-support/src/lib.rs:765,782`) and is
repaired when stale (`:822`). `selfdev` queues requests in
`~/.rayu/selfdev-build-requests` under a per-worktree lock
(`tool/selfdev/mod.rs:155,778`); build/reload/cancel live at
`tool/selfdev/build_queue.rs:450,710,1001`.

## Top findings

1. Three protocol surfaces share one engine: legacy daemon NDJSON (TUI),
   curated API NDJSON v1.16 (Desktop/SDK via bridge), and a debug socket.
2. Two independent `flock`s (daemon socket, API socket) make on-demand
   spawning idempotent.
3. Session durability is snapshot + append-only journal with checkpointing, so
   a turn costs one journal line rather than a full rewrite.
4. TUI usage is partly file-mediated (socket-keyed snapshot); the stable API has
   no account-usage endpoint.
5. Failover is opt-in per client (`supports_server_failover`), reuses TUI pool
   policy, and caps at 3 attempts.
6. Presence, leases, and swarm state are filesystem-first, so a reloaded or
   second process sees live sessions before any client reconnects.
