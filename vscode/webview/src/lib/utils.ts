import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function basenameOf(rawPath?: string | null): string {
  if (!rawPath) return "workspace";
  const parts = rawPath.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || "workspace";
}

export function formatDurationSeconds(secs?: number): string {
  if (!secs || secs <= 0) return "1s";
  if (secs < 60) return `${Math.max(1, Math.round(secs))}s`;
  const mins = Math.floor(secs / 60);
  const rem = Math.round(secs % 60);
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

export function formatRelativeTime(timestampMs?: number, nowMs = Date.now()): string {
  if (!timestampMs) return "just now";
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSec < 45) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  const diffMo = Math.floor(diffDay / 30);
  return `${diffMo}mo`;
}
