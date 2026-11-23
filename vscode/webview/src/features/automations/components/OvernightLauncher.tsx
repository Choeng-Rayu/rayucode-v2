import * as React from "react";
import { GitBranch, Rocket, ShieldCheck, Users } from "lucide-react";
import type { OvernightRunView, PermissionModeId } from "@shared/vscodeProtocol";

import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { cn, useAppStore } from "@/lib";

import { useStartOvernightRun } from "../hooks/useAutomations";

export interface OvernightLauncherProps {
  open?: boolean;
  onClose?: () => void;
  onLaunched?: (run: OvernightRunView) => void;
  className?: string;
}

const DURATION_PRESETS = ["2h", "4h", "8h", "Custom"] as const;
type DurationPreset = (typeof DURATION_PRESETS)[number];

const BRANCH_MODES = [
  { value: "worktree", label: "Isolated Worktree" },
  { value: "branch", label: "Dedicated Branch" },
  { value: "draft-pr", label: "Worktree + Draft PR" },
] as const;

const AGENT_CAPS = [
  { value: "1", label: "1 agent" },
  { value: "2", label: "2 agents" },
  { value: "4", label: "4 agents" },
  { value: "8", label: "8 agents" },
] as const;

const SAFETY_MODES: ReadonlyArray<{
  value: PermissionModeId;
  label: string;
}> = [
  { value: "acceptEdits", label: "Auto-edit" },
  { value: "fullManage", label: "Full Manage" },
  { value: "default", label: "Ask" },
  { value: "plan", label: "Plan Only" },
];

export function OvernightLauncher({
  open = true,
  onClose,
  onLaunched,
  className,
}: OvernightLauncherProps) {
  const workspaces = useAppStore((s) => s.workspaces);
  const primaryWorkspace = workspaces[0];
  const repoName = primaryWorkspace?.name ?? "rayucode-v2";
  const branchName = primaryWorkspace?.branch ?? "main";

  const [mission, setMission] = React.useState("");
  const [durationPreset, setDurationPreset] =
    React.useState<DurationPreset>("4h");
  const [customDuration, setCustomDuration] = React.useState("6h");
  const [branchMode, setBranchMode] = React.useState("worktree");
  const [maxAgents, setMaxAgents] = React.useState("4");
  const [permissionMode, setPermissionMode] =
    React.useState<PermissionModeId>("acceptEdits");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const startMutation = useStartOvernightRun();

  if (!open) {
    return null;
  }

  const resolvedDuration =
    durationPreset === "Custom" ? customDuration.trim() || "6h" : durationPreset;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanMission = mission.trim();
    if (!cleanMission) {
      setErrorMessage("Describe the overnight mission goal before launching.");
      inputRef.current?.focus();
      return;
    }

    setErrorMessage(null);
    try {
      const created = await startMutation.mutateAsync({
        mission: cleanMission,
        duration: resolvedDuration,
        maxAgents: Number(maxAgents) || 4,
        permissionMode,
        workingDir: primaryWorkspace?.path,
        mode: branchMode,
        repo: repoName,
        branch: `overnight/${branchName}`,
      });
      setMission("");
      onLaunched?.(created);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to start overnight mission.",
      );
    }
  };

  return (
    <form
      id="overnight-launcher"
      data-testid="overnight-launcher"
      aria-label="Start overnight mission"
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className={cn(
        "rayu-card-bevel flex flex-col gap-3.5 rounded-[14px] border border-hairline bg-pane p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">
            Start Overnight Run
          </span>
          <Badge variant="outline" className="font-mono text-[10.5px]">
            rayucode-overnight-core
          </Badge>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-ink">
          <GitBranch className="size-3.5 text-brand-text" aria-hidden="true" />
          <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-body">
            {repoName}:{branchName}
          </code>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <input
          ref={inputRef}
          id="ovn-mission-input"
          data-testid="overnight-mission-input"
          type="text"
          value={mission}
          onChange={(e) => {
            setMission(e.target.value);
            if (errorMessage) setErrorMessage(null);
          }}
          placeholder="What should Rayu work on overnight? e.g. Sweep compiler warnings and add harness tests"
          aria-label="What should Rayu work on overnight?"
          aria-invalid={errorMessage ? "true" : "false"}
          className={cn(
            "w-full rounded-[10px] border bg-inset px-3 py-2 font-mono text-xs text-ink placeholder:text-muted-ink focus:outline-none",
            errorMessage
              ? "border-danger focus:border-danger"
              : "border-premium focus:border-brand/60",
          )}
        />
        {errorMessage ? (
          <p
            role="alert"
            data-testid="overnight-launcher-error"
            className="text-xs font-medium text-danger"
          >
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Duration Preset Pills */}
          <div
            role="group"
            aria-label="Duration budget"
            className="inline-flex items-center rounded-lg border border-hairline bg-inset p-0.5"
          >
            {DURATION_PRESETS.map((preset) => {
              const active = durationPreset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  data-testid={`overnight-duration-pill-${preset.toLowerCase()}`}
                  aria-pressed={active}
                  onClick={() => setDurationPreset(preset)}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition-colors",
                    active
                      ? "bg-active text-ink shadow-bevel-surface"
                      : "text-muted-ink hover:text-ink",
                  )}
                >
                  {preset}
                </button>
              );
            })}
          </div>

          {durationPreset === "Custom" && (
            <input
              type="text"
              data-testid="overnight-custom-duration-input"
              value={customDuration}
              onChange={(e) => setCustomDuration(e.target.value)}
              aria-label="Custom duration"
              placeholder="6h"
              className="h-7 w-16 rounded-md border border-control-border bg-inset px-2 font-mono text-xs text-ink focus:border-ring focus:outline-none"
            />
          )}

          {/* Branch / PR Mode Selector */}
          <Select value={branchMode} onValueChange={setBranchMode}>
            <SelectTrigger
              size="sm"
              aria-label="Branch and PR mode"
              data-testid="overnight-mode-select"
            >
              <SelectValue placeholder="Branch mode" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {BRANCH_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Max Parallel Agents Selector */}
          <Select value={maxAgents} onValueChange={setMaxAgents}>
            <SelectTrigger
              size="sm"
              aria-label="Max parallel agents"
              data-testid="overnight-agents-select"
            >
              <Users className="size-3 text-muted-ink" aria-hidden="true" />
              <SelectValue placeholder="Agents" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {AGENT_CAPS.map((cap) => (
                <SelectItem key={cap.value} value={cap.value}>
                  {cap.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Safety / Permission Mode Selector */}
          <Select
            value={permissionMode}
            onValueChange={(v) => setPermissionMode(v as PermissionModeId)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Permission safety mode"
              data-testid="overnight-permission-select"
            >
              <ShieldCheck
                className="size-3 text-muted-ink"
                aria-hidden="true"
              />
              <SelectValue placeholder="Permissions" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {SAFETY_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          {onClose ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={startMutation.isPending}
            data-testid="launch-overnight-btn"
          >
            <Rocket className="size-3.5" aria-hidden="true" />
            <span>
              {startMutation.isPending
                ? "Starting..."
                : "Start Overnight Run"}
            </span>
          </Button>
        </div>
      </div>
    </form>
  );
}
