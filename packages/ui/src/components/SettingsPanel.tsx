import { useState, type ReactNode } from "react";
import type { ModelRouteInfo } from "@rayu-dev/rayucode-sdk/browser";
import type { RayucodePlatformKind, SettingsAccountSummary } from "../adapter/types.js";

export type SettingsTabId = "general" | "account" | "models" | "about";

export interface SettingsPanelProps {
  platform: RayucodePlatformKind;
  account?: SettingsAccountSummary;
  routes: ModelRouteInfo[];
  currentModel?: string;
  currentProvider?: string;
  reasoningEffort?: string;
  onSelectModel?: (model: string) => void;
  onSetReasoningEffort?: (effort: string) => void;
  onSignIn?: () => void;
  onSignOut?: () => void;
  onSaveApiKey?: (provider: string, apiKey: string) => void;
  onClose?: () => void;
  extraSections?: ReactNode;
}

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;

export function SettingsPanel({
  platform,
  account,
  routes,
  currentModel,
  currentProvider,
  reasoningEffort,
  onSelectModel,
  onSetReasoningEffort,
  onSignIn,
  onSignOut,
  onSaveApiKey,
  onClose,
  extraSections,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTabId>("general");
  const [apiKeyInput, setApiKeyInput] = useState("");

  return (
    <section
      aria-label="RayuCode Settings"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "16px",
        backgroundColor: "var(--rc-surface)",
        borderBlockStart: "1px solid var(--rc-border)",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div role="tablist" aria-label="Settings sections" style={{ display: "flex", gap: "6px" }}>
          {(["general", "account", "models", "about"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "rc-btn rc-btn-primary" : "rc-btn"}
              onClick={() => setTab(id)}
            >
              {id[0]!.toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>
        {onClose ? (
          <button type="button" className="rc-btn" onClick={onClose}>
            Close
          </button>
        ) : null}
      </header>

      {tab === "general" ? (
        <div style={{ display: "grid", gap: "10px" }}>
          <div>
            <strong>Reasoning Effort</strong>
            <div style={{ display: "flex", gap: "6px", marginBlockStart: "6px" }}>
              {EFFORT_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={reasoningEffort === level ? "rc-btn rc-btn-primary" : "rc-btn"}
                  onClick={() => onSetReasoningEffort?.(level)}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          {extraSections}
        </div>
      ) : null}

      {tab === "account" ? (
        <div style={{ display: "grid", gap: "10px" }}>
          <div>
            <strong>Rayu Account</strong>
            <p style={{ marginBlock: "4px", color: "var(--rc-muted)" }}>
              {account?.signedIn
                ? `Signed in${account.email ? ` as ${account.email}` : ""}${account.plan ? ` (${account.plan})` : ""}`
                : "Not signed in. Sign in with Rayu Auth or configure a RAYU_API_KEY to unlock Rayu models by default."}
            </p>
            <div style={{ display: "flex", gap: "8px", marginBlockStart: "6px" }}>
              {account?.signedIn ? (
                <button type="button" className="rc-btn rc-btn-danger" onClick={onSignOut}>
                  Sign out
                </button>
              ) : (
                <button type="button" className="rc-btn rc-btn-primary" onClick={onSignIn}>
                  Sign in with Rayu
                </button>
              )}
            </div>
          </div>
          {onSaveApiKey ? (
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(ev) => setApiKeyInput(ev.target.value)}
                placeholder="Paste Rayu API key..."
                aria-label="Rayu API key"
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: "var(--rc-radius-sm)",
                  border: "1px solid var(--rc-border)",
                  backgroundColor: "var(--rc-bg)",
                  color: "var(--rc-fg)",
                }}
              />
              <button
                type="button"
                className="rc-btn"
                disabled={!apiKeyInput.trim()}
                onClick={() => {
                  onSaveApiKey("rayu", apiKeyInput.trim());
                  setApiKeyInput("");
                }}
              >
                Save API Key
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "models" ? (
        <div style={{ display: "grid", gap: "6px" }}>
          <div style={{ color: "var(--rc-muted)", fontSize: "var(--rc-font-size-xs)" }}>
            Active: {currentModel ?? "default"} {currentProvider ? `(${currentProvider})` : ""}
          </div>
          {routes.map((route) => (
            <button
              key={`${route.provider}:${route.model}`}
              type="button"
              className="rc-btn"
              disabled={!route.available}
              style={{
                justifyContent: "space-between",
                borderColor: route.model === currentModel ? "var(--rc-accent)" : undefined,
              }}
              onClick={() => onSelectModel?.(route.model)}
            >
              <span>{route.model}</span>
              <span style={{ color: "var(--rc-muted)", fontSize: "var(--rc-font-size-xs)" }}>
                {route.provider}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {tab === "about" ? (
        <div style={{ color: "var(--rc-muted)" }}>
          RayuCode Shared UI ({platform === "vscode" ? "VS Code Extension" : "Web"}) · Harness API
          v1.12
        </div>
      ) : null}
    </section>
  );
}
