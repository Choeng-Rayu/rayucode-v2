import type { TodoSnapshot } from "@rayu-dev/rayucode-sdk/browser";

export interface TodoListCardProps {
  snapshot?: TodoSnapshot;
}

export function TodoListCard({ snapshot }: TodoListCardProps) {
  if (!snapshot || snapshot.todos.length === 0) return null;

  return (
    <section className="rc-todo-card" aria-label="Task plan">
      <div style={{ fontWeight: 600, marginBlockEnd: "6px" }}>
        Plan &amp; Todos ({snapshot.todos.length})
      </div>
      <ul style={{ margin: 0, paddingInlineStart: "18px", display: "grid", gap: "4px" }}>
        {snapshot.todos.map((item, idx) => {
          const text =
            typeof item.content === "string"
              ? item.content
              : typeof item.title === "string"
                ? item.title
                : JSON.stringify(item);
          const status = typeof item.status === "string" ? item.status : "pending";
          return (
            <li key={idx} data-todo-status={status}>
              <span style={{ color: "var(--rc-muted)", marginInlineEnd: "6px" }}>[{status}]</span>
              <span>{text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
