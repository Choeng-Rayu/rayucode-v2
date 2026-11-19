//! Access-token renewal against `POST {api}/cli/refresh`.
//!
//! Semantics shared with rayu-cli's `refreshRayuAccessToken`:
//! - proactive refresh once `expiresAt - 60_000` is reached;
//! - a single in-flight refresh per process (concurrent callers wait, then
//!   read the renewed file instead of minting a second refresh);
//! - newer-file-wins: if another sign-in (a second terminal, the VS Code
//!   engine) rewrote the session while a refresh was in flight, its tokens
//!   are newer than anything this request could produce and are returned
//!   untouched;
//! - HTTP 400/401 are definitive refusals and clear the stored session;
//!   network failures, 5xx and proxy 403 keep it, because logging the user
//!   out over a transient blip is worse than retrying.

use super::session::{
    RayuSession, clear_session, is_access_token_expired, now_ms, read_session, write_session,
};
use super::urls::api_base;

/// Serializes refresh attempts. The session file is re-read after acquiring
/// the lock, so a caller that waited on an in-flight refresh observes the
/// renewed token without a second network round trip.
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Return a non-expired access token, refreshing when needed.
/// Returns None when the user is not logged in or the session cannot renew.
pub async fn access_token() -> Option<String> {
    let session = read_session()?;
    if session.access_token.is_empty() {
        return None;
    }
    if !is_access_token_expired(&session, now_ms()) {
        return Some(session.access_token);
    }
    refresh_access_token(Some(&session.access_token)).await
}

/// Exchange the stored refresh token for a new access token.
///
/// `stale` is the access token the caller found invalid. When the file now
/// holds a different, fresh token, another process already renewed the
/// session and that token is returned without a network round trip.
/// Never panics and never logs token material.
pub async fn refresh_access_token(stale: Option<&str>) -> Option<String> {
    refresh_matching_account(stale, None).await
}

/// Obtain or renew the credential only while the selected account still owns
/// the profile. Telegram links are bound to the account present at pairing.
pub(crate) async fn telegram_access_token(account: i64, rejected: Option<&str>) -> Option<String> {
    let session = read_session().filter(|session| session.user.id == account)?;
    if session.access_token.is_empty() {
        return None;
    }
    if rejected.is_none() && !is_access_token_expired(&session, now_ms()) {
        return Some(session.access_token);
    }
    refresh_matching_account(
        Some(rejected.unwrap_or(&session.access_token)),
        Some(account),
    )
    .await
}

async fn refresh_matching_account(stale: Option<&str>, account: Option<i64>) -> Option<String> {
    let matching_session =
        || read_session().filter(|session| account.is_none_or(|id| session.user.id == id));
    let session = matching_session()?;
    if let Some(token) = newer_file_token(&session, stale) {
        return Some(token);
    }
    let _guard = REFRESH_LOCK.lock().await;
    // Re-read under the lock: the refresh we waited on may have landed.
    let session = matching_session()?;
    if let Some(token) = newer_file_token(&session, stale) {
        return Some(token);
    }
    let token = do_refresh(session).await?;
    if account.is_some() {
        matching_session().filter(|session| session.access_token == token)?;
    }
    Some(token)
}

fn newer_file_token(session: &RayuSession, stale: Option<&str>) -> Option<String> {
    let stale = stale?;
    if !session.access_token.is_empty()
        && session.access_token != stale
        && !is_access_token_expired(session, now_ms())
    {
        return Some(session.access_token.clone());
    }
    None
}

/// Has the stored session moved on since `session` was read? A refresh is an
/// async round trip and the file can be rewritten meanwhile; in that case the
/// result must NOT overwrite the newer sign-in.
fn session_still_current(session: &RayuSession) -> Option<RayuSession> {
    let latest = read_session()?;
    if latest.refresh_token != session.refresh_token {
        return None;
    }
    Some(latest)
}

#[derive(serde::Deserialize)]
struct RefreshResponse {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: String,
    #[serde(rename = "expiresAt")]
    expires_at: i64,
}

async fn do_refresh(session: RayuSession) -> Option<String> {
    if session.refresh_token.is_empty() {
        // Only drop the file we actually read — never a session another
        // sign-in wrote in the meantime.
        if session_still_current(&session).is_some() {
            clear_session();
        }
        return None;
    }
    let response = super::http_client()
        .post(format!("{}/cli/refresh", api_base()))
        .json(&serde_json::json!({ "refreshToken": session.refresh_token }))
        .send()
        .await;
    let current = session_still_current(&session);
    let response = match response {
        Ok(response) => response,
        // Offline/timeout: keep the session; the token may work next try.
        Err(_) => return None,
    };
    if !response.status().is_success() {
        if current.is_none() {
            // Another sign-in landed mid-flight; its tokens win.
            return read_session().map(|latest| latest.access_token);
        }
        // 403 is deliberately NOT definitive: the refresh controller never
        // returns one, so it more likely came from a proxy/WAF in front.
        if matches!(response.status().as_u16(), 400 | 401) {
            clear_session();
        }
        return None;
    }
    let data: RefreshResponse = match response.json().await {
        Ok(data) => data,
        // Malformed body: keep the session, same as a transient failure.
        Err(_) => return None,
    };
    if data.access_token.is_empty() {
        return None;
    }
    let Some(mut current) = current else {
        return read_session().map(|latest| latest.access_token);
    };
    current.access_token = data.access_token;
    current.refresh_token = data.refresh_token;
    current.expires_at = data.expires_at;
    write_session(&current).ok()?;
    Some(current.access_token)
}
