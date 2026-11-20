import type { SessionInfo } from "@rayu-dev/rayucode-sdk/browser";
import type { BackgroundTaskActivity } from "../state/sessionReducer.js";
import { BotIcon } from "./Icons.js";

export interface AgentActivityBarProps {
  isStreaming: boolean;
  status: string;
  connectionPhase: string;
  subagents: SessionInfo[];
  backgroundTasks: BackgroundTaskActivity[];
}

export function AgentActivityBar({
  isStreaming,
  status,
  connectionPhase,
  subagents,
  backgroundTasks,
}: AgentActivityBarProps) {
  const activeBg = backgroundTasks.filter((t) => !t.done);
  if (!isStreaming && subagents.length === 0 && activeBg.length === 0 && connectionPhase === "connected") {
    return null;
  }

  return (
    <div className="rc-activity-bar" role="status" aria-live="polite">
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 500 }}>
        <BotIcon size={14} />
        {isStreaming ? `Agent working (${status || "streaming"})` : `Status: ${connectionPhase}`}
      </span>
      {subagents.map((sub) => (
        <span
          key={sub.session_id}
          style={{
            padding: "2px 8px",
            borderRadius: "var(--rc-radius-full)",
            border: "1px solid var(--rc-border)",
            backgroundColor: "var(--rc-surface)",
          }}
        >
          Subagent {sub.agent_label || sub.title || sub.session_id}: {sub.swarm_status || sub.status}
        </span>
      ))}
      {activeBg.map((task) => (
        <span key={task.taskId}>
          {task.label}
          {typeof task.percent === "number" ? ` (${Math.round(task.percent)}%)` : ""}: {task.summary}
        </span>
      ))}
    </div>
  );
}
