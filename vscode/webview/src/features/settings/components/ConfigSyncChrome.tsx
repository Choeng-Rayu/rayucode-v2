import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import type { ConfigApplyModeView } from "@shared/vscodeProtocol";

import {
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";

export function ConfigScopeBadge({
  scope,
  configPath = "~/.rayu/config.toml",
  className,
}: {
  scope: "synced" | "local";
  configPath?: string;
  className?: string;
}) {
  if (scope === "local") {
    return (
      <Badge
        variant="outline"
        data-testid="settings-scope-badge-local"
        className={cn("border-hairline text-muted-ink", className)}
      >
        Local to VS Code
      </Badge>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="brand"
          data-testid="settings-scope-badge-synced"
          className={cn(
            "gap-1 border-brand/30 bg-brand-soft text-brand-text",
            className,
          )}
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          <span>Synced with {configPath}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        Shared live across RayuCode CLI, Desktop, and VS Code
      </TooltipContent>
    </Tooltip>
  );
}

export function FieldApplyModeBadge({
  applyMode,
}: {
  applyMode?: ConfigApplyModeView | null;
}) {
  if (applyMode === "restart_required") {
    return (
      <Badge
        variant="warn"
        data-testid="field-reload-required-badge"
        className="gap-1 border-warn/30 bg-warn-soft text-warn"
      >
        <RotateCw className="size-2.5" aria-hidden="true" />
        <span>Reload required</span>
      </Badge>
    );
  }
  if (applyMode === "next_turn") {
    return (
      <Badge
        variant="outline"
        data-testid="field-next-turn-badge"
        className="border-hairline text-muted-ink"
      >
        Next turn
      </Badge>
    );
  }
  return null;
}

export function ConfigRestartBanner({
  visible,
  onReload,
  isReloading = false,
}: {
  visible: boolean;
  onReload: () => Promise<unknown> | void;
  isReloading?: boolean;
}) {
  if (!visible) return null;
  return (
    <div
      role="status"
      data-testid="settings-restart-banner"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-xs"
    >
      <span className="flex items-center gap-2 text-ink">
        <AlertTriangle
          className="size-4 shrink-0 text-warn"
          aria-hidden="true"
        />
        <span>Reload the Rayu daemon to apply updated settings.</span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={isReloading}
        data-testid="settings-reload-daemon-btn"
        onClick={() => void onReload()}
      >
        <span>{isReloading ? "Reloading..." : "Reload daemon"}</span>
      </Button>
    </div>
  );
}

export function LegacyDaemonBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="status"
      data-testid="settings-legacy-v115-banner"
      className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-xs"
    >
      <Info
        className="mt-0.5 size-4 shrink-0 text-info"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">
          Connected to an older Rayu daemon (v1.15)
        </div>
        <div className="mt-0.5 text-body">
          Live ~/.rayu/config.toml sync requires daemon v1.16+. Engine settings
          are read-only here; edit ~/.rayu/config.toml directly or upgrade the
          daemon. Local UI preferences remain editable.
        </div>
      </div>
    </div>
  );
}

export function FieldValidationError({
  message,
  fieldKey,
  onDismiss,
}: {
  message?: string | null;
  fieldKey: string;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      data-testid={`field-error-${fieldKey}`}
      className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[11.5px] text-danger"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </span>
      {onDismiss ? (
        <button
          type="button"
          aria-label={`Dismiss error for ${fieldKey}`}
          data-testid={`field-error-dismiss-${fieldKey}`}
          onClick={onDismiss}
          className="grid size-4 shrink-0 cursor-pointer place-items-center rounded text-danger opacity-80 hover:opacity-100"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function SectionErrorBanner({
  message,
  onDismiss,
}: {
  message?: string | null;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      data-testid="settings-section-error-banner"
      className="flex items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-2.5 text-xs text-danger"
    >
      <span className="flex items-center gap-2">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </span>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss error"
          onClick={onDismiss}
          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-danger opacity-80 hover:opacity-100"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
