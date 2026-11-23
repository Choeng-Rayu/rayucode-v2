import { Check, X } from "lucide-react";
import type { TelegramApprovalView } from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime } from "@/lib/utils";

export interface ApprovalRowProps {
  item: TelegramApprovalView;
  isResolving?: boolean;
  onDecide: (id: string, decision: "allow" | "deny") => void;
}

export function ApprovalRow({
  item,
  isResolving = false,
  onDecide,
}: ApprovalRowProps) {
  const isBash = item.toolName.toLowerCase() === "bash";

  return (
    <div
      data-testid={`tg-approval-row-${item.id}`}
      className="flex flex-wrap items-center justify-between gap-3.5 px-4 py-3 text-xs"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
              isBash
                ? "border-transparent bg-warn-soft text-warn"
                : "border-hairline bg-raised text-body",
            )}
          >
            {item.toolName}
          </span>
          {isBash ? (
            <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-xs text-ink">
              {item.commandOrSummary}
            </code>
          ) : (
            <span className="text-ink">{item.commandOrSummary}</span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-muted-ink">
          Requested by {item.requestedBy ?? "remote"} ·{" "}
          <span className="tabular-nums">
            {formatRelativeTime(item.createdAtMs)}
          </span>{" "}
          ·{" "}
          {item.status === "pending"
            ? "waiting on host or Telegram"
            : item.status === "approved"
              ? `Approved via ${item.resolvedVia ?? "host"}`
              : "Denied"}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {item.status === "pending" ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              disabled={isResolving}
              data-testid={`tg-approval-deny-${item.id}`}
              onClick={() => onDecide(item.id, "deny")}
            >
              <X className="size-3" aria-hidden="true" />
              <span>Deny</span>
            </Button>
            <Button
              type="button"
              variant="primary"
              size="xs"
              disabled={isResolving}
              data-testid={`tg-approval-allow-${item.id}`}
              onClick={() => onDecide(item.id, "allow")}
            >
              <Check className="size-3" aria-hidden="true" />
              <span>Allow</span>
            </Button>
          </>
        ) : item.status === "approved" ? (
          <span
            data-testid={`tg-approval-status-${item.id}`}
            className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-medium text-brand-text"
          >
            <Check className="size-3" aria-hidden="true" />
            <span>Approved via host</span>
          </span>
        ) : (
          <span
            data-testid={`tg-approval-status-${item.id}`}
            className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-0.5 text-[11px] font-medium text-danger"
          >
            <X className="size-3" aria-hidden="true" />
            <span>Denied</span>
          </span>
        )}
      </div>
    </div>
  );
}
