import * as React from "react";
import { Check, ExternalLink, FileDiff, RotateCcw } from "lucide-react";

import { Button, TechFileBadge } from "@/components/ui";
import {
  cn,
  postToHost,
  useAppStore,
  type InlineDiffCardData,
} from "@/lib";

import { applyFileReview, useFileReviewAvailable } from "../hooks/fileReview";

export type InlineDiffDecision = "pending" | "accepted" | "rejected";

export interface InlineDiffCardProps {
  diff: InlineDiffCardData;
  sessionId?: string;
  ownerBadge?: string;
  initialDecision?: InlineDiffDecision;
  onAccept?: (diffId: string, file: string) => void;
  onReject?: (diffId: string, file: string) => void;
  onReset?: (diffId: string, file: string) => void;
  onOpenInVSCodeDiff?: (file: string) => void;
  className?: string;
}

export function InlineDiffCard({
  diff,
  sessionId,
  ownerBadge,
  initialDecision = "pending",
  onAccept,
  onReject,
  onReset,
  onOpenInVSCodeDiff,
  className,
}: InlineDiffCardProps) {
  const resolvedSessionId = sessionId;
  const canReview = useFileReviewAvailable(resolvedSessionId);
  const entry = useAppStore((state) => resolvedSessionId
    ? state.fileChangesBySession[resolvedSessionId]?.files.find(
        (file) => file.path === diff.file || file.displayPath === diff.file,
      )
    : undefined);
  const decision = entry?.status === "kept" ? "accepted"
    : entry?.status === "undone" ? "rejected"
    : initialDecision;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const firstCodeLine = React.useMemo(() => {
    const match = diff.lines.find(
      (line) => line.newLine !== undefined || line.oldLine !== undefined,
    );
    return match?.newLine ?? match?.oldLine ?? 1;
  }, [diff.lines]);

  const review = async (action: "keep" | "undo" | "redo") => {
    if (!canReview || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await applyFileReview(resolvedSessionId, action, diff.file);
      if (!result.ok) {
        const conflicts = result.conflicts?.map((conflict) => `${conflict.displayPath}: ${conflict.reason}`).join(" ");
        setError(conflicts ? `${conflicts} Open the turn’s file review to inspect or force restore.` : result.message ?? "File review failed.");
        return;
      }
      if (action === "keep") onAccept?.(diff.id, diff.file);
      if (action === "undo") onReject?.(diff.id, diff.file);
      if (action === "redo") onReset?.(diff.id, diff.file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File review failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleOpenVSCodeDiff = () => {
    postToHost({
      type: "rayucode.editor.openDiff",
      path: diff.file,
      sessionId: resolvedSessionId,
      scope: "session",
    });
    onOpenInVSCodeDiff?.(diff.file);
  };

  const handleOpenFileInEditor = () => {
    postToHost({
      type: "rayucode.editor.openFile",
      path: diff.file,
      sessionId: resolvedSessionId,
      line: firstCodeLine,
    });
  };

  return (
    <div
      data-slot="inline-diff-card"
      data-testid={`inline-diff-card-${diff.id}`}
      data-decision={decision}
      className={cn(
        "rayu-card-bevel overflow-hidden rounded-xl bg-pane shadow-diff-card",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2 text-xs">
        <FileDiff
          className="size-[13px] shrink-0 text-muted-ink"
          aria-hidden="true"
        />
        <TechFileBadge path={diff.file} className="size-3.5" />
        <button
          type="button"
          onClick={handleOpenFileInEditor}
          title={`Open ${diff.file}:${firstCodeLine} in VS Code Editor`}
          className="cursor-pointer truncate font-mono font-medium text-ink transition-colors hover:text-brand-text focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {diff.file}
        </button>
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          <span className="text-brand-text">+{diff.additions}</span>{" "}
          <span className="text-danger">-{diff.deletions}</span>
        </span>
        {ownerBadge && (
          <span className="rounded-full border border-hairline bg-raised px-2 py-0.5 font-mono text-[11px] text-body">
            {ownerBadge}
          </span>
        )}
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-testid={`open-vscode-diff-${diff.id}`}
          onClick={handleOpenVSCodeDiff}
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          <span>Open in VS Code Diff</span>
        </Button>
      </div>

      {diff.lines.length > 0 && (
        <div
          data-slot="inline-diff-body"
          className="overflow-x-auto bg-inset p-1.5 font-mono text-xs leading-[1.6] tabular-nums"
        >
          {diff.lines.map((line, index) => {
            const lineNum = line.newLine ?? line.oldLine ?? "";
            const mark =
              line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
            return (
              <div
                key={`${diff.id}-line-${index}`}
                data-line-type={line.kind}
                className={cn(
                  "flex min-w-max border-l-2 px-2.5 py-0.5",
                  line.kind === "add" &&
                    "border-l-diff-add-rail bg-diff-add",
                  line.kind === "del" &&
                    "border-l-diff-del-rail bg-diff-del",
                  line.kind === "context" && "border-l-transparent",
                )}
              >
                <span className="w-[38px] shrink-0 pr-2 text-right text-muted-ink select-none">
                  {lineNum}
                </span>
                <span
                  className={cn(
                    "w-4 shrink-0 text-center select-none",
                    line.kind === "add" && "text-brand-text",
                    line.kind === "del" && "text-danger",
                  )}
                >
                  {mark}
                </span>
                <span
                  className={cn(
                    "whitespace-pre",
                    line.kind === "add" && "text-ink",
                    line.kind === "del" && "text-body",
                    line.kind === "context" && "text-body",
                  )}
                >
                  {line.text}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
        <span
          data-slot="inline-diff-hint"
          className={cn(
            "text-[11px] text-muted-ink",
            decision === "accepted" && "text-brand-text",
            decision === "rejected" && "text-danger",
          )}
        >
          {decision === "accepted"
            ? "Accepted · staged in session"
            : decision === "rejected"
              ? "Reverted · changes undone"
              : diff.hint || "Review edit or open side-by-side in VS Code"}
        </span>
        <span className="flex-1" />

        {decision === "pending" ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              data-testid={`reject-diff-${diff.id}`}
              disabled={!canReview || busy}
              onClick={() => void review("undo")}
            >
              Reject
            </Button>
            <Button
              type="button"
              variant="primary"
              size="xs"
              data-testid={`accept-diff-${diff.id}`}
              disabled={!canReview || busy}
              onClick={() => void review("keep")}
            >
              <Check className="size-3" aria-hidden="true" />
              <span>Accept</span>
            </Button>
          </>
        ) : decision === "rejected" ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid={`undo-diff-${diff.id}`}
            disabled={!canReview || busy}
            onClick={() => void review("redo")}
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            <span>Redo</span>
          </Button>
        ) : null}
      </div>
      {error && <p role="alert" className="px-3 pb-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
