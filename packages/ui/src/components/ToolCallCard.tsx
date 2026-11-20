import type { ToolExecutionItem } from "../state/sessionReducer.js";
import { AlertIcon, CheckCircleIcon, ToolIcon } from "./Icons.js";

export interface ToolCallCardProps {
  tool: ToolExecutionItem;
}

const STATUS_LABELS: Record<ToolExecutionItem["status"], string> = {
  pending: "Queued",
  running: "Running",
  done: "Completed",
  error: "Failed",
};

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const statusIcon =
    tool.status === "done" ? (
      <CheckCircleIcon size={14} />
    ) : tool.status === "error" ? (
      <AlertIcon size={14} />
    ) : (
      <ToolIcon size={14} />
    );

  return (
    <details className="rc-tool-card" data-tool-status={tool.status}>
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 600 }}>
          {statusIcon}
          <code>{tool.name}</code>
        </span>
        <span style={{ fontSize: "var(--rc-font-size-xs)", color: "var(--rc-muted)" }}>
          {STATUS_LABELS[tool.status]}
        </span>
      </summary>
      {tool.inputText ? (
        <pre className="rc-code-pre" style={{ marginBlockStart: "8px" }}>
          {tool.inputText}
        </pre>
      ) : null}
      {tool.output ? (
        <pre className="rc-code-pre" style={{ marginBlockStart: "8px" }}>
          {tool.output}
        </pre>
      ) : null}
      {tool.error ? (
        <pre
          className="rc-code-pre"
          style={{ marginBlockStart: "8px", color: "var(--rc-danger)" }}
        >
          {tool.error}
        </pre>
      ) : null}
    </details>
  );
}
