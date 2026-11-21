import { useMemo, useState } from "react";
import type { ModelRouteInfo } from "@rayu-dev/rayucode-sdk/browser";
import { SparklesIcon } from "./Icons.js";

export interface ModelSelectorProps {
  routes: ModelRouteInfo[];
  currentModel?: string;
  currentProvider?: string;
  disabled?: boolean;
  onSelectModel: (model: string) => void;
}

/**
 * Shared model selector preserving the exact provider/model order returned by
 * `rayucode-v2` so Rayu Auth and Rayu API Key routes remain pinned at the top.
 */
export function ModelSelector({
  routes,
  currentModel,
  currentProvider,
  disabled,
  onSelectModel,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredRoutes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter(
      (r) =>
        r.model.toLowerCase().includes(q) ||
        r.provider.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q),
    );
  }, [routes, query]);

  const activeLabel = currentModel
    ? currentProvider
      ? `${currentModel} (${currentProvider})`
      : currentModel
    : "Select model";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="rc-btn"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
      >
        <SparklesIcon size={14} />
        <span title={activeLabel} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activeLabel}
        </span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Available models"
          style={{
            position: "absolute",
            insetInlineEnd: 0,
            insetBlockStart: "calc(100% + 6px)",
            zIndex: 30,
            width: "min(320px, 85cqi)",
            maxHeight: "340px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            padding: "8px",
            borderRadius: "var(--rc-radius-md)",
            border: "1px solid var(--rc-border)",
            backgroundColor: "var(--rc-surface)",
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder="Filter models..."
            aria-label="Filter models"
            style={{
              padding: "6px 8px",
              borderRadius: "var(--rc-radius-sm)",
              border: "1px solid var(--rc-border)",
              backgroundColor: "var(--rc-bg)",
              color: "var(--rc-fg)",
            }}
          />
          <div className="rc-scroll" style={{ display: "grid", gap: "4px" }}>
            {filteredRoutes.map((route) => {
              const selected = route.model === currentModel;
              return (
                <button
                  key={`${route.provider}:${route.model}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={!route.available}
                  className="rc-btn"
                  style={{
                    justifyContent: "space-between",
                    borderColor: selected ? "var(--rc-accent)" : undefined,
                    textAlign: "start",
                  }}
                  onClick={() => {
                    onSelectModel(route.model);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span>
                    <strong>{route.model}</strong>
                    <span style={{ display: "block", fontSize: "var(--rc-font-size-xs)", color: "var(--rc-muted)" }}>
                      {route.provider} · {route.detail}
                    </span>
                  </span>
                  {selected ? <span>Active</span> : null}
                </button>
              );
            })}
            {filteredRoutes.length === 0 ? (
              <div style={{ padding: "8px", color: "var(--rc-muted)" }}>No matching models</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
