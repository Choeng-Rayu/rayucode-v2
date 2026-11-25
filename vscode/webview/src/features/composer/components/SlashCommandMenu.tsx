import * as React from "react";
import { Sparkles, Terminal } from "lucide-react";

import { Badge, ScrollArea, Separator } from "@/components/ui";
import { cn } from "@/lib";

import { useSlashCommandsCatalog } from "../hooks/useComposerData";
import type { SlashCommandItem } from "../types";

export interface SlashCommandMenuProps {
  open: boolean;
  query: string;
  commands?: readonly SlashCommandItem[];
  activeSessionId?: string | null;
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
  activeSessionId,
  activeIndex,
  onActiveIndexChange,
  onSelectCommand,
  className,
}: SlashCommandMenuProps) {
  const { commands: fetchedCommands } = useSlashCommandsCatalog(
    query,
    open && !controlledCommands,
    activeSessionId,
  );

  const items = React.useMemo(() => {
    if (!controlledCommands) return fetchedCommands;
    const clean = query.trim().replace(/^\/+/, "").toLowerCase();
    if (!clean) return controlledCommands;
    return controlledCommands.filter(
      (c) =>
        c.command.toLowerCase().includes(clean) ||
        c.description.toLowerCase().includes(clean) ||
        (c.argHint ?? "").toLowerCase().includes(clean),
    );
  }, [controlledCommands, fetchedCommands, query]);

  const engineItems = React.useMemo(
    () => items.filter((item) => item.kind !== "skill"),
    [items],
  );
  const skillItems = React.useMemo(
    () => items.filter((item) => item.kind === "skill"),
    [items],
  );
  const flatItems = React.useMemo(
    () => [...engineItems, ...skillItems],
    [engineItems, skillItems],
  );

  const clampedIndex =
    flatItems.length > 0
      ? Math.max(0, Math.min(flatItems.length - 1, activeIndex))
      : 0;

  const activeRowRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    if (typeof activeRowRef.current?.scrollIntoView === "function") {
      activeRowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [clampedIndex, open]);

  if (!open) {
    return null;
  }

  const renderRow = (item: SlashCommandItem, flatIdx: number) => {
    const isSelected = flatIdx === clampedIndex;
    const isSessionGated = Boolean(item.requiresSession && !activeSessionId);
    return (
      <button
        key={`${item.kind}:${item.command}`}
        ref={isSelected ? activeRowRef : undefined}
        type="button"
        role="option"
        aria-selected={isSelected}
        aria-disabled={isSessionGated || undefined}
        data-testid="slash-command-item"
        data-command={item.command}
        data-kind={item.kind}
        onMouseEnter={() => onActiveIndexChange(flatIdx)}
        onMouseDown={(event) => {
          event.preventDefault();
          onSelectCommand(item);
        }}
        onClick={() => onSelectCommand(item)}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-xs transition-colors",
          isSelected
            ? "border-hairline bg-active text-ink"
            : "text-body hover:bg-hover hover:text-ink",
          isSessionGated && "opacity-50",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
          {item.kind === "skill" ? (
            <Sparkles
              className="size-3.5 shrink-0 text-code-type"
              aria-hidden="true"
            />
          ) : (
            <Terminal
              className={cn(
                "size-3.5 shrink-0",
                isSelected ? "text-code-kw" : "text-muted-ink",
              )}
              aria-hidden="true"
            />
          )}
          <span className="shrink-0 font-mono text-xs font-medium text-ink">
            {item.command}
          </span>
          {item.argHint ? (
            <span
              data-testid="slash-command-arghint"
              className="shrink-0 font-mono text-[11px] text-faint"
            >
              {item.argHint}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-ink">
            {item.description}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {isSessionGated ? (
            <span className="text-[10px] text-faint">Needs chat</span>
          ) : null}
          {item.category ? (
            <Badge
              variant="outline"
              className="px-1.5 py-0 text-[10px] font-medium"
            >
              {item.kind === "skill" ? "skill" : item.category}
            </Badge>
          ) : null}
        </span>
      </button>
    );
  };

  return (
    <div
      data-testid="slash-command-menu"
      role="listbox"
      aria-label="Slash commands and skills"
      className={cn(
        "rayu-card-bevel rayu-animate-pop z-40 w-full max-w-[520px] overflow-hidden rounded-xl border border-premium-hi bg-popover-solid p-1.5 shadow-rayu-2",
        className,
      )}
    >
      {flatItems.length === 0 ? (
        <div
          data-testid="slash-command-empty"
          className="px-3 py-3 text-center text-xs text-muted-ink"
        >
          No matching commands or skills for &ldquo;/{query.replace(/^\/+/, "")}
          &rdquo;
        </div>
      ) : (
        <ScrollArea className="max-h-[268px]">
          <div className="flex flex-col gap-0.5 py-0.5">
            {engineItems.length > 0 ? (
              <div data-testid="slash-group-engine">
                <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-muted-ink uppercase">
                  Engine Commands
                </div>
                {engineItems.map((item, idx) => renderRow(item, idx))}
              </div>
            ) : null}

            {engineItems.length > 0 && skillItems.length > 0 ? (
              <Separator
                data-testid="slash-group-separator"
                className="my-1 bg-hairline-soft"
              />
            ) : null}

            {skillItems.length > 0 ? (
              <div data-testid="slash-group-skills">
                <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-muted-ink uppercase">
                  Skills
                </div>
                {skillItems.map((item, idx) =>
                  renderRow(item, engineItems.length + idx),
                )}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      )}

      <div className="mt-1 flex items-center justify-between border-t border-hairline-soft px-2.5 pt-1.5 pb-0.5 font-mono text-[10px] text-faint">
        <span>
          {query.trim()
            ? `/${query.trim().replace(/^\/+/, "")}`
            : "Live engine capabilities"}
        </span>
        <span>↑↓ navigate · Tab complete · Enter run · Esc</span>
      </div>
    </div>
  );
}
