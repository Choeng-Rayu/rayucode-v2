# How to Compile and Run `rayucode-v2`

```bash
cd /home/rayu/rayu/rayucode-v2
```

## 1. Build & Install (Recommended)

Fast release build (updates `~/.local/bin/rayu` & `rayucode`, and reloads any running `rayu` daemon):

```bash
umask 022 && bash scripts/install_release.sh --fast
```

Full LTO release build (slower, maximum optimization):

```bash
umask 022 && bash scripts/install_release.sh
```

> Add `CARGO_NET_OFFLINE=true` if building offline.

## 2. Build Only (Without Installing)

```bash
# Debug build
cargo build --locked --bin rayu

# Release build
cargo build --release --locked --bin rayu
```

## 3. Run

```bash
# Interactive TUI (installed binary)
rayu

# Interactive TUI (direct from build output)
./target/release/rayu

# One-shot prompt (plain, JSON, or streaming NDJSON)
rayu run "Say hello"
rayu run --json "Say hello"
rayu run --ndjson "Say hello"

# Authenticate with Rayu account or API key
rayu login --provider rayu
# Or via env var:
RAYU_API_KEY=rayu_sk_live_... rayu
```

## 4. Useful Commands

```bash
# Check installed version
rayu --version

# Reload running shared server onto the newest installed build
rayu server reload

# Run quick offline unit tests
cargo test --offline -p rayucode-message-types -- rayu_credits
cargo test --offline -p rayucode-provider-rayu-runtime
cargo test --offline -p rayucode-harness-api
```
