//! Session-scoped ACP `mcpServers` bridge.
//!
//! Parses ACP `McpServer` descriptors (`stdio`, `http`, `sse`) passed to
//! `session/new`, `session/load`, `session/resume`, and `session/fork`,
//! connects them via an owned [`crate::mcp::McpManager`], registers their
//! tools on the attached Rayu daemon session with `Request::ConfigureTools`,
//! and serves `ServerEvent::ToolCall` callbacks with `Request::ToolResult`.

use crate::mcp::{ContentBlock, McpConfig, McpManager, McpServerConfig};
use crate::protocol::{SessionToolConfig, SessionToolDefinition};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

/// Maximum custom tool name length accepted by daemon SDK tool registration.
const MAX_SDK_TOOL_NAME_LEN: usize = 128;
/// Upper bound on connecting session-scoped ACP MCP servers during session creation.
const ACP_MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug)]
pub(super) struct ParsedAcpMcpServer {
    pub(super) name: String,
    pub(super) config: McpServerConfig,
}

/// Validate and parse the ACP `mcpServers` array from session params.
///
/// Accepts:
/// - `McpServerStdio`: `{ name, command, args?, env? }` (where `env` may be
///   an ACP `[{name, value}]` array OR a `{key: value}` object)
/// - `McpServerHttp` / `McpServerSse`: `{ type: "http"|"sse", name, url, headers? }`
///   (where `headers` may be an ACP `[{name, value}]` array OR a `{key: value}` object)
///
/// Unknown/incomplete entries with a `name` are tolerated (skipped when not runnable)
/// so older or non-standard hosts with placeholder entries do not break session creation,
/// while non-array `mcpServers` values return an invalid-params error.
pub(super) fn parse_acp_mcp_servers(
    params: &Value,
) -> std::result::Result<Vec<ParsedAcpMcpServer>, String> {
    let entries = match params.get("mcpServers") {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(entries)) => entries,
        Some(_) => return Err("ACP mcpServers must be an array".to_string()),
    };

    let mut parsed = Vec::new();
    let mut seen_names = HashSet::new();

    for entry in entries {
        let Some(obj) = entry.as_object() else {
            return Err("Each ACP mcpServers entry must be an object".to_string());
        };
        let Some(name) = obj
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            return Err("Each ACP mcpServers entry requires a non-empty string name".to_string());
        };
        if !seen_names.insert(name.to_string()) {
            continue;
        }

        let transport = obj
            .get("type")
            .and_then(Value::as_str)
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty());
        let command = obj
            .get("command")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        let url = obj
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let args: Vec<String> = obj
            .get("args")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();

        let env = parse_kv_map(obj.get("env"));
        let headers = parse_kv_map(obj.get("headers"));

        let config = McpServerConfig {
            command,
            args,
            env,
            // ACP mcpServers are explicitly session-scoped, never shared across sessions.
            shared: false,
            transport,
            url,
            headers,
            enabled: Some(true),
            disabled: None,
            timeout_secs: None,
        };

        if config.is_runnable() {
            parsed.push(ParsedAcpMcpServer {
                name: name.to_string(),
                config,
            });
        }
    }

    Ok(parsed)
}

/// Parse ACP key-value collections that may appear either as an array of
/// `{ "name": k, "value": v }` objects (official ACP schema) or as a JSON map
/// `{ k: v }` (common client variant).
fn parse_kv_map(value: Option<&Value>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    match value {
        Some(Value::Array(items)) => {
            for item in items {
                if let Some(obj) = item.as_object()
                    && let Some(k) = obj.get("name").and_then(Value::as_str)
                    && let Some(v) = obj.get("value").and_then(Value::as_str)
                    && !k.is_empty()
                {
                    map.insert(k.to_string(), v.to_string());
                }
            }
        }
        Some(Value::Object(obj)) => {
            for (k, v) in obj {
                if let Some(val) = v.as_str()
                    && !k.is_empty()
                {
                    map.insert(k.clone(), val.to_string());
                }
            }
        }
        _ => {}
    }
    map
}

fn sanitize_tool_segment(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-') {
            out.push(byte as char);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        out.push_str("tool");
    }
    out
}

pub(super) fn acp_mcp_tool_name(server: &str, tool: &str, used: &mut HashSet<String>) -> String {
    let base = format!(
        "mcp__{}__{}",
        sanitize_tool_segment(server),
        sanitize_tool_segment(tool)
    );
    let mut candidate: String = base.chars().take(MAX_SDK_TOOL_NAME_LEN).collect();
    if used.insert(candidate.clone()) {
        return candidate;
    }
    for suffix in 2usize..1000 {
        let tag = format!("_{suffix}");
        let max_prefix = MAX_SDK_TOOL_NAME_LEN.saturating_sub(tag.len());
        candidate = format!("{}{}", base.chars().take(max_prefix).collect::<String>(), tag);
        if used.insert(candidate.clone()) {
            return candidate;
        }
    }
    candidate
}

fn normalize_tool_parameters(schema: Value) -> Value {
    match schema {
        Value::Object(mut map) => {
            if map.get("type").and_then(Value::as_str) != Some("object") {
                map.insert("type".to_string(), Value::String("object".to_string()));
            }
            Value::Object(map)
        }
        _ => json!({ "type": "object", "properties": {} }),
    }
}

/// Session-owned MCP manager and tool routing map for ACP `mcpServers`.
pub(super) struct SessionMcpBridge {
    manager: Arc<McpManager>,
    /// Maps registered daemon custom tool name (`mcp__<server>__<tool>`) to
    /// `(server_name, mcp_tool_name)`.
    tool_routes: HashMap<String, (String, String)>,
    tool_definitions: Vec<SessionToolDefinition>,
}

impl SessionMcpBridge {
    /// Connect all parsed ACP `mcpServers` best-effort (bounded by
    /// [`ACP_MCP_CONNECT_TIMEOUT`]) and collect their tool definitions for
    /// registration via `Request::ConfigureTools`.
    pub(super) async fn connect(servers: Vec<ParsedAcpMcpServer>) -> Option<Self> {
        if servers.is_empty() {
            return None;
        }
        let mut server_map = HashMap::new();
        for server in servers {
            server_map.insert(server.name, server.config);
        }
        let manager = Arc::new(McpManager::with_config(McpConfig { servers: server_map }));
        match tokio::time::timeout(ACP_MCP_CONNECT_TIMEOUT, manager.connect_all()).await {
            Ok(Ok(_)) => {}
            Ok(Err(err)) => {
                crate::logging::warn(&format!("ACP session MCP connect_all failed: {err:#}"));
            }
            Err(_) => {
                crate::logging::warn(
                    "ACP session MCP connect_all timed out; continuing with connected servers",
                );
            }
        }

        let discovered = manager.all_tools().await;
        if discovered.is_empty() {
            // Keep the manager dropped if no tools were discovered from any server.
            manager.disconnect_all().await;
            return None;
        }

        let mut used = HashSet::new();
        let mut tool_routes = HashMap::new();
        let mut tool_definitions = Vec::with_capacity(discovered.len());

        for (server_name, def) in discovered {
            let registered_name = acp_mcp_tool_name(&server_name, &def.name, &mut used);
            let description = def
                .description
                .filter(|d| !d.trim().is_empty())
                .unwrap_or_else(|| format!("MCP tool '{}' from server '{}'", def.name, server_name));
            tool_routes.insert(registered_name.clone(), (server_name, def.name));
            tool_definitions.push(SessionToolDefinition {
                name: registered_name,
                description,
                parameters: normalize_tool_parameters(def.input_schema),
            });
        }

        Some(Self {
            manager,
            tool_routes,
            tool_definitions,
        })
    }

    pub(super) fn session_tool_config(&self) -> SessionToolConfig {
        SessionToolConfig {
            enabled: None,
            disabled: Vec::new(),
            custom: self.tool_definitions.clone(),
        }
    }

    pub(super) async fn execute(&self, registered_name: &str, input: Value) -> (String, Option<String>) {
        let Some((server, tool)) = self.tool_routes.get(registered_name).cloned() else {
            return (
                String::new(),
                Some(format!("Unknown ACP session MCP tool: {registered_name}")),
            );
        };
        match self.manager.call_tool(&server, &tool, input).await {
            Ok(result) => {
                let text = format_mcp_tool_content(&result.content);
                if result.is_error {
                    (
                        text.clone(),
                        Some(if text.is_empty() {
                            format!("MCP tool '{server}/{tool}' returned an error")
                        } else {
                            text
                        }),
                    )
                } else {
                    (text, None)
                }
            }
            Err(err) => (String::new(), Some(format!("MCP tool '{server}/{tool}' failed: {err:#}"))),
        }
    }

    pub(super) async fn shutdown(&self) {
        self.manager.disconnect_all().await;
    }
}

fn format_mcp_tool_content(blocks: &[ContentBlock]) -> String {
    let mut parts = Vec::new();
    for block in blocks {
        match block {
            ContentBlock::Text { text } => parts.push(text.clone()),
            ContentBlock::Image { mime_type, data } => {
                parts.push(format!("[Image: {mime_type}, {} base64 bytes]", data.len()));
            }
            ContentBlock::Resource { resource } => {
                if let Some(text) = &resource.text {
                    parts.push(format!("[Resource: {}]\n{text}", resource.uri));
                } else {
                    parts.push(format!("[Resource: {}]", resource.uri));
                }
            }
        }
    }
    parts.join("\n")
}
