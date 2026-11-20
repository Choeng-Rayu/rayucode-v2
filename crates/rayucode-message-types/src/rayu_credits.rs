//! Canonical Rayu per-request charge parsing, drift-free accumulation, and
//! display formatting shared by CLI, TUI, headless JSON, harness API, and
//! desktop apps.
//!
//! The Rayu gateway prices every hosted request with the exact arithmetic it
//! bills with and publishes the charge in a `rayu` JSON member:
//!
//! - Anthropic Messages SSE stream: on the `message_delta` event
//! - Non-streaming JSON response: on the top-level response body
//!
//! ```json
//! "rayu": { "billableTokens": 443760, "tokensPerCredit": 1000, "credits": 443.76 }
//! ```
//!
//! Older gateways and bring-your-own-key providers publish no `rayu` member;
//! those always parse as `None` ("no charge reported"), never as `0.0`.
//!
//! Sums are kept in integer millionths of a credit (`MICRO_CREDITS_PER_CREDIT`)
//! so long multi-tool / multi-agent turns accumulate thousands of calls with
//! zero floating-point drift and constant memory.

use serde::{Deserialize, Serialize};

/// Resolution for drift-free credit summation (1 credit = 1,000,000 micro-credits).
pub const MICRO_CREDITS_PER_CREDIT: u64 = 1_000_000;

/// Below this positive value a charge would round to `"0.00"`, so it renders as `"<0.01"`.
const SMALLEST_SHOWN_CREDITS: f64 = 0.005;

/// At or above this threshold credits switch to compact notation (`1k`, `2.5k`, `1.2M`).
const COMPACT_FROM_CREDITS: f64 = 1000.0;

const COMPACT_UNITS: &[(f64, &str)] = &[(1e3, "k"), (1e6, "M"), (1e9, "B")];

/// Settled credit charge reported by the Rayu gateway for a single API request.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RayuRequestCharge {
    pub credits: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billable_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_per_credit: Option<u64>,
}

impl RayuRequestCharge {
    /// Parse a gateway `rayu` JSON object.
    ///
    /// Accepts both the gateway's camelCase fields (`billableTokens`,
    /// `tokensPerCredit`, `credits`) and snake_case equivalents. When `credits`
    /// is omitted (for example on hosted media endpoints), derives
    /// `billableTokens / tokensPerCredit` when `tokensPerCredit > 0`.
    pub fn from_json_value(value: &serde_json::Value) -> Option<Self> {
        let obj = value.as_object()?;
        let billable_tokens = obj
            .get("billableTokens")
            .or_else(|| obj.get("billable_tokens"))
            .and_then(json_non_negative_u64);
        let tokens_per_credit = obj
            .get("tokensPerCredit")
            .or_else(|| obj.get("tokens_per_credit"))
            .and_then(json_non_negative_u64);

        let credits = obj
            .get("credits")
            .and_then(json_non_negative_f64)
            .or_else(|| {
                let billable = obj
                    .get("billableTokens")
                    .or_else(|| obj.get("billable_tokens"))
                    .and_then(json_non_negative_f64)?;
                let per_credit = obj
                    .get("tokensPerCredit")
                    .or_else(|| obj.get("tokens_per_credit"))
                    .and_then(json_non_negative_f64)?;
                (per_credit > 0.0).then_some(billable / per_credit)
            })?;

        if !credits.is_finite() || credits < 0.0 {
            return None;
        }

        Some(Self {
            credits,
            billable_tokens,
            tokens_per_credit,
        })
    }

    /// Extract a charge from a whole JSON response body (`body.rayu`).
    pub fn from_response_body(body: &serde_json::Value) -> Option<Self> {
        body.get("rayu").and_then(Self::from_json_value)
    }

    /// Charge converted to integer millionths of a credit.
    pub fn micro_credits(&self) -> u64 {
        credits_to_micro(self.credits).unwrap_or(0)
    }
}

/// Drift-free accumulator for Rayu credits across one or more requests in a turn.
///
/// Tracks `charges` separately from `micro_credits` so a turn that made no
/// Rayu-billed requests yields `None` (hide credits UI), whereas a turn that
/// ran on a zero-priced Rayu model yields `Some(0.0)` (`Credits: 0.00`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RayuCreditsAccumulator {
    micro_credits: u64,
    charges: u64,
}

impl RayuCreditsAccumulator {
    pub const fn new() -> Self {
        Self {
            micro_credits: 0,
            charges: 0,
        }
    }

    /// Record a single non-negative finite credit charge. Returns `true` if recorded.
    pub fn record_credits(&mut self, credits: f64) -> bool {
        let Some(micro) = credits_to_micro(credits) else {
            return false;
        };
        self.micro_credits = self.micro_credits.saturating_add(micro);
        self.charges = self.charges.saturating_add(1);
        true
    }

    /// Record a parsed gateway request charge.
    pub fn record_charge(&mut self, charge: RayuRequestCharge) -> bool {
        self.record_credits(charge.credits)
    }

    /// Synchronize with a server-authoritative running turn total (e.g. for
    /// remote TUI / desktop clients that may attach mid-turn).
    pub fn sync_turn_total(&mut self, turn_credits: f64) -> bool {
        let Some(micro) = credits_to_micro(turn_credits) else {
            return false;
        };
        self.micro_credits = micro;
        self.charges = self.charges.max(1);
        true
    }

    /// Merge another accumulator (for example from a subagent or tool round).
    pub fn merge(&mut self, other: Self) {
        self.micro_credits = self.micro_credits.saturating_add(other.micro_credits);
        self.charges = self.charges.saturating_add(other.charges);
    }

    /// Reset to the uncharged state.
    pub fn reset(&mut self) {
        self.micro_credits = 0;
        self.charges = 0;
    }

    /// Number of charged requests recorded in this window.
    pub const fn charges(&self) -> u64 {
        self.charges
    }

    /// True when no charged request has been recorded yet.
    pub const fn is_empty(&self) -> bool {
        self.charges == 0
    }

    /// Total micro-credits if at least one request reported a charge.
    pub const fn micro_credits(&self) -> Option<u64> {
        if self.charges == 0 {
            None
        } else {
            Some(self.micro_credits)
        }
    }

    /// Total credits if at least one request reported a charge.
    pub fn total_credits(&self) -> Option<f64> {
        self.micro_credits()
            .map(|micro| micro as f64 / MICRO_CREDITS_PER_CREDIT as f64)
    }

    /// Ready-to-render label (`"Credits: 443.76"` or `"Credits so far: 1.3k"`),
    /// or `None` when nothing has been charged.
    pub fn formatted_label(&self, so_far: bool) -> Option<String> {
        self.total_credits()
            .map(|credits| rayu_credits_label(credits, so_far))
    }
}

/// Format a credit amount for compact display across CLI, TUI, and desktop UIs.
///
/// Rules (matching RayuCode's canonical display contract):
/// - zero, negative, or non-finite → `"0.00"`
/// - `0 < x < 0.005` → `"<0.01"`
/// - below `1,000` (after cent rounding) → two decimals (`"443.76"`)
/// - `1,000` and up → compact unit (`"1k"`, `"2.5k"`, `"12.8k"`, `"200k"`, `"1M"`, `"1.3M"`, `"1B"`)
pub fn format_rayu_credits(credits: f64) -> String {
    if !credits.is_finite() || credits <= 0.0 {
        return "0.00".to_string();
    }
    if credits < SMALLEST_SHOWN_CREDITS {
        return "<0.01".to_string();
    }
    if (credits * 100.0).round() < COMPACT_FROM_CREDITS * 100.0 {
        return format!("{credits:.2}");
    }
    compact_credits(credits)
}

/// Ready-to-render label shared across CLI, TUI, and desktop completion footers:
/// `"Credits: 443.76"` (final) or `"Credits so far: 1.2k"` (while work continues).
pub fn rayu_credits_label(credits: f64, so_far: bool) -> String {
    let prefix = if so_far { "Credits so far" } else { "Credits" };
    format!("{prefix}: {}", format_rayu_credits(credits))
}

/// Unrounded micro-credit string with thousands separators (e.g. `"200,000.07"`,
/// `"0.00125"`, `"0"`) suitable for desktop tooltips and debug logs.
pub fn format_rayu_credits_exact(credits: f64) -> String {
    if !credits.is_finite() || credits <= 0.0 {
        return "0".to_string();
    }
    let Some(micro) = credits_to_micro(credits) else {
        return "0".to_string();
    };
    let whole = micro / MICRO_CREDITS_PER_CREDIT;
    let frac = micro % MICRO_CREDITS_PER_CREDIT;
    let whole_grouped = group_thousands(whole);
    if frac == 0 {
        whole_grouped
    } else {
        let frac_str = format!("{frac:06}");
        let trimmed = frac_str.trim_end_matches('0');
        format!("{whole_grouped}.{trimmed}")
    }
}

/// Tooltip sentence for desktop/editor UIs showing the exact unrounded charge.
pub fn rayu_credits_tooltip(credits: f64) -> String {
    format!(
        "Rayu credits charged for this request: {}",
        format_rayu_credits_exact(credits)
    )
}

fn compact_credits(credits: f64) -> String {
    for (idx, &(size, suffix)) in COMPACT_UNITS.iter().enumerate() {
        let scaled = credits / size;
        let rounded = if scaled < 99.95 {
            (scaled * 10.0).round() / 10.0
        } else {
            scaled.round()
        };
        let is_last = idx + 1 == COMPACT_UNITS.len();
        if rounded < 1000.0 || is_last {
            return format!("{}{suffix}", trim_zero_decimal(rounded));
        }
    }
    format!("{credits}")
}

fn trim_zero_decimal(value: f64) -> String {
    if (value - value.trunc()).abs() < f64::EPSILON {
        format!("{}", value as u64)
    } else {
        format!("{value:.1}")
    }
}

fn group_thousands(whole: u64) -> String {
    let digits = whole.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        let remaining = digits.len() - i;
        if i > 0 && remaining % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

fn credits_to_micro(credits: f64) -> Option<u64> {
    if !credits.is_finite() || credits < 0.0 {
        return None;
    }
    let scaled = (credits * MICRO_CREDITS_PER_CREDIT as f64).round();
    if !scaled.is_finite() || scaled < 0.0 || scaled > u64::MAX as f64 {
        return None;
    }
    Some(scaled as u64)
}

fn json_non_negative_f64(value: &serde_json::Value) -> Option<f64> {
    let n = value.as_f64()?;
    (n.is_finite() && n >= 0.0).then_some(n)
}

fn json_non_negative_u64(value: &serde_json::Value) -> Option<u64> {
    if let Some(u) = value.as_u64() {
        return Some(u);
    }
    let n = value.as_f64()?;
    if n.is_finite() && n >= 0.0 && (n - n.trunc()).abs() < f64::EPSILON && n <= u64::MAX as f64 {
        Some(n as u64)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gateway_rayu_member_and_derives_when_credits_absent() {
        let full = serde_json::json!({
            "billableTokens": 443760,
            "tokensPerCredit": 1000,
            "credits": 443.76
        });
        let charge = RayuRequestCharge::from_json_value(&full).expect("valid charge");
        assert_eq!(charge.credits, 443.76);
        assert_eq!(charge.billable_tokens, Some(443_760));
        assert_eq!(charge.tokens_per_credit, Some(1_000));

        let derived = serde_json::json!({
            "billableTokens": 2500,
            "tokensPerCredit": 1000
        });
        let derived_charge = RayuRequestCharge::from_json_value(&derived).expect("derived");
        assert_eq!(derived_charge.credits, 2.5);

        let body = serde_json::json!({
            "id": "msg_1",
            "rayu": { "billableTokens": 0, "tokensPerCredit": 1000, "credits": 0 }
        });
        let free_charge = RayuRequestCharge::from_response_body(&body).expect("zero charge");
        assert_eq!(free_charge.credits, 0.0);

        // Missing or invalid values return None, never zero.
        assert!(RayuRequestCharge::from_json_value(&serde_json::json!({})).is_none());
        assert!(
            RayuRequestCharge::from_json_value(&serde_json::json!({ "credits": -1.0 })).is_none()
        );
        assert!(
            RayuRequestCharge::from_json_value(
                &serde_json::json!({ "billableTokens": 100, "tokensPerCredit": 0 })
            )
            .is_none()
        );
        assert!(RayuRequestCharge::from_response_body(&serde_json::json!({"id": "old"})).is_none());
    }

    #[test]
    fn formats_credits_matching_rayu_cli_contract() {
        assert_eq!(format_rayu_credits(0.0), "0.00");
        assert_eq!(format_rayu_credits(-5.0), "0.00");
        assert_eq!(format_rayu_credits(f64::NAN), "0.00");
        assert_eq!(format_rayu_credits(0.0001), "<0.01");
        assert_eq!(format_rayu_credits(0.0049), "<0.01");
        assert_eq!(format_rayu_credits(0.005), "0.01");
        assert_eq!(format_rayu_credits(443.76), "443.76");
        assert_eq!(format_rayu_credits(999.994), "999.99");
        assert_eq!(format_rayu_credits(999.996), "1k");
        assert_eq!(format_rayu_credits(1_000.0), "1k");
        assert_eq!(format_rayu_credits(2_000.0), "2k");
        assert_eq!(format_rayu_credits(2_500.0), "2.5k");
        assert_eq!(format_rayu_credits(12_800.0), "12.8k");
        assert_eq!(format_rayu_credits(99_900.0), "99.9k");
        assert_eq!(format_rayu_credits(100_000.0), "100k");
        assert_eq!(format_rayu_credits(200_000.07), "200k");
        assert_eq!(format_rayu_credits(999_999.99), "1M");
        assert_eq!(format_rayu_credits(1_250_000.0), "1.3M");
        assert_eq!(format_rayu_credits(1_000_000_000.0), "1B");

        assert_eq!(rayu_credits_label(443.76, false), "Credits: 443.76");
        assert_eq!(rayu_credits_label(2_500.0, true), "Credits so far: 2.5k");
        assert_eq!(format_rayu_credits_exact(200_000.07), "200,000.07");
        assert_eq!(format_rayu_credits_exact(0.00125), "0.00125");
        assert_eq!(
            rayu_credits_tooltip(443.76),
            "Rayu credits charged for this request: 443.76"
        );
    }

    #[test]
    fn accumulator_handles_5000_calls_without_drift_or_pruning() {
        let mut acc = RayuCreditsAccumulator::new();
        assert_eq!(acc.total_credits(), None);
        assert_eq!(acc.formatted_label(false), None);

        for _ in 0..5_000 {
            assert!(acc.record_credits(0.1));
        }
        assert_eq!(acc.charges(), 5_000);
        assert_eq!(acc.total_credits(), Some(500.0));
        assert_eq!(
            acc.formatted_label(false).as_deref(),
            Some("Credits: 500.00")
        );

        // Distinct zero-priced charge vs uncharged.
        let mut free = RayuCreditsAccumulator::new();
        assert!(free.record_credits(0.0));
        assert_eq!(free.total_credits(), Some(0.0));
        assert_eq!(
            free.formatted_label(false).as_deref(),
            Some("Credits: 0.00")
        );
    }
}
