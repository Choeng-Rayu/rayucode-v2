# Auth Notes: OAuth + API-key Providers

This document explains how authentication works in RayuCode (`rayu`).

## Overview

RayuCode can detect existing local credentials and can also run built-in OAuth and API-key login flows.

For auth files managed by other tools/CLIs, `rayu` asks before reading them. If you
approve a source, `rayu` remembers that approval for that external auth file path
for future sessions and still leaves the original file untouched (no move,
rewrite, or permission mutation). Symlinked external auth files are rejected.

Credentials are stored locally:
- Rayu (RayuCode) account session (if logged in via `rayu login --provider rayu`): `~/.rayu/rayu-auth.json` (shared with the Rayu TypeScript CLI), or the `RAYU_API_KEY` env var
- RayuCode Claude OAuth (if logged in via `rayu login --provider claude`): `~/.rayu/auth.json`
- Claude Code CLI: `~/.claude/.credentials.json` (Linux/Windows), or the **macOS login Keychain** item `Claude Code-credentials` (the default on macOS, where the JSON file usually does not exist), or the `CLAUDE_CODE_OAUTH_TOKEN` env var (set by `claude setup-token`)
- OpenCode (optional provider/OAuth import source): `~/.local/share/opencode/auth.json`
- pi (optional provider/OAuth import source): `~/.pi/agent/auth.json`
- RayuCode OpenAI/Codex OAuth: `~/.rayu/openai-auth.json`
- Codex CLI auth source (read in place only after confirmation): `~/.codex/auth.json`
- Gemini native OAuth: `~/.rayu/gemini_oauth.json`
- Gemini CLI import fallback: `~/.gemini/oauth_creds.json`
- Copilot CLI plaintext fallback: `~/.copilot/config.json`
- Legacy Copilot JSON sources: `~/.config/github-copilot/hosts.json`, `~/.config/github-copilot/apps.json`

Relevant code:
- Rayu auth (urls/session/login/refresh/apikey/api): `crates/rayucode-base/src/rayu/`
- Rayu gateway transport + live catalog: `crates/rayucode-provider-rayu-runtime/`
- Claude provider: `crates/rayucode-base/src/provider/anthropic.rs`
- OpenAI login + refresh: `crates/rayucode-base/src/auth/oauth.rs`
- OpenAI credentials parsing: `crates/rayucode-base/src/auth/codex.rs`
- OpenAI requests: `crates/rayucode-base/src/provider/openai.rs`
- Azure OpenAI auth/config: `crates/rayucode-base/src/auth/azure.rs`
- Azure OpenAI transport: `crates/rayucode-base/src/provider/openrouter.rs`
- Gemini login + refresh: `crates/rayucode-base/src/auth/gemini.rs`
- Gemini Code Assist provider: `crates/rayucode-base/src/provider/gemini.rs`
- OpenAI-compatible provider metadata/login descriptors: `crates/rayucode-provider-metadata/src/lib.rs`

## Rayu (RayuCode)

Rayu is the recommended first-party provider. It authenticates against
Rayu/RayuCode and routes chat through the RayuCode
Anthropic-Messages gateway. There are two independent credential paths: a shared
account session created by browser loopback login, and a `RAYU_API_KEY`. The
login provider id is `rayu` (display "Rayu", aliases `rayucode` and
`subscription`); model routes use the `rayu:` prefix (`rayu:{model}`).

### Login steps (browser loopback)
1. Run `rayu login --provider rayu` (recommended), or `rayu login` and choose Rayu.
   - For headless / SSH use: `rayu login --provider rayu --no-browser`
   - For scriptable remote flows: `rayu login --provider rayu --print-auth-url`, then later complete with `--callback-url`
2. `rayu` binds a loopback callback listener on `127.0.0.1` (ephemeral port),
   generates a 16-byte hex `state`, and opens the browser to
   `{web}/cli-login?port=<port>&state=<state>`.
3. After you approve in the browser, RayuCode redirects to
   `http://127.0.0.1:<port>/callback?code=<code>&state=<state>`. `rayu` verifies the
   `state` matches, then exchanges the one-time code at `POST {api}/cli/token`.
4. The session is saved to `~/.rayu/rayu-auth.json` (0600). Login times out after
   5 minutes if no callback arrives.

### Shared session file
- Path: `~/.rayu/rayu-auth.json`, shared byte-for-byte with the Rayu TypeScript
  CLI (rayu-cli). Signing in with either tool signs the other in.
- Shape (camelCase): `accessToken`, `refreshToken`, `expiresAt` (epoch
  **milliseconds**), and `user` (`id` numeric, `email`, `displayName`,
  `avatarUrl`, `role`).
- Written atomically with 0600 permissions; never logged.
- Config dir resolution: `RAYU_AUTH_CONFIG_DIR` > `RAYU_CONFIG_DIR` > `~/.rayu`.

### Token refresh
- Proactive refresh once `expiresAt - 60_000` (60s skew) is reached; single-flight
  so concurrent callers share one refresh.
- `POST {api}/cli/refresh` with `{refreshToken}`.
- `400`/`401` clears the session (re-login required); network/`5xx`/`403` keeps
  it; concurrent writes use newer-file-wins.
- A `401` from the gateway triggers one refresh + replay for session credentials.
  API-key `401`s are not retried.

### RAYU_API_KEY
- Set `RAYU_API_KEY` (prefix `rayu_sk_live_…`) for key-only usage; no browser
  login is required. This is the only Rayu API-key env var.
- Validated via `GET {gateway}/v1/credits`: `401` → Invalid; other failures →
  Unavailable (not treated as invalid).
- When both a session and an API key are present, the account JWT wins
  (`gateway_credential()`).

### Env overrides
- `RAYU_API_URL` (default `https://api.rayucode.com/api`)
- `RAYU_WEB_URL` (default `https://rayucode.com`)
- `RAYU_GATEWAY_URL` (default `https://gateway.rayucode.com`)
- `RAYU_CONFIG_DIR` / `RAYU_AUTH_CONFIG_DIR` (session directory)

Trailing slashes are stripped. HTTPS is accepted anywhere; plain HTTP is allowed
only for loopback hosts; URLs with embedded userinfo are rejected. An invalid
override warns and falls back to the default. Non-loopback plain-http and
credential-embedded endpoints are refused before any Bearer credential is sent.

### Account surfaces
- Dashboard: `{web}/dashboard`; plans/pricing: `{web}/plans` (offered when a limit
  is hit; billing is managed on the web, not in the CLI).
- `GET {api}/me` → user + status; `GET {gateway}/v1/credits` → plan/credits/usage;
  `GET {api}/me/entitlements` → `allowedModels`/`hostedModels`/`subagentTiers`.

### Chat wire
- `POST {gateway}/anthropic/v1/messages` (Anthropic Messages API).
- Headers: `Authorization: Bearer <credential>`, `anthropic-version: 2023-06-01`,
  `x-rayu-client: cli`. Never `x-api-key`. Redirects are rejected so the Bearer
  credential cannot be moved off-origin.

### Live model discovery
- Login session: `GET {api}/me/entitlements` (`allowedModels`/`hostedModels`).
- API key: `GET {gateway}/v1/models`.
- Cached prefetch plus explicit forced refresh (which bypasses fresh caches); the
  last-good catalog is preserved on network/auth/malformed-response failure;
  persistent caches are scoped per endpoint; discovery is wired into the shared
  refresh fanout and model-update publication for long-lived sessions. New models
  appear without a `rayu` release. Bundled model arrays are offline fallbacks only.

### Troubleshooting
- `401`/auth errors with a session: run `rayu login --provider rayu` again.
- `401` with `RAYU_API_KEY`: verify the key (it must start with `rayu_sk_live_`)
  and that it is still valid on the dashboard.
- Callback issues: ensure the loopback port is reachable and the browser can
  return to `http://127.0.0.1:<port>/callback`.

## Claude (Claude Max)

### Login steps
1. Run `rayu login --provider claude` (recommended), or `rayu login` and choose Claude.
   - For headless / SSH use: `rayu login --provider claude --no-browser`
   - For scriptable remote flows: `rayu login --provider claude --print-auth-url`, then later complete with `--callback-url` or `--auth-code`
2. Alternative: run `claude` (or `claude setup-token`). `rayu` can detect Claude Code's credentials, ask before reading them, and remember that approval for future sessions. This works whether Claude Code stored them in `~/.claude/.credentials.json` (Linux/Windows), the macOS login Keychain (`Claude Code-credentials`), or the `CLAUDE_CODE_OAUTH_TOKEN` env var. On macOS, approving the Keychain source copies the credentials into `~/.rayu/auth.json` once so later sessions never re-prompt the Keychain.
3. Verify with `rayu --provider claude run "Say hello from rayu"`.

Credential discovery order is:
1. `~/.rayu/auth.json`
2. `~/.claude/.credentials.json`
3. Claude Code native credentials (macOS Keychain `Claude Code-credentials`, or `CLAUDE_CODE_OAUTH_TOKEN` env var) once approved
4. `~/.local/share/opencode/auth.json`
5. `~/.pi/agent/auth.json`

### Direct Anthropic API (default)
`--provider claude` uses the direct Anthropic Messages API by default.
`rayu` owns the full runtime path itself: auth, refresh, request shaping, tool
compatibility, and transport.

#### Anthropic API-key setup

The direct API-key route is separate from both a Claude subscription login and
OpenRouter. In the TUI, run `/login anthropic-api` and enter your key in the
login prompt, not in an agent message. The CLI equivalent is
`rayu login --provider anthropic-api`. You can also configure
`ANTHROPIC_API_KEY` in the process environment. Login persists the key in
`anthropic.env` inside RayuCode's configuration directory.

To explicitly select the direct API route, use
`/model claude-api:claude-opus-5-5`. The Claude subscription route uses
`claude-oauth:` instead. These route prefixes avoid accidentally selecting an
OpenRouter entry for the same model.

Configured direct Anthropic routes discover models from Anthropic's Models API.
New releases do not require a bundled-list update once the authenticated catalog
advertises them. API-key and OAuth availability can differ, so a model advertised
for one route does not establish access on the other. Without credentials, `rayu`
can only show its bundled fallback list, not verify account availability.

#### Claude OAuth direct API compatibility
Claude Code OAuth tokens can be used directly against the Messages API, but only
if the request matches the Claude Code "OAuth contract". `rayu` applies this
automatically for the default Claude runtime path.

Required behaviors (applied by the Anthropic provider):
- Use the Messages endpoint with `?beta=true`.
- Send `User-Agent: claude-cli/1.0.0`.
- Send `anthropic-beta: oauth-2025-04-20,claude-code-20250219`.
- Prepend the system blocks with the Claude Code identity line as the first
  block:
  - `You are Claude Code, Anthropic's official CLI for Claude.`

Tool name allow-list:
Claude OAuth requests reject certain tool names. `rayu` remaps a small set of
builtin tool names on the wire to the Claude-Code builtin names and maps them
back on responses so native tools continue to work. Every other tool is
forwarded under its own name, so the full custom toolset (websearch, webfetch,
browser, codesearch, memory, swarm, multiedit, open, ...) stays available on
OAuth. The remapped names are:
- `bash` → `Bash`
- `read` → `Read`
- `write` → `Write`
- `edit` → `Edit`
- `glob` → `Glob`
- `grep` → `Grep`
- `subagent` → `Agent`
- `schedule` → `ScheduleWakeup`
- `skill_manage` → `Skill`

Notes:
- If the OAuth token expires, refresh via the Claude OAuth refresh endpoint.
- Without the identity line and allow-listed tool names, the API will reject
  OAuth requests even if the token is otherwise valid.

### Removed Claude CLI transport
The old Claude Code CLI shell-out transport has been removed. RayuCode always talks
to the Anthropic API directly. `--provider claude-subprocess` is accepted as an
alias for `--provider claude`, and `RAYU_USE_CLAUDE_CLI` is ignored.

## OpenAI / Codex OAuth

### Login steps
1. Run `rayu login --provider openai`.
   - For headless / SSH use: `rayu login --provider openai --no-browser`
   - For scriptable remote flows: `rayu login --provider openai --print-auth-url`, then later complete with `--callback-url`
2. Your browser opens to the OpenAI OAuth page unless you use `--no-browser`. The local callback listens on
   `http://localhost:1455/auth/callback` by default.
   If port `1455` is unavailable, `rayu` falls back to a manual paste flow where
   you can paste the full callback URL or query string.
3. After login, tokens are saved to `~/.rayu/openai-auth.json`.

Credential discovery order is:
1. `~/.rayu/openai-auth.json`
2. `~/.codex/auth.json`
3. trusted OpenCode/pi OAuth in `~/.local/share/opencode/auth.json` / `~/.pi/agent/auth.json`
4. `OPENAI_API_KEY`

If `rayu` finds existing credentials in `~/.codex/auth.json`, it asks before
reading them. When approved, it remembers that trust decision for future `rayu`
sessions and still does not move, delete, or rewrite the Codex file.

### Request details
RayuCode uses the Responses API. If you have a ChatGPT subscription (refresh
token or id_token present), requests go to:
- `https://chatgpt.com/backend-api/codex/responses`
with headers:
- `originator: codex_cli_rs`
- `chatgpt-account-id: <from token>`

Otherwise it uses:
- `https://api.openai.com/v1/responses`

For **API-key** usage (no ChatGPT/Codex OAuth), the Responses API base URL is
overridable so you can target a local or proxied Responses-API endpoint. Set one
of (checked in this order) to an absolute `http(s)://` base that ends in the API
version, e.g. `http://127.0.0.1:8317/v1`:
- `RAYU_OPENAI_API_BASE`
- `OPENAI_BASE_URL`
- `OPENAI_API_BASE`

`rayu` appends `/responses` itself, derives the WebSocket and `/compact`
endpoints from the same base, and also points the `/models` catalog probe at it.
The override is ignored in ChatGPT/Codex OAuth mode (that backend is fixed), and
a malformed value is logged and ignored rather than breaking requests.

### Banked Codex usage resets

Agents automatically spend an earned reset and continue when the OpenAI weekly
limit is exhausted and no approved pool route is ready. To opt out, set the
following under `[provider]` in `~/.rayu/config.toml`:

```toml
[provider]
openai_auto_banked_reset = false
```

This is enabled by default. Automatic recovery checks fresh, account-scoped
usage and requires an enforced limit plus exhausted weekly usage, not just a
rounded percentage or a transient 429. It redeems the soonest-expiring reset for
that OAuth login and retries the request once when no approved pool route is ready.
It never purchases credits or enables paid overage. Concurrent agents serialize
automatic redemption, and uncertain redemption results have a five-minute
cooldown to avoid spending another reset immediately. Manual resets remain
available independently of this setting.

Anthropic Fable earned resets have a separate opt-in:

```toml
[provider]
anthropic_auto_fable_reset = true
```

This uses the Fable-specific `cedar_ember` grant, not the five-hour-only
`juniper_tide` session reset. It requires a named saved OAuth account, fresh
server-confirmed weekly exhaustion, and a usable earned Fable grant. A successful
claim must be confirmed against fresh quota before the waiting request resumes.
Uncertain claims retain a durable journal to prevent another automatic spend.
It never purchases usage credits. See [Fable reset details](docs/anthropic-fable-resets.md).

Both automatic reset options default to **route first, reset last**. When the
existing account router can offer another ready account or provider in your
auto-switch pool, it offers that exact route instead of spending a reset.
Normal route approval and cross-provider countdown/manual rules still apply.
Excluded accounts, cooling-down routes, and models that cannot fit the request
do not postpone reset recovery. To prefer spending a reset before routing instead:

```toml
[provider]
auto_reset_only_when_no_routes = false
```

This ordering option does not enable automatic reset spending by itself. The
provider-specific opt-in is still required, and the reset must pass fresh
weekly-exhaustion and earned-grant checks.

Account headers report session, weekly, and each model-specific/additional usage
window that the provider reports, rather than selecting just one window.

`/reset` (or `/reset usage limits openai`) checks the active OpenAI OAuth account's banked
resets and shows the selected reset, account, and expiry. It selects the
soonest-expiring available reset. With automatic recovery disabled, nothing is spent until you run
`/reset usage limits openai confirm`. Use `/reset usage limits openai cancel`
to dismiss the pending confirmation. API keys cannot redeem these resets.

When the active ChatGPT account is fully limited and has a banked reset, the
TUI notification shows the reset count and each known expiry in UTC, followed by
`/reset usage limits openai`. The hint wraps on narrow terminals. Expiries that
cannot be retrieved are explicitly marked unknown. Credit details are fetched
read-only alongside usage data and are also listed in the confirmation review.
This uses fresh, account-matched quota data and respects OpenAI's `allowed`
flag rather than suggesting a reset merely because a percentage rounds to 100%.
Hard quota failures trigger a read-only refresh. The hint never redeems a reset.

The implementation follows [Codex's backend client](https://github.com/openai/codex/blob/5c5308fc9a9ee789049d646ef11e5400384b9c6f/codex-rs/backend-client/src/client/rate_limit_resets.rs):

- Read: `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`
- Redeem: `POST` to that URL plus `/consume`, with JSON `credit_id` and a UUID
  `redeem_request_id`.
- Both requests use the ChatGPT OAuth bearer token and `chatgpt-account-id`
  when available. This is the Codex backend contract, not a public OpenAI API-key
  endpoint, and availability depends on the account.
- Confirmation pins the original account and credit. Retrying a failed or
  timed-out confirmation reuses the same redemption UUID, since the original
  request may already have succeeded. Check `/usage` before abandoning an
  uncertain redemption. Pending confirmations are session-local, not persisted.
- A reset spends one earned, single-use grant. It does not purchase credits,
  increase the subscription's limits, or bypass OpenAI's eligibility rules.
  See [OpenAI's banked reset explanation](https://help.openai.com/en/articles/20001498-how-banked-codex-resets-work).

### Troubleshooting
- Claude 401/auth errors: run `rayu login --provider claude`.
- 401/403: re-run `rayu login --provider openai`.
- Callback issues: make sure port 1455 is free and the browser can reach
  `http://localhost:1455/auth/callback`.

## Azure OpenAI

This was added after comparing RayuCode to OpenCode/Crush. The meaningful auth gap
was not another browser OAuth flow, but support for **Azure OpenAI** using either:
- **Microsoft Entra ID** credentials (via Azure's `DefaultAzureCredential` chain), or
- **Azure OpenAI API keys**.

### Login/setup steps
1. Run `rayu login --provider azure`.
2. Enter your Azure OpenAI endpoint, for example:
   - `https://your-resource.openai.azure.com`
3. Enter your Azure deployment/model name.
4. Choose one auth mode:
   - **Entra ID** (recommended)
   - **API key**
5. `rayu` saves settings to `~/.config/rayucode/azure-openai.env`.

### Stored configuration
The Azure env file may contain:
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_MODEL`
- `AZURE_OPENAI_USE_ENTRA`
- `AZURE_OPENAI_API_KEY` (only when using key auth)

### Runtime behavior
- `rayu` normalizes the endpoint to the newer Azure OpenAI `/openai/v1` base.
- In **Entra ID** mode, `rayu` obtains bearer tokens using `azure_identity::DefaultAzureCredential` with scope:
  - `https://cognitiveservices.azure.com/.default`
- In **API key** mode, `rayu` sends the credential in the Azure-style `api-key` header.
- The Azure provider currently reuses RayuCode's OpenAI-compatible transport layer under the hood.
- Model catalog fetching is disabled for Azure by default, so you should configure a deployment/model explicitly.

### Entra ID credential sources
`DefaultAzureCredential` can resolve credentials from sources like:
- `az login`
- managed identity
- Azure environment credentials

### Troubleshooting
- If Entra ID auth fails locally, try `az login` first.
- Make sure your identity has access to the Azure OpenAI resource.
- If requests fail with deployment/model errors, verify `AZURE_OPENAI_MODEL` matches your deployed model name.
- If you prefer static credentials, re-run `rayu login --provider azure` and choose API key mode.

## Gemini OAuth

### Login steps
1. Run `rayu login --provider gemini` or `/login gemini` inside the TUI.
   - For headless / SSH use: `rayu login --provider gemini --no-browser`
   - For scriptable remote flows: `rayu login --provider gemini --print-auth-url`, then later complete with `--auth-code`
2. `rayu` opens a browser to the Google OAuth flow used for Gemini Code Assist unless you use `--no-browser`.
3. If local callback binding is unavailable, `rayu` falls back to a manual paste flow using `https://codeassist.google.com/authcode`.
4. Tokens are saved to `~/.rayu/gemini_oauth.json`.

### Credential discovery order
1. Native `rayu` Gemini tokens: `~/.rayu/gemini_oauth.json`
2. Gemini CLI OAuth source (read only after approval): `~/.gemini/oauth_creds.json`
3. trusted OpenCode/pi OAuth in `~/.local/share/opencode/auth.json` / `~/.pi/agent/auth.json`

### Runtime notes
- `rayu` uses native Google OAuth and talks to the Google Code Assist backend directly.
- Expired tokens are refreshed automatically using the Google refresh token.
- Some school / Workspace accounts may require `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID` for Code Assist entitlement checks.

### Troubleshooting
- If browser launch fails, use `--no-browser` and the pasted callback/code flow.
- If entitlement or onboarding fails for a Workspace account, set `GOOGLE_CLOUD_PROJECT` and retry.
- If login succeeds but requests fail later, re-run `rayu login --provider gemini` to refresh the stored session.

### Auth verification
Use the built-in auth verifier to test the full local auth/runtime path after login:

```bash
# Run Gemini login now, then verify token refresh + provider smoke
rayu --provider gemini auth-test --login

# Verify existing Gemini auth without re-running login
rayu --provider gemini auth-test

# Check every currently configured supported auth provider
rayu auth-test --all-configured
```

For model providers, `auth-test` attempts:
1. credential discovery
2. refresh/auth probe
3. a real provider smoke prompt expecting `AUTH_TEST_OK`
4. a tool-enabled smoke prompt using the same tool-attached request path as normal chat

Use `--no-tool-smoke` if you only want the auth/simple-runtime checks.

For Gmail/Google it verifies credential discovery and token refresh, but skips model smoke because it is not a model provider.

## OpenAI-compatible API-key providers

RayuCode also ships first-class provider presets for many OpenAI-compatible APIs.
These providers use the same built-in login flow pattern: `rayu login --provider <name>`.

For arbitrary OpenAI-compatible APIs, especially when an agent is doing setup, prefer the named profile command instead of hand-editing config:

```bash
printf '%s' "$MY_API_KEY" | rayu provider add my-api \
  --base-url https://llm.example.com/v1 \
  --model my-model-id \
  --api-key-stdin \
  --set-default \
  --json

rayu --provider-profile my-api auth-test --no-tool-smoke
```

This writes `[providers.my-api]` in `~/.rayu/config.toml` and stores the key in `rayu`'s private app config dir, for example `~/.config/rayucode/provider-my-api.env`. For localhost servers, use `--no-api-key`.

Notable presets include:

### Fireworks
- Login: `rayu login --provider fireworks`
- Stored env file: `~/.config/rayucode/fireworks.env`
- API key env var: `FIREWORKS_API_KEY`
- Base URL: `https://api.fireworks.ai/inference/v1`
- Default model hint: `accounts/fireworks/routers/kimi-k2p5-turbo`
- Docs: <https://docs.fireworks.ai/tools-sdks/openai-compatibility>

### Novita AI
- Login: `rayu login --provider novita` or `/login novita` in the TUI
- Authentication: pay-as-you-go API key, not a subscription login or browser OAuth
- Stored env file: `~/.config/rayucode/novita.env`
- API key env var: `NOVITA_API_KEY`
- Base URL: `https://api.novita.ai/openai`
- Default model hint: `zai-org/glm-5.3`
- Get a key: <https://novita.ai/settings/key-management>
- Docs: <https://novita.ai/docs/guides/llm-api>

### MiniMax
- Login: `rayu login --provider minimax`
- Stored env file: `~/.config/rayucode/minimax.env`
- API key env var: `OPENAI_API_KEY`
- Base URL: `https://api.minimax.io/v1`
- Default model hint: `MiniMax-M2.7`
- Docs: <https://platform.minimax.io/docs/guides/text-generation>

These are first-class `rayu` provider presets, not just manual custom endpoint examples.
You can still use `openai-compatible` for arbitrary custom providers when there is not a built-in preset.

If `rayu` finds matching API keys in trusted OpenCode/pi auth files, it can reuse them for the corresponding provider preset without asking you to paste the key again.

## Experimental CLI Providers

RayuCode also supports experimental native/CLI-backed providers, plus Antigravity with native OAuth login:
- `--provider cursor`
- `--provider copilot`
- `--provider antigravity`

Cursor uses `rayu`'s native HTTPS transport. Copilot uses GitHub device-flow auth. Antigravity login/auth storage is handled natively by `rayu`.

### Cursor
- Login: `rayu login --provider cursor`
  - saves `CURSOR_API_KEY` to `~/.config/rayucode/cursor.env`
- Runtime:
  - `rayu` uses native HTTPS requests
  - if a Cursor API key is configured, `rayu` exchanges/uses it directly
- Env vars:
  - `RAYU_CURSOR_MODEL` (default: `composer-1.5`)
  - `CURSOR_API_KEY` (optional; overrides saved key)

### GitHub Copilot
- Login: `rayu login --provider copilot`
  - Headless / SSH: `rayu login --provider copilot --no-browser`
  - Scriptable remote flow: `rayu login --provider copilot --print-auth-url`, then later `rayu login --provider copilot --complete`
  - `rayu` uses GitHub device code flow and can print the verification URL/QR without opening a local browser.
- Credential discovery order:
  1. `COPILOT_GITHUB_TOKEN`
  2. `GH_TOKEN`
  3. `GITHUB_TOKEN`
  4. trusted `~/.copilot/config.json`
  5. trusted legacy `~/.config/github-copilot/hosts.json`
  6. trusted legacy `~/.config/github-copilot/apps.json`
  7. trusted OpenCode/pi OAuth entries
  8. `gh auth token`
- Env vars:
  - `RAYU_COPILOT_CLI_PATH` (optional override for CLI path)
  - `RAYU_COPILOT_MODEL` (default: `claude-sonnet-4`)

### Antigravity
- Login: `rayu login --provider antigravity` (native Google OAuth flow; does **not** require Antigravity to be installed)
  - Headless / SSH: `rayu login --provider antigravity --no-browser`
  - Scriptable remote flow: `rayu login --provider antigravity --print-auth-url`, then later complete with `--callback-url`
- Tokens: `~/.rayu/antigravity_oauth.json`
- Credential discovery order:
  1. native `rayu` tokens at `~/.rayu/antigravity_oauth.json`
  2. trusted OpenCode/pi OAuth entries when present
- Runtime:
  - `rayu` authenticates directly and stores/refreshes Antigravity OAuth tokens itself
  - the provider transport uses native HTTP requests when configured via `--provider antigravity`
- Env vars:
  - `RAYU_ANTIGRAVITY_CLIENT_ID` (optional override for OAuth client id)
  - `RAYU_ANTIGRAVITY_CLIENT_SECRET` (optional override for OAuth client secret)
  - `RAYU_ANTIGRAVITY_VERSION` (optional override for Antigravity request fingerprint/version)
  - `RAYU_ANTIGRAVITY_CLI_PATH` (default: `antigravity`, runtime only)
  - `RAYU_ANTIGRAVITY_MODEL` (default: `default`)
  - `RAYU_ANTIGRAVITY_PROMPT_FLAG` (default: `-p`)
  - `RAYU_ANTIGRAVITY_MODEL_FLAG` (default: `--model`)

## Google / Gmail OAuth

### Login steps
1. Run `rayu login --provider google`.
   - For headless / SSH use: `rayu login --provider google --no-browser`
   - For scriptable remote flows after credentials are already configured: `rayu login --provider google --print-auth-url`
2. If Google credentials are not configured yet, `rayu` first walks you through saving your client ID/client secret or importing the JSON credentials file.
3. For scriptable Google flows, choose the Gmail scope with `--google-access-tier full|readonly` if you do not want the default full access tier.
4. Complete the printed flow later with `rayu login --provider google --callback-url '<full callback url or query>'`.

### Notes
- Google/Gmail scriptable auth requires saved OAuth client credentials first.
- The callback URL can come from a remote browser session that fails on the loopback redirect. Copy the final URL from the address bar and paste or pass it back to `rayu`.

## Scriptable auth state lifecycle

- `rayu` stores temporary scriptable login state in `~/.rayu/pending-login/*.json`
- pending state expires automatically
- stale pending entries are cleaned up when scriptable login flows start or resume
- Copilot `--print-auth-url` stores the GitHub device code session and `--complete` resumes polling later
