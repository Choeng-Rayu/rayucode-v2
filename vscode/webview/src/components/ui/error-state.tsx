import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Section failed to render",
  description = "An unexpected error occurred in this workspace panel.",
  actionLabel = "Reload section",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "rayu-card-bevel flex flex-col items-start gap-3 rounded-lg bg-pane p-4 text-ink",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-danger">
        <AlertTriangle className="size-4 shrink-0" />
        <span>{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-ink">{description}</p>
      {onRetry && (
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onRetry}
          className="mt-1"
        >
          <RotateCcw className="size-3.5" />
          <span>{actionLabel}</span>
        </Button>
      )}
    </div>
  );
}
