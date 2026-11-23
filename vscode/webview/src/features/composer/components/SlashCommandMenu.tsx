import * as React from "react";
import { Sparkles, Terminal } from "lucide-react";

import { ScrollArea } from "@/components/ui";
import { cn } from "@/lib";

import { useSlashCommandsCatalog } from "../hooks/useComposerData";
import type { SlashCommandItem } from "../types";

export interface SlashCommandMenuProps {
  open: boolean;
  query: string;
  commands?: readonly SlashCommandItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelectCommand: (item: SlashCommandItem) => void;
  onClose: () => void;
  className?: string;
}

export function SlashCommandMenu({
  open,
  query,
  commands: controlledCommands,
  activeIndex,
  onActiveIndexChange,
  onSelectCommand,
  className,
}: SlashCommandMenuProps) {
  const { commands: fetchedCommands } = useSlashCommandsCatalog(
    query,
    open && !controlledCommands,
  );

  const items = React.useMemo(() => {
    if (!controlledCommands) return fetchedCommands;
    const clean = query.trim().replace(/^\/+/, "").toLowerCase();
    if (!clean) return controlledCommands;
    return controlledCommands.filter(
      (c) =>
        c.command.toLowerCase().includes(clean) ||
        c.description.toLowerCase().includes(clean),
    );
  }, [controlledCommands, fetchedCommands, query]);

  if (!open) {
    return null;
  }

  const clampedIndex =
    items.length > 0
      ? Math.max(0, Math.min(items.length - 1, activeIndex))
      : 0;

  return (
    <div
      data-testid="slash-command-menu"
      role="listbox"
      aria-label="Slash commands and skills"
      className={cn(
        "rayu-card-bevel rayu-animate-pop z-40 w-full max-w-[480px] overflow-hidden rounded-xl border border-premium-hi bg-popover-solid p-1.5 shadow-popover",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-hairline-soft px-2.5 py-1.5 text-[11px] font-medium text-muted-ink">
        <span className="inline-flex items-center gap-1.5">
          <Terminal className="size-3.5 text-brand-text" aria-hidden="true" />
          <span>
            {query.trim()
              ? `Commands matching "/${query.trim().replace(/^\/+/, "")}"`
              : "Runtime commands & SKILL.md workflows"}
          </span>
        </span>
        <span className="font-mono text-[10px] text-faint">
          Enter to run · Esc
        </span>
      </div>

      {items.length === 0 ? (
        <div
          data-testid="slash-command-empty"
          className="px-3 py-4 text-center text-xs text-muted-ink"
        >
          No matching commands or skills for &ldquo;/{query.replace(/^\/+/, "")}
          &rdquo;
        </div>
      ) : (
        <ScrollArea className="max-h-[248px]">
          <div className="flex flex-col gap-0.5 py-1">
            {items.map((item, idx) => {
              const isSelected = idx === clampedIndex;
              return (
                <button
                  key={item.command}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-testid="slash-command-item"
                  data-command={item.command}
                  onMouseEnter={() => onActiveIndexChange(idx)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelectCommand(item);
                  }}
                  onClick={() => onSelectCommand(item)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-xs transition-colors",
                    isSelected
                      ? "border-hairline bg-active text-ink"
                      : "text-body hover:bg-hover hover:text-ink",
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {item.kind === "skill" ? (
                      <Sparkles
                        className="size-3.5 shrink-0 text-brand-text"
                        aria-hidden="true"
                      />
                    ) : (
                      <Terminal
                        className="size-3.5 shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                    )}
                    <span className="shrink-0 font-mono text-xs font-medium text-ink">
                      {item.command}
                    </span>
                    <span className="truncate text-xs text-muted-ink">
                      {item.description}
                    </span>
                  </span>
                  {item.category ? (
                    <span className="shrink-0 rounded border border-hairline-soft bg-inset px-1.5 py-0.5 text-[10px] font-medium text-muted-ink">
                      {item.category}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
