//! Minimal dependency-free 5-field UTC cron expression parser & evaluator.
//!
//! Supports standard `minute hour day-of-month month day-of-week` expressions
//! with wildcards (`*`), steps (`*/n`, `a-b/n`), ranges (`a-b`), lists (`a,b`),
//! and common aliases (`@hourly`, `@daily`, `@midnight`, `@weekly`, `@weekdays`,
//! `@monthly`).

use anyhow::{Result, bail};
use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CronSchedule {
    pub expr: String,
    minutes: [bool; 60],
    hours: [bool; 24],
    dom: [bool; 32],
    months: [bool; 13],
    dow: [bool; 7],
    dom_wildcard: bool,
    dow_wildcard: bool,
}

impl CronSchedule {
    pub fn parse(raw: &str) -> Result<Self> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            bail!("Cron expression cannot be empty");
        }
        let normalized = match trimmed.to_ascii_lowercase().as_str() {
            "@hourly" => "0 * * * *",
            "@daily" | "@midnight" => "0 0 * * *",
            "@weekly" => "0 0 * * 0",
            "@weekdays" => "0 9 * * 1-5",
            "@monthly" => "0 0 1 * *",
            _ => trimmed,
        };

        let fields: Vec<&str> = normalized.split_whitespace().collect();
        if fields.len() != 5 {
            bail!(
                "Invalid cron expression `{trimmed}`: expected 5 fields (minute hour dom month dow) or an alias (@hourly, @daily, @weekly, @weekdays, @monthly)"
            );
        }

        let mut minutes = [false; 60];
        let mut hours = [false; 24];
        let mut dom = [false; 32];
        let mut months = [false; 13];
        let mut dow = [false; 7];

        parse_field(fields[0], 0, 59, false, &mut minutes)?;
        parse_field(fields[1], 0, 23, false, &mut hours)?;
        parse_field(fields[2], 1, 31, false, &mut dom)?;
        parse_field(fields[3], 1, 12, false, &mut months)?;
        parse_field(fields[4], 0, 7, true, &mut dow)?;

        let dom_wildcard = fields[2] == "*";
        let dow_wildcard = fields[4] == "*";

        Ok(Self {
            expr: trimmed.to_string(),
            minutes,
            hours,
            dom,
            months,
            dow,
            dom_wildcard,
            dow_wildcard,
        })
    }

    /// Return the next matching UTC timestamp strictly after `after`.
    pub fn next_after(&self, after: DateTime<Utc>) -> Result<DateTime<Utc>> {
        // Truncate to minute boundary and step forward by 1 minute.
        let mut candidate = Utc
            .with_ymd_and_hms(
                after.year(),
                after.month(),
                after.day(),
                after.hour(),
                after.minute(),
                0,
            )
            .single()
            .ok_or_else(|| anyhow::anyhow!("Invalid reference timestamp"))?
            + Duration::minutes(1);

        let limit = candidate + Duration::days(366 * 4);
        while candidate <= limit {
            let month = candidate.month() as usize;
            if !self.months[month] {
                candidate = advance_month(candidate)?;
                continue;
            }
            let day = candidate.day() as usize;
            let weekday = candidate.weekday().num_days_from_sunday() as usize;
            let day_matches = if self.dom_wildcard && self.dow_wildcard {
                true
            } else if self.dom_wildcard {
                self.dow[weekday]
            } else if self.dow_wildcard {
                self.dom[day]
            } else {
                self.dom[day] || self.dow[weekday]
            };
            if !day_matches {
                candidate = advance_day(candidate)?;
                continue;
            }
            let hour = candidate.hour() as usize;
            if !self.hours[hour] {
                candidate = advance_hour(candidate)?;
                continue;
            }
            let minute = candidate.minute() as usize;
            if !self.minutes[minute] {
                candidate += Duration::minutes(1);
                continue;
            }
            return Ok(candidate);
        }
        bail!(
            "Cron expression `{}` produced no matching time within 4 years",
            self.expr
        )
    }
}

pub fn describe_cron(raw: &str) -> String {
    let trimmed = raw.trim();
    match trimmed.to_ascii_lowercase().as_str() {
        "@hourly" => return "Every hour (UTC)".to_string(),
        "@daily" | "@midnight" => return "Daily at 00:00 UTC".to_string(),
        "@weekly" => return "Weekly on Sun at 00:00 UTC".to_string(),
        "@weekdays" => return "Weekdays at 09:00 UTC".to_string(),
        "@monthly" => return "Monthly on day 1 at 00:00 UTC".to_string(),
        _ => {}
    }
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() != 5 {
        return format!("Cron `{trimmed}`");
    }
    let (min, hour, dom, mon, dow) = (parts[0], parts[1], parts[2], parts[3], parts[4]);
    if let Some(step) = min.strip_prefix("*/")
        && hour == "*"
        && dom == "*"
        && mon == "*"
        && dow == "*"
    {
        return format!("Every {step} min");
    }
    if min == "0" && hour == "*" && dom == "*" && mon == "*" && dow == "*" {
        return "Every hour (UTC)".to_string();
    }
    if let (Ok(m), Ok(h)) = (min.parse::<u32>(), hour.parse::<u32>())
        && dom == "*"
        && mon == "*"
    {
        let hhmm = format!("{h:02}:{m:02} UTC");
        return match dow {
            "*" => format!("Daily at {hhmm}"),
            "1-5" => format!("Weekdays at {hhmm}"),
            "0,6" | "6,0" => format!("Weekends at {hhmm}"),
            "0" | "7" => format!("Sundays at {hhmm}"),
            "1" => format!("Mondays at {hhmm}"),
            "2" => format!("Tuesdays at {hhmm}"),
            "3" => format!("Wednesdays at {hhmm}"),
            "4" => format!("Thursdays at {hhmm}"),
            "5" => format!("Fridays at {hhmm}"),
            "6" => format!("Saturdays at {hhmm}"),
            _ => format!("Cron `{trimmed}` (UTC)"),
        };
    }
    format!("Cron `{trimmed}` (UTC)")
}

fn parse_field(
    field: &str,
    min: usize,
    max: usize,
    wrap_seven_to_zero: bool,
    out: &mut [bool],
) -> Result<()> {
    for part in field.split(',') {
        let part = part.trim();
        if part.is_empty() {
            bail!("Empty segment in cron field `{field}`");
        }
        let (range_part, step) = match part.split_once('/') {
            Some((r, s)) => {
                let step: usize = s
                    .parse()
                    .map_err(|_| anyhow::anyhow!("Invalid cron step `{s}` in `{field}`"))?;
                if step == 0 {
                    bail!("Cron step cannot be 0 in `{field}`");
                }
                (r, step)
            }
            None => (part, 1),
        };
        let (start, end) = if range_part == "*" {
            (min, if wrap_seven_to_zero { 6 } else { max })
        } else if let Some((a, b)) = range_part.split_once('-') {
            let a = parse_bound(a, min, max, wrap_seven_to_zero)?;
            let b = parse_bound(b, min, max, wrap_seven_to_zero)?;
            if a > b {
                bail!("Invalid cron range `{range_part}` in `{field}`");
            }
            (a, b)
        } else {
            let val = parse_bound(range_part, min, max, wrap_seven_to_zero)?;
            if part.contains('/') {
                (val, if wrap_seven_to_zero { 6 } else { max })
            } else {
                (val, val)
            }
        };
        let mut cur = start;
        while cur <= end {
            let idx = if wrap_seven_to_zero && cur == 7 {
                0
            } else {
                cur
            };
            if idx < out.len() {
                out[idx] = true;
            }
            cur += step;
        }
    }
    if !out.iter().any(|&v| v) {
        bail!("Cron field `{field}` matched no values");
    }
    Ok(())
}

fn parse_bound(raw: &str, min: usize, max: usize, wrap_seven_to_zero: bool) -> Result<usize> {
    let val: usize = raw
        .trim()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid cron number `{raw}`"))?;
    if val < min || val > max {
        bail!("Cron value `{val}` out of range ({min}..={max})");
    }
    if wrap_seven_to_zero && val == 7 {
        return Ok(0);
    }
    Ok(val)
}

fn advance_hour(dt: DateTime<Utc>) -> Result<DateTime<Utc>> {
    let truncated = Utc
        .with_ymd_and_hms(dt.year(), dt.month(), dt.day(), dt.hour(), 0, 0)
        .single()
        .ok_or_else(|| anyhow::anyhow!("Invalid timestamp"))?;
    Ok(truncated + Duration::hours(1))
}

fn advance_day(dt: DateTime<Utc>) -> Result<DateTime<Utc>> {
    let truncated = Utc
        .with_ymd_and_hms(dt.year(), dt.month(), dt.day(), 0, 0, 0)
        .single()
        .ok_or_else(|| anyhow::anyhow!("Invalid timestamp"))?;
    Ok(truncated + Duration::days(1))
}

fn advance_month(dt: DateTime<Utc>) -> Result<DateTime<Utc>> {
    let (year, month) = if dt.month() == 12 {
        (dt.year() + 1, 1)
    } else {
        (dt.year(), dt.month() + 1)
    };
    Utc.with_ymd_and_hms(year, month, 1, 0, 0, 0)
        .single()
        .ok_or_else(|| anyhow::anyhow!("Invalid timestamp"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_and_alias_expressions() {
        let base = Utc.with_ymd_and_hms(2026, 11, 28, 8, 15, 30).unwrap(); // Saturday

        let every_15 = CronSchedule::parse("*/15 * * * *").unwrap();
        assert_eq!(
            every_15.next_after(base).unwrap(),
            Utc.with_ymd_and_hms(2026, 11, 28, 8, 30, 0).unwrap()
        );

        let weekdays = CronSchedule::parse("0 9 * * 1-5").unwrap();
        // Saturday -> next Monday Nov 30 at 09:00 UTC
        assert_eq!(
            weekdays.next_after(base).unwrap(),
            Utc.with_ymd_and_hms(2026, 11, 30, 9, 0, 0).unwrap()
        );

        let alias_weekdays = CronSchedule::parse("@weekdays").unwrap();
        assert_eq!(
            alias_weekdays.next_after(base).unwrap(),
            Utc.with_ymd_and_hms(2026, 11, 30, 9, 0, 0).unwrap()
        );

        let daily = CronSchedule::parse("@daily").unwrap();
        assert_eq!(
            daily.next_after(base).unwrap(),
            Utc.with_ymd_and_hms(2026, 11, 29, 0, 0, 0).unwrap()
        );
    }

    #[test]
    fn rejects_invalid_expressions() {
        assert!(CronSchedule::parse("").is_err());
        assert!(CronSchedule::parse("* * *").is_err());
        assert!(CronSchedule::parse("60 * * * *").is_err());
        assert!(CronSchedule::parse("*/0 * * * *").is_err());
        assert!(CronSchedule::parse("0 25 * * *").is_err());
    }

    #[test]
    fn describes_common_patterns() {
        assert_eq!(describe_cron("0 9 * * 1-5"), "Weekdays at 09:00 UTC");
        assert_eq!(describe_cron("30 7 * * *"), "Daily at 07:30 UTC");
        assert_eq!(describe_cron("*/15 * * * *"), "Every 15 min");
        assert_eq!(describe_cron("@hourly"), "Every hour (UTC)");
    }
}
