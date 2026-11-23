import * as React from "react";
import { ArrowRight, Check, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/lib";

export interface ClarifyingOptionItem {
  id: string;
  key: string;
  title: string;
  subtitle?: string;
  recommended?: boolean;
}

export interface ClarifyingQuestionRequest {
  requestId: string;
  sessionId: string;
  prompt: string;
  placeholder?: string;
  multiSelect?: boolean;
  options: ClarifyingOptionItem[];
}

export interface ClarifyingQuestionCardProps {
  question: ClarifyingQuestionRequest;
  onSubmitAnswer: (
    answers: Record<string, string>,
    notes?: Record<string, string>,
  ) => void;
  onDismiss?: () => void;
  className?: string;
}

export function ClarifyingQuestionCard({
  question,
  onSubmitAnswer,
  onDismiss,
  className,
}: ClarifyingQuestionCardProps) {
  const [hoveredKey, setHoveredKey] = React.useState<string>(
    question.options[0]?.key ?? "1",
  );
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [customText, setCustomText] = React.useState("");

  const handleSelectOption = React.useCallback(
    (opt: ClarifyingOptionItem) => {
      if (question.multiSelect) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(opt.id)) {
            next.delete(opt.id);
          } else {
            next.add(opt.id);
          }
          return next;
        });
        return;
      }

      onSubmitAnswer(
        { [question.requestId]: opt.title },
        customText.trim()
          ? { [question.requestId]: customText.trim() }
          : undefined,
      );
    },
    [customText, onSubmitAnswer, question.multiSelect, question.requestId],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss?.();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const matched = question.options.find((opt) => opt.key === event.key);
      if (matched) {
        event.preventDefault();
        handleSelectOption(matched);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSelectOption, onDismiss, question.options]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.multiSelect && selectedIds.size > 0) {
      const chosen = question.options
        .filter((o) => selectedIds.has(o.id))
        .map((o) => o.title)
        .join(", ");
      onSubmitAnswer(
        { [question.requestId]: chosen },
        customText.trim()
          ? { [question.requestId]: customText.trim() }
          : undefined,
      );
      return;
    }

    const trimmed = customText.trim();
    if (!trimmed) return;
    onSubmitAnswer({ [question.requestId]: trimmed });
  };

  return (
    <div
      data-slot="clarifying-question-card"
      data-testid="clarifying-question-card"
      className={cn(
        "rayu-card-bevel mb-2.5 w-full max-w-[732px] rounded-[20px] border border-premium-hi bg-popover-solid p-4 shadow-rayu-2",
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <h3 className="m-0 text-[14.5px] leading-snug font-medium text-ink">
          {question.prompt}
        </h3>
        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss clarifying question"
            data-testid="clarifying-dismiss-btn"
            onClick={onDismiss}
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="space-y-1">
        {question.options.map((opt) => {
          const isHighlighted = hoveredKey === opt.key;
          const isChecked = selectedIds.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`clarifying-option-${opt.key}`}
              onMouseEnter={() => setHoveredKey(opt.key)}
              onFocus={() => setHoveredKey(opt.key)}
              onClick={() => handleSelectOption(opt)}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between gap-3 rounded-[12px] border border-transparent px-3 py-2 text-left transition-colors outline-none",
                isHighlighted || isChecked
                  ? "border-hairline bg-hover/90"
                  : "hover:border-hairline hover:bg-hover/70",
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-[5px] border font-mono text-[11px] font-medium",
                    isChecked
                      ? "border-brand bg-brand text-brand-ink"
                      : "border-hairline-strong bg-inset text-muted-ink",
                  )}
                >
                  {isChecked ? (
                    <Check className="size-3" aria-hidden="true" />
                  ) : (
                    opt.key
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium text-ink">
                      {opt.title}
                    </span>
                    {opt.recommended ? (
                      <span className="rounded-md bg-active px-2 py-0.5 text-[11px] font-medium text-body">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  {opt.subtitle && (
                    <p className="m-0 mt-0.5 text-[12px] leading-snug text-muted-ink">
                      {opt.subtitle}
                    </p>
                  )}
                </div>
              </div>

              <ArrowRight
                className={cn(
                  "size-4 shrink-0 text-muted-ink transition-opacity",
                  isHighlighted ? "opacity-100" : "opacity-0",
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <form
        onSubmit={handleFormSubmit}
        className="mt-3 flex items-center gap-2.5 rounded-[14px] border border-hairline bg-inset/80 px-3 py-1.5 focus-within:border-hairline-strong"
      >
        <Pencil
          className="size-3.5 shrink-0 text-muted-ink"
          strokeWidth={1.7}
          aria-hidden="true"
        />
        <input
          type="text"
          data-testid="clarifying-custom-input"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder={
            question.placeholder ?? "Or type a custom response..."
          }
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted-ink focus:outline-none"
        />
        <Button
          type="submit"
          variant={
            customText.trim() || selectedIds.size > 0 ? "primary" : "default"
          }
          size="xs"
          data-testid="clarifying-submit-btn"
        >
          {customText.trim() || selectedIds.size > 0 ? "Send" : "Skip"}
        </Button>
      </form>
    </div>
  );
}
