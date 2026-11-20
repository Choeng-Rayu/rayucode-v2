//! Opt-in preview discovery and explicit release-channel selection.

use super::*;

/// GitHub's latest endpoint deliberately excludes prereleases. Keep preview
/// discovery separate so stable users never see opt-in builds.
#[derive(serde::Deserialize)]
struct PreviewRelease {
    #[serde(flatten)]
    release: GitHubRelease,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct PreviewTag {
    major: u64,
    minor: u64,
    patch: u64,
    number: u64,
}

pub(super) fn preview_number(tag: &str) -> Option<PreviewTag> {
    let rest = tag.strip_prefix('v')?;
    let (base, number) = rest.split_once("-preview.")?;
    let mut parts = base.split('.');
    let major_str = parts.next()?;
    let minor_str = parts.next()?;
    let patch_str = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let parse_component = |s: &str| -> Option<u64> {
        if s.is_empty()
            || !s.bytes().all(|b| b.is_ascii_digit())
            || (s.len() > 1 && s.starts_with('0'))
        {
            return None;
        }
        s.parse::<u64>().ok()
    };
    let major = parse_component(major_str)?;
    let minor = parse_component(minor_str)?;
    let patch = parse_component(patch_str)?;
    let number = parse_component(number).filter(|&n| n > 0)?;
    Some(PreviewTag {
        major,
        minor,
        patch,
        number,
    })
}

fn preview_is_installable(candidate: &PreviewRelease) -> bool {
    let release = &candidate.release;
    !candidate.draft
        && candidate.prerelease
        && release
            ._published_at
            .as_ref()
            .is_some_and(|s| !s.is_empty())
        && preview_number(&release.tag_name).is_some()
        && release.assets.iter().any(|asset| {
            (asset.name == get_asset_name() || asset.name == format!("{}.tar.gz", get_asset_name()))
                && asset._size > 0
                && !asset.browser_download_url.is_empty()
        })
        && checksum_asset(release)
            .is_some_and(|asset| asset._size > 0 && !asset.browser_download_url.is_empty())
}

fn select_latest_preview(
    latest: &mut Option<GitHubRelease>,
    releases: impl IntoIterator<Item = PreviewRelease>,
) {
    for candidate in releases.into_iter().filter(preview_is_installable) {
        if latest.as_ref().is_none_or(|previous| {
            preview_number(&candidate.release.tag_name) > preview_number(&previous.tag_name)
        }) {
            *latest = Some(candidate.release);
        }
    }
}

pub fn fetch_latest_preview_blocking() -> Result<Option<GitHubRelease>> {
    let client = reqwest::blocking::Client::builder()
        .timeout(UPDATE_CHECK_TIMEOUT)
        .user_agent("rayu-updater")
        .build()?;
    let mut latest: Option<GitHubRelease> = None;
    // Paginate because stable releases may otherwise bury preview releases.
    // Bound work to avoid an unbounded automatic network check.
    for page in 1..=20 {
        let url =
            format!("https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=100&page={page}");
        let response = github_api_request(&client, &url)
            .send()
            .context("Failed to fetch preview releases")?;
        if let Some(error) = rate_limit_error(&response) {
            return Err(error);
        }
        if !response.status().is_success() {
            anyhow::bail!("GitHub API error: {}", response.status());
        }
        let releases: Vec<PreviewRelease> = response
            .json()
            .context("Failed to parse preview releases")?;
        let last_page = releases.len() < 100;
        select_latest_preview(&mut latest, releases);
        if last_page {
            break;
        }
    }
    clear_rate_limit_backoff();
    Ok(latest)
}

pub(super) fn prepare_preview_update_blocking() -> Result<PreparedUpdate> {
    match fetch_latest_preview_blocking()? {
        Some(release) if release_is_update(&release)? => prepare_release_update(release),
        _ => Ok(PreparedUpdate::None {
            current: rayucode_build_meta::version().to_string(),
        }),
    }
}

fn release_identity(version: &str) -> &str {
    version
        .trim_start_matches('v')
        .split('+')
        .next()
        .unwrap_or(version)
}

fn explicit_stable_is_update(release: &str, current: &str, release_build: bool) -> bool {
    !release_build || release_identity(release) != release_identity(current)
}

/// An explicit stable selection can intentionally return from a newer preview
/// or development build. Automatic checks never downgrade.
pub fn check_for_update_with_channel_blocking(
    explicit_channel: Option<crate::config::UpdateChannel>,
) -> Result<Option<GitHubRelease>> {
    let channel =
        explicit_channel.unwrap_or_else(|| crate::config::config().features.update_channel);
    match channel {
        crate::config::UpdateChannel::Main => check_for_main_update_blocking(),
        crate::config::UpdateChannel::Stable if explicit_channel.is_some() => {
            let release = fetch_latest_release_blocking()?;
            if explicit_stable_is_update(
                &release.tag_name,
                current_update_semver(),
                is_release_build(),
            ) && platform_asset(&release).is_ok()
            {
                Ok(Some(release))
            } else {
                Ok(None)
            }
        }
        crate::config::UpdateChannel::Stable => check_for_stable_update_blocking(),
        crate::config::UpdateChannel::Preview => match fetch_latest_preview_blocking()? {
            Some(release) if release_is_update(&release)? => Ok(Some(release)),
            _ => Ok(None),
        },
    }
}

pub(super) fn prepare_stable_update_blocking() -> Result<PreparedUpdate> {
    let release = fetch_latest_release_blocking()?;
    if !release_is_update(&release)? {
        return Ok(PreparedUpdate::None {
            current: rayucode_build_meta::version().to_string(),
        });
    }
    prepare_release_update(release)
}

pub(super) fn check_for_stable_update_blocking() -> Result<Option<GitHubRelease>> {
    let release = fetch_latest_release_blocking()?;

    if release_is_update(&release)? {
        let asset_name = get_asset_name();
        let has_asset = release
            .assets
            .iter()
            .any(|a| a.name.starts_with(asset_name));

        if has_asset {
            return Ok(Some(release));
        }
    }

    Ok(None)
}

#[cfg(test)]
#[path = "update_preview_tests.rs"]
mod tests;
