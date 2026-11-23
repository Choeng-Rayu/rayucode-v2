#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${1:?Usage: scripts/dispatch-opencode.sh <task-id> <provider/model> <prompt-file> [ref-image...]}"
MODEL="${2:?provider/model required}"
PROMPT_FILE="${3:?prompt file required}"
shift 3

mkdir -p .swarm-logs/verify

HEADER="AUTONOMOUS SWARM WORKER (${TASK_ID}):
1. Read DESIGN.md, AGENTS.md, desktop/src/styles/globals.css, and target prototype/*.html first.
2. Run: node desktop/scripts/check-shadcn.mjs check <primitives...> --json before coding.
3. Execute end-to-end without stopping for minor questions.
4. Pass: cd desktop && pnpm verify (typecheck, lint, lint:design, test, build).
5. Capture verification screenshots at 1440x934 into .swarm-logs/verify/${TASK_ID}-*.png and compare against prototype/.
6. Stage & commit ONLY your owned files on swarm/${TASK_ID}."

TMP_PROMPT="$(mktemp)"
trap 'rm -f "${TMP_PROMPT}"' EXIT
{
  printf '%s\n\n---\n\n' "${HEADER}"
  cat "${PROMPT_FILE}"
} > "${TMP_PROMPT}"

echo "[dispatch] task=${TASK_ID} model=${MODEL} refs=$#"
exec opencode run --pure --auto -m "${MODEL}" -f "${TMP_PROMPT}" "$@"
