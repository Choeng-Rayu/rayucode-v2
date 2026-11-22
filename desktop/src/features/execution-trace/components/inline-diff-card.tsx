import * as React from "react"
import { Check, FileDiff } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import { openDiffInVSCode } from "../api/trace-api"
import type { DiffDecision, InlineDiffCardData } from "../types"

export interface InlineDiffCardProps {
  diff: InlineDiffCardData
  onAccept?: (diffId: string) => void
  onReject?: (diffId: string) => void
  onReset?: (diffId: string) => void
  onOpenInVSCode?: (file: string, line?: number) => void
  className?: string
}

function getBasename(filePath: string): string {
  const parts = filePath.split("/")
  return parts[parts.length - 1] || filePath
}

export function InlineDiffCard({
  diff,
  onAccept,
  onReject,
  onReset,
  onOpenInVSCode,
  className,
}: InlineDiffCardProps) {
  const initialDecision: DiffDecision = diff.accepted
    ? "accepted"
    : diff.rejected
      ? "rejected"
      : "pending"

  const [decision, setDecision] = React.useState<DiffDecision>(initialDecision)

  const firstCodeLine = React.useMemo(() => {
    const match = diff.lines.find(
      (line) => line.lineNumber !== null && line.type !== "hunk"
    )
    return match?.lineNumber ?? undefined
  }, [diff.lines])

  const handleAccept = () => {
    setDecision("accepted")
    onAccept?.(diff.id)
    toast(`Accepted changes in ${diff.file}`)
  }

  const handleReject = () => {
    setDecision("rejected")
    onReject?.(diff.id)
    toast(`Rejected changes in ${diff.file}`)
  }

  const handleUndo = () => {
    setDecision("pending")
    onReset?.(diff.id)
    toast(`Restored review state for ${diff.file}`)
  }

  const handleOpenVSCode = async () => {
    if (onOpenInVSCode) {
      onOpenInVSCode(diff.file, firstCodeLine)
    } else {
      await openDiffInVSCode(diff.file, firstCodeLine)
    }
    const lineSuffix = firstCodeLine ? `:${firstCodeLine}` : ""
    toast(`Opened ${diff.file}${lineSuffix} in Visual Studio Code`)
  }

  const handleOpenInInspector = () => {
    useAppStore
      .getState()
      .openCodeFile(getBasename(diff.file), firstCodeLine ?? null)
  }

  return (
    <div
      data-slot="inline-diff-card"
      data-decision={decision}
      className={cn(
        "rayu-card-bevel overflow-hidden rounded-xl bg-pane",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-xs">
        <FileDiff
          className="size-[13px] shrink-0 text-muted-ink"
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={handleOpenInInspector}
          className="cursor-pointer truncate font-mono font-medium text-ink transition-colors hover:text-brand-text focus-visible:rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {diff.file}
        </button>
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          <span className="text-brand-text">+{diff.additions}</span>{" "}
          <span className="text-danger">−{diff.deletions}</span>
        </span>
        {diff.ownerBadge && (
          <span className="rounded-full border border-hairline bg-raised px-2 py-0.5 font-mono text-[11px] text-body">
            {diff.ownerBadge}
          </span>
        )}
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void handleOpenVSCode()}
        >
          VS Code
        </Button>
      </div>

      {diff.lines.length > 0 && (
        <div
          data-slot="inline-diff-body"
          className="overflow-x-auto bg-inset p-1.5 font-mono text-xs leading-[1.6] tabular-nums"
        >
          {diff.lines.map((line, index) => (
            <div
              key={`${diff.id}-line-${index}`}
              data-line-type={line.type}
              className={cn(
                "flex min-w-max px-2.5 py-0.5",
                line.type === "hunk" && "bg-pane py-1 text-muted-ink",
                line.type === "add" && "bg-diff-add",
                line.type === "del" && "bg-diff-del"
              )}
            >
              <span className="w-[38px] shrink-0 pr-2 text-right text-muted-ink select-none">
                {line.lineNumber ?? ""}
              </span>
              <span
                className={cn(
                  "w-4 shrink-0 text-center select-none",
                  line.type === "add" && "text-brand-text",
                  line.type === "del" && "text-danger"
                )}
              >
                {line.mark}
              </span>
              <span
                className={cn(
                  "whitespace-pre",
                  line.type === "hunk" && "text-muted-ink",
                  line.type === "add" && "text-ink",
                  line.type === "del" && "text-body",
                  line.type === "ctx" && "text-body"
                )}
              >
                {line.content}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
        <span
          data-slot="inline-diff-hint"
          className={cn(
            "text-[11px] text-muted-ink",
            decision === "accepted" && "text-brand-text",
            decision === "rejected" && "text-danger"
          )}
        >
          {decision === "accepted"
            ? "Accepted · staged for commit"
            : decision === "rejected"
              ? "Rejected · rayu will revise"
              : diff.hint}
        </span>
        <span className="flex-1" />

        {decision === "pending" ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleReject}
            >
              Reject
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleAccept}
            >
              <Check className="size-3" aria-hidden="true" />
              Accept
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleUndo}
          >
            Undo
          </Button>
        )}
      </div>
    </div>
  )
}
