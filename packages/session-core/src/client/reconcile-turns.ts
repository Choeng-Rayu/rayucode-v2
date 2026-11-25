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

function normalizeAnswerForDedup(answer?: string | null): string {
  return (answer ?? "").trim().replace(/\s+/g, " ");
}

function answersMatchForDedup(
  a?: string | null,
  b?: string | null
): boolean {
  const na = normalizeAnswerForDedup(a);
  const nb = normalizeAnswerForDedup(b);
  if (!na && !nb) return true;
  if (!na || !nb) return false;
  if (na === nb) return true;
  const minLen = Math.min(na.length, nb.length);
  if (minLen >= 16) {
    return (
      na.startsWith(nb) ||
      nb.startsWith(na) ||
      na.includes(nb) ||
      nb.includes(na)
    );
  }
  return false;
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
  baseHistoryTurnCount?: number,
  claimedIndices?: ReadonlySet<number>
): number {
  const byId = historyTurns.findIndex(
    (t, idx) => t.id === candidate.id && !claimedIndices?.has(idx)
  );
  if (byId >= 0) return byId;

  const candidatePrompt = normalizePromptForDedup(candidate.userPrompt);
  if (!candidatePrompt) {
    // Daemon-initiated settled turn without a local userPrompt: match by answer against the trailing turn.
    if (!candidate.isLive && normalizeAnswerForDedup(candidate.answerMarkdown).length >= 16) {
      const lastIdx = historyTurns.length - 1;
      if (
        lastIdx >= 0 &&
        !claimedIndices?.has(lastIdx) &&
        answersMatchForDedup(
          historyTurns[lastIdx].answerMarkdown,
          candidate.answerMarkdown
        )
      ) {
        return lastIdx;
      }
    }
    return -1;
  }

  if (typeof baseHistoryTurnCount === "number" && baseHistoryTurnCount >= 0) {
    // Only inspect turns at or after the submission watermark
    for (let i = historyTurns.length - 1; i >= baseHistoryTurnCount; i -= 1) {
      if (claimedIndices?.has(i)) continue;
      if (normalizePromptForDedup(historyTurns[i].userPrompt) === candidatePrompt) {
        return i;
      }
    }
    return -1;
  }

  // Active live turn without watermark: only match the trailing history stub.
  if (candidate.isLive) {
    const lastIdx = historyTurns.length - 1;
    if (
      lastIdx >= 0 &&
      !claimedIndices?.has(lastIdx) &&
      normalizePromptForDedup(historyTurns[lastIdx].userPrompt) === candidatePrompt
    ) {
      return lastIdx;
    }
    return -1;
  }

  // Settled turn without watermark (e.g. completedLiveTurns):
  // scan backwards for an unclaimed history turn with matching prompt and either
  // no persisted assistant output yet OR matching/overlapping assistant output.
  for (let i = historyTurns.length - 1; i >= 0; i -= 1) {
    if (claimedIndices?.has(i)) continue;
    const historyTurn = historyTurns[i];
    if (normalizePromptForDedup(historyTurn.userPrompt) !== candidatePrompt) {
      continue;
    }
    if (!hasAssistantContent(historyTurn)) {
      return i;
    }
    if (answersMatchForDedup(historyTurn.answerMarkdown, candidate.answerMarkdown)) {
      return i;
    }
    if (
      i === historyTurns.length - 1 &&
      !normalizeAnswerForDedup(candidate.answerMarkdown) &&
      hasAssistantContent(historyTurn)
    ) {
      return i;
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
 * 2. Preserves intentional repeated identical prompts via `baseHistoryTurnCount` and 1-to-1 matching.
 * 3. Keeps a settled `liveTurn` / `completedLiveTurn` visible until durable history actually
 *    contains the assistant output, then retires the local copy so it never renders twice.
 */
export function reconcileChatTurns<TTurn extends ReconcilableTurnLike>(
  input: ReconcileChatTurnsInput<TTurn>
): TTurn[] {
  const merged: TTurn[] = [...input.historyTurns];
  const claimedIndices = new Set<number>();

  // Reconcile recently settled live turns first (if history hasn't refetched yet)
  for (const completed of input.completedLiveTurns ?? []) {
    const matchIdx = findMatchingHistoryIndex(
      merged,
      completed,
      undefined,
      claimedIndices
    );
    if (matchIdx >= 0) {
      claimedIndices.add(matchIdx);
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
