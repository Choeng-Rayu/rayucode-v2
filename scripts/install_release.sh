#!/usr/bin/env bash
# Install the current release binary into the immutable version store,
# update the stable + current channel symlinks, and point the launcher at current.
#
# Paths after install:
# - ~/.rayu/builds/versions/<hash>/rayu (immutable)
# - ~/.rayu/builds/versions/<hash>/rayucode-harness-api-bridge (immutable, when crate present)
# - ~/.rayu/builds/stable/rayu -> .../versions/<hash>/rayu
# - ~/.rayu/builds/stable/rayucode-harness-api-bridge -> .../versions/<hash>/rayucode-harness-api-bridge
# - ~/.rayu/builds/current/rayu -> .../versions/<hash>/rayu
# - ~/.rayu/builds/current/rayucode-harness-api-bridge -> .../versions/<hash>/rayucode-harness-api-bridge
# - ~/.local/bin/rayu -> ~/.rayu/builds/current/rayu (launcher)
# - ~/.local/bin/rayucode -> ~/.rayu/builds/current/rayu (alias)
# - ~/.local/bin/rayucode-harness-api-bridge -> ~/.rayu/builds/current/rayucode-harness-api-bridge
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

profile="${RAYU_RELEASE_PROFILE:-release-lto}"
if [[ "${1:-}" == "--fast" ]]; then
  profile="release"
  shift
fi

if [[ "$#" -gt 0 ]]; then
  echo "Usage: $0 [--fast]" >&2
  exit 1
fi

case "$profile" in
  release-lto)
    echo "Building with LTO (this takes a few minutes)..."
    ;;
  release)
    echo "Building fast release profile (no LTO)..."
    ;;
  *)
    echo "Unsupported profile: $profile (expected: release or release-lto)" >&2
    exit 1
    ;;
esac

git_hash=""
git_date=""
git_dirty="0"
if command -v git >/dev/null 2>&1; then
  if git -C "$repo_root" rev-parse --git-dir >/dev/null 2>&1; then
    git_hash="$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || true)"
    git_date="$(git -C "$repo_root" log -1 --format=%ci 2>/dev/null || true)"
    if [[ -n "${git_hash}" ]] && [[ -n "$(git -C "$repo_root" status --porcelain 2>/dev/null || true)" ]]; then
      git_dirty="1"
    fi
  fi
fi

hash="$git_hash"
if [[ -n "$hash" ]] && [[ "$git_dirty" == "1" ]]; then
  hash="${hash}-dirty"
fi
if [[ -z "$hash" ]]; then
  hash="$(date +%Y%m%d%H%M%S)"
fi

cargo_args=(build --profile "$profile" --manifest-path "$repo_root/Cargo.toml")
has_bridge_crate="0"
if [[ -f "$repo_root/crates/rayucode-harness-api-server/Cargo.toml" ]]; then
  has_bridge_crate="1"
  cargo_args+=(-p rayucode --bin rayu -p rayucode-harness-api-server --bin rayucode-harness-api-bridge)
fi

if [[ -n "$git_hash" ]]; then
  RAYU_BUILD_GIT_HASH="$git_hash" \
    RAYU_BUILD_GIT_DATE="$git_date" \
    RAYU_BUILD_GIT_DIRTY="$git_dirty" \
    cargo "${cargo_args[@]}"
else
  cargo "${cargo_args[@]}"
fi
bin="$repo_root/target/$profile/rayu"
bridge_bin="$repo_root/target/$profile/rayucode-harness-api-bridge"

if [[ ! -x "$bin" ]]; then
  echo "Release binary not found: $bin" >&2
  exit 1
fi
if [[ "$has_bridge_crate" == "1" ]] && [[ ! -x "$bridge_bin" ]]; then
  echo "Harness bridge binary not found: $bridge_bin" >&2
  exit 1
fi

if [[ -n "$git_hash" ]]; then
  expected_git_identity="($git_hash)"
  if [[ "$git_dirty" == "1" ]]; then
    expected_git_identity="($git_hash, dirty)"
  fi
  if [[ "$($bin --version)" != *"$expected_git_identity"* ]]; then
    echo "Release binary does not report expected git identity: $expected_git_identity" >&2
    exit 1
  fi
fi

# Install versioned binary into ~/.rayu/builds/versions/<hash>/
builds_dir="$HOME/.rayu/builds"
version_dir="$builds_dir/versions/$hash"
mkdir -p "$version_dir"
install -m 755 "$bin" "$version_dir/rayu"
if [[ -x "$bridge_bin" ]]; then
  install -m 755 "$bridge_bin" "$version_dir/rayucode-harness-api-bridge"
fi
for notice in LICENSE THIRD_PARTY_NOTICES; do
  if [[ -f "$repo_root/$notice" ]]; then
    install -m 644 "$repo_root/$notice" "$version_dir/$notice"
  fi
done

# Update stable symlink
stable_dir="$builds_dir/stable"
mkdir -p "$stable_dir"
ln -sfn "$version_dir/rayu" "$stable_dir/rayu"
if [[ -x "$version_dir/rayucode-harness-api-bridge" ]]; then
  ln -sfn "$version_dir/rayucode-harness-api-bridge" "$stable_dir/rayucode-harness-api-bridge"
fi

# Update stable-version marker
printf '%s\n' "$hash" > "$builds_dir/stable-version"

# Update current symlink + marker
current_dir="$builds_dir/current"
mkdir -p "$current_dir"
ln -sfn "$version_dir/rayu" "$current_dir/rayu"
if [[ -x "$version_dir/rayucode-harness-api-bridge" ]]; then
  ln -sfn "$version_dir/rayucode-harness-api-bridge" "$current_dir/rayucode-harness-api-bridge"
fi
printf '%s\n' "$hash" > "$builds_dir/current-version"

# Update launcher path to current channel (+ rayucode alias + harness API bridge)
install_dir="${RAYU_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$install_dir"
ln -sfn "$current_dir/rayu" "$install_dir/rayu"
ln -sfn "$current_dir/rayu" "$install_dir/rayucode"
if [[ -x "$current_dir/rayucode-harness-api-bridge" ]]; then
  ln -sfn "$current_dir/rayucode-harness-api-bridge" "$install_dir/rayucode-harness-api-bridge"
fi

echo "Installed: $version_dir/rayu"
echo "Updated stable symlink: $stable_dir/rayu -> $version_dir/rayu"
echo "Updated current symlink: $current_dir/rayu -> $version_dir/rayu"
echo "Updated launcher symlink: $install_dir/rayu -> $current_dir/rayu"
echo "Updated alias symlink: $install_dir/rayucode -> $current_dir/rayu"
if [[ -x "$current_dir/rayucode-harness-api-bridge" ]]; then
  echo "Installed bridge: $version_dir/rayucode-harness-api-bridge"
  echo "Updated bridge symlink: $install_dir/rayucode-harness-api-bridge -> $current_dir/rayucode-harness-api-bridge"
fi

# Configure supported desktop launch hotkeys as part of installation. This is
# idempotent and best-effort because headless installs may not expose a desktop
# session; the first interactive launch retries automatically.
case "$(uname -s)" in
  Darwin)
    if "$install_dir/rayu" setup-launcher </dev/null >/dev/null 2>&1; then
      echo "Installed macOS launcher and turn-notification broker."
    fi
    if "$install_dir/rayu" setup-hotkey </dev/null >/dev/null 2>&1; then
      echo "Configured system-wide rayu launch hotkeys (when supported)."
    fi
    ;;
  Linux)
    if "$install_dir/rayu" setup-hotkey </dev/null >/dev/null 2>&1; then
      echo "Configured system-wide rayu launch hotkeys (when supported)."
    fi
    ;;
esac

# Gracefully reload any running background server onto the binary we just
# installed (issue #291). `server reload` only reloads when the running daemon
# is genuinely older, hands live headless/swarm sessions to the new process, and
# is a no-op when no server is running, so it is safe to call unconditionally.
if [ "${RAYU_SKIP_SERVER_RELOAD:-}" != "1" ]; then
  if "$install_dir/rayu" server reload </dev/null >/dev/null 2>&1; then
    echo "Reloaded the running rayu server onto $hash (if one was active)."
  fi
fi

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$install_dir"; then
  echo ""
  echo "Tip: add $install_dir to PATH if needed."
fi

# Ensure the launcher dir is on PATH for bash, zsh and fish in future shells.
# shellcheck source=scripts/lib/configure_path.sh
. "$(dirname "$0")/lib/configure_path.sh"
rayu_configure_path "$install_dir"
