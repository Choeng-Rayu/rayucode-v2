#!/usr/bin/env bash
set -euo pipefail

# Run Terminal-Bench through Harbor with rayu using Opus 4.8.
# Default route is OpenRouter (anthropic/claude-opus-4.8) since native Claude
# OAuth may be unavailable. Override with RAYU_TB_MODEL / env vars.

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
DEFAULT_BINARY_DIR=${RAYU_HARBOR_BINARY_DIR:-/tmp/rayu-compat-dist}
DEFAULT_BINARY_PATH=${RAYU_HARBOR_BINARY:-$DEFAULT_BINARY_DIR/rayu-linux-x86_64.bin}
DEFAULT_MODEL=${RAYU_TB_MODEL:-anthropic-api/claude-opus-4-8}
DEFAULT_PATH=${RAYU_TB_PATH:-/tmp/terminal-bench-2.1}

have_model=0
have_agent_import=0
have_task_source=0

for arg in "$@"; do
  case "$arg" in
    --model|-m)
      have_model=1
      ;;
    --agent-import-path)
      have_agent_import=1
      ;;
    --path|-p|--dataset|-d|--task|-t)
      have_task_source=1
      ;;
  esac
done

if [[ ! -x "$DEFAULT_BINARY_PATH" ]]; then
  echo "Building Linux-compatible rayu binary into $DEFAULT_BINARY_DIR" >&2
  "$REPO_ROOT/scripts/build_linux_compat.sh" "$DEFAULT_BINARY_DIR"
fi

# Resolve provider keys from rayu's env files if not already set.
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  OR_ENV=${RAYU_HARBOR_OPENROUTER_ENV:-$HOME/.config/rayucode/openrouter.env}
  if [[ -f "$OR_ENV" ]]; then
    export RAYU_HARBOR_OPENROUTER_ENV="$OR_ENV"
  fi
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  ANT_ENV=${RAYU_HARBOR_ANTHROPIC_ENV:-$HOME/.config/rayucode/anthropic.env}
  if [[ -f "$ANT_ENV" ]]; then
    export RAYU_HARBOR_ANTHROPIC_ENV="$ANT_ENV"
  fi
fi

export PYTHONPATH="$REPO_ROOT/scripts${PYTHONPATH:+:$PYTHONPATH}"
export RAYU_HARBOR_BINARY="$DEFAULT_BINARY_PATH"
export RAYU_ANTHROPIC_REASONING_EFFORT=${RAYU_ANTHROPIC_REASONING_EFFORT:-high}
export RAYU_NO_TELEMETRY=${RAYU_NO_TELEMETRY:-1}

HARBOR_BIN=${RAYU_HARBOR_BIN:-harbor}

cmd=($HARBOR_BIN run)
if [[ $have_task_source -eq 0 ]]; then
  cmd+=(--path "$DEFAULT_PATH")
fi
if [[ $have_agent_import -eq 0 ]]; then
  cmd+=(--agent-import-path rayucode_harbor_claude_agent:RayuClaudeHarborAgent)
fi
if [[ $have_model -eq 0 ]]; then
  cmd+=(--model "$DEFAULT_MODEL")
fi
cmd+=("$@")

{
  echo "Running Harbor with rayu Opus 4.8 adapter"
  echo "  binary: $RAYU_HARBOR_BINARY"
  echo "  model:  ${DEFAULT_MODEL}"
} >&2

exec "${cmd[@]}"
