# Account Flows: Observability, Privacy, and Support Diagnostics

Security logging, audit events, metrics, traces, redaction, retention, and
support diagnostics for the Rayu (RayuCode) account flows:
(1) browser loopback login, (2) access-token refresh, (3) account state
(`/me`, gateway `/v1/credits`, `/me/entitlements`), and (4) `RAYU_API_KEY`
validation.

Companion to `docs/dev/ACCOUNT_CONTRACT_CONFORMANCE_TESTS.md`. Client-side
surfaces live in this repo; the account/backend surfaces live in the Rayu
service (the same backend the Rayu TypeScript CLI uses). Billing, checkout, and
plan management are web-only on rayucode.com and are not CLI flows.

## Existing surfaces (grounding)

- Rayu auth client: `crates/rayucode-base/src/rayu/`
  (`login.rs`, `refresh.rs`, `session.rs`, `apikey.rs`, `api.rs`, `urls.rs`).
- Rayu gateway transport + live catalog: `crates/rayucode-provider-rayu-runtime/`.
- Client telemetry pipeline: `crates/rayucode-telemetry-core/src/lib.rs`
  (`record_auth_success`; `sanitize_telemetry_label` applied to all auth labels).
  The `AuthEvent` schema (`crates/rayucode-usage-types/src/lib.rs`) has no
  account_id/email slot; Rayu auth telemetry stays coarse.
- Onboarding auth funnel: `auth_provider`, `auth_method`, `auth_failure_reason`
  on onboarding step events.
- Failure classification labels: `crates/rayucode-base/src/auth/login_diagnostics.rs`
  (`AuthFailureReason::label`) — the only failure detail that may be reported.
- Local logs: `~/.rayu/logs/rayu-YYYY-MM-DD.log`.
- Public privacy contract: `TELEMETRY.md` (minimal usage telemetry, no ordinary
  prompts or code, no account identity; opt-out env vars).

## Never-log list (enforced by tests)

These values must never appear in logs, telemetry, traces, crash reports, or
support bundles, at any log level:

- `RAYU_API_KEY` (`rayu_sk_live_…`) — full or truncated beyond a non-secret
  fingerprint (SHA-256), never a readable prefix/suffix of the key itself.
- Session `accessToken` and `refreshToken` (JWTs), full or partial.
- The one-time login `code` and the loopback `state`, and the full callback URL
  query string (`/callback?code=…&state=…`).
- The contents of `~/.rayu/rayu-auth.json` and any `Authorization` header in HTTP
  client debug logging.
- Raw account email addresses and `user.id`. Rayu auth telemetry carries no
  account identity; the account email is shown only in local, user-facing
  account UI, never uploaded as usage telemetry.

Enforcement: an output-capture conformance test greps captured login/refresh
output for the never-log list (see SN-03 in the companion doc); auth labels flow
into telemetry only through `sanitize_telemetry_label`.

## Audit events (backend, durable)

Account-linked audit is owned by the Rayu service, not the CLI. The client sends
no account identifier in telemetry. Backend audit (for the service operators)
covers, keyed by account id and request id:

| Event | Required fields |
|---|---|
| `cli_login.started` / `completed` / `expired` | opaque state id (not the state), ip hash, user-agent class |
| `cli_token.issued` | account id, key/session id (not the token) |
| `cli_refresh.succeeded` / `rejected` | account id, reason class |
| `api_key.validated` / `rejected` | key id (not the key), verdict |

Correlation: the CLI uses a random per-attempt `state` for loopback login only;
it is never joined with the telemetry install id. Account-linked events stay in
the backend audit store, separate from coarse client usage telemetry.

## Client telemetry (this repo, minimal usage data)

Rayu auth events keep the coarse shape: success events with `auth_provider`
("rayu") + `auth_method` ("loopback" or "api_key"), failure reasons restricted to
`AuthFailureReason::label` values.

- `auth_success` on a completed login or a validated API key.
- `auth_failure` mirroring `auth_success` (reason label only).
- Do NOT add `account_id`, email, `user.id`, or any token to `AuthEvent`.
- Refresh outcomes may be counted coarsely (refreshed / cleared / kept) without
  timestamps precise enough to correlate with backend logs.

## Metrics and alerting

Client-side (via existing coarse telemetry, dashboarded in telemetry-worker):
login success ratio by version and `auth_failure_reason` distribution —
regression alert when a new release shifts the failure mix.

Backend-side (Rayu service operators): token-exchange and refresh success rates,
401 spikes (mass revocation or clock skew), and `/v1/credits` / `/me/entitlements`
latency. The client uses bounded timeouts and preserves the last-good catalog on
failure, so a backend outage degrades discovery rather than breaking sessions.

## Traces

Backend: one trace per request; span attributes limited to the audit-field set
(ids and hashes, never secrets/emails/tokens).

Client: no distributed tracing for auth (privacy). Local log lines around the
login/refresh flow record the flow outcome label only.

## Retention

| Data | Where | Retention |
|---|---|---|
| Account audit events | Rayu backend | per the service's audit policy, append-only |
| Client usage telemetry | telemetry-worker D1 | per TELEMETRY.md; no account identity |
| Local client logs | `~/.rayu/logs/` | user-owned; must satisfy never-log list |
| Rayu session file | `~/.rayu/rayu-auth.json` | user-owned, 0600; cleared on logout / 400/401 refresh |
| Support bundles | created on demand | delete after case close (<= 90 days) |

## Support diagnostics

`rayu doctor`-style Rayu diagnostics (extend the existing provider doctor,
`crates/rayucode-provider-doctor/`): prints the resolved API/web/gateway bases,
whether a usable session exists, the session expiry (coarse), a non-secret API-key
fingerprint, the cached account/credits status, and the session-file path and
permissions. Copy-safe by construction (never a full key or token). Support asks
the user for the masked key fingerprint, approximate login time, and the
`AuthFailureReason` label; the backend joins on key id / account id in its audit
store. No flow requires the user to paste a key, token, or callback link.

## Per-flow one-page summary

1. Loopback login: client logs the outcome label only; the random `state` and
   one-time `code` are never logged; backend audits start/complete/expire.
2. Refresh: client logs refreshed/cleared/kept coarsely; 400/401 clears the
   session, network/5xx/403 keeps it; tokens never logged.
3. Account state (`/me`, `/v1/credits`, `/me/entitlements`): client caches status
   and the last-good catalog, logs nothing sensitive; alert on 401 spikes/latency.
4. API-key validation: `GET {gateway}/v1/credits`; 401 → Invalid, other failures →
   Unavailable; only a non-secret fingerprint is ever surfaced.

## Follow-ups (actionable in this repo)

- Keep `record_auth_failure` for the Rayu flow label-only.
- Maintain the SN-03-style output-capture test asserting the never-log list for
  login/refresh, and a doctor command for Rayu account diagnostics.