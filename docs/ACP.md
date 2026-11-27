# RayuCode Agent Client Protocol (ACP)

`rayu acp` exposes the shared Rayu daemon over **ACP v1** (newline-delimited JSON-RPC 2.0 over stdio or any bidirectional async stream) so **RayuCode Desktop**, **RayuCode VS Code Extension**, **Zed**, **JetBrains IDEs**, **Neovim**, and any other ACP-compatible host share the exact same engine, credentials, models, skills, and session history.

## Architecture

- **Engine (`src/cli/acp.rs` + `src/cli/acp/*`)**:
  - Backed by the shared Rayu daemon (`~/.rayu`), so sessions created in CLI, TUI, Desktop, VS Code, Zed, JetBrains, or Neovim are immediately shared via `session/list`, `session/load`, `session/resume`, and `session/fork`.
  - **Profiles**:
    - `standard` (default): strict ACP v1 spec for third-party IDEs (`rayu acp`).
    - `extended` / `full`: standard ACP v1 **plus** `_rayu/server_event` notifications for first-party Rayu hosts (`rayu acp --profile extended --product studio` for Desktop, `rayu acp --profile extended --product rayucode` for VS Code, or per-connection `_meta.rayu.profile` in `initialize`).
- **Shared TypeScript Client (`packages/acp-client` — `@rayu-dev/rayucode-acp-client`)**:
  - Reusable across `desktop/`, `vscode/`, and Node tooling.
  - Typed bidirectional JSON-RPC 2.0 client (`AcpClient.spawn(...)` or custom `AcpTransport`), permission prompt handler (`onPermissionRequest`), update streams (`onSessionUpdate`, `onRayuServerEvent`), structured `-32000` auth error detection (`isAuthRequiredError`), and IDE config builders (`buildIdeAcpConfig`).

## Supported ACP Methods

### Client → Agent
| Method | Description |
| --- | --- |
| `initialize` | Negotiates ACP v1, reads `clientCapabilities` & `clientInfo`, honors `_meta.rayu.profile`, advertises `sessionCapabilities` (`list`, `fork`, `resume`, `close`, `delete`), `mcpCapabilities` (`http`, `sse`), and `authMethods`. |
| `authenticate` | Supports `rayu-login` (browser OAuth or manual `callbackUrl`) and `rayu-api-key` (`RAYU_API_KEY` or `apiKey`), and notifies the running daemon. |
| `session/new` | Creates a daemon session for `cwd`, connects session-scoped `mcpServers`, returns `sessionId`, `configOptions`, `models`, `modes`, and `available_commands_update`. |
| `session/load` | Attaches an existing session and replays transcript (`user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`). |
| `session/resume` | Attaches an existing session without history replay. |
| `session/fork` | Clones an existing session via daemon split, attaches the new session with inherited mode, and returns `{ sessionId, configOptions, models, modes }`. |
| `session/list` | Lists persisted and active sessions (from the shared SQLite index + disk + live handles) with optional `cwd` filter and `cursor` / `nextCursor` pagination. |
| `session/close` | Detaches a session from the ACP connection and cleans up session-scoped MCP bridges. |
| `session/delete` | Detaches and deletes a session's persisted transcript, journal, backups, file-change cache, and metadata index row. |
| `session/set_mode` | Switches the daemon permission mode (`default`, `accept_edits`, `plan`, `full_manage`, `orchestrator`, plus IDE aliases like `acceptEdits`, `ask`, `code`, `architect`, `bypassPermissions`), works idle or mid-turn, and emits `current_mode_update` + `config_option_update`. |
| `session/set_config_option` | Switches `model`, `reasoning_effort`, or `mode` (plus compatibility aliases `session/set_model` and `session/set_reasoning_effort`). |
| `session/prompt` | Streams model output (`agent_message_chunk`), reasoning (`agent_thought_chunk`), tool lifecycle (`tool_call` / `tool_call_update` with `locations`, live `BashProgress`, and `diff` blocks), plans (`plan`), token usage (`usage_update`), and slash commands (`/model`, `/models`, `/effort`, `/mode`, plus skills). |
| `session/cancel` | Cancels the active prompt and immediately unblocks any pending permission prompt. |

### Agent → Client
| Method | Description |
| --- | --- |
| `session/request_permission` | Interactive permission gate for edit/command tools in `default` and `accept_edits` modes (`allow_once`, `allow_always`, `reject_once`). |
| `session/update` | Streaming updates (`agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`, `usage_update`, `session_info_update`). |
| `_rayu/server_event` | Raw daemon `ServerEvent` mirror (only emitted in `extended` / `full` profiles). |

## Connecting IDEs & Products

### Zed (`~/.config/zed/settings.json`)
```json
{
  "agent_servers": {
    "RayuCode": {
      "command": "rayu",
      "args": ["acp"]
    }
  }
}
```

### JetBrains (`~/.jetbrains/acp.json`)
```json
{
  "agent_servers": {
    "RayuCode": {
      "command": "rayu",
      "args": ["acp"]
    }
  }
}
```

### RayuCode Desktop / VS Code Extension (TypeScript)
```ts
import { AcpClient } from "@rayu-dev/rayucode-acp-client";

const client = AcpClient.spawn({ profile: "extended", product: "studio" }); // or "rayucode" for VS Code
client.onPermissionRequest(async (req) => ({
  outcome: { outcome: "selected", optionId: "allow_once" },
}));
await client.initialize({
  clientInfo: { name: "rayucode-desktop", version: "0.1.0" },
  profile: "extended",
  product: "studio",
});
```
