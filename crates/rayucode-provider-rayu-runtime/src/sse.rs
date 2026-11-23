//! Compact Anthropic Messages SSE parser for the Rayu gateway stream.
//!
//! Handles the full event vocabulary the gateway forwards: `message_start`,
//! `content_block_start`, `content_block_delta` (`text_delta`,
//! `input_json_delta`, `thinking_delta`, `signature_delta`),
//! `content_block_stop`, `message_delta` (usage / stop_reason), `message_stop`,
//! `ping`, and `error`. Unknown event and block types are ignored without
//! breaking the rest of the stream, so a newer gateway never wedges this
//! client. Chunk boundaries are arbitrary: UTF-8 characters and SSE events may
//! split across TCP reads (upstream issue #609).

use anyhow::Result;
use futures::StreamExt;
use rayucode_message_types::StreamEvent;
use rayucode_provider_core::EventStream;
use serde::Deserialize;
use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq, Eq)]
enum BlockKind {
    Text,
    Thinking,
    ToolUse(String),
    Other,
}

/// Incremental SSE → [`StreamEvent`] translator for one response stream.
#[derive(Default)]
pub(crate) struct SseParser {
    decoder: rayucode_base::util::Utf8StreamDecoder,
    buffer: String,
    queue: VecDeque<Result<StreamEvent>>,
    /// Block kind per content-block index, so `content_block_stop` knows
    /// whether to close a tool call or a thinking block, and `signature_delta`
    /// can route Gemini-3 tool signatures to `ToolUseSignatureFor`.
    blocks: Vec<Option<BlockKind>>,
    has_input_from_start: bool,
    message_ended: bool,
    model: Option<String>,
}

impl SseParser {
    pub(crate) fn with_model(model: Option<String>) -> Self {
        Self {
            model,
            ..Default::default()
        }
    }
    pub(crate) fn push_bytes(&mut self, chunk: &[u8]) {
        let text = self.decoder.decode(chunk);
        self.buffer.push_str(&text);
        self.drain_events();
    }

    /// Flush at end of stream: a final event missing its trailing blank line
    /// is still an event.
    pub(crate) fn finish(&mut self) {
        let rest = self.decoder.flush();
        self.buffer.push_str(&rest);
        if !self.buffer.trim().is_empty() {
            self.buffer.push_str("\n\n");
            self.drain_events();
        }
    }

    pub(crate) fn next_item(&mut self) -> Option<Result<StreamEvent>> {
        self.queue.pop_front()
    }

    fn drain_events(&mut self) {
        // SSE permits CRLF line endings, and a relay/proxy may normalize to
        // them; boundaries are searched as "\n\n", so fold CRLF first or the
        // whole stream would buffer until EOF. Fold the accumulated buffer
        // (not each chunk) so a \r\n split across two reads is still folded.
        if self.buffer.contains('\r') {
            self.buffer = self.buffer.replace("\r\n", "\n");
        }
        while let Some(end) = self.buffer.find("\n\n") {
            let event_str = self.buffer[..end].to_string();
            self.buffer.drain(..end + 2);
            let mut event_type = String::new();
            let mut data = String::new();
            for line in event_str.lines() {
                if let Some(rest) = line.strip_prefix("event:") {
                    event_type = rest.strip_prefix(' ').unwrap_or(rest).to_string();
                } else if let Some(rest) = rayucode_base::util::sse_data_line(line) {
                    if !data.is_empty() {
                        data.push('\n');
                    }
                    data.push_str(rest);
                }
            }
            if event_type.is_empty() && data.is_empty() {
                continue;
            }
            if event_type.is_empty()
                && let Ok(val) = serde_json::from_str::<serde_json::Value>(&data)
                && let Some(ty) = val.get("type").and_then(|v| v.as_str())
            {
                event_type = ty.to_string();
            }
            self.process_event(&event_type, &data);
        }
    }

    fn set_block(&mut self, index: usize, kind: BlockKind) {
        if self.blocks.len() <= index {
            self.blocks.resize(index + 1, None);
        }
        self.blocks[index] = Some(kind);
    }

    fn emit_usage(&mut self, usage: Usage) {
        self.queue.push_back(Ok(StreamEvent::TokenUsage {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
        }));
    }

    fn process_event(&mut self, event_type: &str, data: &str) {
        match event_type {
            "message_start" => {
                if let Ok(parsed) = serde_json::from_str::<MessageStart>(data)
                    && let Some(usage) = parsed.message.usage
                {
                    if usage.input_tokens.unwrap_or(0) > 0
                        || usage.cache_read_input_tokens.unwrap_or(0) > 0
                        || usage.cache_creation_input_tokens.unwrap_or(0) > 0
                    {
                        self.has_input_from_start = true;
                    }
                    self.emit_usage(usage);
                }
            }
            "content_block_start" => {
                let Ok(parsed) = serde_json::from_str::<ContentBlockStart>(data) else {
                    return;
                };
                let block = parsed.content_block;
                let kind = match block.block_type.as_str() {
                    "text" => BlockKind::Text,
                    "thinking" | "redacted_thinking" => BlockKind::Thinking,
                    "tool_use" => BlockKind::ToolUse(block.id.clone().unwrap_or_default()),
                    _ => BlockKind::Other,
                };
                self.set_block(parsed.index, kind.clone());
                match kind {
                    BlockKind::Text => {
                        if let Some(text) = block.text.filter(|t| !t.is_empty()) {
                            self.queue.push_back(Ok(StreamEvent::TextDelta(text)));
                        }
                    }
                    BlockKind::Thinking => {
                        self.queue.push_back(Ok(StreamEvent::ThinkingStart));
                        if let Some(thinking) = block.thinking.filter(|text| !text.is_empty()) {
                            self.queue
                                .push_back(Ok(StreamEvent::ThinkingDelta(thinking)));
                        }
                        if let Some(sig) = block.signature.filter(|s| !s.is_empty()) {
                            self.queue
                                .push_back(Ok(StreamEvent::ThinkingSignatureDelta(sig)));
                        }
                    }
                    BlockKind::ToolUse(_) => {
                        if let (Some(id), Some(name)) = (block.id, block.name) {
                            self.queue
                                .push_back(Ok(StreamEvent::ToolUseStart { id, name }));
                        }
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                let Ok(parsed) = serde_json::from_str::<ContentBlockDelta>(data) else {
                    return;
                };
                let delta = parsed.delta;
                let event = match delta.delta_type.as_str() {
                    "text_delta" => delta.text.map(StreamEvent::TextDelta),
                    "input_json_delta" => delta.partial_json.map(StreamEvent::ToolInputDelta),
                    "thinking_delta" => delta.thinking.map(StreamEvent::ThinkingDelta),
                    "signature_delta" => delta.signature.map(|sig| {
                        let tool_id = parsed
                            .index
                            .and_then(|idx| self.blocks.get(idx))
                            .and_then(|slot| slot.as_ref())
                            .and_then(|kind| match kind {
                                BlockKind::ToolUse(id) if !id.is_empty() => Some(id.clone()),
                                _ => None,
                            });
                        if let Some(id) = tool_id {
                            StreamEvent::ToolUseSignatureFor { id, signature: sig }
                        } else {
                            StreamEvent::ThinkingSignatureDelta(sig)
                        }
                    }),
                    _ => None,
                };
                if let Some(event) = event {
                    self.queue.push_back(Ok(event));
                }
            }
            "content_block_stop" => {
                let Ok(parsed) = serde_json::from_str::<ContentBlockStop>(data) else {
                    return;
                };
                let kind = self
                    .blocks
                    .get_mut(parsed.index)
                    .and_then(|slot| slot.take());
                match kind {
                    Some(BlockKind::ToolUse(_)) => {
                        self.queue.push_back(Ok(StreamEvent::ToolUseEnd));
                    }
                    Some(BlockKind::Thinking) => {
                        self.queue.push_back(Ok(StreamEvent::ThinkingEnd));
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                let Ok(parsed) = serde_json::from_str::<MessageDelta>(data) else {
                    return;
                };
                if let Some(mut usage) = parsed.usage {
                    // Output-only deltas (or proxies echoing 0 for input buckets)
                    // must not wipe non-zero input/cache counts reported by
                    // `message_start`.
                    if self.has_input_from_start
                        && usage.input_tokens.unwrap_or(0) == 0
                        && usage.cache_read_input_tokens.unwrap_or(0) == 0
                        && usage.cache_creation_input_tokens.unwrap_or(0) == 0
                    {
                        usage.input_tokens = None;
                        usage.cache_read_input_tokens = None;
                        usage.cache_creation_input_tokens = None;
                    }
                    self.emit_usage(usage);
                }
                if let Some(charge) = parsed
                    .rayu
                    .as_ref()
                    .and_then(rayucode_message_types::RayuRequestCharge::from_json_value)
                {
                    self.queue.push_back(Ok(StreamEvent::RayuCharge(charge)));
                }
                if let Some(stop_reason) = parsed.delta.stop_reason {
                    self.message_ended = true;
                    self.queue.push_back(Ok(StreamEvent::MessageEnd {
                        stop_reason: Some(stop_reason),
                    }));
                }
            }
            "message_stop" => {
                // Defensive close: the gateway normally reports stop_reason on
                // message_delta, but a stream that skips it must still end the
                // turn exactly once.
                if !self.message_ended {
                    self.message_ended = true;
                    self.queue
                        .push_back(Ok(StreamEvent::MessageEnd { stop_reason: None }));
                }
            }
            "ping" => {
                // Keepalive surfaced as a phase event so downstream stall
                // guards see traffic during silent reasoning (upstream #451).
                self.queue.push_back(Ok(StreamEvent::ConnectionPhase {
                    phase: rayucode_message_types::ConnectionPhase::Streaming,
                }));
            }
            "error" => {
                let err = rayucode_base::rayu::RayuGatewayError::from_sse_error_data(
                    data,
                    self.model.as_deref(),
                );
                self.queue.push_back(Ok(StreamEvent::Error {
                    message: err.message,
                    retry_after_secs: None,
                }));
            }
            _ => {
                // Unknown event types are ignored so a newer gateway keeps
                // working with this client.
            }
        }
    }
}

#[derive(Deserialize)]
struct MessageStart {
    message: MessageStartBody,
}

#[derive(Deserialize)]
struct MessageStartBody {
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct ContentBlockStart {
    index: usize,
    content_block: ContentBlockStartBody,
}

#[derive(Deserialize)]
struct ContentBlockStartBody {
    #[serde(rename = "type")]
    block_type: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    signature: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
struct ContentBlockDelta {
    #[serde(default)]
    index: Option<usize>,
    delta: DeltaBody,
}

#[derive(Deserialize)]
struct DeltaBody {
    #[serde(rename = "type")]
    delta_type: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    partial_json: Option<String>,
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    signature: Option<String>,
}

#[derive(Deserialize)]
struct ContentBlockStop {
    index: usize,
}

#[derive(Deserialize)]
struct MessageDelta {
    delta: StopDelta,
    #[serde(default)]
    usage: Option<Usage>,
    #[serde(default)]
    rayu: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct StopDelta {
    #[serde(default)]
    stop_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
struct Usage {
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
    #[serde(default)]
    cache_read_input_tokens: Option<u64>,
    #[serde(default)]
    cache_creation_input_tokens: Option<u64>,
}

/// Correlation facts about one gateway response, attached to transport
/// errors so a client failure can be matched to gateway and edge logs.
#[derive(Clone, Debug, Default)]
pub(crate) struct ResponseTrace {
    pub(crate) request_id: String,
    http_version: String,
    /// Edge/proxy identifiers, e.g. `cf-ray`, in header order.
    edge: Vec<(&'static str, String)>,
}

/// Response headers worth recording. All are non-secret routing metadata.
const TRACE_HEADERS: &[&str] = &["cf-ray", "server", "via", "x-request-id"];

impl ResponseTrace {
    pub(crate) fn from_response(response: &reqwest::Response, request_id: String) -> Self {
        let edge = TRACE_HEADERS
            .iter()
            .filter_map(|name| {
                let value = response.headers().get(*name)?.to_str().ok()?;
                Some((
                    *name,
                    rayucode_base::util::truncate_str(value, 120).to_string(),
                ))
            })
            .collect();
        Self {
            request_id,
            http_version: format!("{:?}", response.version()),
            edge,
        }
    }

    pub(crate) fn describe(&self) -> String {
        let mut out = format!("request_id={} http={}", self.request_id, self.http_version);
        for (name, value) in &self.edge {
            out.push_str(&format!(" {name}={value}"));
        }
        out
    }
}

/// Renders an error with every `source()` cause. reqwest labels any body-read
/// failure "error decoding response body"; the real reason (unexpected EOF,
/// connection reset, HTTP/2 RST_STREAM, TLS close) lives in the chain.
pub(crate) fn error_chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut out = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !out.ends_with(&text) {
            out.push_str(": ");
            out.push_str(&text);
        }
        source = cause.source();
    }
    out
}

/// Wrap a gateway HTTP response as a provider [`EventStream`], guarding reads
/// against dead TCP connections with `idle_timeout`.
pub(crate) fn stream_events(
    response: reqwest::Response,
    trace: ResponseTrace,
    idle_timeout: std::time::Duration,
    model: Option<String>,
) -> EventStream {
    let inner = response.bytes_stream();
    let parser = SseParser::with_model(model);
    let started = std::time::Instant::now();
    let trace = std::sync::Arc::new(trace);
    Box::pin(futures::stream::unfold(
        (inner, parser, false, 0usize),
        move |(mut inner, mut parser, mut finished, mut bytes_read)| {
            let trace = std::sync::Arc::clone(&trace);
            async move {
                loop {
                    if let Some(item) = parser.next_item() {
                        return Some((item, (inner, parser, finished, bytes_read)));
                    }
                    if finished {
                        return None;
                    }
                    match tokio::time::timeout(idle_timeout, inner.next()).await {
                        Ok(Some(Ok(bytes))) => {
                            bytes_read += bytes.len();
                            parser.push_bytes(&bytes);
                        }
                        Ok(Some(Err(error))) => {
                            finished = true;
                            let message = format!(
                                "Rayu gateway stream transport error: {} ({}, bytes_read={bytes_read}, elapsed_ms={}, message_ended={})",
                                error_chain(&error),
                                trace.describe(),
                                started.elapsed().as_millis(),
                                parser.message_ended,
                            );
                            rayucode_base::logging::warn(&message);
                            return Some((
                                Err(anyhow::anyhow!(message)),
                                (inner, parser, finished, bytes_read),
                            ));
                        }
                        Ok(None) => {
                            finished = true;
                            parser.finish();
                        }
                        Err(_) => {
                            finished = true;
                            let message = format!(
                                "Rayu gateway stream idle timeout after {:?} ({}, bytes_read={bytes_read}, elapsed_ms={}, message_ended={})",
                                idle_timeout,
                                trace.describe(),
                                started.elapsed().as_millis(),
                                parser.message_ended,
                            );
                            rayucode_base::logging::warn(&message);
                            return Some((
                                Err(anyhow::anyhow!(message)),
                                (inner, parser, finished, bytes_read),
                            ));
                        }
                    }
                }
            }
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_all(chunks: &[&[u8]]) -> Vec<Result<StreamEvent>> {
        let mut parser = SseParser::default();
        let mut out = Vec::new();
        for chunk in chunks {
            parser.push_bytes(chunk);
            while let Some(item) = parser.next_item() {
                out.push(item);
            }
        }
        parser.finish();
        while let Some(item) = parser.next_item() {
            out.push(item);
        }
        out
    }

    const FULL_STREAM: &str = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"model\":\"rayu-future-model-9\",\"usage\":{\"input_tokens\":10,\"output_tokens\":1,\"cache_read_input_tokens\":5}}}\n\n",
        "event: ping\n",
        "data: {\"type\":\"ping\"}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"considering\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"sig-abc\"}}\n\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello 世界\"}}\n\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":1}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":2,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"bash\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"ls\\\"}\"}}\n\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":2}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":42}}\n\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n\n",
    );

    #[test]
    fn parses_the_full_anthropic_event_vocabulary() {
        let events = parse_all(&[FULL_STREAM.as_bytes()]);
        let events: Vec<StreamEvent> = events.into_iter().map(|item| item.unwrap()).collect();
        assert!(matches!(
            &events[0],
            StreamEvent::TokenUsage {
                input_tokens: Some(10),
                output_tokens: Some(1),
                cache_read_input_tokens: Some(5),
                cache_creation_input_tokens: None,
            }
        ));
        assert!(matches!(
            &events[1],
            StreamEvent::ConnectionPhase {
                phase: rayucode_message_types::ConnectionPhase::Streaming
            }
        ));
        assert!(matches!(&events[2], StreamEvent::ThinkingStart));
        assert!(matches!(&events[3], StreamEvent::ThinkingDelta(text) if text == "considering"));
        assert!(matches!(&events[4], StreamEvent::ThinkingSignatureDelta(sig) if sig == "sig-abc"));
        assert!(matches!(&events[5], StreamEvent::ThinkingEnd));
        assert!(matches!(&events[6], StreamEvent::TextDelta(text) if text == "Hello 世界"));
        assert!(matches!(
            &events[7],
            StreamEvent::ToolUseStart { id, name } if id == "toolu_1" && name == "bash"
        ));
        assert!(matches!(&events[8], StreamEvent::ToolInputDelta(json) if json == "{\"command\":"));
        assert!(matches!(&events[9], StreamEvent::ToolInputDelta(json) if json == "\"ls\"}"));
        assert!(matches!(&events[10], StreamEvent::ToolUseEnd));
        assert!(matches!(
            &events[11],
            StreamEvent::TokenUsage {
                output_tokens: Some(42),
                ..
            }
        ));
        assert!(matches!(
            &events[12],
            StreamEvent::MessageEnd {
                stop_reason: Some(reason)
            } if reason == "tool_use"
        ));
        // message_stop after a stop_reason must not emit a second MessageEnd.
        assert_eq!(events.len(), 13);
    }

    #[test]
    fn survives_arbitrary_chunk_splits_including_mid_utf8() {
        let bytes = FULL_STREAM.as_bytes();
        // Split at every possible byte position, including inside the 3-byte
        // CJK characters and inside SSE event framing.
        for split in 0..bytes.len() {
            let events = parse_all(&[&bytes[..split], &bytes[split..]]);
            assert_eq!(events.len(), 13, "split at {split}");
            assert!(events.iter().all(|item| item.is_ok()), "split at {split}");
            let text: String = events
                .iter()
                .filter_map(|item| match item.as_ref().unwrap() {
                    StreamEvent::TextDelta(text) => Some(text.as_str()),
                    _ => None,
                })
                .collect();
            assert_eq!(text, "Hello 世界", "split at {split}");
        }
    }

    #[test]
    fn crlf_framing_streams_incrementally_including_split_crlf_pairs() {
        // A relay that normalizes LF to CRLF must not stall the stream until
        // EOF: events must drain as they arrive, exactly like LF framing.
        let crlf = FULL_STREAM.replace('\n', "\r\n");
        let events = parse_all(&[crlf.as_bytes()]);
        assert_eq!(events.len(), 13);
        assert!(events.iter().all(|item| item.is_ok()));
        let text: String = events
            .iter()
            .filter_map(|item| match item.as_ref().unwrap() {
                StreamEvent::TextDelta(text) => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "Hello 世界");

        // Split at every byte, including inside \r\n pairs and CJK chars.
        let bytes = crlf.as_bytes();
        for split in 0..bytes.len() {
            let events = parse_all(&[&bytes[..split], &bytes[split..]]);
            assert_eq!(events.len(), 13, "split at {split}");
            assert!(events.iter().all(|item| item.is_ok()), "split at {split}");
        }

        // Incremental delivery: the first text delta must surface from the
        // first chunk, not only after the stream ends.
        let mut parser = SseParser::default();
        let head = crlf.find("Hello").unwrap();
        // End of the event that carries the first text delta.
        let cut = head + crlf[head..].find("\r\n\r\n").unwrap() + 4;
        parser.push_bytes(crlf[..cut].as_bytes());
        let mut saw_text = false;
        while let Some(item) = parser.next_item() {
            if matches!(item.unwrap(), StreamEvent::TextDelta(_)) {
                saw_text = true;
            }
        }
        assert!(saw_text, "text must drain before EOF under CRLF framing");
    }

    #[test]
    fn error_events_surface_as_stream_errors() {
        let stream = concat!(
            "event: error\n",
            "data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n",
        );
        let events = parse_all(&[stream.as_bytes()]);
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].as_ref().unwrap(),
            StreamEvent::Error { message, retry_after_secs: None } if message.contains("Overloaded")
        ));
    }

    #[test]
    fn unknown_events_and_blocks_do_not_break_the_stream() {
        let stream = concat!(
            "event: brand_new_event\n",
            "data: {\"type\":\"brand_new_event\"}\n\n",
            "event: content_block_start\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"server_tool_use\",\"id\":\"srvtoolu_1\",\"name\":\"web_search\"}}\n\n",
            "event: content_block_stop\n",
            "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
            "event: content_block_start\n",
            "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"still works\"}}\n\n",
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\"}\n\n",
        );
        let events = parse_all(&[stream.as_bytes()]);
        let events: Vec<StreamEvent> = events.into_iter().map(|item| item.unwrap()).collect();
        assert!(matches!(&events[0], StreamEvent::TextDelta(text) if text == "still works"));
        // message_stop without a prior message_delta closes the turn once.
        assert!(matches!(
            &events[1],
            StreamEvent::MessageEnd { stop_reason: None }
        ));
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn final_event_without_trailing_blank_line_is_still_parsed() {
        let stream = "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}";
        let events = parse_all(&[stream.as_bytes()]);
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].as_ref().unwrap(),
            StreamEvent::MessageEnd {
                stop_reason: Some(reason)
            } if reason == "end_turn"
        ));
    }

    #[test]
    fn message_delta_parses_gateway_rayu_credit_charge() {
        let stream = concat!(
            "event: message_delta\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":42},\"rayu\":{\"billableTokens\":443760,\"tokensPerCredit\":1000,\"credits\":443.76}}\n\n",
        );
        let events: Vec<StreamEvent> = parse_all(&[stream.as_bytes()])
            .into_iter()
            .map(|item| item.unwrap())
            .collect();
        assert_eq!(events.len(), 3);
        assert!(matches!(
            events[0],
            StreamEvent::TokenUsage {
                output_tokens: Some(42),
                ..
            }
        ));
        assert!(matches!(
            events[1],
            StreamEvent::RayuCharge(charge)
                if (charge.credits - 443.76).abs() < 1e-9
                    && charge.billable_tokens == Some(443_760)
                    && charge.tokens_per_credit == Some(1_000)
        ));
        assert!(matches!(
            &events[2],
            StreamEvent::MessageEnd {
                stop_reason: Some(reason)
            } if reason == "end_turn"
        ));
    }

    #[test]
    fn tool_use_signature_delta_emits_tool_use_signature_for() {
        let stream = concat!(
            "event: content_block_start\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_g3_1\",\"name\":\"read\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"GEMINI3_SIG\"}}\n\n",
            "event: content_block_stop\n",
            "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        );
        let events: Vec<StreamEvent> = parse_all(&[stream.as_bytes()])
            .into_iter()
            .map(|item| item.unwrap())
            .collect();
        assert!(events.iter().any(|ev| matches!(
            ev,
            StreamEvent::ToolUseSignatureFor { id, signature }
                if id == "toolu_g3_1" && signature == "GEMINI3_SIG"
        )));
    }

    #[test]
    fn output_only_zero_input_message_delta_does_not_overwrite_message_start_usage() {
        let stream = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":500,\"cache_read_input_tokens\":400,\"output_tokens\":1}}}\n\n",
            "event: message_delta\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":0,\"cache_read_input_tokens\":0,\"output_tokens\":55}}\n\n",
        );
        let events: Vec<StreamEvent> = parse_all(&[stream.as_bytes()])
            .into_iter()
            .map(|item| item.unwrap())
            .collect();
        assert!(matches!(
            events[0],
            StreamEvent::TokenUsage {
                input_tokens: Some(500),
                cache_read_input_tokens: Some(400),
                ..
            }
        ));
        assert!(matches!(
            events[1],
            StreamEvent::TokenUsage {
                input_tokens: None,
                cache_read_input_tokens: None,
                cache_creation_input_tokens: None,
                output_tokens: Some(55),
            }
        ));
    }
}
