#!/usr/bin/env bash
# Run a locally built `rayu` against the developer `.env`, isolated from the
# installed binary and from the shared production daemon.
#
# Why this exists: `rayu` never loads `./.env` at runtime. Only Cargo reads it,
# and only for ENABLE_OTHER_PROVIDER and RAYU_FALLBACK_MODEL. Every runtime
# setting in `.env` (RAYU_API_URL, RAYU_GATEWAY_URL, RAYU_WEB_URL,
# USE_RAYU_OAUTH, RAYU_NO_TELEMETRY, ...) reaches a process only if the shell
# that starts it exported those variables. Running `./target/release/rayu`
# directly therefore talks to the production endpoints no matter what `.env`
# says, which is easy to misread as ".env was baked into the build".
#
# This wrapper fixes that and keeps the run self-contained:
#   * exports `.env` into the child process,
#   * points RAYU_HOME at a scratch dir, so `rayu login` here cannot overwrite
#     your real ~/.rayu/rayu-auth.json,
#   * binds a private socket, so it never competes with the running daemon.
#
# Usage:
#   scripts/rayu-local.sh                      # interactive TUI
#   scripts/rayu-local.sh run 'Say hello'      # any `rayu` arguments
#   scripts/rayu-local.sh provider list
#
# Env:
#   RAYU_LOCAL_HOME    scratch dir (default: ./.rayu-local)
#   RAYU_LOCAL_SOCKET  socket path (default: <home>/rayu.sock)
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

env_file="$repo_root/.env"
if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file." >&2
  echo "Copy .env.example to .env first." >&2
  exit 1
fi

# Prefer a selfdev build, then the fast release build, then release-lto.
binary=""
for candidate in \
  "$repo_root/target/selfdev/rayu" \
  "$repo_root/target/release/rayu" \
  "$repo_root/target/release-lto/rayu"; do
  if [[ -x "$candidate" ]]; then
    binary="$candidate"
    break
  fi
done
if [[ -z "$binary" ]]; then
  echo "No built binary found. Build one first:" >&2
  echo "  scripts/dev_cargo.sh build --profile selfdev -p rayucode --bin rayu" >&2
  exit 1
fi

local_home="${RAYU_LOCAL_HOME:-$repo_root/.rayu-local}"
mkdir -p "$local_home"
local_socket="${RAYU_LOCAL_SOCKET:-$local_home/rayu.sock}"

# Load .env without leaking it into the caller's shell.
set -a
# shellcheck source=/dev/null
source "$env_file"
set +a

# Sandbox identity and endpoint, and keep the private socket off the shared one.
export RAYU_HOME="$local_home"
export RAYU_SOCKET="$local_socket"
export RAYU_NO_AUTO_UPDATE=1

# A sandboxed RAYU_HOME starts with no credentials. Say so up front instead of
# letting a turn fail with an auth error that looks like a broken endpoint.
if [[ ! -f "$local_home/rayu-auth.json" && -z "${RAYU_API_KEY:-}" ]]; then
  echo "note: $local_home has no Rayu session yet; run 'rayu login --provider rayu'"
  echo "      (this login lands in $local_home, not ~/.rayu)" >&2
fi

echo "binary: $binary" >&2
echo "api:    ${RAYU_API_URL:-<built-in default>}" >&2
echo "socket: $local_socket" >&2

exec "$binary" --no-update --socket "$local_socket" "$@"
