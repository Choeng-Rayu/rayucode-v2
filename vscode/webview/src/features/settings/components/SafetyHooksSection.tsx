import { ExternalLink, Shield, ShieldAlert } from "lucide-react";
import type { HookEntryView, PermissionModeId } from "@shared/vscodeProtocol";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SafetyHooksSectionProps {
  defaultPermissionMode: PermissionModeId;
  onSelectPermissionMode: (mode: PermissionModeId) => Promise<unknown>;
  hooks: ReadonlyArray<
    HookEntryView & {
      kindLabel?: string;
      description?: string;
    }
  >;
  configPath?: string;
  onOpenHooksConfig: () => Promise<unknown>;
}

const FIVE_PERMISSION_MODES: ReadonlyArray<{
  id: PermissionModeId;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    id: "default",
    label: "Ask (Default)",
    badge: "default",
    description:
      "Read-only tools run freely; file edits and shell commands prompt for approval",
  },
  {
    id: "acceptEdits",
    label: "Auto-edit",
    badge: "accept_edits",
    description:
      "Workspace file edits apply automatically; non-safe shell commands still prompt",
  },
  {
    id: "plan",
    label: "Plan Only",
    badge: "plan",
    description:
      "Strictly read-only exploration and architecture planning; zero mutations allowed",
  },
  {
    id: "fullManage",
    label: "Full Manage",
    badge: "full_manage",
    description:
      "Autonomous workspace edits and bounded commands; Stage-2 Command-Risk Gate still guards high-risk ops",
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    badge: "orchestrator",
    description:
      "Coordinator mode for multi-agent swarms and worktree task delegation",
  },
];

const COMMAND_RISK_TIERS = [
  {
    tier: "safe",
    label: "Safe",
    tone: "bg-brand-soft text-brand-text",
    rule: "Read-only inspection commands (git status, git diff, rg, ls, cargo check) execute without prompting.",
  },
  {
    tier: "bounded",
    label: "Bounded",
    tone: "bg-info-soft text-info",
    rule: "Workspace-scoped builds & test runners (cargo test, npm test, vitest) auto-run in Full Manage mode.",
  },
  {
    tier: "confirm",
    label: "Confirm",
    tone: "bg-warn-soft text-warn",
    rule: "Network mutations, git push, package installs, and outside-workspace writes always require explicit confirmation.",
  },
  {
    tier: "hard_deny",
    label: "Hard-Deny",
    tone: "bg-danger-soft text-danger",
    rule: "Destructive root/home wipes, SSH/cloud credential exfiltration, and force-push to main are mechanically blocked.",
  },
] as const;

export function SafetyHooksSection({
  defaultPermissionMode,
  onSelectPermissionMode,
  hooks,
  configPath = "~/.rayu/config.toml",
  onOpenHooksConfig,
}: SafetyHooksSectionProps) {
  return (
    <section
      data-testid="settings-section-safety"
      aria-labelledby="settings-h-safety"
      className="flex flex-col gap-6"
    >
      <div>
        <h1
          id="settings-h-safety"
          className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink"
        >
          Safety &amp; Hooks
        </h1>
        <p className="mt-1 text-xs text-muted-ink">
          Configure the 5-mode permission policy, inspect the 2-stage
          Command-Risk Gate rules, and manage all 7 Rust lifecycle hooks.
        </p>
      </div>

      {/* 5 Default Permission Modes */}
      <div>
        <h2 className="mb-3 text-xs font-semibold text-ink">
          Default Permission Mode (5 Modes · Cycle anytime with Shift+Tab)
        </h2>
        <div
          role="radiogroup"
          aria-label="Default permission mode"
          data-testid="permission-modes-list"
          className="grid grid-cols-1 gap-2.5"
        >
          {FIVE_PERMISSION_MODES.map((m) => {
            const isSelected = defaultPermissionMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`permission-mode-card-${m.id}`}
                onClick={() => void onSelectPermissionMode(m.id)}
                className={cn(
                  "flex cursor-pointer items-start justify-between gap-3 rounded-xl border bg-pane px-4 py-3 text-left text-xs transition-all",
                  isSelected
                    ? "border-brand bg-brand-softer ring-1 ring-brand"
                    : "border-hairline hover:border-hairline-strong",
                )}
              >
                <div>
                  <div className="flex items-center gap-2 font-medium text-ink">
                    <span>{m.label}</span>
                    <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-muted-ink">
                      {m.badge}
                    </code>
                  </div>
                  <div className="mt-1 text-muted-ink">{m.description}</div>
                </div>
                <span
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0 rounded-full border",
                    isSelected
                      ? "border-brand bg-brand"
                      : "border-hairline-strong bg-inset",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* 2-Stage Command-Risk Gate Rules */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Shield className="size-4 text-brand-text" aria-hidden="true" />
          <h2 className="m-0 text-xs font-semibold text-ink">
            Two-Stage Command-Risk Gate (rayucode-command-risk)
          </h2>
        </div>

        <div
          data-testid="command-risk-gate-card"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane"
        >
          {COMMAND_RISK_TIERS.map((item) => (
            <div
              key={item.tier}
              data-testid={`risk-tier-${item.tier}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "inline-flex min-w-[82px] justify-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium",
                    item.tone,
                  )}
                >
                  {item.label}
                </span>
                <span className="text-body">{item.rule}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* All 7 Lifecycle Hooks Inventory */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-xs font-semibold text-ink">
              Lifecycle Hooks Inventory (7 Hooks: 1 Sync Gate, 1 Sync Feedback,
              5 Async Observers)
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-ink">
              Configured in{" "}
              <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-body">
                {configPath}
              </code>{" "}
              under [hooks]
            </p>
          </div>

          <Button
            type="button"
            variant="default"
            size="xs"
            onClick={() => void onOpenHooksConfig()}
            data-testid="open-hooks-config-btn"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            <span>Open Hooks Config in VS Code</span>
          </Button>
        </div>

        <div
          data-testid="lifecycle-hooks-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane"
        >
          {hooks.map((hook) => (
            <div
              key={hook.event}
              data-testid={`hook-row-${hook.event}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  <code className="font-mono text-xs text-ink">
                    {hook.event}
                  </code>
                  <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10px] text-muted-ink">
                    {hook.kindLabel ??
                      (hook.mode === "sync" ? "Sync" : "Async Observer")}
                  </span>
                </div>
                {hook.description && (
                  <div className="mt-0.5 text-[11px] text-muted-ink">
                    {hook.description}
                  </div>
                )}
                {hook.commandSummary && (
                  <code className="mt-1 inline-block rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-brand-text">
                    {hook.commandSummary}
                  </code>
                )}
              </div>

              <span
                data-testid={`hook-status-${hook.event}`}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  hook.configured
                    ? "bg-brand-soft text-brand-text"
                    : "bg-raised text-muted-ink",
                )}
              >
                {hook.configured ? "Configured" : "Unset"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-hairline bg-inset px-3.5 py-2.5 text-[11px] text-muted-ink">
        <ShieldAlert className="size-3.5 shrink-0 text-warn" />
        <span>
          Synchronous hooks (pre_tool and post_tool_feedback) run with bounded
          timeouts so runaway scripts cannot deadlock an active session.
        </span>
      </div>
    </section>
  );
}
