#!/usr/bin/env bash
# Populate the platform npm packages from rayu release tarballs.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <release-assets-directory>" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
assets="$(cd "$1" && pwd)"

prepare() {
  local package="$1" archive="$2" archived_binary="$3" installed_binary="$4"
  local package_dir="$repo_root/sdk/npm/$package"
  python3 "$repo_root/scripts/verify_public_release.py" --check-archive "$assets/$archive"
  rm -rf "$package_dir/bin"
  mkdir -p "$package_dir/bin"
  tar -xzf "$assets/$archive" -C "$package_dir/bin"
  mv "$package_dir/bin/$archived_binary" "$package_dir/bin/$installed_binary"
  chmod +x "$package_dir/bin/$installed_binary"
  mv "$package_dir/bin/LICENSE" "$package_dir/LICENSE"
  mv "$package_dir/bin/THIRD_PARTY_NOTICES" "$package_dir/THIRD_PARTY_NOTICES"
  mv "$package_dir/bin/dependency-inventory.json" "$package_dir/dependency-inventory.json"
}

prepare linux-x64 rayu-linux-x86_64.tar.gz rayu-linux-x86_64 rayu
prepare linux-arm64 rayu-linux-aarch64.tar.gz rayu-linux-aarch64 rayu
prepare darwin-x64 rayu-macos-x86_64.tar.gz rayu-macos-x86_64 rayu
prepare darwin-arm64 rayu-macos-aarch64.tar.gz rayu-macos-aarch64 rayu
prepare win32-x64 rayu-windows-x86_64.tar.gz rayu-windows-x86_64.exe rayu.exe
prepare win32-arm64 rayu-windows-aarch64.tar.gz rayu-windows-aarch64.exe rayu.exe
