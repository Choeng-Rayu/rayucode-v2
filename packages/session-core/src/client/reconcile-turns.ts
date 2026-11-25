export interface ReconcilableTurnLike {
  id: string;
  userPrompt: string;
  answerMarkdown?: string;
  isLive?: boolean;
  steps?: readonly unknown[];
  workGroups?: readonly unknown[];
  toolGroups?: readonly unknown[];
}

export interface ReconcileChatTurnsInput<TTurn extends ReconcilableTurnLike> {
  historyTurns: readonly TTurn[];
  liveTurn: TTurn | null | undefined;
  completedLiveTurns?: readonly TTurn[];
  /**
   * Number of history turns that existed at the moment `liveTurn` was submitted.
   * Ensures we only match/retire against turns created AFTER submission, so a
   * user intentionally sending the exact same prompt twice in a row keeps both turns.
   */
  baseHistoryTurnCount?: number;
}

export interface StaleLiveTurnCheckInput {
  liveTurn: ReconcilableTurnLike | null | undefined;
  sessionStatus?: string | null;
  lastEventAtMs?: number;
  nowMs?: number;
  gracePeriodMs?: number;
}

export function normalizePromptForDedup(prompt?: string | null): string {
  return (prompt ?? "").trim().replace(/\s+/g, " ");
}

function hasAssistantContent(turn: ReconcilableTurnLike): boolean {
  if (turn.answerMarkdown && turn.answerMarkdown.trim().length > 0) {
    return true;
  }
  if (Array.isArray(turn.steps) && turn.steps.length > 0) {
    return true;
  }
  if (Array.isArray(turn.workGroups) && turn.workGroups.length > 0) {
    return true;
  }
  if (Array.isArray(turn.toolGroups) && turn.toolGroups.length > 0) {
    return true;
  }
  return false;
}

function findMatchingHistoryIndex<TTurn extends ReconcilableTurnLike>(
  historyTurns: readonly TTurn[],
  candidate: TTurn,
  baseHistoryTurnCount?: number
): number {
  const byId = historyTurns.findIndex((t) => t.id === candidate.id);
  if (byId >= 0) return byId;

  const candidatePrompt = normalizePromptForDedup(candidate.userPrompt);
  if (!candidatePrompt) return -1;

  if (typeof baseHistoryTurnCount === "number" && baseHistoryTurnCount >= 0) {
    // Only inspect turns at or after the submission watermark
    for (let i = historyTurns.length - 1; i >= baseHistoryTurnCount; i -= 1) {
      if (normalizePromptForDedup(historyTurns[i].userPrompt) === candidatePrompt) {
        return i;
      }
    }
    return -1;
  }

  // Fallback when caller did not capture baseHistoryTurnCount:
  // only match the very last history turn when it matches the prompt
  // AND either the live turn is still active or the history turn has no assistant output yet.
  const lastIdx = historyTurns.length - 1;
  if (lastIdx >= 0) {
    const lastTurn = historyTurns[lastIdx];
    if (normalizePromptForDedup(lastTurn.userPrompt) === candidatePrompt) {
      if (candidate.isLive || !hasAssistantContent(lastTurn)) {
        return lastIdx;
      }
    }
  }
  return -1;
}

/**
 * Reconciles durable `sessions.history` turns with local optimistic/streaming turns.
 *
 * Guarantees:
 * 1. Never renders a duplicate user prompt bubble when `sessions.history` resolves
 *    while a turn is still streaming (replaces the empty/stub history turn with `liveTurn`).
 * 2. Preserves intentional repeated identical prompts via `baseHistoryTurnCount`.
 * 3. Keeps a settled `liveTurn` visible until durable history actually contains
 *    the assistant output (preventing blank flash between `turn_done` and refetch).
 */
export function reconcileChatTurns<TTurn extends ReconcilableTurnLike>(
  input: ReconcileChatTurnsInput<TTurn>
): TTurn[] {
  const merged: TTurn[] = [...input.historyTurns];

  // Reconcile recently settled live turns first (if history hasn't refetched yet)
  for (const completed of input.completedLiveTurns ?? []) {
    const matchIdx = findMatchingHistoryIndex(merged, completed);
    if (matchIdx >= 0) {
      if (!hasAssistantContent(merged[matchIdx]) && hasAssistantContent(completed)) {
        merged[matchIdx] = completed;
      }
      // Otherwise durable history already has this completed turn -> retire local copy
    } else {
      merged.push(completed);
    }
  }

  const live = input.liveTurn;
  if (!live) {
    return merged;
  }

  const matchIdx = findMatchingHistoryIndex(
    merged,
    live,
    input.baseHistoryTurnCount
  );

  if (matchIdx >= 0) {
    const historyEntry = merged[matchIdx];
    if (live.isLive) {
      // Live stream is authoritative over the incomplete history stub
      merged[matchIdx] = live;
    } else if (!hasAssistantContent(historyEntry) && hasAssistantContent(live)) {
      // History has not persisted the final answer yet -> keep settled live turn
      merged[matchIdx] = live;
    }
    // Else: liveTurn is settled and durable history already contains the response -> retire liveTurn
    return merged;
  }

  merged.push(live);
  return merged;
}

/**
 * Determines whether a live streaming turn is stale because the daemon reports
 * the session as `idle` and no stream frames have arrived within the grace window.
 */
export function shouldClearStaleLiveTurn(
  input: StaleLiveTurnCheckInput
): boolean {
  if (!input.liveTurn?.isLive) return false;
  const status = (input.sessionStatus ?? "").trim().toLowerCase();
  if (status !== "idle") return false;
  const now = input.nowMs ?? Date.now();
  const grace = input.gracePeriodMs ?? 2_500;
  const lastEvent = input.lastEventAtMs ?? 0;
  return now - lastEvent >= grace;
}
