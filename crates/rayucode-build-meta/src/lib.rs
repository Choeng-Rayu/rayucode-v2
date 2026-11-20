//! Build and runtime version metadata for RayuCode.
//!
//! The build script (`build.rs`) computes git- and version-derived values and
//! emits them via `cargo:rustc-env`. Most binaries use those compile-time values.
//! A fast local release may wrap an already-built selfdev binary and set
//! `RAYU_RUNTIME_RELEASE_SEMVER`; the accessor functions below then present the
//! tagged release identity without recompiling the dependency graph solely to
//! change version strings.

use std::sync::OnceLock;

#[path = "../build_inputs.rs"]
mod build_inputs;

/// Compile-time human-readable version string, e.g. `v0.14.6-dev (abc1234)`.
pub const VERSION: &str = env!("RAYU_VERSION");
/// Short git hash of the build commit, e.g. `abc1234` (or `unknown`).
pub const GIT_HASH: &str = env!("RAYU_GIT_HASH");
/// Commit date/time of the build commit (or `unknown`).
pub const GIT_DATE: &str = env!("RAYU_GIT_DATE");
/// `git describe --tags --always` output (may be empty).
pub const GIT_TAG: &str = env!("RAYU_GIT_TAG");
/// Compile-time auto-incrementing build semver (dev) or explicit release semver.
pub const SEMVER: &str = env!("RAYU_SEMVER");
/// Compile-time base semver taken from the root `Cargo.toml` package version.
pub const BASE_SEMVER: &str = env!("RAYU_BASE_SEMVER");
/// Compile-time semver used for update comparisons.
pub const UPDATE_SEMVER: &str = env!("RAYU_UPDATE_SEMVER");
/// Encoded changelog (record/unit separated). See build.rs for the format.
pub const CHANGELOG: &str = env!("RAYU_CHANGELOG");
/// Compile-time root crate package version.
pub const PKG_VERSION: &str = env!("RAYU_PKG_VERSION");
/// Compile-time switch controlling whether non-Rayu providers are enabled.
///
/// Resolved at build time from `ENABLE_OTHER_PROVIDER` (process env takes precedence over
/// workspace `.env`, defaulting to `true`).
pub const ENABLE_OTHER_PROVIDER: bool =
    matches!(env!("RAYU_ENABLE_OTHER_PROVIDER").as_bytes(), b"true");
/// Compile-time preferred Ctrl+Y / failover fallback model.
///
/// Resolved at build time from `RAYU_FALLBACK_MODEL` (process env takes precedence over
/// workspace `.env`, defaulting to `""` meaning default fallback ranking).
pub const DEFAULT_FALLBACK_MODEL: &str = env!("RAYU_FALLBACK_MODEL");

#[cfg(any(test, feature = "test-support"))]
std::thread_local! {
    static TEST_OTHER_PROVIDERS_OVERRIDE: std::cell::Cell<Option<bool>> =
        const { std::cell::Cell::new(None) };
    static TEST_DEFAULT_FALLBACK_MODEL_OVERRIDE: std::cell::RefCell<Option<Option<String>>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(any(test, feature = "test-support"))]
static IS_TEST_HARNESS_EXE: OnceLock<bool> = OnceLock::new();

#[cfg(any(test, feature = "test-support"))]
fn is_test_harness_exe() -> bool {
    *IS_TEST_HARNESS_EXE.get_or_init(|| {
        std::env::current_exe()
            .ok()
            .and_then(|path| {
                path.parent()
                    .and_then(|parent| parent.file_name())
                    .map(|name| name == std::ffi::OsStr::new("deps"))
            })
            .unwrap_or(false)
    })
}

/// Returns whether non-Rayu providers are enabled for this build.
///
/// In production binaries this returns the compile-time constant [`ENABLE_OTHER_PROVIDER`].
/// In Cargo unit-test harness executables (`target/<profile>/deps/*`), it defaults to `true`
/// unless explicitly scoped with [`scoped_other_providers_enabled_for_tests`] so existing
/// multi-provider unit tests remain independent of the developer's local `.env`, while spawned
/// `rayu` binaries still observe [`ENABLE_OTHER_PROVIDER`].
pub fn other_providers_enabled() -> bool {
    #[cfg(any(test, feature = "test-support"))]
    {
        if let Some(override_value) = TEST_OTHER_PROVIDERS_OVERRIDE.with(|cell| cell.get()) {
            return override_value;
        }
        if is_test_harness_exe() {
            return true;
        }
    }
    ENABLE_OTHER_PROVIDER
}

/// RAII guard restoring the previous thread-local `other_providers_enabled` test override on drop.
#[cfg(any(test, feature = "test-support"))]
pub struct ScopedOtherProvidersGuard {
    previous: Option<bool>,
}

#[cfg(any(test, feature = "test-support"))]
impl Drop for ScopedOtherProvidersGuard {
    fn drop(&mut self) {
        TEST_OTHER_PROVIDERS_OVERRIDE.with(|cell| cell.set(self.previous));
    }
}

/// Temporarily override [`other_providers_enabled`] on the current test thread.
#[cfg(any(test, feature = "test-support"))]
pub fn scoped_other_providers_enabled_for_tests(enabled: bool) -> ScopedOtherProvidersGuard {
    let previous = TEST_OTHER_PROVIDERS_OVERRIDE.with(|cell| cell.replace(Some(enabled)));
    ScopedOtherProvidersGuard { previous }
}

/// Returns the compile-time default Ctrl+Y / failover fallback model configured via
/// `RAYU_FALLBACK_MODEL` (workspace `.env` or build environment).
///
/// In Cargo unit-test harness executables (`target/<profile>/deps/*`), returns `None`
/// unless explicitly scoped with [`scoped_default_fallback_model_for_tests`] so existing
/// fallback unit tests stay independent of the developer's local `.env`, while production
/// `rayu` binaries always observe [`DEFAULT_FALLBACK_MODEL`].
pub fn default_fallback_model() -> Option<String> {
    #[cfg(any(test, feature = "test-support"))]
    {
        if let Some(override_value) =
            TEST_DEFAULT_FALLBACK_MODEL_OVERRIDE.with(|cell| cell.borrow().clone())
        {
            return override_value;
        }
        if is_test_harness_exe() {
            return None;
        }
    }
    let trimmed = DEFAULT_FALLBACK_MODEL.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// RAII guard restoring the previous thread-local `default_fallback_model` test override on drop.
#[cfg(any(test, feature = "test-support"))]
pub struct ScopedDefaultFallbackModelGuard {
    previous: Option<Option<String>>,
}

#[cfg(any(test, feature = "test-support"))]
impl Drop for ScopedDefaultFallbackModelGuard {
    fn drop(&mut self) {
        TEST_DEFAULT_FALLBACK_MODEL_OVERRIDE.with(|cell| cell.replace(self.previous.take()));
    }
}

/// Temporarily override [`default_fallback_model`] on the current test thread.
#[cfg(any(test, feature = "test-support"))]
pub fn scoped_default_fallback_model_for_tests(
    model: Option<&str>,
) -> ScopedDefaultFallbackModelGuard {
    let next = model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let previous = TEST_DEFAULT_FALLBACK_MODEL_OVERRIDE.with(|cell| cell.replace(Some(next)));
    ScopedDefaultFallbackModelGuard { previous }
}

static RUNTIME_RELEASE_SEMVER: OnceLock<Option<String>> = OnceLock::new();
static RUNTIME_VERSION: OnceLock<Option<String>> = OnceLock::new();
static RUNTIME_GIT_HASH: OnceLock<Option<String>> = OnceLock::new();
static RUNTIME_GIT_DATE: OnceLock<Option<String>> = OnceLock::new();
static RUNTIME_GIT_TAG: OnceLock<Option<String>> = OnceLock::new();

fn parse_release_semver(value: &str) -> Option<String> {
    build_inputs::release_semver(value)
}

/// Optional release semver supplied by the fast-release wrapper at process start.
pub fn runtime_release_semver() -> Option<&'static str> {
    RUNTIME_RELEASE_SEMVER
        .get_or_init(|| {
            std::env::var("RAYU_RUNTIME_RELEASE_SEMVER")
                .ok()
                .and_then(|value| parse_release_semver(&value))
        })
        .as_deref()
}

/// Human-readable runtime version, honoring a fast-release wrapper override.
pub fn version() -> &'static str {
    RUNTIME_VERSION
        .get_or_init(|| {
            runtime_release_semver().map(|semver| format!("v{semver} ({})", git_hash()))
        })
        .as_deref()
        .unwrap_or(VERSION)
}

fn runtime_identity_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Runtime git hash, honoring the fast-release wrapper identity.
pub fn git_hash() -> &'static str {
    RUNTIME_GIT_HASH
        .get_or_init(|| runtime_identity_value("RAYU_RUNTIME_RELEASE_GIT_HASH"))
        .as_deref()
        .unwrap_or(GIT_HASH)
}

/// Runtime git date, honoring the fast-release wrapper identity.
pub fn git_date() -> &'static str {
    RUNTIME_GIT_DATE
        .get_or_init(|| runtime_identity_value("RAYU_RUNTIME_RELEASE_GIT_DATE"))
        .as_deref()
        .unwrap_or(GIT_DATE)
}

/// Runtime git tag, honoring the fast-release wrapper identity.
pub fn git_tag() -> &'static str {
    RUNTIME_GIT_TAG
        .get_or_init(|| runtime_identity_value("RAYU_RUNTIME_RELEASE_GIT_TAG"))
        .as_deref()
        .unwrap_or(GIT_TAG)
}

/// Runtime build semver, honoring a fast-release wrapper override.
pub fn semver() -> &'static str {
    runtime_release_semver().unwrap_or(SEMVER)
}

/// Runtime base semver, honoring a fast-release wrapper override.
pub fn base_semver() -> &'static str {
    runtime_release_semver().unwrap_or(BASE_SEMVER)
}

/// Runtime update-comparison semver, honoring a fast-release wrapper override.
pub fn update_semver() -> &'static str {
    runtime_release_semver().unwrap_or(UPDATE_SEMVER)
}

/// Runtime package version, honoring a fast-release wrapper override.
pub fn pkg_version() -> &'static str {
    runtime_release_semver().unwrap_or(PKG_VERSION)
}

/// Whether this process should behave as a release build.
pub fn is_release_build() -> bool {
    option_env!("RAYU_RELEASE_BUILD").is_some() || runtime_release_semver().is_some()
}

#[cfg(test)]
mod tests {
    use super::parse_release_semver;

    #[test]
    fn forwarded_tag_distance_matches_compiled_dev_version() {
        if option_env!("RAYU_BUILD_SEMVER").is_some() {
            return;
        }
        let base = super::build_inputs::semver_core(super::BASE_SEMVER).unwrap();
        if let Some(offset) = super::build_inputs::base_tag_offset(super::GIT_TAG, base) {
            assert_eq!(
                super::SEMVER,
                format!("{}.{}.{}", base.0, base.1, base.2.saturating_add(offset))
            );
            assert_eq!(super::UPDATE_SEMVER, super::BASE_SEMVER);
        }
    }

    #[test]
    fn release_build_display_preserves_comparison_identity() {
        if option_env!("RAYU_RELEASE_BUILD").is_some() {
            assert!(super::VERSION.starts_with(&format!("v{} (", super::SEMVER)));
            assert_eq!(super::UPDATE_SEMVER, super::SEMVER);
        }
        assert_eq!(
            parse_release_semver("v1.0.0-preview.42").as_deref(),
            Some("1.0.0-preview.42")
        );
    }

    #[test]
    fn explicit_build_override_preserves_release_identity() {
        if let Some(expected) = option_env!("RAYU_BUILD_SEMVER").and_then(parse_release_semver) {
            assert_eq!(super::SEMVER, expected);
            assert_eq!(super::UPDATE_SEMVER, expected);
        }
    }

    #[test]
    fn runtime_release_semver_accepts_only_three_numeric_components() {
        assert_eq!(parse_release_semver("v1.2.3").as_deref(), Some("1.2.3"));
        assert_eq!(parse_release_semver(" 1.2.3 ").as_deref(), Some("1.2.3"));
        assert_eq!(
            parse_release_semver("v1.2.3-rc.1").as_deref(),
            Some("1.2.3-rc.1")
        );
        assert_eq!(parse_release_semver("1.2"), None);
        assert_eq!(parse_release_semver("1.2.3.4"), None);
        assert_eq!(parse_release_semver("1.2.beta"), None);
    }

    #[test]
    fn scoped_other_providers_override_restores_previous_state() {
        assert!(super::other_providers_enabled());
        {
            let _outer = super::scoped_other_providers_enabled_for_tests(false);
            assert!(!super::other_providers_enabled());
            {
                let _inner = super::scoped_other_providers_enabled_for_tests(true);
                assert!(super::other_providers_enabled());
            }
            assert!(!super::other_providers_enabled());
        }
        assert!(super::other_providers_enabled());
    }

    #[test]
    fn scoped_default_fallback_model_override_restores_previous_state() {
        assert_eq!(super::default_fallback_model(), None);
        {
            let _outer = super::scoped_default_fallback_model_for_tests(Some(
                "deepseek-v4.1-flash-1017-cloud",
            ));
            assert_eq!(
                super::default_fallback_model().as_deref(),
                Some("deepseek-v4.1-flash-1017-cloud")
            );
            {
                let _inner = super::scoped_default_fallback_model_for_tests(None);
                assert_eq!(super::default_fallback_model(), None);
            }
            assert_eq!(
                super::default_fallback_model().as_deref(),
                Some("deepseek-v4.1-flash-1017-cloud")
            );
        }
        assert_eq!(super::default_fallback_model(), None);
    }
}
