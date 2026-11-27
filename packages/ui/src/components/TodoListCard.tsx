import type { TodoSnapshot } from "@rayu-dev/rayucode-sdk/browser";
import { normalizeTodoItems } from "@rayu-dev/rayucode-session-core/client";
import { TaskChecklistCard } from "./TaskChecklistCard.js";

export interface TodoListCardProps {
  snapshot?: TodoSnapshot;
  sessionId?: string | null;
  className?: string;
}

export function TodoListCard({
  snapshot,
  sessionId,
  className,
}: TodoListCardProps) {
  return (
    <TaskChecklistCard
      sessionId={sessionId}
      todos={normalizeTodoItems(snapshot)}
      className={className}
    />
  );
}
