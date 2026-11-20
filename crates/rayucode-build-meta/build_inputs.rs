use std::ffi::OsStr;
use std::path::Path;

/// Recover the base-tag distance forwarded by a source-only hosted build.
#[allow(dead_code)]
pub fn base_tag_offset(description: &str, base: (u32, u32, u32)) -> Option<u32> {
    let tag = format!("v{}.{}.{}", base.0, base.1, base.2);
    let description = description.trim();
    if description == tag {
        return Some(0);
    }
    let suffix = description.strip_prefix(&format!("{tag}-"))?;
    let (count, hash) = suffix.split_once("-g")?;
    if count.is_empty()
        || !count.bytes().all(|byte| byte.is_ascii_digit())
        || hash.is_empty()
        || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    count.bytes().try_fold(0u32, |offset, digit| {
        offset.checked_mul(10)?.checked_add(u32::from(digit - b'0'))
    })
}

/// Accept release identities without accepting arbitrary environment text.
pub fn release_semver(value: &str) -> Option<String> {
    let value = value.trim().strip_prefix('v').unwrap_or(value.trim());
    let (core, prerelease) = match value.split_once('-') {
        Some((core, suffix)) => (core, Some(suffix)),
        None => (value, None),
    };
    let components: Vec<_> = core.split('.').collect();
    if components.len() != 3 || components.iter().any(|part| !numeric_component(part)) {
        return None;
    }
    if let Some(suffix) = prerelease
        && !suffix.split('.').all(prerelease_identifier)
    {
        return None;
    }
    Some(value.to_string())
}

fn prerelease_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        // Preserve the release identity policy that numeric identifiers start at 1.
        && (!value.bytes().all(|byte| byte.is_ascii_digit()) || !value.starts_with('0'))
}

/// Extract the numeric core of a package or build version, ignoring its prerelease.
#[allow(dead_code)] // Used by build.rs, not runtime release identity parsing.
pub fn semver_core(value: &str) -> Option<(u32, u32, u32)> {
    let trimmed = value.trim().trim_start_matches('v');
    let core = trimmed.split_once('-').map_or(trimmed, |(core, _)| core);
    let mut parts = core.split('.');
    let (Ok(major), Ok(minor), Ok(patch)) = (
        parts.next()?.parse(),
        parts.next()?.parse(),
        parts.next()?.parse(),
    ) else {
        // Invalid and overflowing components are not semantic versions.
        return None;
    };
    Some((major, minor, patch))
}

fn numeric_component(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
        && value.parse::<u64>().is_ok()
}

/// Snapshot contents are build inputs even when no Git checkout is available.
#[allow(dead_code)] // Used by build.rs, but not by the runtime identity parser.
pub fn metadata_rerun_inputs(path: Option<&OsStr>) -> Vec<String> {
    let mut inputs = vec![
        "cargo:rerun-if-env-changed=RAYU_BUILD_METADATA_FILE".to_owned(),
        "cargo:rerun-if-env-changed=RAYU_BUILD_CHANGELOG_RAW".to_owned(),
        "cargo:rerun-if-changed=build_inputs.rs".to_owned(),
    ];
    if let Some(path) = path {
        inputs.push(format!(
            "cargo:rerun-if-changed={}",
            Path::new(path).display()
        ));
    }
    inputs
}

/// Parse a boolean build flag (`true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`).
#[allow(dead_code)] // Used by build.rs and unit tests.
pub fn parse_bool_flag(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Some(true),
        "false" | "0" | "no" | "off" => Some(false),
        _ => None,
    }
}

/// Read the last value assigned to `target_key` from `.env`-formatted text.
///
/// Supports optional `export ` prefix, blank/comment lines, `\r\n` endings,
/// single/double quotes, and inline `#` comments on unquoted values.
#[allow(dead_code)] // Used by build.rs and unit tests.
pub fn read_dotenv_value(contents: &str, target_key: &str) -> Option<String> {
    let mut found = None;
    for (idx, raw_line) in contents.lines().enumerate() {
        let line = if idx == 0 {
            raw_line.strip_prefix('\u{feff}').unwrap_or(raw_line)
        } else {
            raw_line
        };
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let body = trimmed
            .strip_prefix("export")
            .filter(|rest| rest.starts_with(char::is_whitespace))
            .map(str::trim_start)
            .unwrap_or(trimmed);
        let Some((key, raw_value)) = body.split_once('=') else {
            continue;
        };
        if key.trim() != target_key {
            continue;
        }
        found = Some(parse_dotenv_rhs(raw_value));
    }
    found
}

fn parse_dotenv_rhs(raw_value: &str) -> String {
    let trimmed = raw_value.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
        let mut out = String::new();
        let mut chars = rest.chars();
        while let Some(ch) = chars.next() {
            match ch {
                '\\' => {
                    if let Some(next) = chars.next() {
                        out.push(next);
                    }
                }
                '"' => break,
                other => out.push(other),
            }
        }
        return out;
    }
    if let Some(rest) = trimmed.strip_prefix('\'') {
        return rest.split_once('\'').map_or(rest, |(val, _)| val).to_string();
    }
    // Strip inline `#` comment on unquoted values when `#` is at the start or
    // preceded by whitespace.
    let mut end = trimmed.len();
    let mut prev_ws = true;
    for (byte_idx, ch) in trimmed.char_indices() {
        if ch == '#' && prev_ws {
            end = byte_idx;
            break;
        }
        prev_ws = ch.is_whitespace();
    }
    trimmed[..end].trim().to_string()
}

/// Resolve compile-time `ENABLE_OTHER_PROVIDER` with precedence:
/// 1. Explicit process env `ENABLE_OTHER_PROVIDER` (when non-empty)
/// 2. Workspace `.env` `ENABLE_OTHER_PROVIDER` (when non-empty)
/// 3. Default `true`
///
/// Returns `(enabled, optional_warning)`.
#[allow(dead_code)] // Used by build.rs and unit tests.
pub fn resolve_enable_other_provider(
    env_value: Option<&str>,
    dotenv_contents: Option<&str>,
) -> (bool, Option<String>) {
    if let Some(raw) = env_value.map(str::trim).filter(|v| !v.is_empty()) {
        return match parse_bool_flag(raw) {
            Some(value) => (value, None),
            None => (
                true,
                Some(format!(
                    "Invalid ENABLE_OTHER_PROVIDER env value {:?}; expected true/false, defaulting to true",
                    raw
                )),
            ),
        };
    }

    if let Some(contents) = dotenv_contents
        && let Some(raw) = read_dotenv_value(contents, "ENABLE_OTHER_PROVIDER")
        && !raw.trim().is_empty()
    {
        return match parse_bool_flag(&raw) {
            Some(value) => (value, None),
            None => (
                true,
                Some(format!(
                    "Invalid ENABLE_OTHER_PROVIDER value {:?} in .env; expected true/false, defaulting to true",
                    raw
                )),
            ),
        };
    }

    (true, None)
}

/// Normalize an optional `RAYU_FALLBACK_MODEL` value.
///
/// Empty/whitespace strings return `None` (unspecified; fall through to lower
/// precedence). Explicit disable sentinels (`none`, `off`, `auto`, `default`)
/// return `Some(None)` so higher-precedence env values can disable a `.env`
/// default without falling through.
#[allow(dead_code)] // Used by build.rs and unit tests.
pub fn normalize_fallback_model_value(raw: &str) -> Option<Option<String>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if matches!(
        trimmed.to_ascii_lowercase().as_str(),
        "none" | "off" | "auto" | "default"
    ) {
        return Some(None);
    }
    Some(Some(trimmed.to_string()))
}

/// Resolve compile-time `RAYU_FALLBACK_MODEL` with precedence:
/// 1. Explicit process env `RAYU_FALLBACK_MODEL` (when non-empty)
/// 2. Workspace `.env` `RAYU_FALLBACK_MODEL` (when non-empty)
/// 3. `None` (use default fallback ranking)
#[allow(dead_code)] // Used by build.rs and unit tests.
pub fn resolve_fallback_model(
    env_value: Option<&str>,
    dotenv_contents: Option<&str>,
) -> Option<String> {
    if let Some(raw) = env_value
        && let Some(resolved) = normalize_fallback_model_value(raw)
    {
        return resolved;
    }

    if let Some(contents) = dotenv_contents
        && let Some(raw) = read_dotenv_value(contents, "RAYU_FALLBACK_MODEL")
        && let Some(resolved) = normalize_fallback_model_value(&raw)
    {
        return resolved;
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_base_tag_distance() {
        let base = (0, 99, 1);
        assert_eq!(base_tag_offset("v0.99.1-42-gabc1234", base), Some(42));
        assert_eq!(base_tag_offset("v0.99.1-0-gabc1234", base), Some(0));
        assert_eq!(base_tag_offset("v0.99.1", base), Some(0));
        for invalid in [
            "v0.98.1-42-gabc1234",
            "abc1234",
            "v0.99.1-x-gabc",
            "v0.99.1-42-g",
            "v0.99.1-42-gxyz",
            "v0.99.1-4294967296-gabc",
        ] {
            assert_eq!(base_tag_offset(invalid, base), None, "{invalid}");
        }
    }

    #[test]
    fn release_identity_accepts_stable_and_prereleases() {
        for value in [
            "1.2.3",
            "1.0.0-preview.1",
            "1.0.0-preview.123",
            "1.2.3-rc.1",
            "0.99.2-dist.7",
            "1.1.0-preview.1",
            "1.0.0-preview.1-dev",
            "1.2.3-alpha-beta",
            "1.2.3-01a",
            "1.2.3-18446744073709551616",
        ] {
            assert_eq!(release_semver(value).as_deref(), Some(value));
        }
        assert_eq!(
            release_semver(" v1.0.0-preview.2 ").as_deref(),
            Some("1.0.0-preview.2")
        );
        for value in [
            "1.2",
            "1.2.3.4",
            "1.0.0-preview.0",
            "1.0.0-preview.01",
            "1.2.3-rc.0",
            "1.2.3-dist.01",
            "1.2.3-",
            "1.2.3-rc..1",
            "1.2.3-rc.1.",
            "1.2.3-rc_1",
            "1.2.3-rc.1\nINJECT=1",
            "01.0.0",
            "1.0.0\nINJECT=1",
        ] {
            assert_eq!(release_semver(value), None, "{value}");
        }
    }

    #[test]
    fn package_and_build_prereleases_preserve_numeric_core() {
        for value in ["0.95.1", "0.95.1-rc.7", " v0.95.1-preview.2 "] {
            assert_eq!(semver_core(value), Some((0, 95, 1)), "{value}");
        }
        assert_eq!(semver_core("1.2.3-rc.1"), Some((1, 2, 3)));
        for value in ["1.2", "1.2.beta-rc.1", "4294967296.1.2-rc.1"] {
            assert_eq!(semver_core(value), None, "{value}");
        }
    }

    #[test]
    fn no_snapshot_still_tracks_metadata_environment() {
        let inputs = metadata_rerun_inputs(None);
        assert!(inputs.contains(&"cargo:rerun-if-env-changed=RAYU_BUILD_METADATA_FILE".into()));
        assert!(inputs.contains(&"cargo:rerun-if-env-changed=RAYU_BUILD_CHANGELOG_RAW".into()));
        assert_eq!(inputs.len(), 3);
    }

    #[test]
    fn snapshot_contents_are_tracked_without_git() {
        let inputs = metadata_rerun_inputs(Some(OsStr::new(".rayu-release-metadata/build.txt")));
        assert!(inputs.contains(&"cargo:rerun-if-changed=.rayu-release-metadata/build.txt".into()));
        assert_eq!(inputs.len(), 4);
    }

    #[test]
    fn dotenv_enable_other_provider_parsing_and_precedence() {
        assert_eq!(resolve_enable_other_provider(None, None), (true, None));
        assert_eq!(
            resolve_enable_other_provider(Some("false"), Some("ENABLE_OTHER_PROVIDER=true")),
            (false, None)
        );
        assert_eq!(
            resolve_enable_other_provider(Some("true"), Some("ENABLE_OTHER_PROVIDER=false")),
            (true, None)
        );
        assert_eq!(
            resolve_enable_other_provider(Some(""), Some("ENABLE_OTHER_PROVIDER=false\r\n")),
            (false, None)
        );

        let dotenv = "\u{feff}# leading comment\r\n\
            USE_RAYU_OAUTH=true\r\n\
            ENABLE_OTHER_PROVIDER=true # first\r\n\
            export ENABLE_OTHER_PROVIDER=\"false\" # last wins\r\n";
        assert_eq!(
            read_dotenv_value(dotenv, "ENABLE_OTHER_PROVIDER").as_deref(),
            Some("false")
        );
        assert_eq!(
            resolve_enable_other_provider(None, Some(dotenv)),
            (false, None)
        );

        let single_quoted = "ENABLE_OTHER_PROVIDER='0' # comment";
        assert_eq!(
            resolve_enable_other_provider(None, Some(single_quoted)),
            (false, None)
        );

        let unquoted_comment = "ENABLE_OTHER_PROVIDER=no # rayu only";
        assert_eq!(
            resolve_enable_other_provider(None, Some(unquoted_comment)),
            (false, None)
        );

        let (enabled, warning) =
            resolve_enable_other_provider(None, Some("ENABLE_OTHER_PROVIDER=maybe"));
        assert!(enabled);
        assert!(warning.is_some());
    }

    #[test]
    fn dotenv_fallback_model_parsing_and_precedence() {
        assert_eq!(resolve_fallback_model(None, None), None);
        assert_eq!(
            resolve_fallback_model(
                None,
                Some("RAYU_FALLBACK_MODEL=deepseek-v4.1-flash-1017-cloud # ctrl+y\n")
            )
            .as_deref(),
            Some("deepseek-v4.1-flash-1017-cloud")
        );
        assert_eq!(
            resolve_fallback_model(
                Some("qwen4-max-preview"),
                Some("RAYU_FALLBACK_MODEL=deepseek-v4.1-flash-1017-cloud\n")
            )
            .as_deref(),
            Some("qwen4-max-preview")
        );
        assert_eq!(
            resolve_fallback_model(
                Some("none"),
                Some("RAYU_FALLBACK_MODEL=deepseek-v4.1-flash-1017-cloud\n")
            ),
            None
        );
        assert_eq!(
            resolve_fallback_model(
                Some(""),
                Some("export RAYU_FALLBACK_MODEL=\"deepseek-v4.1-flash-1017-cloud\"\r\n")
            )
            .as_deref(),
            Some("deepseek-v4.1-flash-1017-cloud")
        );
    }
}
