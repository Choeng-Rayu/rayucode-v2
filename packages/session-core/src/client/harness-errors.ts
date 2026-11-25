export interface ErrorSettlementTrackerLike {
  startedAtMs: number;
  turnActive: boolean;
  turnCompleted: boolean;
  batchEpoch: number;
  hasStreamedTextInPhase: boolean;
  lastCredits: string;
  lastKvCachePct: number;
}

export interface SettledErrorEvents {
  message: string;
  elapsedSec: number;
  workedDuration: string;
  credits: string;
  kvCachePct: number;
}

export function formatElapsedDuration(totalSec: number): string {
  const safe = Math.max(1, Math.floor(totalSec));
  if (safe < 60) return `${safe}s`;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function extractHarnessErrorMessage(
  frame: Record<string, unknown>,
  fallback = "The request failed."
): string {
  const candidates = [frame.message, frame.error, frame.detail, frame.reason];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

/**
 * Shared terminal settlement helper for `ev: "error"` frames (and synthetic
 * socket-close failures) so neither Desktop nor VS Code ever drops errors into
 * `default: return []` and leaves `Working · 5m 8s` spinning forever.
 */
export function settleHarnessErrorFrame(
  frame: Record<string, unknown>,
  tracker: ErrorSettlementTrackerLike,
  resetPhase?: () => void
): SettledErrorEvents | null {
  if (tracker.turnCompleted && !tracker.turnActive) {
    return null;
  }
  const message = extractHarnessErrorMessage(frame);
  const elapsedSec = Math.max(
    1,
    Math.floor((Date.now() - (tracker.startedAtMs || Date.now())) / 1000)
  );
  tracker.turnCompleted = true;
  tracker.turnActive = false;
  tracker.batchEpoch = 1;
  tracker.hasStreamedTextInPhase = false;
  resetPhase?.();

  return {
    message,
    elapsedSec,
    workedDuration: formatElapsedDuration(elapsedSec),
    credits: tracker.lastCredits,
    kvCachePct: tracker.lastKvCachePct,
  };
}
