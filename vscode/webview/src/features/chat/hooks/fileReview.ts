import type {
  FileChangeActionKind,
  FileChangeActionResultView,
} from "@shared/vscodeProtocol";
import { callRpc, isVsCodeWebview, useAppStore } from "@/lib";

export function useFileReviewAvailable(sessionId?: string): boolean {
  const daemon = useAppStore((state) => state.daemonStatus);
  return Boolean(
    sessionId &&
    (!isVsCodeWebview() ||
      (daemon.state === "connected" && daemon.capabilities.includes("file_changes"))),
  );
}

export async function applyFileReview(
  sessionId: string | undefined,
  action: FileChangeActionKind,
  path?: string,
  force = false,
): Promise<FileChangeActionResultView> {
  if (!sessionId) throw new Error("Select the session that made these edits.");
  if ((action === "keep" || action === "undo" || action === "redo") && !path) {
    throw new Error("Select a file from this session’s review.");
  }
  const params = { sessionId, path: path ?? "", ...(force ? { force: true } : {}) };
  const batch = { sessionId, ...(force ? { force: true } : {}) };
  const requests = {
    keep: () => callRpc("changes.keep", params),
    undo: () => callRpc("changes.undo", params),
    redo: () => callRpc("changes.redo", params),
    keep_all: () => callRpc("changes.keepAll", { sessionId }),
    undo_all: () => callRpc("changes.undoAll", batch),
    redo_all: () => callRpc("changes.redoAll", batch),
  };
  try {
    const result = await requests[action]();
    if (result.snapshot?.sessionId === sessionId) {
      useAppStore.getState().setFileChangesSnapshot(sessionId, result.snapshot);
    }
    return result;
  } finally {
    // The request may have partially completed even if the reply was lost.
    void callRpc("changes.getSessionSummary", { sessionId }).then((snapshot) => {
      if (snapshot.sessionId === sessionId) {
        useAppStore.getState().setFileChangesSnapshot(sessionId, snapshot);
      }
    }).catch(() => {});
  }
}
