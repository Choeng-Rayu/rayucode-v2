export interface ThinkingBlockProps {
  reasoning?: string;
  durationSecs?: number;
  streaming?: boolean;
}

export function ThinkingBlock({ reasoning, durationSecs, streaming }: ThinkingBlockProps) {
  if (!reasoning) return null;
  const summary = streaming
    ? "Thinking..."
    : typeof durationSecs === "number"
      ? `Thought for ${durationSecs.toFixed(1)}s`
      : "Reasoning";

  return (
    <details className="rc-thinking" open={Boolean(streaming)}>
      <summary style={{ cursor: "pointer", fontWeight: 500 }}>{summary}</summary>
      <pre
        style={{
          marginBlockStart: "8px",
          marginBlockEnd: 0,
          whiteSpace: "pre-wrap",
          fontFamily: "var(--rc-font-mono)",
          fontSize: "0.85em",
          color: "var(--rc-muted)",
        }}
      >
        {reasoning}
      </pre>
    </details>
  );
}
