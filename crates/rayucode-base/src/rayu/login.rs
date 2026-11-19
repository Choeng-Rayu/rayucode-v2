//! Interactive Rayu account login via a loopback browser redirect.
//!
//! Mirrors rayu-cli's `loginRayu`:
//!   1. start a loopback HTTP server on 127.0.0.1:<ephemeral port>;
//!   2. open the browser to `{web}/cli-login?port=<port>&state=<state>`;
//!   3. the website signs the user in and redirects the browser to
//!      `http://127.0.0.1:<port>/callback?code=<code>&state=<state>`;
//!   4. verify state, exchange the one-time code at `POST {api}/cli/token`;
//!   5. persist the session (0600).
//!
//! Binding explicitly to 127.0.0.1 (IPv4) matches the website's redirect and
//! avoids the "localhost resolves to ::1" mismatch on IPv6-first systems.

use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::session::{RayuSession, RayuSessionUser, write_session};
use super::urls::{api_base, web_base};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(5);

pub struct RayuLoginOptions {
    /// Do not launch a browser; the user opens the printed URL themselves.
    pub no_browser: bool,
    /// Print the login URL to the terminal.
    pub print_auth_url: bool,
    /// A pre-captured callback URL (manual flow). When set, no loopback
    /// server is started; the code/state pair is exchanged directly and the
    /// backend verifies their binding.
    pub callback_url: Option<String>,
}

/// An initialized loopback Rayu OAuth login session.
///
/// Split into `prepare()` + `wait_and_exchange()` so interactive UIs (such as
/// the pre-UI setup screen and in-TUI `/login rayu`) can immediately render the
/// exact `{web}/cli-login?port=<port>&state=<state>` URL while waiting for the
/// browser redirect (and cancel cleanly by dropping/aborting the future).
pub struct PreparedRayuLogin {
    listener: tokio::net::TcpListener,
    state: String,
    url: String,
}

impl PreparedRayuLogin {
    /// Synchronously bind an ephemeral loopback listener on `127.0.0.1:0` inside
    /// an active Tokio runtime so synchronous UI callers can display the exact
    /// sign-in URL immediately before spawning `wait_and_exchange`.
    pub fn prepare_sync() -> Result<Self> {
        let state = new_state();
        let std_listener = std::net::TcpListener::bind("127.0.0.1:0")
            .context("Could not start the Rayu login callback server on 127.0.0.1")?;
        std_listener.set_nonblocking(true)?;
        let listener = tokio::net::TcpListener::from_std(std_listener)
            .context("Could not register Rayu login callback listener with Tokio")?;
        let port = listener.local_addr()?.port();
        let url = build_cli_login_url(&web_base(), port, &state);
        Ok(Self {
            listener,
            state,
            url,
        })
    }

    /// Bind an ephemeral loopback listener on `127.0.0.1:0` and build the login URL.
    pub async fn prepare() -> Result<Self> {
        let state = new_state();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .context("Could not start the Rayu login callback server on 127.0.0.1")?;
        let port = listener.local_addr()?.port();
        let url = build_cli_login_url(&web_base(), port, &state);
        Ok(Self {
            listener,
            state,
            url,
        })
    }

    /// Exact website sign-in URL bound to this loopback listener.
    pub fn auth_url(&self) -> &str {
        &self.url
    }

    /// Best-effort open the sign-in URL in the system browser.
    pub fn open_browser(&self) {
        crate::companion_client::open_url(&self.url);
    }

    /// Wait for the loopback redirect (up to 5 minutes) and exchange the code
    /// for a persisted Rayu session.
    pub async fn wait_and_exchange(self) -> Result<RayuSessionUser> {
        let code = tokio::time::timeout(
            LOGIN_TIMEOUT,
            wait_for_callback(&self.listener, &self.state),
        )
        .await
        .map_err(|_| anyhow!("Rayu login timed out (5 minutes)."))??;
        exchange_code(&code, &self.state).await
    }
}

/// Exchange a manually pasted callback URL (for SSH / headless browsers) into
/// a persisted Rayu session.
pub async fn exchange_callback_url(callback_url: &str) -> Result<RayuSessionUser> {
    let (code, state) = parse_callback_url(callback_url)?;
    exchange_code(&code, &state).await
}

/// Build the website login URL the browser is pointed at. Pure (testable).
pub(super) fn build_cli_login_url(web_base_url: &str, port: u16, state: &str) -> String {
    let mut url = url::Url::parse(&format!("{}/cli-login", web_base_url.trim_end_matches('/')))
        .expect("validated web base");
    url.query_pairs_mut()
        .append_pair("port", &port.to_string())
        .append_pair("state", state);
    url.to_string()
}

fn new_state() -> String {
    let bytes: [u8; 16] = rand::random();
    hex::encode(bytes)
}

/// Run the interactive login. Resolves with the signed-in user on success.
/// Errors on timeout, redirect/state failure, or token exchange failure.
pub async fn login(opts: RayuLoginOptions) -> Result<RayuSessionUser> {
    if let Some(callback_url) = opts.callback_url.as_deref() {
        return exchange_callback_url(callback_url).await;
    }
    let prepared = PreparedRayuLogin::prepare().await?;
    if opts.print_auth_url {
        crate::terminal_println!("Open this URL to sign in to Rayu:\n{}", prepared.auth_url());
    }
    if !opts.no_browser {
        prepared.open_browser();
    }
    prepared.wait_and_exchange().await
}

/// Parse `code` and `state` from a pasted callback URL (manual flow).
fn parse_callback_url(input: &str) -> Result<(String, String)> {
    let trimmed = input.trim();
    let url = url::Url::parse(trimmed)
        .or_else(|_| url::Url::parse(&format!("http://127.0.0.1{trimmed}")))
        .map_err(|_| anyhow!("Paste the full callback URL from the browser address bar."))?;
    let mut code = None;
    let mut state = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            _ => {}
        }
    }
    let code = code.filter(|value| !value.is_empty()).ok_or_else(|| {
        anyhow!(
            "The callback URL contains no authorization code. Copy the full URL after signing in."
        )
    })?;
    let state = state
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("The callback URL contains no state parameter."))?;
    Ok((code, state))
}

async fn read_request_line<R>(reader: &mut BufReader<R>) -> Result<Option<String>>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut line = String::new();
    match tokio::time::timeout(CALLBACK_READ_TIMEOUT, reader.read_line(&mut line)).await {
        Ok(Ok(0)) => Ok(None),
        Ok(Ok(_)) => Ok(Some(line)),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => Ok(None),
    }
}

async fn drain_headers<R>(reader: &mut BufReader<R>) -> Result<bool>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut line = String::new();
    loop {
        line.clear();
        match tokio::time::timeout(CALLBACK_READ_TIMEOUT, reader.read_line(&mut line)).await {
            Ok(Ok(0)) => return Ok(false),
            Ok(Ok(_)) if line.trim().is_empty() => return Ok(true),
            Ok(Ok(_)) => {}
            Ok(Err(error)) => return Err(error.into()),
            Err(_) => return Ok(false),
        }
    }
}

fn http_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    )
}

/// Wait for the website's redirect on the loopback listener. Probes without
/// a code (favicon, prefetch) get a 204 and are ignored; a state mismatch is
/// a possible CSRF and aborts the flow.
pub(super) async fn wait_for_callback(
    listener: &tokio::net::TcpListener,
    expected_state: &str,
) -> Result<String> {
    loop {
        let (stream, _) = listener.accept().await?;
        let (reader, mut writer) = stream.into_split();
        let mut reader = BufReader::new(reader);
        let Some(request_line) = read_request_line(&mut reader).await? else {
            continue;
        };
        if !drain_headers(&mut reader).await? {
            continue;
        }
        let Some(path) = request_line.split_whitespace().nth(1) else {
            continue;
        };
        let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{path}")) else {
            continue;
        };
        let mut code = None;
        let mut state = None;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.into_owned()),
                "state" => state = Some(value.into_owned()),
                _ => {}
            }
        }
        let Some(code) = code.filter(|value| !value.is_empty()) else {
            // Ignore favicon / unrelated probes that carry no code.
            let _ = writer
                .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                .await;
            continue;
        };
        if state.as_deref() != Some(expected_state) {
            let _ = writer
                .write_all(http_response("400 Bad Request", "Invalid state parameter.").as_bytes())
                .await;
            bail!("OAuth state mismatch (possible CSRF). Start /login again.");
        }
        let body = format!(
            "<html><body style=\"font-family:sans-serif\"><h3>Signed in to Rayu.</h3><p>You can close this tab and return to your terminal.</p><p>View your dashboard: <a href=\"{}\" target=\"_blank\">here</a></p></body></html>",
            super::urls::account_url()
        );
        let _ = writer
            .write_all(http_response("200 OK", &body).as_bytes())
            .await;
        return Ok(code);
    }
}

/// Exchange the one-time code for Rayu tokens and persist the session.
pub(super) async fn exchange_code(code: &str, state: &str) -> Result<RayuSessionUser> {
    let response = super::http_client()
        .post(format!("{}/cli/token", api_base()))
        .json(&serde_json::json!({ "code": code, "state": state }))
        .send()
        .await
        .map_err(|_| anyhow!("Could not reach the Rayu account service to finish sign-in."))?;
    let status = response.status();
    if !status.is_success() {
        bail!(
            "Token exchange failed (HTTP {}). Please try /login again.",
            status.as_u16()
        );
    }
    let session: RayuSession = response
        .json()
        .await
        .map_err(|_| anyhow!("The Rayu account service returned an invalid token response."))?;
    if session.access_token.is_empty() {
        bail!("The Rayu account service returned an empty access token.");
    }
    write_session(&session).context("Could not save the Rayu session")?;
    // Rayu Auth and Rayu API key are either-or credentials: a fresh account
    // login invalidates any recorded API-key verdict (best-effort).
    super::apikey::clear_apikey_state();
    crate::auth::AuthStatus::invalidate_cache();
    Ok(session.user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_url_carries_port_and_state() {
        let url = build_cli_login_url("https://rayucode.com/", 43210, "abc123");
        assert_eq!(
            url,
            "https://rayucode.com/cli-login?port=43210&state=abc123"
        );
    }

    #[test]
    fn state_is_16_random_bytes_hex() {
        let a = new_state();
        let b = new_state();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn callback_url_parsing_extracts_code_and_state() {
        let (code, state) =
            parse_callback_url("http://127.0.0.1:43210/callback?code=the-code&state=the-state")
                .unwrap();
        assert_eq!(code, "the-code");
        assert_eq!(state, "the-state");
        // Bare query strings are accepted too.
        let (code, state) = parse_callback_url("/callback?code=c2&state=s2").unwrap();
        assert_eq!((code.as_str(), state.as_str()), ("c2", "s2"));
        assert!(parse_callback_url("http://127.0.0.1:1/callback").is_err());
        assert!(parse_callback_url("http://127.0.0.1:1/callback?code=x").is_err());
        assert!(parse_callback_url("not a url at all").is_err());
    }

    #[tokio::test]
    async fn prepared_login_exposes_bound_url_with_port_and_state() {
        let _env = crate::rayu::test_support::RayuTestEnv::new();
        crate::env::set_var("RAYU_WEB_URL", "https://rayucode.com");
        let prepared = PreparedRayuLogin::prepare().await.unwrap();
        let parsed = url::Url::parse(prepared.auth_url()).unwrap();
        assert_eq!(parsed.scheme(), "https");
        assert_eq!(parsed.host_str(), Some("rayucode.com"));
        assert_eq!(parsed.path(), "/cli-login");
        let pairs: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        let port: u16 = pairs.get("port").unwrap().parse().unwrap();
        assert!(port > 0);
        let state = pairs.get("state").unwrap();
        assert_eq!(state.len(), 32);
        assert!(state.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
