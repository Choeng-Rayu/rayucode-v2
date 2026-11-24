import * as React from "react";
import {
   queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ChangedFileView,
  ChangesStatusView,
  FileChangesSnapshotView,
  FileDiffView,
  FileReviewDecision,
} from "@shared/vscodeProtocol";

import { useAppStore } from "@/lib/app-store";
import { callRpc, onHostMessage, postToHost } from "@/lib/rpc-client";

export type ChangesScope = "session" | "git";
export type DiffViewMode = "unified" | "split";

export interface DiffHunkLine {
  type: "hunk" | "add" | "del" | "ctx";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  lineNumber: number | null;
  mark: string;
  content: string;
}

export interface CommitReceipt {
  commitHash: string;
  summary: string;
  committedCount: number;
}

export interface CreatedPrReceipt {
  url: string;
  number: number;
  title: string;
  baseBranch: string;
  headBranch: string;
}

export interface CreatePrInput {
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
  draft?: boolean;
}

export function parseUnifiedDiffLines(unifiedDiff: string): DiffHunkLine[] {
  const rawLines = unifiedDiff.replace(/\r\n/g, "\n").split("\n");
  const parsed: DiffHunkLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const raw of rawLines) {
    if (!raw && parsed.length > 0 && rawLines[rawLines.length - 1] === raw) {
      continue;
    }
    if (
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) {
      continue;
    }

    if (raw.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (match) {
        oldLine = Number.parseInt(match[1] ?? "1", 10);
        newLine = Number.parseInt(match[2] ?? "1", 10);
      }
      parsed.push({
        type: "hunk",
        oldLineNumber: null,
        newLineNumber: null,
        lineNumber: null,
        mark: "@@",
        content: raw,
      });
      continue;
    }

    if (raw.startsWith("+")) {
      parsed.push({
        type: "add",
        oldLineNumber: null,
        newLineNumber: newLine,
        lineNumber: newLine,
        mark: "+",
        content: raw.slice(1),
      });
      newLine += 1;
      continue;
    }

    if (raw.startsWith("-")) {
      parsed.push({
        type: "del",
        oldLineNumber: oldLine,
        newLineNumber: null,
        lineNumber: oldLine,
        mark: "-",
        content: raw.slice(1),
      });
      oldLine += 1;
      continue;
    }

    const content = raw.startsWith(" ") ? raw.slice(1) : raw;
    parsed.push({
      type: "ctx",
      oldLineNumber: oldLine,
      newLineNumber: newLine,
      lineNumber: newLine,
      mark: " ",
      content,
    });
    oldLine += 1;
    newLine += 1;
  }

  return parsed;
}

export function changesStatusQueryOptions(
  sessionId: string | null,
  scope: ChangesScope,
) {
  return queryOptions({
    queryKey: ["changes", "status", sessionId ?? "workspace", scope] as const,
    queryFn: () =>
      callRpc("changes.status", {
        sessionId: sessionId ?? undefined,
        scope,
      }),
  });
}

export function fileDiffQueryOptions(
  path: string | null,
  sessionId: string | null,
  scope: ChangesScope,
) {
  return queryOptions({
    queryKey: [
      "changes",
      "diff",
      path ?? "",
      sessionId ?? "workspace",
      scope,
    ] as const,
    queryFn: () =>
      callRpc("changes.diff", {
        path: path ?? "",
        sessionId: sessionId ?? undefined,
        scope,
      }),
    enabled: Boolean(path),
  });
}

export function useChanges() {
  const queryClient = useQueryClient();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setStoreFileChangesSnapshot = useAppStore(
    (s) => s.setFileChangesSnapshot,
  );
  const sessionSnapshot = useAppStore((s) =>
    activeSessionId ? (s.fileChangesBySession[activeSessionId] ?? null) : null,
  );

  const [scope, setScope] = React.useState<ChangesScope>("git");
  const [diffMode, setDiffMode] = React.useState<DiffViewMode>("unified");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [inlinePreviewOpen, setInlinePreviewOpen] = React.useState(false);
  const [lastCommit, setLastCommit] = React.useState<CommitReceipt | null>(null);
  const [createdPr, setCreatedPr] = React.useState<CreatedPrReceipt | null>(
    null,
  );
  const [actionError, setActionError] = React.useState<string | null>(null);

  const statusQuery = useQuery(
    changesStatusQueryOptions(activeSessionId, scope),
  );

  const applyFileChangesSnapshotToCache = React.useCallback(
    (snapshot: FileChangesSnapshotView) => {
      if (snapshot.sessionId) {
        setStoreFileChangesSnapshot(snapshot.sessionId, snapshot);
      }
      const patchStatus = (prev: ChangesStatusView | undefined) => {
        if (!prev) return prev;
        const nextFiles = prev.files.map((file) => {
          const matched = snapshot.files.find(
            (entry) =>
              entry.displayPath === file.path || entry.path === file.path,
          );
          if (!matched) return file;
          const decision: FileReviewDecision =
            matched.status === "kept"
              ? "accepted"
              : matched.status === "undone"
                ? "rejected"
                : "pending";
          return {
            ...file,
            fromSession: true,
            decision,
            additions: matched.additions,
            deletions: matched.deletions,
            staged: matched.status === "undone" ? false : file.staged,
          };
        });
        return {
          ...prev,
          files: nextFiles,
          totalAdditions: nextFiles.reduce((acc, f) => acc + f.additions, 0),
          totalDeletions: nextFiles.reduce((acc, f) => acc + f.deletions, 0),
          stagedCount: nextFiles.filter((f) => f.staged).length,
        };
      };

      for (const targetScope of ["git", "session"] as const) {
        const key = changesStatusQueryOptions(
          activeSessionId,
          targetScope,
        ).queryKey;
        queryClient.setQueryData<ChangesStatusView>(key, patchStatus);
      }
      void queryClient.invalidateQueries({ queryKey: ["changes", "status"] });
      void queryClient.invalidateQueries({ queryKey: ["changes", "diff"] });
    },
    [activeSessionId, queryClient, setStoreFileChangesSnapshot],
  );

  // Sync ChangesView immediately whenever Chat or another VS Code surface updates file changes
  React.useEffect(() => {
    return onHostMessage((msg) => {
      if (msg.type !== "rayucode.fileChanges.updated") return;
      if (activeSessionId && msg.sessionId !== activeSessionId) return;
      applyFileChangesSnapshotToCache(msg.snapshot);
    });
  }, [activeSessionId, applyFileChangesSnapshotToCache]);

  React.useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    void callRpc("changes.getSessionSummary", { sessionId: activeSessionId })
      .then((snapshot) => {
        if (!cancelled) {
          setStoreFileChangesSnapshot(activeSessionId, snapshot);
        }
      })
      .catch(() => {
        // Ignore if daemon does not support file_changes
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, setStoreFileChangesSnapshot]);

  const visibleFiles = React.useMemo<ChangedFileView[]>(() => {
    const files = statusQuery.data?.files ?? [];
    if (scope === "session") {
      return files.filter((file) => file.fromSession);
    }
    return files;
  }, [scope, statusQuery.data?.files]);

  const activeFile = React.useMemo<ChangedFileView | null>(() => {
    if (visibleFiles.length === 0) return null;
    if (selectedPath) {
      const found = visibleFiles.find((f) => f.path === selectedPath);
      if (found) return found;
    }
    return visibleFiles[0] ?? null;
  }, [selectedPath, visibleFiles]);

  const diffQuery = useQuery(
    fileDiffQueryOptions(activeFile?.path ?? null, activeSessionId, scope),
  );

  const diffLines = React.useMemo<DiffHunkLine[]>(() => {
    if (diffQuery.data?.unifiedDiff) {
      return parseUnifiedDiffLines(diffQuery.data.unifiedDiff);
    }
    if (!activeFile) return [];
    return [
      {
        type: "hunk",
        oldLineNumber: null,
        newLineNumber: null,
        lineNumber: null,
        mark: "@@",
        content: `@@ -1,${Math.max(1, activeFile.deletions)} +1,${Math.max(1, activeFile.additions)} @@ ${activeFile.path}`,
      },
      ...(activeFile.deletions > 0
        ? [
            {
              type: "del" as const,
              oldLineNumber: 1,
              newLineNumber: null,
              lineNumber: 1,
              mark: "-",
              content: `// removed ${activeFile.deletions} line(s) in ${activeFile.path}`,
            },
          ]
        : []),
      ...(activeFile.additions > 0
        ? [
            {
              type: "add" as const,
              oldLineNumber: null,
              newLineNumber: 1,
              lineNumber: 1,
              mark: "+",
              content: `// added ${activeFile.additions} line(s) in ${activeFile.path}`,
            },
          ]
        : []),
    ];
  }, [activeFile, diffQuery.data?.unifiedDiff]);

  const updateCachedStatus = React.useCallback(
    (updater: (prev: ChangesStatusView) => ChangesStatusView) => {
      const key = changesStatusQueryOptions(activeSessionId, scope).queryKey;
      queryClient.setQueryData<ChangesStatusView>(key, (prev) =>
        prev ? updater(prev) : prev,
      );
    },
    [activeSessionId, queryClient, scope],
  );

  const stageMutation = useMutation({
    mutationFn: async ({
      paths,
      stage,
    }: {
      paths: string[];
      stage: boolean;
    }) => {
      return stage
        ? callRpc("changes.stage", { paths })
        : callRpc("changes.unstage", { paths });
    },
    onSuccess: (_res, { paths, stage }) => {
      setActionError(null);
      const pathSet = new Set(paths);
      updateCachedStatus((prev) => {
        const nextFiles = prev.files.map((f) =>
          pathSet.has(f.path) ? { ...f, staged: stage } : f,
        );
        return {
          ...prev,
          files: nextFiles,
          stagedCount: nextFiles.filter((f) => f.staged).length,
        };
      });
    },
  });

  const keepMutation = useMutation({
    mutationFn: async (path: string) =>
      callRpc("changes.keep", {
        path,
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (res, path) => {
      if (!res.ok) {
        setActionError(res.message ?? `Failed to keep changes in ${path}.`);
        return;
      }
      setActionError(null);
      if (res.snapshot) {
        applyFileChangesSnapshotToCache(res.snapshot);
      }
      updateCachedStatus((prev) => ({
        ...prev,
        files: prev.files.map((f) =>
          f.path === path
            ? { ...f, decision: "accepted" as FileReviewDecision, staged: true }
            : f,
        ),
        stagedCount: prev.files.filter((f) => f.path === path || f.staged)
          .length,
      }));
    },
  });

  const undoMutation = useMutation({
    mutationFn: async ({ path, force }: { path: string; force?: boolean }) =>
      callRpc("changes.undo", {
        path,
        sessionId: activeSessionId ?? undefined,
        ...(force ? { force: true } : {}),
      }),
    onSuccess: (res, { path }) => {
      if (res.snapshot) {
        applyFileChangesSnapshotToCache(res.snapshot);
      }
      if (!res.ok || res.conflict || (res.conflicts && res.conflicts.length > 0)) {
        const conflictDetail = res.conflicts?.[0]?.reason;
        setActionError(
          conflictDetail ??
            res.message ??
            `Cannot auto-revert ${path}: manual edits were detected after the session snapshot.`,
        );
        return;
      }
      setActionError(null);
      updateCachedStatus((prev) => {
        const nextFiles = prev.files.map((f) =>
          f.path === path
            ? {
                ...f,
                decision: "rejected" as FileReviewDecision,
                staged: false,
              }
            : f,
        );
        return {
          ...prev,
          files: nextFiles,
          stagedCount: nextFiles.filter((f) => f.staged).length,
        };
      });
    },
  });

  const keepAllMutation = useMutation({
    mutationFn: async () =>
      callRpc("changes.keepAll", {
        sessionId: activeSessionId ?? undefined,
      }),
    onSuccess: (res) => {
      if (res.snapshot) {
        applyFileChangesSnapshotToCache(res.snapshot);
      }
      if (!res.ok) {
        setActionError(res.message ?? "Unable to keep all session changes.");
        return;
      }
      setActionError(null);
    },
  });

  const undoAllMutation = useMutation({
    mutationFn: async (force?: boolean) =>
      callRpc("changes.undoAll", {
        sessionId: activeSessionId ?? undefined,
        ...(force ? { force: true } : {}),
      }),
    onSuccess: (res) => {
      if (res.snapshot) {
        applyFileChangesSnapshotToCache(res.snapshot);
      }
      if (!res.ok || res.conflict || (res.conflicts && res.conflicts.length > 0)) {
        setActionError(
          res.conflicts?.[0]?.reason ??
            res.message ??
            "Manual edits prevented undoing one or more files.",
        );
        return;
      }
      setActionError(null);
    },
  });

  const redoAllMutation = useMutation({
    mutationFn: async (force?: boolean) =>
      callRpc("changes.redoAll", {
        sessionId: activeSessionId ?? undefined,
        ...(force ? { force: true } : {}),
      }),
    onSuccess: (res) => {
      if (res.snapshot) {
        applyFileChangesSnapshotToCache(res.snapshot);
      }
      if (!res.ok) {
        setActionError(res.message ?? "Unable to redo session changes.");
        return;
      }
      setActionError(null);
    },
  });

  const commitMutation = useMutation({
    mutationFn: async (message: string) =>
      callRpc("changes.commit", { message }),
  });

  const createPrMutation = useMutation({
    mutationFn: async (input: CreatePrInput) =>
      callRpc("changes.createPr", input),
  });

  const toggleStage = React.useCallback(
    async (file: ChangedFileView) => {
      await stageMutation.mutateAsync({
        paths: [file.path],
        stage: !file.staged,
      });
    },
    [stageMutation],
  );

  const stageAll = React.useCallback(
    async (stage: boolean) => {
      const targetPaths = visibleFiles.map((f) => f.path);
      if (targetPaths.length === 0) return;
      await stageMutation.mutateAsync({ paths: targetPaths, stage });
    },
    [stageMutation, visibleFiles],
  );

  const keepFile = React.useCallback(
    async (path: string) => {
      await keepMutation.mutateAsync(path);
    },
    [keepMutation],
  );

  const undoFile = React.useCallback(
    async (path: string, force?: boolean) => {
      await undoMutation.mutateAsync({ path, force });
    },
    [undoMutation],
  );

  const keepAllSession = React.useCallback(async () => {
    await keepAllMutation.mutateAsync();
  }, [keepAllMutation]);

  const undoAllSession = React.useCallback(
    async (force?: boolean) => {
      await undoAllMutation.mutateAsync(force);
    },
    [undoAllMutation],
  );

  const redoAllSession = React.useCallback(
    async (force?: boolean) => {
      await redoAllMutation.mutateAsync(force);
    },
    [redoAllMutation],
  );

  const commitStaged = React.useCallback(
    async (
      rawMessage: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const trimmed = rawMessage.trim();
      if (!trimmed) {
        return { ok: false, error: "Enter a commit message for staged files." };
      }
      const stagedFiles = visibleFiles.filter((f) => f.staged);
      if (stagedFiles.length === 0) {
        return {
          ok: false,
          error: "Stage at least one changed file before committing.",
        };
      }
      try {
        const res = await commitMutation.mutateAsync(trimmed);
        if (!res.ok) {
          return {
            ok: false,
            error: res.summary ?? "Git commit failed.",
          };
        }
        setLastCommit({
          commitHash: res.commitHash ?? "HEAD",
          summary: res.summary ?? trimmed,
          committedCount: stagedFiles.length,
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Git commit failed.",
        };
      }
    },
    [commitMutation, visibleFiles],
  );

  const createPr = React.useCallback(
    async (
      input: CreatePrInput,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!input.baseBranch.trim()) {
        return { ok: false, error: "Target base branch is required." };
      }
      if (!input.title.trim()) {
        return { ok: false, error: "Pull request title is required." };
      }
      try {
        const res = await createPrMutation.mutateAsync({
          baseBranch: input.baseBranch.trim(),
          headBranch: input.headBranch.trim(),
          title: input.title.trim(),
          body: input.body.trim(),
          draft: input.draft,
        });
        if (!res.ok) {
          return { ok: false, error: "Unable to create pull request." };
        }
        setCreatedPr({
          url: res.url ?? "https://github.com/rayu-dev/rayucode/pull/101",
          number: res.number ?? 101,
          title: input.title.trim(),
          baseBranch: input.baseBranch.trim(),
          headBranch: input.headBranch.trim(),
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : "Unable to create pull request.",
        };
      }
    },
    [createPrMutation],
  );

  const openDiffInVsCode = React.useCallback(
    (path?: string) => {
      const target = path ?? activeFile?.path;
      if (!target) return;
      postToHost({
        type: "rayucode.editor.openDiff",
        path: target,
        sessionId: activeSessionId ?? undefined,
        scope,
      });
    },
    [activeFile?.path, activeSessionId, scope],
  );

  const openFileInVsCode = React.useCallback(
    (path?: string, line?: number) => {
      const target = path ?? activeFile?.path;
      if (!target) return;
      postToHost({
        type: "rayucode.editor.openFile",
        path: target,
        line,
      });
    },
    [activeFile?.path],
  );

  const prefetchFileDiff = React.useCallback(
    (path: string) => {
      void queryClient.prefetchQuery(
        fileDiffQueryOptions(path, activeSessionId, scope),
      );
    },
    [activeSessionId, queryClient, scope],
  );

  const summary = React.useMemo(() => {
    const fileCount = visibleFiles.length;
    const stagedCount = visibleFiles.filter((f) => f.staged).length;
    const unstagedCount = Math.max(0, fileCount - stagedCount);
    const acceptedCount = visibleFiles.filter(
      (f) => f.decision === "accepted",
    ).length;
    const rejectedCount = visibleFiles.filter(
      (f) => f.decision === "rejected",
    ).length;
    const totalAdditions = visibleFiles.reduce(
      (acc, f) => acc + f.additions,
      0,
    );
    const totalDeletions = visibleFiles.reduce(
      (acc, f) => acc + f.deletions,
      0,
    );
    return {
      fileCount,
      stagedCount,
      unstagedCount,
      acceptedCount,
      rejectedCount,
      totalAdditions,
      totalDeletions,
    };
  }, [visibleFiles]);

  return {
    changes: statusQuery.data ?? null,
    sessionSnapshot,
    files: visibleFiles,
    activeFile,
    activeDiff: (diffQuery.data as FileDiffView | undefined) ?? null,
    diffLines,
    summary,
    scope,
    setScope,
    diffMode,
    setDiffMode,
    selectedPath: activeFile?.path ?? null,
    selectFile: setSelectedPath,
    inlinePreviewOpen,
    setInlinePreviewOpen,
    isLoading: statusQuery.isPending,
    isError: statusQuery.isError,
    error: statusQuery.error,
    refetch: () => statusQuery.refetch(),
    toggleStage,
    stageAll,
    isStaging: stageMutation.isPending,
    keepFile,
    undoFile,
    keepAllSession,
    undoAllSession,
    redoAllSession,
    isReviewing:
      keepMutation.isPending ||
      undoMutation.isPending ||
      keepAllMutation.isPending ||
      undoAllMutation.isPending ||
      redoAllMutation.isPending,
    commitStaged,
    isCommitting: commitMutation.isPending,
    lastCommit,
    createPr,
    isCreatingPr: createPrMutation.isPending,
    createdPr,
    actionError,
    clearActionError: () => setActionError(null),
    openDiffInVsCode,
    openFileInVsCode,
    prefetchFileDiff,
  };
}
