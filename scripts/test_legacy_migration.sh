#!/usr/bin/env bash
# End-to-end sandboxed tests for RayuCode v3 install.sh legacy Node -> Rust migration.
# Never touches the real $HOME or ~/.rayu.
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin" "$tmp/payload"

# Create a real compressed tar.gz archive with a fake Rust v3.0.0 binary + notices.
cat > "$tmp/payload/rayu-linux-x86_64" <<'BIN'
#!/usr/bin/env bash
case "${1:-}" in
  --version) printf 'rayu v3.0.0 (testbuild)\n' ;;
  setup-hotkey|setup-launcher|server) exit 0 ;;
  *) printf 'rayu-rust-v3 %s\n' "$*" ;;
esac
BIN
chmod +x "$tmp/payload/rayu-linux-x86_64"
printf 'MIT License\n' > "$tmp/payload/LICENSE"
printf 'Third Party Notices\n' > "$tmp/payload/THIRD_PARTY_NOTICES"
tar czf "$tmp/rayu-linux-x86_64.tar.gz" -C "$tmp/payload" \
  rayu-linux-x86_64 LICENSE THIRD_PARTY_NOTICES

ARCHIVE_SHA256=$(sha256sum "$tmp/rayu-linux-x86_64.tar.gz" | awk '{print tolower($1)}')

cat > "$tmp/bin/uname" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  -s) printf 'Linux\n' ;;
  -m) printf 'x86_64\n' ;;
  *) printf 'Linux\n' ;;
esac
EOF

cat > "$tmp/bin/curl" <<EOF
#!/usr/bin/env bash
output=""
url=""
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    -o) output="\$2"; shift 2 ;;
    http*) url="\$1"; shift ;;
    *) shift ;;
  esac
done
case "\$url" in
  *releases/latest/version)
    printf 'v3.0.0\n'
    ;;
  *github.com*/releases/latest)
    printf 'https://github.com/Choeng-Rayu/rayucode-v2/releases/tag/v3.0.0'
    ;;
  *releases/v3.0.0/download-bases)
    printf 'https://github.com/Choeng-Rayu/rayucode-v2/releases/download/v3.0.0\n'
    ;;
  *SHA256SUMS)
    if [ "\${BAD_CHECKSUM:-0}" = "1" ]; then
      printf '0000000000000000000000000000000000000000000000000000000000000000  rayu-linux-x86_64.tar.gz\n'
    else
      printf '%s  rayu-linux-x86_64.tar.gz\n' "$ARCHIVE_SHA256"
    fi
    ;;
  *rayu-linux-x86_64.tar.gz)
    cp "$tmp/rayu-linux-x86_64.tar.gz" "\$output"
    ;;
  *)
    exit 22
    ;;
esac
EOF

# Mock node runtime so the preserved rayu-legacy launcher can actually execute!
cat > "$tmp/bin/node" <<'EOF'
#!/usr/bin/env bash
entry="$1"; shift || true
if [ "${1:-}" = "--version" ]; then
  printf '2.5.3\n'
else
  printf 'legacy-node-cli:%s:%s\n' "$(basename "$entry")" "$*"
fi
EOF
chmod +x "$tmp/bin/uname" "$tmp/bin/curl" "$tmp/bin/node"

seed_legacy_home() {
  local h="$1"
  mkdir -p "$h/.rayu/bin" "$h/.rayu/lib/rayu-2.5.3" "$h/.rayu/runtime/node/bin" "$h/.rayu/sessions"
  printf 'console.log("legacy");\n' > "$h/.rayu/lib/rayu-2.5.3/rayu.js"
  ln -sfn "$h/.rayu/lib/rayu-2.5.3" "$h/.rayu/lib/current"
  cp "$tmp/bin/node" "$h/.rayu/runtime/node/bin/node"
  cat > "$h/.rayu/install.json" <<JSON
{
  "installer": "rayucode.com/install",
  "method": "tarball",
  "version": "2.5.3",
  "platform": "linux-x64",
  "binDir": "$h/.rayu/bin",
  "node": "$h/.rayu/runtime/node/bin/node",
  "installedAt": "2026-11-18T08:24:13Z"
}
JSON
  cat > "$h/.rayu/bin/rayu" <<SH
#!/bin/sh
# Rayu CLI launcher
if [ "\${1:-}" = "update" ]; then exec "$h/.rayu/bin/.rayu-installer"; fi
exec "$h/.rayu/runtime/node/bin/node" "$h/.rayu/lib/current/rayu.js" "\$@"
SH
  chmod +x "$h/.rayu/bin/rayu"
  printf '#!/bin/sh\necho old installer\n' > "$h/.rayu/bin/.rayu-installer"
  chmod +x "$h/.rayu/bin/.rayu-installer"
  # User data that MUST NEVER be deleted!
  printf '{"apiKey":"keep-me"}\n' > "$h/.rayu/config.json"
  printf '{"token":"secret"}\n' > "$h/.rayu/rayu-auth.json"
  printf 'session-data\n' > "$h/.rayu/sessions/s1.json"
  cat > "$h/.bashrc" <<RC
# existing bashrc
# >>> rayu cli >>>
export PATH="$h/.rayu/bin:\$PATH"
# <<< rayu cli <<<
RC
}

echo "=== Case 1: Fresh install (no legacy) ==="
h1="$tmp/home-fresh"
mkdir -p "$h1"
out1=$(PATH="$tmp/bin:/usr/bin:/bin" HOME="$h1" RAYU_HOME="$h1/.rayu" \
  RAYU_INSTALL_DIR="$h1/.local/bin" RAYU_SKIP_SERVER_RELOAD=1 RAYU_NO_TELEMETRY=1 \
  RAYU_SKIP_NPM_CHECK=1 bash "$repo_dir/scripts/install.sh")
test -x "$h1/.local/bin/rayu"
test "$("$h1/.local/bin/rayu" --version)" = "rayu v3.0.0 (testbuild)"
! printf '%s' "$out1" | grep -q "rayu-legacy"

echo "=== Case 2: Existing legacy install + --keep-legacy ==="
h2="$tmp/home-keep"
seed_legacy_home "$h2"
out2=$(PATH="$tmp/bin:/usr/bin:/bin" HOME="$h2" RAYU_HOME="$h2/.rayu" \
  RAYU_INSTALL_DIR="$h2/.local/bin" RAYU_SKIP_SERVER_RELOAD=1 RAYU_NO_TELEMETRY=1 \
  RAYU_SKIP_NPM_CHECK=1 bash "$repo_dir/scripts/install.sh" --keep-legacy)
printf '%s\n' "$out2" | grep -q "renamed to: rayu-legacy"
# Old ~/.rayu/bin/rayu MUST be gone so ~/.local/bin/rayu wins even if ~/.rayu/bin is first on PATH!
test ! -e "$h2/.rayu/bin/rayu"
test ! -e "$h2/.rayu/bin/.rayu-installer"
test -x "$h2/.rayu/bin/rayu-legacy"
test -x "$h2/.local/bin/rayu"
# Verify PATH resolution: rayu -> Rust v3, rayu-legacy -> old Node v2!
test "$(PATH="$h2/.rayu/bin:$h2/.local/bin:$tmp/bin:/usr/bin:/bin" rayu --version)" = "rayu v3.0.0 (testbuild)"
test "$(PATH="$h2/.rayu/bin:$h2/.local/bin:$tmp/bin:/usr/bin:/bin" rayu-legacy --version)" = "2.5.3"
# Verify rayu-legacy update is safely blocked!
if PATH="$h2/.rayu/bin:$h2/.local/bin:$tmp/bin:/usr/bin:/bin" rayu-legacy update >/dev/null 2>&1; then
  echo "expected rayu-legacy update to fail safely" >&2
  exit 1
fi
# User data preserved!
test "$(cat "$h2/.rayu/config.json")" = '{"apiKey":"keep-me"}'
test "$(cat "$h2/.rayu/rayu-auth.json")" = '{"token":"secret"}'
test "$(cat "$h2/.rayu/sessions/s1.json")" = 'session-data'

echo "=== Case 3: Existing legacy install + --remove-legacy ==="
h3="$tmp/home-remove"
seed_legacy_home "$h3"
out3=$(PATH="$tmp/bin:/usr/bin:/bin" HOME="$h3" RAYU_HOME="$h3/.rayu" \
  RAYU_INSTALL_DIR="$h3/.local/bin" RAYU_SKIP_SERVER_RELOAD=1 RAYU_NO_TELEMETRY=1 \
  RAYU_SKIP_NPM_CHECK=1 bash "$repo_dir/scripts/install.sh" --remove-legacy)
printf '%s\n' "$out3" | grep -q "Removed rayu-legacy"
test ! -e "$h3/.rayu/bin/rayu"
test ! -e "$h3/.rayu/bin/rayu-legacy"
test ! -e "$h3/.rayu/lib"
test ! -e "$h3/.rayu/runtime"
test ! -e "$h3/.rayu/install.json"
! grep -q ">>> rayu cli >>>" "$h3/.bashrc"
grep -q "$h3/.local/bin" "$h3/.bashrc"
# New Rust binary works AND user data is 100% preserved!
test "$("$h3/.local/bin/rayu" --version)" = "rayu v3.0.0 (testbuild)"
test "$(cat "$h3/.rayu/config.json")" = '{"apiKey":"keep-me"}'
test "$(cat "$h3/.rayu/rayu-auth.json")" = '{"token":"secret"}'
test "$(cat "$h3/.rayu/sessions/s1.json")" = 'session-data'

echo "=== Case 4: Checksum mismatch MUST leave legacy rayu completely untouched ==="
h4="$tmp/home-bad-sha"
seed_legacy_home "$h4"
if PATH="$tmp/bin:/usr/bin:/bin" HOME="$h4" RAYU_HOME="$h4/.rayu" \
  RAYU_INSTALL_DIR="$h4/.local/bin" RAYU_SKIP_SERVER_RELOAD=1 RAYU_NO_TELEMETRY=1 \
  RAYU_SKIP_NPM_CHECK=1 BAD_CHECKSUM=1 bash "$repo_dir/scripts/install.sh" --remove-legacy >/dev/null 2>&1; then
  echo "expected checksum verification failure" >&2
  exit 1
fi
test -x "$h4/.rayu/bin/rayu"
test ! -e "$h4/.rayu/bin/rayu-legacy"
test -f "$h4/.rayu/lib/current/rayu.js"
test ! -e "$h4/.local/bin/rayu"

echo "=== Case 5: Legacy AutoUpdater invocation (--version 2.6.0 --quiet --no-modify-path) ==="
h5="$tmp/home-autoupdate"
seed_legacy_home "$h5"
cp "$h5/.bashrc" "$h5/.bashrc.before"
PATH="$tmp/bin:/usr/bin:/bin" HOME="$h5" RAYU_HOME="$h5/.rayu" \
  RAYU_INSTALL_DIR="$h5/.local/bin" RAYU_SKIP_SERVER_RELOAD=1 RAYU_NO_TELEMETRY=1 \
  RAYU_SKIP_NPM_CHECK=1 bash "$repo_dir/scripts/install.sh" --version 2.6.0 --quiet --no-modify-path
test "$("$h5/.local/bin/rayu" --version)" = "rayu v3.0.0 (testbuild)"
test ! -e "$h5/.rayu/bin/rayu"
test -x "$h5/.rayu/bin/rayu-legacy"
cmp -s "$h5/.bashrc" "$h5/.bashrc.before"

echo "=== Case 6: Installer API marker required by legacy refreshInstallerCopy ==="
grep -qF "rayu-installer-api: 2" "$repo_dir/scripts/install.sh"
grep -qF "rayu-installer-api: 2" "$repo_dir/scripts/install.ps1"

echo "ALL legacy migration tests passed!"
