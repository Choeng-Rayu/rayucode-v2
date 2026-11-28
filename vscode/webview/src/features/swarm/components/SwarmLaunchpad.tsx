import * as React from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Layers,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Wrench,
} from "lucide-react";

import {
  Button,
  NavGlyph,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { cn } from "@/lib";

import {
  DEFAULT_SWARM_MODELS,
  type LaunchPresetInput,
  type SpawnWorkerInput,
  type SwarmAgentView,
} from "../hooks/useSwarm";
import { SpawnWorkerBar } from "./SpawnWorkerBar";

export type SwarmPresetId = "feature-build" | "code-audit" | "bug-hunt";

export interface SwarmPresetDefinition {
  id: SwarmPresetId;
  label: string;
  workerCount: number;
  workerCountLabel: string;
  description: string;
  defaultGoal: string;
  icon: "layers" | "shield" | "wrench";
  buildWorkers: (
    goal: string,
    workerCount: number,
  ) => Array<{
    label: string;
    role: string;
    useWorktree: boolean;
    prompt: string;
    summary: string;
  }>;
}

export const SWARM_LAUNCH_PRESETS: readonly SwarmPresetDefinition[] = [
  {
    id: "feature-build",
    label: "Feature Build Squad",
    workerCount: 2,
    workerCountLabel: "2 agents",
    description:
      "Implement a feature in an isolated git worktree while a verifier writes and runs tests",
    defaultGoal:
      "Implement the requested feature in an isolated worktree and add unit tests covering key paths",
    icon: "layers",
    buildWorkers: (goal, count) => {
      const base = [
        {
          label: "builder-1",
          role: "Worker",
          useWorktree: true,
          prompt: goal,
          summary: "@builder-1 (worktree)",
        },
        {
          label: "verifier-1",
          role: "Verifier",
          useWorktree: false,
          prompt: `Write and run verification tests for: ${goal}`,
          summary: "@verifier-1 (tests)",
        },
        {
          label: "reviewer-1",
          role: "Reviewer",
          useWorktree: false,
          prompt: `Audit design tokens, edge cases, and diff safety for: ${goal}`,
          summary: "@reviewer-1 (review)",
        },
      ];
      return base.slice(0, Math.max(1, Math.min(count, base.length)));
    },
  },
  {
    id: "code-audit",
    label: "Parallel Code Audit",
    workerCount: 3,
    workerCountLabel: "3 agents",
    description:
      "Fan out architecture, security, and regression reviewers across modules in parallel",
    defaultGoal:
      "Audit module boundaries, security invariants, and test coverage gaps across the workspace",
    icon: "shield",
    buildWorkers: (goal, count) => {
      const base = [
        {
          label: "auditor-arch",
          role: "Reviewer",
          useWorktree: false,
          prompt: `Audit architectural boundaries and type safety for: ${goal}`,
          summary: "@auditor-arch (architecture)",
        },
        {
          label: "auditor-sec",
          role: "Reviewer",
          useWorktree: false,
          prompt: `Audit security, permissions, and input validation for: ${goal}`,
          summary: "@auditor-sec (security)",
        },
        {
          label: "verifier-1",
          role: "Verifier",
          useWorktree: true,
          prompt: `Run regression suites and verify edge cases for: ${goal}`,
          summary: "@verifier-1 (verification)",
        },
      ];
      return base.slice(0, Math.max(1, Math.min(count, base.length)));
    },
  },
  {
    id: "bug-hunt",
    label: "Bug Hunt & Verify",
    workerCount: 2,
    workerCountLabel: "2 agents",
    description:
      "Reproduce and patch the root cause in an isolated branch while auditing regressions",
    defaultGoal:
      "Reproduce the failing behavior, patch the root cause, and check for related edge cases",
    icon: "wrench",
    buildWorkers: (goal, count) => {
      const base = [
        {
          label: "fixer-1",
          role: "Worker",
          useWorktree: true,
          prompt: goal,
          summary: "@fixer-1 (worktree)",
        },
        {
          label: "reviewer-1",
          role: "Reviewer",
          useWorktree: false,
          prompt: `Review edge cases, regressions, and diff safety for: ${goal}`,
          summary: "@reviewer-1 (review)",
        },
        {
          label: "verifier-1",
          role: "Verifier",
          useWorktree: false,
          prompt: `Add regression test coverage for: ${goal}`,
          summary: "@verifier-1 (tests)",
        },
      ];
      return base.slice(0, Math.max(1, Math.min(count, base.length)));
    },
  },
] as const;

function PresetGlyph({ kind }: { kind: SwarmPresetDefinition["icon"] }) {
  switch (kind) {
    case "layers":
      return <Layers className="size-4 text-brand-text" aria-hidden="true" />;
    case "shield":
      return <ShieldCheck className="size-4 text-brand-text" aria-hidden="true" />;
    case "wrench":
      return <Wrench className="size-4 text-brand-text" aria-hidden="true" />;
  }
}

export interface SwarmLaunchpadProps {
  existingAgentNames: string[];
  availableModels?: string[];
  isSubmitting?: boolean;
  onSpawnWorker: (
    input: SpawnWorkerInput,
  ) => Promise<{ ok: boolean; error?: string; agent?: SwarmAgentView }>;
  onLaunchPreset?: (
    input: LaunchPresetInput,
  ) => Promise<{ ok: boolean; error?: string }>;
  className?: string;
}

export function SwarmLaunchpad({
  existingAgentNames,
  availableModels = [...DEFAULT_SWARM_MODELS],
  isSubmitting = false,
  onSpawnWorker,
  onLaunchPreset,
  className,
}: SwarmLaunchpadProps) {
  const [presetId, setPresetId] = React.useState<SwarmPresetId>("feature-build");
  const [goal, setGoal] = React.useState<string>("");
  const [model, setModel] = React.useState<string>(
    availableModels[1] ?? availableModels[0] ?? "claude-sonnet-4-5",
  );
  const [workerCount, setWorkerCount] = React.useState<number>(2);
  const [useWorktree, setUseWorktree] = React.useState<boolean>(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isLaunching, setIsLaunching] = React.useState<boolean>(false);
  const [showCustomBar, setShowCustomBar] = React.useState<boolean>(false);

  const goalInputRef = React.useRef<HTMLTextAreaElement | null>(null);

  const activePreset =
    SWARM_LAUNCH_PRESETS.find((p) => p.id === presetId) ??
    SWARM_LAUNCH_PRESETS[0];

  const plannedWorkers = React.useMemo(
    () =>
      activePreset.buildWorkers(
        goal.trim() || activePreset.defaultGoal,
        workerCount,
      ),
    [activePreset, goal, workerCount],
  );

  const busy = isSubmitting || isLaunching;

  const handleSelectPreset = (preset: SwarmPresetDefinition) => {
    setPresetId(preset.id);
    setWorkerCount(preset.workerCount);
    if (!goal.trim()) {
      setGoal(preset.defaultGoal);
    }
    setErrorMessage(null);
  };

  const handleLaunch = async () => {
    const trimmedGoal = goal.trim();
    if (trimmedGoal.length < 4) {
      setErrorMessage(
        "Describe what the agents should work on (at least 4 characters).",
      );
      goalInputRef.current?.focus();
      return;
    }

    setErrorMessage(null);
    setIsLaunching(true);
    try {
      const workers = activePreset.buildWorkers(trimmedGoal, workerCount);
      if (onLaunchPreset) {
        const res = await onLaunchPreset({
          presetId: activePreset.id,
          goal: trimmedGoal,
          model,
          workerCount,
          useWorktree,
          workers,
        });
        if (!res.ok) {
          setErrorMessage(res.error ?? "Failed to launch swarm");
          return;
        }
      } else {
        for (const spec of workers) {
          const res = await onSpawnWorker({
            label: spec.label,
            role: spec.role,
            model,
            useWorktree: useWorktree ? spec.useWorktree : false,
            prompt: spec.prompt,
          });
          if (!res.ok) {
            setErrorMessage(res.error ?? "Failed to spawn worker");
            return;
          }
        }
      }
      setGoal("");
    } finally {
      setIsLaunching(false);
    }
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleLaunch();
  };

  return (
    <div
      data-slot="swarm-launchpad"
      data-testid="swarm-launchpad"
      className={cn(
        "mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center gap-6 px-3.5 py-6 @min-[480px]/swarm:px-5 @min-[480px]/swarm:py-8",
        className,
      )}
    >
      {/* Calm Centered Header with 3-node Swarm Symbol */}
      <div className="flex items-start gap-3.5">
        <div className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-premium bg-pane text-brand">
          <NavGlyph icon="swarm" className="size-5" />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[20px] font-semibold tracking-tight text-ink">
            Swarm Mission Control
          </h1>
          <p className="m-0 text-[13px] leading-relaxed text-muted-ink">
            Root-only fan-out coordination — give a goal once and let parallel
            workers code, verify, and audit in isolated git worktrees.
          </p>
        </div>
      </div>

      {/* 3 Curated Launch Presets */}
      <div className="flex flex-col gap-2">
        <div className="px-1 text-[11.5px] font-medium text-muted-ink">
          Curated launch squads
        </div>
        <div
          role="radiogroup"
          aria-label="Swarm launch presets"
          className="grid grid-cols-1 gap-2.5 @min-[560px]/swarm:grid-cols-3"
        >
          {SWARM_LAUNCH_PRESETS.map((preset) => {
            const selected = preset.id === presetId;
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-slot="swarm-preset-card"
                data-testid={`swarm-preset-${preset.id}`}
                onClick={() => handleSelectPreset(preset)}
                className={cn(
                  "flex cursor-pointer flex-col items-start gap-2 rounded-[12px] border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-brand bg-active text-ink"
                    : "border-hairline bg-pane text-body hover:border-premium hover:bg-hover",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="grid size-7 place-items-center rounded-[7px] border border-hairline bg-inset">
                    <PresetGlyph kind={preset.icon} />
                  </div>
                  <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10.5px] text-muted-ink">
                    {preset.workerCountLabel}
                  </span>
                </div>
                <div className="text-[13px] font-semibold text-ink">
                  {preset.label}
                </div>
                <div className="line-clamp-2 text-[11.5px] leading-snug text-muted-ink">
                  {preset.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Goal Prompt & Worker / Model Configuration Form */}
      <form
        onSubmit={handleFormSubmit}
        noValidate
        className="flex flex-col gap-2.5"
      >
        <div
          className={cn(
            "flex flex-col rounded-[14px] border bg-pane transition-colors focus-within:border-brand/55",
            errorMessage ? "border-danger/60" : "border-premium",
          )}
        >
          <textarea
            ref={goalInputRef}
            id="swarm-launchpad-goal"
            data-slot="swarm-launchpad-goal"
            data-testid="swarm-launchpad-goal"
            rows={3}
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleLaunch();
              }
            }}
            aria-label="Swarm goal"
            aria-invalid={Boolean(errorMessage)}
            placeholder="Describe the mission goal, owned modules, and verification criteria..."
            className="min-h-[88px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[13.5px] leading-relaxed text-ink placeholder:text-muted-ink focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline-soft px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(workerCount)}
                onValueChange={(v) => setWorkerCount(Number(v))}
              >
                <SelectTrigger
                  aria-label="Worker count"
                  data-testid="swarm-worker-count-select"
                  className="h-7 min-w-[98px] rounded-[8px] text-xs"
                >
                  <SelectValue placeholder="Workers" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="1">1 worker</SelectItem>
                  <SelectItem value="2">2 workers</SelectItem>
                  <SelectItem value="3">3 workers</SelectItem>
                </SelectContent>
              </Select>

              <Select value={model} onValueChange={setModel}>
                <SelectTrigger
                  aria-label="Swarm model"
                  data-testid="swarm-model-select"
                  className="h-7 min-w-0 max-w-full rounded-[8px] font-mono text-xs @min-[360px]/swarm:min-w-[154px]"
                >
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {availableModels.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item === "inherit" ? "inherit (coordinator)" : item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <button
                type="button"
                role="switch"
                aria-checked={useWorktree}
                aria-label="Use isolated git worktrees"
                data-testid="swarm-worktree-switch"
                onClick={() => setUseWorktree((prev) => !prev)}
                className={cn(
                  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[8px] border px-2.5 text-[11.5px] transition-colors",
                  useWorktree
                    ? "border-brand/45 bg-brand-softer text-brand-text"
                    : "border-hairline bg-inset text-muted-ink",
                )}
              >
                <GitBranch className="size-3" aria-hidden="true" />
                <span>Worktrees: {useWorktree ? "On" : "Off"}</span>
              </button>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={busy}
              data-slot="launch-swarm-btn"
              data-testid="launch-swarm-btn"
              className="h-8 rounded-[9px] px-3.5"
            >
              <span>{busy ? "Starting..." : "Start Swarm Mode"}</span>
              <ArrowUp className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Quiet Preview of Planned Workers + Custom Single Worker Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-muted-ink">
          <div className="flex flex-wrap items-center gap-1.5">
            <Users className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            <span>
              Will spawn{" "}
              <span
                data-testid="launchpad-planned-workers"
                className="font-mono text-[11.5px] text-body"
              >
                {plannedWorkers.map((w) => w.summary).join(" + ")}
              </span>
            </span>
          </div>

          <button
            type="button"
            data-slot="toggle-custom-worker-btn"
            data-testid="launchpad-custom-worker-toggle"
            aria-expanded={showCustomBar}
            onClick={() => setShowCustomBar((prev) => !prev)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <SlidersHorizontal className="size-3" aria-hidden="true" />
            <span>Launch first worker manually</span>
            {showCustomBar ? (
              <ChevronDown className="size-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3" aria-hidden="true" />
            )}
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            data-slot="swarm-launchpad-error"
            data-testid="swarm-launchpad-error"
            className="rounded-[10px] border border-danger/35 bg-danger-soft px-3 py-2 text-xs text-danger"
          >
            {errorMessage}
          </div>
        )}
      </form>

      {showCustomBar && (
        <SpawnWorkerBar
          existingAgentNames={existingAgentNames}
          availableModels={availableModels}
          isSubmitting={isSubmitting}
          onSpawn={onSpawnWorker}
          onCancel={() => setShowCustomBar(false)}
        />
      )}
    </div>
  );
}
