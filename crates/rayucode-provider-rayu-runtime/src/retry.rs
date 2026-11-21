//! Bounded replay of a Rayu gateway request after a transient transport fault.
//!
//! The gateway path (client -> Cloudflare -> Traefik -> gateway -> provider)
//! can drop a streaming body mid-flight. reqwest reports every such body-read
//! failure as "error decoding response body", and before this module the turn
//! simply ended. Other v2 providers (Anthropic, OpenAI, OpenRouter, Copilot)
//! already replay the request and emit [`StreamEvent::RetryRollback`] when
//! partial output had reached the consumer; this brings Rayu in line.
//!
//! Replaying is safe because tools only run after a stream completes, so a
//! discarded partial attempt has no side effects. A stream that already
//! reported its end is never replayed.

use crate::RetryFuture;
use anyhow::Result;
use futures::StreamExt;
use rayucode_message_types::{ConnectionPhase, StreamEvent};
use rayucode_provider_core::EventStream;
use std::sync::Arc;
use std::time::Duration;

/// Total attempts per logical request, including the first.
pub(crate) const MAX_ATTEMPTS: u32 = 3;

/// Longest total time spent waiting out gateway capacity answers (429/503)
/// before any output, across all of their retries.
pub(crate) const CAPACITY_BUDGET: Duration = Duration::from_secs(60);

/// Wait used when a capacity answer carries no `Retry-After`.
const CAPACITY_DEFAULT_WAIT: Duration = Duration::from_secs(3);

/// Statuses meaning "the gateway has no free provider slot right now": 429 (a
/// rate or concurrency limit) and 503 (no usable route at the moment).
pub(crate) fn is_capacity_status(status: u16) -> bool {
    matches!(status, 429 | 503)
}

/// A 429/503 the gateway marked retryable, with its requested wait.
#[derive(Debug)]
pub(crate) struct CapacityError {
    message: String,
    retry_after: Option<rayucode_provider_core::retry_after::RetryAfter>,
}

impl CapacityError {
    pub(crate) fn new(
        message: String,
        retry_after: Option<rayucode_provider_core::retry_after::RetryAfter>,
    ) -> Self {
        Self {
            message,
            retry_after,
        }
    }

    fn wait(&self) -> Duration {
        self.retry_after
            .map(|r| r.remaining())
            .filter(|d| !d.is_zero())
            .unwrap_or(CAPACITY_DEFAULT_WAIT)
    }
}

impl std::fmt::Display for CapacityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CapacityError {}

/// The wait a capacity error asks for, or `None` for any other error.
fn capacity_wait(error: &anyhow::Error) -> Option<Duration> {
    error
        .chain()
        .find_map(|e| e.downcast_ref::<CapacityError>())
        .map(CapacityError::wait)
}

/// Opens one full attempt (credential lookup, send, 401 refresh).
pub(crate) type OpenFn = Arc<dyn Fn() -> RetryFuture + Send + Sync>;

/// Prefix of a non-2xx response error from `complete_once`. A status reply is
/// a real answer from the gateway, not a transport fault, so it is not replayed
/// here even if its body mentions a timeout.
const HTTP_STATUS_ERROR_PREFIX: &str = "Rayu gateway request failed (HTTP";

/// The gateway's mid-stream failure message (`UPSTREAM_ENDED_UNEXPECTEDLY`),
/// sent as an SSE `error` event when the provider stream breaks or stalls.
const GATEWAY_UPSTREAM_ENDED: &str = "ended the response unexpectedly";

/// Whether a send/stream error is a transient transport fault worth replaying.
pub(crate) fn is_retryable_error(error: &anyhow::Error) -> bool {
    let text = format!("{error:#}");
    !text.starts_with(HTTP_STATUS_ERROR_PREFIX)
        && rayucode_provider_core::is_transient_transport_error(&text)
}

/// Whether an in-band gateway `error` event reports a broken upstream stream.
fn is_retryable_stream_event(message: &str) -> bool {
    message.contains(GATEWAY_UPSTREAM_ENDED)
}

fn backoff(attempt: u32) -> Duration {
    Duration::from_millis(500 * u64::from(attempt))
}

/// Opens the first attempt, replaying transient send failures and waiting out
/// gateway capacity answers (bounded by [`CAPACITY_BUDGET`]).
pub(crate) async fn open_with_retry(open: &OpenFn) -> Result<(EventStream, u32)> {
    let mut attempt = 1;
    let started = std::time::Instant::now();
    loop {
        match open().await {
            Ok(stream) => return Ok((stream, attempt)),
            Err(error) if capacity_wait(&error).is_some() => {
                let wait = capacity_wait(&error).unwrap_or(CAPACITY_DEFAULT_WAIT);
                let spent = started.elapsed();
                if spent + wait > CAPACITY_BUDGET {
                    return Err(error);
                }
                rayucode_base::logging::warn(&format!(
                    "Rayu gateway at capacity; retrying in {:.1}s (waited {:.1}s of {}s): {}",
                    wait.as_secs_f64(),
                    spent.as_secs_f64(),
                    CAPACITY_BUDGET.as_secs(),
                    error.to_string().lines().next().unwrap_or_default()
                ));
                tokio::time::sleep(wait).await;
            }
            Err(error) if attempt < MAX_ATTEMPTS && is_retryable_error(&error) => {
                rayucode_base::logging::warn(&format!(
                    "Rayu gateway send failed (attempt {attempt}/{MAX_ATTEMPTS}); retrying: {error:#}"
                ));
                tokio::time::sleep(backoff(attempt)).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

struct State {
    inner: EventStream,
    open: OpenFn,
    attempt: u32,
    /// Whether this attempt already yielded content the consumer accumulates
    /// (text, thinking, tools, charge). Phase notices and usage counters do
    /// not count: the turn overwrites usage with each new value.
    saw_output: bool,
    ended: bool,
    done: bool,
    /// Time spent waiting out gateway capacity during replays.
    capacity_spent: Duration,
    /// Events to yield before polling `inner` again (rollback/phase notices).
    queued: std::collections::VecDeque<Result<StreamEvent>>,
}

impl State {
    /// Replays the request. Returns the terminal error when replay is no
    /// longer possible.
    async fn replay(&mut self, mut cause: String) -> Option<anyhow::Error> {
        loop {
            rayucode_base::logging::warn(&format!(
                "Rayu gateway stream failed (attempt {}/{MAX_ATTEMPTS}, partial_output={}); replaying request: {cause}",
                self.attempt, self.saw_output
            ));
            tokio::time::sleep(backoff(self.attempt)).await;
            self.attempt += 1;
            match (self.open)().await {
                Ok(stream) => {
                    self.inner = stream;
                    let event = if self.saw_output {
                        StreamEvent::RetryRollback {
                            attempt: self.attempt,
                            max: MAX_ATTEMPTS,
                        }
                    } else {
                        StreamEvent::ConnectionPhase {
                            phase: ConnectionPhase::Retrying {
                                attempt: self.attempt,
                                max: MAX_ATTEMPTS,
                            },
                        }
                    };
                    self.saw_output = false;
                    self.queued.push_back(Ok(event));
                    return None;
                }
                // Keep `saw_output`: the consumer still holds the partial
                // output from the earlier attempt.
                Err(error) if self.attempt < MAX_ATTEMPTS && is_retryable_error(&error) => {
                    cause = format!("{error:#}");
                }
                // The replay landed on a full gateway: wait out capacity (its
                // own budget) without spending a transport attempt.
                Err(error) if capacity_wait(&error).is_some() => {
                    let wait = capacity_wait(&error).unwrap_or(CAPACITY_DEFAULT_WAIT);
                    if self.capacity_spent + wait > CAPACITY_BUDGET {
                        return Some(error);
                    }
                    self.capacity_spent += wait;
                    tokio::time::sleep(wait).await;
                    // Retry the same attempt number after the wait.
                    self.attempt -= 1;
                    cause = format!("{error:#}");
                }
                Err(error) => return Some(error),
            }
        }
    }
}

/// Wraps an open stream so transient mid-stream faults replay the request.
pub(crate) fn transport_retry_stream(
    inner: EventStream,
    open: OpenFn,
    attempt: u32,
) -> EventStream {
    let state = State {
        inner,
        open,
        attempt,
        saw_output: false,
        ended: false,
        done: false,
        capacity_spent: Duration::ZERO,
        queued: Default::default(),
    };
    Box::pin(futures::stream::unfold(state, |mut state| async move {
        loop {
            if let Some(item) = state.queued.pop_front() {
                return Some((item, state));
            }
            if state.done {
                return None;
            }
            match state.inner.next().await {
                None => return None,
                Some(Ok(event)) => {
                    if let StreamEvent::Error { message, .. } = &event
                        && !state.ended
                        && state.attempt < MAX_ATTEMPTS
                        && is_retryable_stream_event(message)
                    {
                        let cause = message.clone();
                        if let Some(error) = state.replay(cause).await {
                            state.done = true;
                            return Some((Err(error), state));
                        }
                        continue;
                    }
                    if !matches!(
                        event,
                        StreamEvent::ConnectionPhase { .. }
                            | StreamEvent::RetryRollback { .. }
                            | StreamEvent::TokenUsage { .. }
                    ) {
                        state.saw_output = true;
                    }
                    if matches!(event, StreamEvent::MessageEnd { .. }) {
                        state.ended = true;
                    }
                    return Some((Ok(event), state));
                }
                Some(Err(error)) => {
                    if state.ended && is_retryable_error(&error) {
                        // The message already finished; a connection that
                        // drops afterwards loses nothing.
                        rayucode_base::logging::warn(&format!(
                            "Rayu gateway connection dropped after message end; treating the stream as complete: {error:#}"
                        ));
                        return None;
                    }
                    if !state.ended && state.attempt < MAX_ATTEMPTS && is_retryable_error(&error) {
                        if let Some(error) = state.replay(format!("{error:#}")).await {
                            state.done = true;
                            return Some((Err(error), state));
                        }
                        continue;
                    }
                    state.done = true;
                    return Some((Err(error), state));
                }
            }
        }
    }))
}
