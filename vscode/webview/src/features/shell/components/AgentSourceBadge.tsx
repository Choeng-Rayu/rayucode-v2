import * as React from "react";
import {
  formatSessionSourceLabel,
  normalizeSessionSource,
  sessionSourceToFilterGroup,
  type SessionSourceFilter,
} from "@rayu-dev/rayucode-session-core/client";

import { cn } from "@/lib/utils";

export interface AgentSourceBadgeProps {
  source?: string | null;
  className?: string;
  showLabel?: boolean;
}

/**
 * Monochrome brand mark for each synced coding agent.
 * Uses `currentColor` + semantic CSS tokens (no raw hex, no UI emojis).
 */
export function AgentSourceIcon({
  source,
  className,
}: {
  source?: string | null;
  className?: string;
}) {
  const group: Exclude<SessionSourceFilter, "all"> =
    sessionSourceToFilterGroup(source);

  switch (group) {
    case "claude":
      // Sunburst mark representing Claude Code / Claude Desktop
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", className)}
        >
          <path
            d="M8 1.75v3.1M8 11.15v3.1M1.75 8h3.1M11.15 8h3.1M3.58 3.58l2.2 2.2M10.22 10.22l2.2 2.2M12.42 3.58l-2.2 2.2M5.78 10.22l-2.2 2.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
        </svg>
      );
    case "codex":
      // Hexagonal neural knot mark representing OpenAI Codex
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", className)}
        >
          <path
            d="M8 1.8L13.2 4.8v6.4L8 14.2 2.8 11.2V4.8L8 1.8Z"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
          <path
            d="M6.3 6.2L4.9 8l1.4 1.8M9.7 6.2L11.1 8l-1.4 1.8M8.5 5.6l-1 4.8"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "cursor":
      // Cursor chevron/pointer prism mark
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", className)}
        >
          <path
            d="M3.2 2.6L13.2 7.2L8.4 8.9L6.8 13.4L3.2 2.6Z"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "opencode":
      // OpenCode bracket mark
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", className)}
        >
          <rect
            x="2.2"
            y="3"
            width="11.6"
            height="10"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.35"
          />
          <path
            d="M5.4 6.5L7.4 8l-2 1.5M8.6 9.5h2.2"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "pi":
      // Pi glyph mark
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", className)}
        >
          <path
            d="M3.2 4.5h9.6M5.8 4.5v6.8c0 .8-.4 1.2-1 1.2M10.2 4.5v6.6c0 .8.4 1.4 1.2 1.4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "rayu":
    default:
      // RayuCode geometric diamond spark
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", className)}
        >
          <path
            d="M8 2L13.5 8L8 14L2.5 8L8 2Z"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" />
        </svg>
      );
  }
}

export function AgentSourceBadge({
  source,
  className,
  showLabel = false,
}: AgentSourceBadgeProps) {
  const normalized = normalizeSessionSource(source);
  const label = formatSessionSourceLabel(normalized);
  const isNative = normalized === "rayu";

  return (
    <span
      data-testid={`agent-source-badge-${normalized}`}
      title={isNative ? "RayuCode session" : `Synced from ${label}`}
      aria-label={isNative ? "RayuCode" : `Synced from ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-none",
        isNative ? "text-muted-ink" : "bg-control text-ink",
        className,
      )}
    >
      <AgentSourceIcon
        source={normalized}
        className={cn("size-3", isNative ? "text-brand-text" : "text-ink")}
      />
      {showLabel && <span className="truncate font-medium">{label}</span>}
    </span>
  );
}
