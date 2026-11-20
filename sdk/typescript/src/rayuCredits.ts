/**
 * Canonical Rayu credit charge parsing, drift-free accumulation, and display
 * formatting for TypeScript/Electron/Web/Desktop apps.
 *
 * Mirrors `crates/rayucode-message-types/src/rayu_credits.rs` byte-for-byte
 * so CLI, TUI, and desktop front ends always display identical credit figures.
 */

export const MICRO_CREDITS_PER_CREDIT = 1_000_000;

const SMALLEST_SHOWN_CREDITS = 0.005;
const COMPACT_FROM_CREDITS = 1000;
const COMPACT_UNITS = [
  { size: 1e3, suffix: "k" },
  { size: 1e6, suffix: "M" },
  { size: 1e9, suffix: "B" },
] as const;

export interface RayuRequestCharge {
  credits: number;
  billableTokens?: number;
  tokensPerCredit?: number;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Parse a gateway `rayu` charge object, deriving `billableTokens / tokensPerCredit` when needed. */
export function parseRayuRequestCharge(member: unknown): RayuRequestCharge | undefined {
  if (typeof member !== "object" || member === null) return undefined;
  const obj = member as Record<string, unknown>;
  const rawBillable = obj.billableTokens ?? obj.billable_tokens;
  const rawPerCredit = obj.tokensPerCredit ?? obj.tokens_per_credit;
  const billableTokens = isNonNegativeNumber(rawBillable) ? rawBillable : undefined;
  const tokensPerCredit = isNonNegativeNumber(rawPerCredit) ? rawPerCredit : undefined;

  let credits: number | undefined;
  if (isNonNegativeNumber(obj.credits)) {
    credits = obj.credits;
  } else if (
    billableTokens !== undefined &&
    tokensPerCredit !== undefined &&
    tokensPerCredit > 0
  ) {
    credits = billableTokens / tokensPerCredit;
  }

  if (credits === undefined || !Number.isFinite(credits) || credits < 0) return undefined;
  return { credits, billableTokens, tokensPerCredit };
}

/** Format a credit total identically to CLI/TUI (`"443.76"`, `"<0.01"`, `"2.5k"`, `"1.3M"`). */
export function formatRayuCredits(credits: number): string {
  if (!Number.isFinite(credits) || credits <= 0) return "0.00";
  if (credits < SMALLEST_SHOWN_CREDITS) return "<0.01";
  if (Math.round(credits * 100) < COMPACT_FROM_CREDITS * 100) {
    return credits.toFixed(2);
  }
  for (let i = 0; i < COMPACT_UNITS.length; i++) {
    const { size, suffix } = COMPACT_UNITS[i]!;
    const scaled = credits / size;
    const rounded = scaled < 99.95 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
    const isLast = i === COMPACT_UNITS.length - 1;
    if (rounded < 1000 || isLast) {
      const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return `${text}${suffix}`;
    }
  }
  return `${credits}`;
}

/** Ready-to-render completion label (`"Credits: 443.76"` or `"Credits so far: 2.5k"`). */
export function rayuCreditsLabel(credits: number, options: { soFar?: boolean } = {}): string {
  return `${options.soFar ? "Credits so far" : "Credits"}: ${formatRayuCredits(credits)}`;
}

/** Exact micro-credit string with comma grouping (`"200,000.07"`, `"0.00125"`) for tooltips. */
export function formatRayuCreditsExact(credits: number): string {
  if (!Number.isFinite(credits) || credits <= 0) return "0";
  const micro = Math.round(credits * MICRO_CREDITS_PER_CREDIT);
  const whole = Math.floor(micro / MICRO_CREDITS_PER_CREDIT);
  const frac = micro % MICRO_CREDITS_PER_CREDIT;
  const wholeGrouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (frac === 0) return wholeGrouped;
  const trimmed = String(frac).padStart(6, "0").replace(/0+$/, "");
  return `${wholeGrouped}.${trimmed}`;
}

/** Desktop/editor tooltip sentence showing the exact unrounded charge. */
export function rayuCreditsTooltip(credits: number): string {
  return `Rayu credits charged for this request: ${formatRayuCreditsExact(credits)}`;
}

/** Drift-free micro-credit accumulator for custom client-side aggregation windows. */
export class RayuCreditsAccumulator {
  private microCredits = 0;
  private chargeCount = 0;

  recordCredits(credits: number): boolean {
    if (!isNonNegativeNumber(credits)) return false;
    this.microCredits += Math.round(credits * MICRO_CREDITS_PER_CREDIT);
    this.chargeCount += 1;
    return true;
  }

  syncTurnTotal(turnCredits: number): boolean {
    if (!isNonNegativeNumber(turnCredits)) return false;
    this.microCredits = Math.round(turnCredits * MICRO_CREDITS_PER_CREDIT);
    this.chargeCount = Math.max(this.chargeCount, 1);
    return true;
  }

  reset(): void {
    this.microCredits = 0;
    this.chargeCount = 0;
  }

  get charges(): number {
    return this.chargeCount;
  }

  get totalCredits(): number | undefined {
    return this.chargeCount === 0 ? undefined : this.microCredits / MICRO_CREDITS_PER_CREDIT;
  }

  formattedLabel(options: { soFar?: boolean } = {}): string | undefined {
    const total = this.totalCredits;
    return total === undefined ? undefined : rayuCreditsLabel(total, options);
  }
}
