import {
  rayuCreditsLabel,
  rayuCreditsTooltip,
  type ResponseStats,
} from "@rayu-dev/rayucode-sdk/browser";
import { CoinsIcon } from "./Icons.js";

export interface TurnCreditsFooterProps {
  stats?: ResponseStats;
  liveCredits?: number;
  streaming?: boolean;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/**
 * Shared per-turn completion footer showing canonical Rayu credits (identical
 * to CLI/TUI formatting via `@rayu-dev/rayucode-sdk/browser`), duration, and
 * token counts.
 */
export function TurnCreditsFooter({ stats, liveCredits, streaming }: TurnCreditsFooterProps) {
  const credits = streaming ? liveCredits : stats?.rayu_credits ?? liveCredits;
  const hasCredits = typeof credits === "number" && Number.isFinite(credits) && credits >= 0;
  const hasTokens =
    typeof stats?.input_tokens === "number" || typeof stats?.output_tokens === "number";
  const hasDuration = typeof stats?.duration_secs === "number" && stats.duration_secs > 0;

  if (!hasCredits && !hasTokens && !hasDuration) {
    return null;
  }

  return (
    <footer className="rc-credits-footer" data-testid="turn-credits-footer">
      {hasCredits ? (
        <span
          className="rc-credits-pill"
          title={rayuCreditsTooltip(credits!)}
          data-testid="turn-credits-label"
        >
          <CoinsIcon size={13} />
          {rayuCreditsLabel(credits!, { soFar: Boolean(streaming) })}
        </span>
      ) : null}
      {hasDuration ? <span>{stats!.duration_secs!.toFixed(1)}s</span> : null}
      {hasTokens ? (
        <span>
          {typeof stats?.input_tokens === "number"
            ? `${formatTokenCount(stats.input_tokens)} in`
            : ""}
          {typeof stats?.input_tokens === "number" && typeof stats?.output_tokens === "number"
            ? " · "
            : ""}
          {typeof stats?.output_tokens === "number"
            ? `${formatTokenCount(stats.output_tokens)} out`
            : ""}
        </span>
      ) : null}
    </footer>
  );
}
