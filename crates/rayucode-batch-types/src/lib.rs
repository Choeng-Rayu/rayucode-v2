use rayucode_message_types::ToolCall;
use serde::{Deserialize, Serialize};

/// Progress update from a running batch tool call
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BatchSubcallState {
    Running,
    Succeeded,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BatchSubcallMetrics {
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_bytes: Option<u64>,
}

impl BatchSubcallMetrics {
    pub fn section_prefix(self) -> String {
        match self.output_bytes {
            Some(bytes) => format!(
                "[batch timing: duration_ms={} output_bytes={bytes}] ",
                self.duration_ms
            ),
            None => format!("[batch timing: duration_ms={}] ", self.duration_ms),
        }
    }

    pub fn from_section_prefix(prefix: &str) -> Option<Self> {
        let (_, timing) = prefix.rsplit_once("[batch timing: duration_ms=")?;
        let timing = timing.strip_suffix("] ")?;
        let (duration_ms, output_bytes) = match timing.split_once(" output_bytes=") {
            Some((duration, bytes)) => (duration, Some(bytes.parse().ok()?)),
            None => (timing, None),
        };
        Some(Self {
            duration_ms: duration_ms.parse().ok()?,
            output_bytes,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BatchSubcallProgress {
    pub index: usize,
    pub tool_call: ToolCall,
    pub state: BatchSubcallState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics: Option<BatchSubcallMetrics>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BatchProgress {
    pub session_id: String,
    /// Parent tool_call_id of the batch call
    pub tool_call_id: String,
    /// Total number of sub-calls in this batch
    pub total: usize,
    /// Number of sub-calls that have completed (success or error)
    pub completed: usize,
    /// Name of the sub-call that just completed
    pub last_completed: Option<String>,
    /// Sub-calls that are currently still running
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub running: Vec<ToolCall>,
    /// Ordered per-subcall progress state for richer UI rendering
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subcalls: Vec<BatchSubcallProgress>,
}
