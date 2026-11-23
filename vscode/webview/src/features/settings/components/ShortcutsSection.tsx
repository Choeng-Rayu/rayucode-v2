import * as React from "react";
import { ExternalLink, Keyboard, Search } from "lucide-react";
import type { ShortcutEntryView } from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";

export interface ShortcutsSectionProps {
  shortcuts: ReadonlyArray<ShortcutEntryView & { category?: string }>;
  onOpenKeybindings: () => Promise<unknown>;
}

export function ShortcutsSection({
  shortcuts,
  onOpenKeybindings,
}: ShortcutsSectionProps) {
  const [filter, setFilter] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return shortcuts;
    return shortcuts.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.keybinding.toLowerCase().includes(q) ||
        (s.commandId ?? "").toLowerCase().includes(q),
    );
  }, [filter, shortcuts]);

  return (
    <section
      data-testid="settings-section-shortcuts"
      aria-labelledby="settings-h-shortcuts"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            id="settings-h-shortcuts"
            className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink"
          >
            Shortcuts
          </h1>
          <p className="mt-1 text-xs text-muted-ink">
            Complete keyboard shortcuts reference including Shift+Tab, Alt+B,
            and Cmd/Ctrl+Shift+P commands.
          </p>
        </div>

        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => void onOpenKeybindings()}
          data-testid="open-vscode-keybindings-btn"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          <span>Customize in VS Code Keyboard Shortcuts</span>
        </Button>
      </div>

      {/* Shortcut Search Input */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-muted-ink"
          aria-hidden="true"
        />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search shortcuts by action, keybinding (Shift+Tab, Alt+B), or command..."
          aria-label="Search keyboard shortcuts"
          data-testid="shortcuts-search-input"
          className="h-8 w-full rounded-lg border border-control-border bg-inset pr-3 pl-9 text-xs text-ink placeholder:text-muted-ink focus-visible:border-ring focus-visible:outline-none"
        />
      </div>

      <div
        data-testid="shortcuts-table"
        className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane"
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-ink">
            No keyboard shortcuts match &ldquo;{filter}&rdquo;.
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              data-testid={`shortcut-row-${item.id}`}
              className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium text-ink">
                  <Keyboard
                    className="size-3.5 shrink-0 text-muted-ink"
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </div>
                {(item.commandId || item.when) && (
                  <div className="mt-0.5 pl-5.5 font-mono text-[11px] text-muted-ink">
                    {item.commandId ?? ""}
                    {item.commandId && item.when ? " · " : ""}
                    {item.when ? `when: ${item.when}` : ""}
                  </div>
                )}
              </div>

              <kbd
                data-testid={`shortcut-kbd-${item.id}`}
                className="inline-flex h-6 items-center justify-center rounded-[6px] border border-hairline-strong bg-raised px-2 font-mono text-[11.5px] font-medium text-ink shadow-bevel-surface"
              >
                {item.keybinding}
              </kbd>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
