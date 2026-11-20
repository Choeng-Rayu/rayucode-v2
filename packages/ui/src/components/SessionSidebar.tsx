import type { SessionInfo } from "@rayu-dev/rayucode-sdk/browser";
import { PlusIcon, RayuMarkIcon } from "./Icons.js";

export interface SessionSidebarProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
}: SessionSidebarProps) {
  const rootSessions = sessions.filter((s) => !s.parent_session_id);

  return (
    <aside className="rc-sidebar" aria-label="Sessions">
      <div className="rc-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
          <RayuMarkIcon size={16} />
          RayuCode
        </span>
        <button type="button" className="rc-btn" onClick={onNewSession} aria-label="New session">
          <PlusIcon size={14} />
          New
        </button>
      </div>
      <div className="rc-scroll" style={{ flex: 1, padding: "8px", display: "grid", gap: "4px", alignContent: "start" }}>
        {rootSessions.map((session) => {
          const active = session.session_id === activeSessionId;
          const children = sessions.filter((c) => c.parent_session_id === session.session_id);
          return (
            <div key={session.session_id} style={{ display: "grid", gap: "4px" }}>
              <button
                type="button"
                className="rc-btn"
                aria-current={active ? "page" : undefined}
                style={{
                  justifyContent: "space-between",
                  textAlign: "start",
                  borderColor: active ? "var(--rc-accent)" : undefined,
                }}
                onClick={() => onSelectSession(session.session_id)}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {session.title || session.session_id}
                </span>
                <span style={{ fontSize: "var(--rc-font-size-xs)", color: "var(--rc-muted)" }}>
                  {session.status}
                </span>
              </button>
              {children.map((sub) => (
                <button
                  key={sub.session_id}
                  type="button"
                  className="rc-btn"
                  style={{
                    marginInlineStart: "14px",
                    justifyContent: "space-between",
                    fontSize: "var(--rc-font-size-xs)",
                  }}
                  onClick={() => onSelectSession(sub.session_id)}
                >
                  <span>{sub.agent_label || sub.title || sub.session_id}</span>
                  <span style={{ color: "var(--rc-muted)" }}>{sub.swarm_status || sub.status}</span>
                </button>
              ))}
            </div>
          );
        })}
        {rootSessions.length === 0 ? (
          <div style={{ padding: "8px", color: "var(--rc-muted)", fontSize: "var(--rc-font-size-xs)" }}>
            No sessions yet
          </div>
        ) : null}
      </div>
    </aside>
  );
}
