/**
 * Pure per-model reasoning effort ladder resolution and display label
 * formatting shared by Desktop and VS Code.
 *
 * Reads `supported_efforts` / `default_effort` strictly from the engine's
 * `ModelRouteInfo` with zero hardcoded model tables and zero fabricated
 * `"auto"` entries.
 */

export interface EffortRouteLike {
  supported_efforts?: readonly string[] | null;
  default_effort?: string | null;
  /** Optional camelCase aliases for client-normalized route objects. */
  supportedEfforts?: readonly string[] | null;
  defaultEffort?: string | null;
}

export interface EffortLadder {
  supported: boolean;
  stops: string[];
  defaultStop: string | null;
}

export type EffortLabelVariant = "header" | "tick";

const EFFORT_LABELS: Record<string, { header: string; tick: string }> = {
  none: { header: "Off", tick: "Off" },
  minimal: { header: "Minimal", tick: "Minimal" },
  low: { header: "Low", tick: "Low" },
  medium: { header: "Medium", tick: "Medium" },
  high: { header: "High", tick: "High" },
  xhigh: { header: "Extra High", tick: "X-High" },
  max: { header: "Max", tick: "Max" },
};

function toTitleCase(raw: string): string {
  return raw
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Resolve the dynamic effort ladder for a model route.
 *
 * - Defensively filters out TUI-only `swarm*` sentinels and empty entries.
 * - Never fabricates `"auto"`.
 * - Returns `{ supported: false, stops: [], defaultStop: null }` when the
 *   model does not support configurable reasoning effort.
 */
export function resolveEffortLadder(
  route: EffortRouteLike | null | undefined,
): EffortLadder {
  if (!route) {
    return { supported: false, stops: [], defaultStop: null };
  }

  const rawStops = route.supported_efforts ?? route.supportedEfforts ?? [];
  const seen = new Set<string>();
  const stops: string[] = [];

  for (const entry of rawStops) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    // Defensively exclude TUI-only `swarm*` sentinels.
    if (lower.startsWith("swarm")) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    stops.push(trimmed);
  }

  if (stops.length === 0) {
    return { supported: false, stops: [], defaultStop: null };
  }

  const rawDefault = (route.default_effort ?? route.defaultEffort ?? "")
    .trim()
    .toLowerCase();

  const matchedDefault = rawDefault
    ? stops.find((stop) => stop.toLowerCase() === rawDefault)
    : undefined;

  const defaultStop =
    matchedDefault ??
    stops.find((stop) => stop.toLowerCase() === "medium") ??
    stops.find((stop) => stop.toLowerCase() === "low") ??
    stops[0] ??
    null;

  return {
    supported: true,
    stops,
    defaultStop,
  };
}

/**
 * Format an engine reasoning effort stop for UI display.
 *
 * - `none` -> `"Off"`
 * - `minimal` -> `"Minimal"`
 * - `low` -> `"Low"`
 * - `medium` -> `"Medium"`
 * - `high` -> `"High"`
 * - `xhigh` -> `"Extra High"` (`"header"`) / `"X-High"` (`"tick"`)
 * - `max` -> `"Max"`
 * - Unknown future engine stops fall back to Title Case.
 */
export function formatEffortLabel(
  stop: string,
  variant: EffortLabelVariant = "header",
): string {
  const normalized = stop.trim().toLowerCase();
  if (!normalized) return "";
  const known = EFFORT_LABELS[normalized];
  if (known) {
    return known[variant];
  }
  return toTitleCase(stop);
}
