import type {
  FileChangeActionKind,
  FileChangeActionResultView,
  FileChangesSnapshotView,
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
  onSnapshot?: (snapshot: FileChangesSnapshotView) => void,
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
  const updateSnapshot = (snapshot: FileChangeActionResultView["snapshot"]) => {
    if (snapshot?.sessionId === sessionId) {
      useAppStore.getState().setFileChangesSnapshot(sessionId, snapshot);
      onSnapshot?.(snapshot);
    }
  };
  const refresh = () => callRpc("changes.getSessionSummary", { sessionId })
    .then(updateSnapshot)
    .catch(() => {});
  try {
    const result = await requests[action]();
    updateSnapshot(result.snapshot);
    if (!result.ok || !result.snapshot) await refresh();
    return result;
  } catch (error) {
    await refresh();
    throw error;
  }
}
