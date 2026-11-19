# Account Contract Conformance Tests and Test Vectors

Executable conformance design for the Rayu (RayuCode) account contract: browser
loopback login, access-token refresh, account state (`/me`, gateway
`/v1/credits`, `/me/entitlements`), `RAYU_API_KEY` validation, live model
discovery, and the Anthropic-Messages chat wire.

The client half of the contract lives in this repo; the server half lives in the
Rayu service (the same backend the Rayu TypeScript CLI uses). This document
defines the shared test vectors, the harnesses that execute them, and who owns
what. Billing/checkout/webhook ordering are web-only on rayucode.com and are not
part of the CLI contract.

## Grounding (current code and tests)

- Auth client + wire contract: `crates/rayucode-base/src/rayu/`
  - Login (`login.rs`): bind `127.0.0.1` ephemeral port, 16-byte hex `state`,
    open `{web}/cli-login?port&state`, receive `/callback?code&state`, verify
    state, exchange `POST {api}/cli/token`, persist session. 5-minute timeout.
  - Refresh (`refresh.rs`): `POST {api}/cli/refresh {refreshToken}`; proactive at
    `expiresAt - 60_000`; 400/401 clear, network/5xx/403 keep, newer-file-wins.
  - Session (`session.rs`): `~/.rayu/rayu-auth.json`, camelCase
    `accessToken`/`refreshToken`/`expiresAt` (epoch ms)/`user` (numeric `id`),
    0600, shared byte-for-byte with the Rayu TS CLI.
  - API key (`apikey.rs`): `RAYU_API_KEY` (`rayu_sk_live_…`), validated via
    `GET {gateway}/v1/credits`; 401 → Invalid, other → Unavailable (fail-open).
  - Account reads (`api.rs`): `fetch_me`, `fetch_credits`, `fetch_entitlements`,
    `gateway_credential` (JWT wins over API key).
- Gateway transport + catalog: `crates/rayucode-provider-rayu-runtime/src/lib.rs`
  (`POST {gateway}/anthropic/v1/messages`, `anthropic-version: 2023-06-01`,
  `x-rayu-client: cli`, never `x-api-key`, redirects rejected, 401 → refresh once
  → replay; API-key 401 no retry).
- Executable harnesses:
  - Unit: `crates/rayucode-base/src/rayu/tests.rs` (scripted local HTTP server).
  - Runtime: `crates/rayucode-provider-rayu-runtime/src/lib.rs` tests.
  - Discovery regression: `crates/rayucode-base/src/provider/tests/catalog_rayu.rs`
    (spliced via `include!`; drives the real runtime against a mock gateway).
  - Integration: `tests/auth_login_flow.rs` (existing) and
    `tests/rayu_auth_flow.rs` (Rayu login flow, owned by integration-tests).
- Auth failure classification: `crates/rayucode-base/src/auth/login_diagnostics.rs`.

## Repository ownership

| Concern | Owner | Harness |
|---|---|---|
| Loopback login, refresh, session persistence, account-read parsing, API-key verdicts | rayu (this repo) | Rust unit tests against a scripted HTTP server (`rayu/tests.rs`) |
| Gateway wire, 401 replay, catalog discovery | rayu (this repo) | runtime crate tests + `catalog_rayu.rs` |
| End-to-end login flow | integration-tests | `tests/rayu_auth_flow.rs` |
| `/cli/token`, `/cli/refresh`, `/me`, `/v1/credits`, `/me/entitlements`, `/v1/models` truth | Rayu service | backend integration tests |

Rule: the session file is a shared contract with the Rayu TS CLI. Any change to
its shape (camelCase keys, epoch-ms `expiresAt`, numeric `user.id`, 0600) is a
contract change and must stay byte-compatible.

## 1. Loopback login vectors

| ID | Script | Expected | Covered by |
|---|---|---|---|
| DL-01 happy path | callback with matching state; token 200 full session | session persisted (0600), user returned | `login_via_callback_url_exchanges_code_and_persists_session` |
| DL-02 state mismatch | callback `state` differs | rejected, nothing persisted | `loopback_callback_rejects_state_mismatch` |
| DL-03 probes | non-callback / favicon requests | ignored, listener stays up | `loopback_callback_verifies_state_and_ignores_probes` |
| DL-04 exchange failure | token 4xx/5xx | error surfaced, nothing persisted | `login_exchange_failure_is_reported_without_persisting` |
| DL-05 timeout | no callback within 5 min | login aborts cleanly | integration (`rayu_auth_flow`) |
| DL-06 garbage 200 | token 200 non-JSON / missing fields | parse error, nothing persisted | unit (session parse) |

## 2. Refresh vectors

| ID | Script | Expected | Covered by |
|---|---|---|---|
| RF-01 fresh | `expiresAt` far in future | token returned, no network | `fresh_session_returns_token_without_network` |
| RF-02 expired | `expiresAt` past; refresh 200 | refreshed, user preserved | `expired_session_refreshes_and_preserves_user` |
| RF-03 definitive refusal | refresh 400 / 401 | session cleared | `definitive_refusals_clear_the_session` |
| RF-04 transient | refresh network / 5xx / 403 | session kept | `transient_failures_keep_the_session` |
| RF-05 malformed | refresh 200 bad body | session kept | `malformed_refresh_body_keeps_the_session` |
| RF-06 newer file wins | file renewed mid-refresh | newer file wins | `newer_file_wins_over_an_in_flight_refresh` |
| RF-07 stale token | caller holds stale token, file already renewed | short-circuit, no second refresh | `stale_token_short_circuits_when_the_file_already_renewed` |
| RF-08 single-flight | concurrent callers | one in-flight request shared | `concurrent_refreshes_share_one_in_flight_request` |
| RF-09 no refresh token | expired, no refreshToken | cleared | `expired_session_without_refresh_token_is_cleared` |

## 3. Account state (`/me`, `/v1/credits`, `/me/entitlements`)

| ID | Body | Expected | Covered by |
|---|---|---|---|
| ME-01 full | `/me` user+status; entitlements allowedModels/hostedModels | parsed with session JWT | `fetch_me_and_entitlements_use_the_session_jwt` |
| ME-02 credits | gateway camelCase incl. `apiKey{keyId,creditLimit,allowedModels,rateLimitRpm}` | parsed | `fetch_credits_parses_the_gateway_schema_including_api_key_limits` |
| ME-03 no session | account read without credential | error surfaced | `account_reads_require_a_session_and_surface_http_errors` |
| ME-04 HTTP error | 401 / 5xx | surfaced; cached catalog NOT overwritten | runtime last-good tests |
| ME-05 unknown fields | extra/absent optional fields | tolerated (serde default; never `deny_unknown_fields`) | unit parse |

## 4. API-key validation

| ID | Script | Expected | Covered by |
|---|---|---|---|
| AK-01 valid | `GET /v1/credits` 200 | Valid | `api_key_verdicts_follow_gateway_status_and_fail_open` |
| AK-02 invalid | 401 | Invalid | same |
| AK-03 unavailable | network / 5xx | Unavailable, records nothing | `offline_validation_is_unavailable_and_records_nothing` |
| AK-04 precedence | session + key both present | JWT wins | `gateway_credential_prefers_jwt_over_api_key` |
| AK-05 prefix | non-`rayu_sk_live_` value | not treated as a Rayu key | `apikey.rs` unit |

## 5. Live catalog discovery regression (AGENTS.md)

`crates/rayucode-base/src/provider/tests/catalog_rayu.rs` drives the real runtime
against a mock gateway serving the ACTUAL Rayu response schema:

- DC-01 an arbitrary future model absent from every offline fallback array is
  discovered and reaches the model-picker routes with the `rayu:` prefix.
- DC-02 explicit forced refresh bypasses a fresh cache.
- DC-03 the last-good catalog survives network, 401, and malformed failures.
- DC-04 the persistent cache is scoped to the endpoint that produced it.
  (`rayu_live_catalog_discovery_picker_routes_force_refresh_and_last_good`,
  `rayu_persistent_catalog_cache_is_endpoint_scoped`)

Runtime-side catalog tests:
`api_key_catalog_discovers_future_models_and_force_refresh_bypasses_fresh_cache`
(`GET {gateway}/v1/models`, OpenAI-style `{"object":"list","data":[…]}`) and
`jwt_entitlements_catalog_separates_usable_from_visible` (`/me/entitlements`).

## 6. Chat wire and 401 replay

- CW-01 `POST {gateway}/anthropic/v1/messages` with `Authorization: Bearer`,
  `anthropic-version: 2023-06-01`, `x-rayu-client: cli`, never `x-api-key`.
- CW-02 session 401 → refresh once → replay; API-key 401 → no retry.
  (`chat_streams_sse_with_bare_model_and_replays_once_after_401_refresh`)
- CW-03 route prefix stripped to bare model id; empty rejected.
  (`model_selection_strips_route_prefix_and_rejects_empty`)
- CW-04 stable route ids; rayu owns tools. (`routes_keep_stable_ids_and_rayu_owns_tools`)

## 7. Security negative tests

- SN-01 login `state` is 16 random bytes (hex), not guessable; callback verifies it.
- SN-02 loopback only: the callback listener binds `127.0.0.1`.
- SN-03 client never prints `RAYU_API_KEY`, `accessToken`, `refreshToken`, the
  one-time `code`, or the full callback URL to stdout/stderr or logs (output
  capture grep; see the observability doc's never-log list).
- SN-04 endpoint overrides: non-loopback plain-http and credential-embedded
  (userinfo) URLs are refused before any Bearer is sent; invalid → warn + default.
  (`bearer_endpoints_are_validated_before_send`, `urls.rs` tests)
- SN-05 redirects rejected so the Bearer cannot move off-origin.
- SN-06 session file is 0600 on Unix; written atomically (`session.rs` tests).
- SN-07 oversized/hostile bodies: wrong content-type, NUL bytes, huge body —
  client errors cleanly, no panic.

## 8. Clocks and races

- CR-01 proactive refresh boundary at `expiresAt - 60_000` (epoch ms).
- CR-02 concurrent refreshes single-flight (RF-08); newer-file-wins (RF-06).
- CR-03 stale-token short-circuit when the file already renewed (RF-07).
- CR-04 two concurrent logins: last writer wins on the session file; no
  interleaved/corrupt file (atomic write).

## Execution plan

Run the focused suites (economical; `CARGO_INCREMENTAL=0`):

```bash
cargo test -p rayucode-base rayu::                 # auth unit vectors
cargo test -p rayucode-base catalog_rayu           # discovery regression
cargo test -p rayucode-provider-rayu-runtime       # gateway wire + catalog
cargo test -p rayu --test auth_login_flow      # existing login flow
cargo test -p rayu --test rayu_auth_flow       # Rayu login flow (integration-tests)
```

The integration-tests packet owns `tests/rayu_auth_flow.rs` and the `include!`
splice fix for `catalog_rayu.rs` (convert leading `//!` inner doc comments to
`//` and drop the redundant `use super::*;`). Fixture/schema changes are contract
changes and must keep the shared session file byte-compatible with the Rayu TS
CLI.