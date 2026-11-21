import type { ModelRouteInfo, SessionEditStats } from "@rayu-dev/rayucode-sdk/browser";
import { PlusIcon, SettingsIcon } from "./Icons.js";
import { ModelSelector } from "./ModelSelector.js";

export interface SessionHeaderProps {
  title: string;
  routes: ModelRouteInfo[];
  currentModel?: string;
  currentProvider?: string;
  modelDisabled?: boolean;
  editStats?: SessionEditStats;
  onSelectModel: (model: string) => void;
  onNewSession?: () => void;
  onOpenSettings?: () => void;
}

export function SessionHeader({
  title,
  routes,
  currentModel,
  currentProvider,
  modelDisabled,
  editStats,
  onSelectModel,
  onNewSession,
  onOpenSettings,
}: SessionHeaderProps) {
  return (
    <header className="rc-header">
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </strong>
        {editStats && (editStats.added > 0 || editStats.removed > 0) ? (
          <span style={{ fontSize: "var(--rc-font-size-xs)", fontFamily: "var(--rc-font-mono)" }}>
            <span style={{ color: "var(--rc-accent)" }}>+{editStats.added}</span>{" "}
            <span style={{ color: "var(--rc-danger)" }}>-{editStats.removed}</span>
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <ModelSelector
          routes={routes}
          currentModel={currentModel}
          currentProvider={currentProvider}
          disabled={modelDisabled}
          onSelectModel={onSelectModel}
        />
        {onNewSession ? (
          <button type="button" className="rc-btn" onClick={onNewSession} aria-label="New session">
            <PlusIcon size={14} />
          </button>
        ) : null}
        {onOpenSettings ? (
          <button
            type="button"
            className="rc-btn"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            <SettingsIcon size={14} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
