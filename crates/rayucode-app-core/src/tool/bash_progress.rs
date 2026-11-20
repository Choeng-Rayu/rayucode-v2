use crate::protocol::{BashProgress, BashProgressUpdate, ServerEvent};
use std::collections::VecDeque;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::{Arc, Mutex, Weak};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, ReadBuf};
use tokio::sync::mpsc::UnboundedSender;

const TAIL_BYTES: usize = 8 * 1024;
const UPDATE_INTERVAL: Duration = Duration::from_millis(250);

tokio::task_local! {
    static TURN_EVENTS: UnboundedSender<ServerEvent>;
}

pub async fn with_bash_progress<T>(
    sender: UnboundedSender<ServerEvent>,
    work: impl Future<Output = T>,
) -> T {
    TURN_EVENTS.scope(sender, work).await
}

pub(super) fn publish_batch_progress(progress: &crate::bus::BatchProgress) {
    let _ = TURN_EVENTS.try_with(|sender| {
        sender.send(ServerEvent::BatchProgress {
            progress: progress.clone(),
        })
    });
}

struct Capture {
    call_id: String,
    started: Instant,
    published: Option<Instant>,
    published_bytes: u64,
    observed: u64,
    tail: VecDeque<u8>,
    pending: Weak<Mutex<BashProgress>>,
    sender: Option<UnboundedSender<ServerEvent>>,
}

impl Capture {
    fn publish(&mut self, now: Instant) {
        let Some(sender) = &self.sender else { return };
        if self.published_bytes == self.observed
            || self
                .published
                .is_some_and(|last| now.duration_since(last) < UPDATE_INTERVAL)
        {
            return;
        }
        self.published = Some(now);
        self.published_bytes = self.observed;
        let bytes = self.tail.make_contiguous();
        let first = bytes
            .iter()
            .position(|byte| byte & 0xc0 != 0x80)
            .unwrap_or(bytes.len());
        let bytes = &bytes[first..];
        let bytes = match std::str::from_utf8(bytes) {
            Err(error) if error.error_len().is_none() => &bytes[..error.valid_up_to()],
            _ => bytes,
        };
        let text = String::from_utf8_lossy(bytes);
        let mut start = text.len().saturating_sub(TAIL_BYTES);
        while !text.is_char_boundary(start) {
            start += 1;
        }
        let sample = BashProgress {
            call_id: self.call_id.clone(),
            elapsed_ms: now.duration_since(self.started).as_millis() as u64,
            output_bytes: self.observed,
            tail: text[start..].to_owned(),
        };
        if let Some(pending) = self.pending.upgrade() {
            *pending.lock().unwrap_or_else(|error| error.into_inner()) = sample;
        } else {
            let pending = Arc::new(Mutex::new(sample));
            self.pending = Arc::downgrade(&pending);
            let _ = sender.send(ServerEvent::BashProgress {
                update: BashProgressUpdate(pending),
            });
        }
    }
}

/// The foreground invocation owns the scope. Its readers may survive a
/// background handoff, while the progress sender closes with this scope.
pub(super) struct BashPreview(Arc<Mutex<Capture>>);

impl BashPreview {
    pub(super) fn new(call_id: &str) -> Option<Self> {
        let sender = TURN_EVENTS.try_with(Clone::clone).ok()?;
        let capture = Arc::new(Mutex::new(Capture {
            call_id: call_id.to_owned(),
            started: Instant::now(),
            published: None,
            published_bytes: 0,
            observed: 0,
            tail: VecDeque::new(),
            pending: Weak::new(),
            sender: Some(sender),
        }));
        let pending = Arc::downgrade(&capture);
        tokio::spawn(async move {
            let mut ticks = tokio::time::interval(UPDATE_INTERVAL);
            ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticks.tick().await;
                let Some(capture) = pending.upgrade() else {
                    break;
                };
                let mut state = capture.lock().unwrap_or_else(|error| error.into_inner());
                if state.sender.is_none() {
                    break;
                }
                state.publish(Instant::now());
            }
        });
        Some(Self(capture))
    }

    pub(super) fn reader<R>(&self, reader: R) -> PreviewReader<R> {
        PreviewReader {
            reader,
            capture: Some(Arc::clone(&self.0)),
        }
    }

    #[cfg(unix)]
    pub(super) async fn sample_file(&self, path: &std::path::Path) -> io::Result<()> {
        use tokio::io::{AsyncReadExt, AsyncSeekExt};
        let mut file = tokio::fs::File::open(path).await?;
        let observed = file.metadata().await?.len();
        let now = Instant::now();
        {
            let state = self.0.lock().unwrap_or_else(|error| error.into_inner());
            if state.observed == observed
                || state
                    .published
                    .is_some_and(|last| now.duration_since(last) < UPDATE_INTERVAL)
            {
                return Ok(());
            }
        }
        let count = observed.min(TAIL_BYTES as u64) as usize;
        file.seek(io::SeekFrom::Start(observed - count as u64))
            .await?;
        let mut bytes = vec![0; count];
        file.read_exact(&mut bytes).await?;
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        state.observed = observed;
        state.tail = bytes.into();
        state.publish(now);
        Ok(())
    }
}

impl Drop for BashPreview {
    fn drop(&mut self) {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .sender = None;
    }
}

pub(super) struct PreviewReader<R> {
    reader: R,
    capture: Option<Arc<Mutex<Capture>>>,
}

impl<R> PreviewReader<R> {
    pub(super) fn new(reader: R, preview: Option<&BashPreview>) -> Self {
        match preview {
            Some(preview) => preview.reader(reader),
            None => Self {
                reader,
                capture: None,
            },
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for PreviewReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let start = buf.filled().len();
        let result = Pin::new(&mut self.reader).poll_read(cx, buf);
        let bytes = &buf.filled()[start..];
        if !bytes.is_empty()
            && let Some(capture) = &self.capture
        {
            let mut state = capture.lock().unwrap_or_else(|error| error.into_inner());
            if state.sender.is_some() {
                state.observed = state.observed.saturating_add(bytes.len() as u64);
                let bytes = &bytes[bytes.len().saturating_sub(TAIL_BYTES)..];
                let discard = (state.tail.len() + bytes.len()).saturating_sub(TAIL_BYTES);
                state.tail.drain(..discard);
                state.tail.extend(bytes);
                state.publish(Instant::now());
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn bounded_bash_progress_coalesces_without_changing_pipe_output() {
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        with_bash_progress(sender, async {
            let preview = BashPreview::new("fixture").unwrap();
            let (mut writer, pipe) = tokio::io::duplex(16_384);
            let input = format!("{}界 partial", "x".repeat(9_000));
            writer.write_all(input.as_bytes()).await.unwrap();
            drop(writer);
            let mut reader = PreviewReader::new(pipe, Some(&preview));
            let mut output = Vec::new();
            reader.read_to_end(&mut output).await.unwrap();
            assert_eq!(output, input.as_bytes());

            // Keep the first event waiting through a sampling interval so the
            // latest buffered bytes replace it in the same queue slot.
            tokio::time::sleep(Duration::from_millis(525)).await;
            let ServerEvent::BashProgress { update } = receiver.try_recv().unwrap() else {
                panic!("expected Bash progress");
            };
            let sample = update.snapshot();
            assert_eq!(sample.call_id, "fixture");
            assert_eq!(sample.output_bytes, input.len() as u64);
            assert!(sample.tail.len() <= TAIL_BYTES);
            assert!(sample.tail.ends_with("界 partial"));
            assert!(receiver.try_recv().is_err());
        })
        .await;
    }
}
