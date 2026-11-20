import type { TranscriptEntry } from "../state/sessionReducer.js";
import { RayuMarkIcon } from "./Icons.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { TurnCreditsFooter } from "./TurnCreditsFooter.js";

export interface ChatTranscriptProps {
  entries: TranscriptEntry[];
  liveTurnCredits?: number;
  onCopyCode?: (code: string) => void | Promise<void>;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
}

export function ChatTranscript({
  entries,
  liveTurnCredits,
  onCopyCode,
  welcomeTitle = "RayuCode",
  welcomeSubtitle = "Ask a question, explain code, or request edits across your workspace.",
}: ChatTranscriptProps) {
  if (entries.length === 0) {
    return (
      <div
        className="rc-transcript rc-scroll"
        style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}
      >
        <RayuMarkIcon size={32} />
        <h2 style={{ margin: 0 }}>{welcomeTitle}</h2>
        <p style={{ margin: 0, maxWidth: "42ch", color: "var(--rc-muted)" }}>{welcomeSubtitle}</p>
      </div>
    );
  }

  return (
    <div className="rc-transcript rc-scroll" role="log" aria-label="Conversation transcript">
      {entries.map((entry, idx) => {
        const isLastAssistant =
          entry.role === "assistant" && idx === entries.length - 1;
        return (
          <article key={entry.id} className="rc-message" data-role={entry.role}>
            <div style={{ fontSize: "var(--rc-font-size-xs)", fontWeight: 600, color: "var(--rc-muted)" }}>
              {entry.role === "user" ? "You" : entry.role === "assistant" ? "RayuCode" : "System"}
            </div>
            {entry.reasoning ? (
              <ThinkingBlock
                reasoning={entry.reasoning}
                durationSecs={entry.reasoningDurationSecs}
                streaming={entry.streaming}
              />
            ) : null}
            {entry.tools.length > 0 ? (
              <div style={{ display: "grid", gap: "6px" }}>
                {entry.tools.map((tool) => (
                  <ToolCallCard key={tool.callId} tool={tool} />
                ))}
              </div>
            ) : null}
            {entry.content ? (
              entry.role === "assistant" ? (
                <MarkdownRenderer content={entry.content} onCopyCode={onCopyCode} />
              ) : (
                <div style={{ whiteSpace: "pre-wrap" }}>{entry.content}</div>
              )
            ) : null}
            {entry.role === "assistant" ? (
              <TurnCreditsFooter
                stats={entry.responseStats}
                liveCredits={isLastAssistant ? liveTurnCredits : undefined}
                streaming={entry.streaming}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
