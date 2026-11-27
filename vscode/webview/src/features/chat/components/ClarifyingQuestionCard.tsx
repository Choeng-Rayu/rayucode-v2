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

export interface ClarifyingQuestionItem {
  question: string;
  header?: string;
  placeholder?: string;
  multiSelect?: boolean;
  options: ClarifyingOptionItem[];
}

export interface ClarifyingQuestionSubmitMeta {
  selected?: Record<string, number[]>;
  declined?: boolean;
}

export interface ClarifyingQuestionRequest {
  requestId: string;
  sessionId: string;
  prompt: string;
  placeholder?: string;
  multiSelect?: boolean;
  options: ClarifyingOptionItem[];
  questions?: ClarifyingQuestionItem[];
}

export interface ClarifyingQuestionCardProps {
  question: ClarifyingQuestionRequest;
  onSubmitAnswer: (
    answers: Record<string, string>,
    notes?: Record<string, string>,
    meta?: ClarifyingQuestionSubmitMeta,
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
  const items = React.useMemo<ClarifyingQuestionItem[]>(() => {
    if (question.questions && question.questions.length > 0) {
      return question.questions;
    }
    return [
      {
        question: question.prompt,
        placeholder: question.placeholder,
        multiSelect: question.multiSelect,
        options: question.options,
      },
    ];
  }, [
    question.multiSelect,
    question.options,
    question.placeholder,
    question.prompt,
    question.questions,
  ]);

  const isMultiQuestion = items.length > 1;
  const [hoveredKey, setHoveredKey] = React.useState<string>(
    items[0]?.options[0]?.key ?? "1",
  );
  const [selectedByQuestion, setSelectedByQuestion] = React.useState<
    Record<string, number[]>
  >({});
  const [customByQuestion, setCustomByQuestion] = React.useState<
    Record<string, string>
  >({});

  // Reset local state whenever a new clarifying question arrives
  React.useEffect(() => {
    setHoveredKey(items[0]?.options[0]?.key ?? "1");
    setSelectedByQuestion({});
    setCustomByQuestion({});
  }, [question.requestId, items]);

  const primaryItem = items[0]!;
  const primarySelectedIndices = selectedByQuestion[primaryItem.question] ?? [];
  const primaryCustomText = customByQuestion[primaryItem.question] ?? "";

  const handleSelectOption = React.useCallback(
    (item: ClarifyingQuestionItem, opt: ClarifyingOptionItem, optIdx: number) => {
      const qKey = item.question;
      if (!isMultiQuestion && !item.multiSelect) {
        const noteText = (customByQuestion[qKey] ?? "").trim();
        onSubmitAnswer(
          { [qKey]: opt.title },
          noteText ? { [qKey]: noteText } : undefined,
          { selected: { [qKey]: [optIdx] } },
        );
        return;
      }

      setSelectedByQuestion((prev) => {
        const current = prev[qKey] ?? [];
        if (item.multiSelect) {
          const exists = current.includes(optIdx);
          const nextIndices = exists
            ? current.filter((i) => i !== optIdx)
            : [...current, optIdx].sort((a, b) => a - b);
          return { ...prev, [qKey]: nextIndices };
        }
        return { ...prev, [qKey]: [optIdx] };
      });
    },
    [customByQuestion, isMultiQuestion, onSubmitAnswer],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss?.();
        return;
      }
      if (isMultiQuestion) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const matchedIdx = primaryItem.options.findIndex(
        (opt) => opt.key === event.key,
      );
      if (matchedIdx >= 0) {
        event.preventDefault();
        handleSelectOption(
          primaryItem,
          primaryItem.options[matchedIdx]!,
          matchedIdx,
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSelectOption, isMultiQuestion, onDismiss, primaryItem]);

  const hasAnyAnswer = React.useMemo(() => {
    return items.some((item) => {
      const sel = selectedByQuestion[item.question] ?? [];
      const custom = (customByQuestion[item.question] ?? "").trim();
      return sel.length > 0 || custom.length > 0;
    });
  }, [customByQuestion, items, selectedByQuestion]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAnyAnswer) {
      if (onDismiss) {
        onDismiss();
      } else {
        onSubmitAnswer({}, undefined, { declined: true });
      }
      return;
    }

    const answers: Record<string, string> = {};
    const notes: Record<string, string> = {};
    const selected: Record<string, number[]> = {};

    for (const item of items) {
      const qKey = item.question;
      const indices = selectedByQuestion[qKey] ?? [];
      const custom = (customByQuestion[qKey] ?? "").trim();
      if (indices.length > 0) {
        selected[qKey] = indices;
        const chosenLabels = indices
          .map((idx) => item.options[idx]?.title)
          .filter((t): t is string => Boolean(t));
        answers[qKey] = chosenLabels.join(", ");
        if (custom) {
          notes[qKey] = custom;
        }
      } else if (custom) {
        answers[qKey] = custom;
      }
    }

    onSubmitAnswer(
      answers,
      Object.keys(notes).length > 0 ? notes : undefined,
      Object.keys(selected).length > 0 ? { selected } : undefined,
    );
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
      <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
        {items.map((item, qIdx) => {
          const itemSelected = selectedByQuestion[item.question] ?? [];
          const itemCustom = customByQuestion[item.question] ?? "";
          return (
            <div
              key={`${question.requestId}_q_${qIdx}`}
              data-testid={`clarifying-question-item-${qIdx}`}
              className={cn(
                qIdx > 0 && "border-t border-hairline-soft pt-3",
              )}
            >
              <div className="mb-2.5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  {item.header ? (
                    <div className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-ink uppercase">
                      {item.header}
                    </div>
                  ) : null}
                  <h3 className="m-0 text-[14.5px] leading-snug font-medium text-ink">
                    {isMultiQuestion ? `${qIdx + 1}. ${item.question}` : item.question}
                  </h3>
                </div>
                {qIdx === 0 && onDismiss && (
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
                {item.options.map((opt, optIdx) => {
                  const isHighlighted = !isMultiQuestion && hoveredKey === opt.key;
                  const isChecked = itemSelected.includes(optIdx);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={
                        qIdx === 0
                          ? `clarifying-option-${opt.key}`
                          : `clarifying-option-q${qIdx}-${opt.key}`
                      }
                      onMouseEnter={() => {
                        if (!isMultiQuestion) setHoveredKey(opt.key);
                      }}
                      onFocus={() => {
                        if (!isMultiQuestion) setHoveredKey(opt.key);
                      }}
                      onClick={() => handleSelectOption(item, opt, optIdx)}
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

              {isMultiQuestion ? (
                <div className="mt-2 flex items-center gap-2.5 rounded-[12px] border border-hairline bg-inset/80 px-3 py-1.5 focus-within:border-hairline-strong">
                  <Pencil
                    className="size-3.5 shrink-0 text-muted-ink"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    data-testid={`clarifying-custom-input-${qIdx}`}
                    value={itemCustom}
                    onChange={(e) =>
                      setCustomByQuestion((prev) => ({
                        ...prev,
                        [item.question]: e.target.value,
                      }))
                    }
                    placeholder={
                      item.placeholder ?? "Or type a custom response / note..."
                    }
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted-ink focus:outline-none"
                  />
                </div>
              ) : null}
            </div>
          );
        })}

        {isMultiQuestion ? (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="default"
              size="xs"
              data-testid="clarifying-skip-btn"
              onClick={() => {
                if (onDismiss) {
                  onDismiss();
                } else {
                  onSubmitAnswer({}, undefined, { declined: true });
                }
              }}
            >
              Skip
            </Button>
            <Button
              type="submit"
              variant={hasAnyAnswer ? "primary" : "default"}
              size="xs"
              data-testid="clarifying-submit-btn"
            >
              {hasAnyAnswer ? "Send answers" : "Skip"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-[14px] border border-hairline bg-inset/80 px-3 py-1.5 focus-within:border-hairline-strong">
            <Pencil
              className="size-3.5 shrink-0 text-muted-ink"
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <input
              type="text"
              data-testid="clarifying-custom-input"
              value={primaryCustomText}
              onChange={(e) =>
                setCustomByQuestion((prev) => ({
                  ...prev,
                  [primaryItem.question]: e.target.value,
                }))
              }
              placeholder={
                primaryItem.placeholder ?? "Or type a custom response..."
              }
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted-ink focus:outline-none"
            />
            <Button
              type="submit"
              variant={
                primaryCustomText.trim() || primarySelectedIndices.length > 0
                  ? "primary"
                  : "default"
              }
              size="xs"
              data-testid="clarifying-submit-btn"
            >
              {primaryCustomText.trim() || primarySelectedIndices.length > 0
                ? "Send"
                : "Skip"}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
