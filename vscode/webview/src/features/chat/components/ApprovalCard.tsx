import * as React from "react";
import { ShieldAlert, Terminal } from "lucide-react";

import { Badge, Button } from "@/components/ui";
import { cn, type PendingPermissionRequest } from "@/lib";
import type { RiskTier } from "@shared/vscodeProtocol";

export type ApprovalRiskTier = RiskTier | "catastrophic";

export interface ApprovalCardRequest
  extends Omit<PendingPermissionRequest, "riskTier"> {
  riskTier?: ApprovalRiskTier;
}

export interface ApprovalCardProps {
  request: ApprovalCardRequest;
  onDecision: (
    decision: "allow_once" | "allow_always" | "deny",
    request: ApprovalCardRequest,
  ) => void;
  isSubmitting?: boolean;
  className?: string;
}

function resolveRiskBadge(riskTier?: ApprovalRiskTier): {
  label: string;
  variant: "brand" | "info" | "warn" | "danger";
} {
  switch (riskTier) {
    case "safe":
      return { label: "Safe", variant: "brand" };
    case "bounded":
      return { label: "Bounded", variant: "info" };
    case "confirm":
      return { label: "Confirm", variant: "warn" };
    case "catastrophic":
    case "hard_deny":
      return { label: "Catastrophic", variant: "danger" };
    default:
      return { label: "Confirm", variant: "warn" };
  }
}

export function ApprovalCard({
  request,
  onDecision,
  isSubmitting = false,
  className,
}: ApprovalCardProps) {
  const riskMeta = resolveRiskBadge(request.riskTier);

  return (
    <div
      data-slot="approval-card"
      data-testid="approval-card"
      data-risk-tier={request.riskTier ?? "confirm"}
      className={cn(
        "rayu-card-bevel flex flex-col gap-3 rounded-xl border border-premium-hi bg-pane p-3.5 shadow-rayu-2",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md border border-hairline bg-inset text-warn">
            <ShieldAlert className="size-3.5" aria-hidden="true" />
          </span>
          <span className="font-mono text-xs font-semibold text-ink">
            {request.toolName}
          </span>
        </div>

        <Badge
          data-testid="approval-risk-badge"
          variant={riskMeta.variant}
          className="font-mono text-[10.5px]"
        >
          {riskMeta.label}
        </Badge>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-[13.5px] leading-snug font-medium text-ink">
          {request.description.trim().endsWith("?")
            ? request.description
            : `Allow RayuCode to run ${request.toolName}?`}
        </p>

        {(request.command || !request.description.trim().endsWith("?")) && (
          <div
            data-testid="approval-command-preview"
            className="flex items-center gap-2 overflow-x-auto rounded-lg border border-hairline-soft bg-inset px-3 py-2 font-mono text-xs text-body"
          >
            <Terminal
              className="size-3.5 shrink-0 text-muted-ink"
              aria-hidden="true"
            />
            <code className="whitespace-pre">
              {request.command ?? request.description}
            </code>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isSubmitting}
          data-testid="approval-deny-btn"
          onClick={() => onDecision("deny", request)}
        >
          Deny
        </Button>

        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={isSubmitting}
          data-testid="approval-allow-once-btn"
          onClick={() => onDecision("allow_once", request)}
        >
          Allow once
        </Button>

        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={isSubmitting}
          data-testid="approval-allow-session-btn"
          onClick={() => onDecision("allow_always", request)}
        >
          Allow for session
        </Button>
      </div>
    </div>
  );
}
