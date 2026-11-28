import * as React from "react";
import { Calendar, Globe, Laptop, Mail } from "lucide-react";

import {
  Badge,
  BrandLogo,
  Button,
  RunStatusPulse,
  Switch,
} from "@/components/ui";
import { postToHost } from "@/lib";

import {
  useTriggerWorkspaceIntegration,
  useWorkspaceIntegrations,
} from "../hooks/usePlugins";

export function WorkspaceToolsTab() {
  const { data: integrations, isError } = useWorkspaceIntegrations();
  const triggerMutation = useTriggerWorkspaceIntegration();

  const [lastActionBanner, setLastActionBanner] = React.useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const handleTrigger = async (
    integration: "gmail" | "calendar" | "browser" | "companion",
    action: string,
    label: string,
  ) => {
    try {
      const res = await triggerMutation.mutateAsync({ integration, action });
      setLastActionBanner({
        tone: "ok",
        text: res.message ? `${label}: ${res.message}` : label,
      });
    } catch (err) {
      setLastActionBanner({
        tone: "error",
        text:
          err instanceof Error
            ? err.message
            : `Failed to run ${integration}:${action}`,
      });
    }
  };

  if (integrations?.available === false) {
    return <p className="p-4 text-sm text-muted-ink">Workspace integration status is unavailable in this runtime.</p>;
  }
  if (!integrations) {
    return <p className="p-4 text-sm text-muted-ink">{isError ? "Could not load workspace integrations." : "Loading workspace integrations…"}</p>;
  }

  const gmail = integrations?.gmail;
  const calendar = integrations?.calendar;
  const browser = integrations?.browser;
  const companion = integrations?.companion;

  return (
    <div data-testid="workspace-tools-tab" className="flex flex-col gap-6">
      <header>
        <h1 className="m-0 text-xl font-semibold tracking-tight text-ink">
          Workspace Integrations
        </h1>
        <p className="mt-0.5 text-xs text-muted-ink">
          Built-in Rust engine tools for Gmail, Google Calendar, Multi-Browser
          Automation, and Desktop Companion readiness.
        </p>
      </header>

      {lastActionBanner && (
        <div
          role={lastActionBanner.tone === "error" ? "alert" : undefined}
          data-testid="workspace-action-banner"
          className={
            lastActionBanner.tone === "error"
              ? "rounded-xl border border-danger/40 bg-danger-soft px-4 py-2.5 text-xs text-danger"
              : "rounded-xl border border-brand/40 bg-brand-soft px-4 py-2.5 text-xs text-brand-text"
          }
        >
          {lastActionBanner.text}
        </div>
      )}

      {/* 4-Card Status Grid */}
      <div className="grid grid-cols-1 gap-4 @min-[600px]/plugins-stage:grid-cols-2">
        {/* 1. Gmail Card */}
        <section
          data-testid="workspace-card-gmail"
          className="rayu-card-bevel flex flex-col justify-between gap-4 rounded-[14px] border border-premium bg-pane p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <BrandLogo name="gmail" size="md" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="m-0 text-sm font-semibold text-ink">
                      Gmail
                    </h2>
                    <Badge variant={gmail?.connected ? "brand" : "secondary"}>
                      {gmail?.connected ? "Connected" : "Not connected"}
                    </Badge>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-ink">
                    gmail tool · {gmail?.actionCount ?? 15} actions
                    {gmail?.account ? ` · ${gmail.account}` : ""}
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted-ink">
              Search threads, read messages, create drafts, manage labels, and
              summarize engineering inbox updates directly via the Rust{" "}
              <code className="font-mono text-body">gmail</code> tool.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
            <Button
              type="button"
              variant={gmail?.connected ? "secondary" : "primary"}
              size="xs"
              data-testid="gmail-connect-btn"
              onClick={() => {
                void handleTrigger(
                  "gmail",
                  "connect",
                  "Connected Google Workspace OAuth",
                );
              }}
            >
              <Mail className="size-3" aria-hidden="true" />
              <span>
                {gmail?.connected
                  ? "Reconnect Workspace"
                  : "Connect Google Workspace"}
              </span>
            </Button>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid="gmail-search-action-btn"
                onClick={() => {
                  void handleTrigger("gmail", "search", "Gmail thread search");
                }}
              >
                <span>Search</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid="gmail-drafts-action-btn"
                onClick={() => {
                  void handleTrigger("gmail", "drafts", "Gmail drafts list");
                }}
              >
                <span>Drafts</span>
              </Button>
            </div>
          </div>
        </section>

        {/* 2. Google Calendar Card */}
        <section
          data-testid="workspace-card-calendar"
          className="rayu-card-bevel flex flex-col justify-between gap-4 rounded-[14px] border border-premium bg-pane p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <BrandLogo name="icloud-calendar" size="md" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="m-0 text-sm font-semibold text-ink">
                      Google Calendar
                    </h2>
                    <Badge
                      variant={calendar?.connected ? "brand" : "secondary"}
                    >
                      {calendar?.connected ? "Connected" : "Shared OAuth"}
                    </Badge>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-ink tabular-nums">
                    calendar tool · {calendar?.actionCount ?? 7} actions ·{" "}
                    {calendar?.calendarCount ?? 0} active calendars
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted-ink">
              Shares Google Workspace OAuth credentials to list upcoming standups,
              check free/busy blocks, and run{" "}
              <code className="font-mono text-body">quick_add</code> event
              scheduling.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
            <Button
              type="button"
              variant="default"
              size="xs"
              data-testid="calendar-list-btn"
              onClick={() => {
                void handleTrigger(
                  "calendar",
                  "list",
                  "Listed today's calendar events",
                );
              }}
            >
              <Calendar className="size-3" aria-hidden="true" />
              <span>List Events</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="calendar-quick-add-btn"
              onClick={() => {
                void handleTrigger(
                  "calendar",
                  "quick_add",
                  "Quick-add calendar event ready",
                );
              }}
            >
              <span>Quick-Add Event</span>
            </Button>
          </div>
        </section>

        {/* 3. Multi-Browser Automation Card */}
        <section
          data-testid="workspace-card-browser"
          className="rayu-card-bevel flex flex-col justify-between gap-4 rounded-[14px] border border-premium bg-pane p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <BrandLogo name="chrome-devtools" size="md" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="m-0 text-sm font-semibold text-ink">
                      Browser Automation
                    </h2>
                    <Badge
                      variant={browser?.handoffActive ? "brand" : "info"}
                    >
                      {browser?.handoffActive
                        ? "Handoff Active"
                        : "Ready"}
                    </Badge>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-ink">
                    browser tool · {browser?.actionCount ?? 17} actions
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-ink">Detected:</span>
              {browser?.detectedBrowsers && browser.detectedBrowsers.length > 0 ? (
                browser.detectedBrowsers.map((b) => (
                  <span
                    key={b}
                    className="rounded border border-hairline bg-inset px-2 py-0.5 font-mono text-[10.5px] text-body"
                  >
                    {b}
                  </span>
                ))
              ) : (
                <span className="font-mono text-[10.5px] text-muted-ink">
                  None reported by daemon
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
            <Button
              type="button"
              variant="primary"
              size="xs"
              data-testid="browser-handoff-btn"
              onClick={() => {
                void handleTrigger(
                  "browser",
                  "handoff",
                  "Opened live Browser Handoff session",
                );
              }}
            >
              <Globe className="size-3" aria-hidden="true" />
              <span>Open Browser Handoff</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="xs"
              data-testid="browser-open-simple-btn"
              onClick={() => {
                postToHost({
                  type: "rayucode.editor.openSimpleBrowser",
                });
              }}
            >
              <Globe className="size-3" aria-hidden="true" />
              <span>Open in VS Code Browser</span>
            </Button>
          </div>
        </section>

        {/* 4. Desktop Companion Card */}
        <section
          data-testid="workspace-card-companion"
          className="rayu-card-bevel flex flex-col justify-between gap-4 rounded-[14px] border border-premium bg-pane p-4"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-premium bg-inset text-brand-text">
                  <Laptop className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="m-0 text-sm font-semibold text-ink">
                      Desktop Companion
                    </h2>
                    <RunStatusPulse
                      status={companion?.running ? "success" : "idle"}
                    />
                    <Badge variant={companion?.running ? "brand" : "secondary"}>
                      {companion?.running ? "Running" : "Offline"}
                    </Badge>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-ink">
                    rayucode-companion · v{companion?.version ?? "2.4.0"}
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted-ink">
              Provides lid-close keep-awake power override for overnight swarms,
              macOS Computer Use readiness, and native desktop bridge health.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
            <div className="flex items-center gap-2 text-xs">
              <Switch
                size="sm"
                checked={Boolean(companion?.keepAwake)}
                onCheckedChange={() => {
                  void handleTrigger(
                    "companion",
                    "toggleKeepAwake",
                    "Updated Keep-Awake power override",
                  );
                }}
                aria-label="Keep-Awake power override"
                data-testid="companion-keep-awake-switch"
              />
              <span className="text-body">Keep-Awake Power Override</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
