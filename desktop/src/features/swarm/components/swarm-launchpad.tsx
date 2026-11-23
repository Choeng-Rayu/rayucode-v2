import * as React from "react"
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
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ActionResult } from "@/lib/action-result"
import { cn } from "@/lib/utils"

import type { SpawnWorkerInput, SwarmState } from "../types"
import { SpawnWorkerBar } from "./spawn-worker-bar"

type TeamPresetId = "single" | "build-verify" | "fix-review"

interface PresetWorkerSpec {
  name: string
  role: string
  worktree: string
  buildTask: (goal: string) => string
  summary: string
}

interface TeamPreset {
  id: TeamPresetId
  label: string
  workerCountLabel: string
  description: string
  workers: PresetWorkerSpec[]
}

const TEAM_PRESETS: readonly TeamPreset[] = [
  {
    id: "build-verify",
    label: "Build + Verify",
    workerCountLabel: "2 agents",
    description: "One agent writes code in a new branch while another tests it",
    workers: [
      {
        name: "builder-1",
        role: "Worker",
        worktree: "new git worktree",
        buildTask: (goal) => goal,
        summary: "@builder-1 (new branch)",
      },
      {
        name: "verifier-1",
        role: "Verifier",
        worktree: "local checkout",
        buildTask: (goal) =>
          `Write and run verification tests for: ${goal}`,
        summary: "@verifier-1 (tests)",
      },
    ],
  },
  {
    id: "fix-review",
    label: "Fix + Review",
    workerCountLabel: "2 agents",
    description: "One agent patches the issue while another audits edge cases",
    workers: [
      {
        name: "fixer-1",
        role: "Worker",
        worktree: "new git worktree",
        buildTask: (goal) => goal,
        summary: "@fixer-1 (new branch)",
      },
      {
        name: "reviewer-1",
        role: "Reviewer",
        worktree: "local checkout",
        buildTask: (goal) =>
          `Review edge cases, regressions, and diff safety for: ${goal}`,
        summary: "@reviewer-1 (review)",
      },
    ],
  },
  {
    id: "single",
    label: "Single worker",
    workerCountLabel: "1 agent",
    description: "One background worker running in its own git worktree",
    workers: [
      {
        name: "worker-1",
        role: "Worker",
        worktree: "new git worktree",
        buildTask: (goal) => goal,
        summary: "@worker-1 (new branch)",
      },
    ],
  },
] as const

const LAUNCHPAD_MODELS = [
  "Claude Sonnet 5",
  "Claude Opus 5.5",
  "GPT-6.1 Sol",
  "DeepSeek V4 Flash",
  "Gemini 3.1 Pro",
] as const

interface StarterTemplate {
  id: string
  title: string
  subtitle: string
  presetId: TeamPresetId
  goal: string
  icon: "layers" | "wrench" | "shield"
}

const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: "feature-tests",
    title: "Build a feature with parallel tests",
    subtitle: "Implement in an isolated branch while a verifier writes tests",
    presetId: "build-verify",
    goal: "Implement the requested feature in an isolated worktree and add unit tests covering key paths",
    icon: "layers",
  },
  {
    id: "bug-hunt",
    title: "Track down and fix a bug",
    subtitle: "Patch the root cause and audit regressions in parallel",
    presetId: "fix-review",
    goal: "Reproduce the failing behavior, patch the root cause, and check for related edge cases",
    icon: "wrench",
  },
  {
    id: "safe-refactor",
    title: "Refactor a module safely",
    subtitle: "Clean up code in a separate worktree without touching your branch",
    presetId: "single",
    goal: "Refactor the target module for clarity and run the existing test suite to confirm no regressions",
    icon: "shield",
  },
] as const

function TemplateIcon({ kind }: { kind: StarterTemplate["icon"] }) {
  switch (kind) {
    case "layers":
      return <Layers className="size-4 text-muted-ink" aria-hidden="true" />
    case "wrench":
      return <Wrench className="size-4 text-muted-ink" aria-hidden="true" />
    case "shield":
      return <ShieldCheck className="size-4 text-muted-ink" aria-hidden="true" />
  }
}

export interface SwarmLaunchpadProps {
  existingAgentNames: string[]
  isSubmitting?: boolean
  onSpawnWorker: (input: SpawnWorkerInput) => Promise<ActionResult<SwarmState>>
  className?: string
}

export function SwarmLaunchpad({
  existingAgentNames,
  isSubmitting = false,
  onSpawnWorker,
  className,
}: SwarmLaunchpadProps) {
  const [goal, setGoal] = React.useState("")
  const [presetId, setPresetId] = React.useState<TeamPresetId>("build-verify")
  const [model, setModel] = React.useState<string>("Claude Sonnet 5")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [isLaunchingTeam, setIsLaunchingTeam] = React.useState(false)
  const [showCustomBar, setShowCustomBar] = React.useState(false)

  const goalInputRef = React.useRef<HTMLTextAreaElement | null>(null)

  const activePreset =
    TEAM_PRESETS.find((preset) => preset.id === presetId) ?? TEAM_PRESETS[0]

  const busy = isSubmitting || isLaunchingTeam

  const handleLaunch = async () => {
    const trimmedGoal = goal.trim()
    if (trimmedGoal.length < 4) {
      setErrorMessage("Describe what the agents should work on (at least 4 characters).")
      goalInputRef.current?.focus()
      return
    }

    setErrorMessage(null)
    setIsLaunchingTeam(true)
    try {
      for (const spec of activePreset.workers) {
        const result = await onSpawnWorker({
          name: spec.name,
          role: spec.role,
          model,
          worktree: spec.worktree,
          task: spec.buildTask(trimmedGoal),
        })
        if (!result.ok) {
          setErrorMessage(result.error)
          return
        }
      }
      setGoal("")
    } finally {
      setIsLaunchingTeam(false)
    }
  }

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleLaunch()
  }

  const handleTemplatePick = (template: StarterTemplate) => {
    setGoal(template.goal)
    setPresetId(template.presetId)
    setErrorMessage(null)
    requestAnimationFrame(() => {
      const el = goalInputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  return (
    <div
      data-slot="swarm-launchpad"
      className={cn(
        "mx-auto flex w-full max-w-[740px] flex-1 flex-col justify-center gap-7 px-6 py-10",
        className
      )}
    >
      {/* Plain-English Heading */}
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[22px] font-semibold tracking-tight text-ink">
          Run parallel agents
        </h1>
        <p className="m-0 max-w-[580px] text-[13.5px] leading-relaxed text-muted-ink">
          Give a goal once and let agents code, review, and test in isolated git
          branches at the same time.
        </p>
      </div>

      {/* Primary Composer-Style Launcher */}
      <form
        onSubmit={handleFormSubmit}
        noValidate
        className="flex flex-col gap-2.5"
      >
        <div
          className={cn(
            "flex flex-col rounded-[16px] border bg-pane transition-colors focus-within:border-brand/55",
            errorMessage ? "border-danger/60" : "border-premium"
          )}
        >
          <textarea
            ref={goalInputRef}
            id="swarm-launchpad-goal"
            data-slot="swarm-launchpad-goal"
            rows={3}
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value)
              if (errorMessage) setErrorMessage(null)
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                void handleLaunch()
              }
            }}
            aria-label="Swarm goal"
            aria-invalid={Boolean(errorMessage)}
            placeholder="Describe what to build, fix, or refactor..."
            className="min-h-[92px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14px] leading-relaxed text-ink placeholder:text-muted-ink focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline-soft px-3 py-2.5">
            <div
              role="radiogroup"
              aria-label="Team setup"
              className="flex flex-wrap items-center gap-1"
            >
              {TEAM_PRESETS.map((preset) => {
                const selected = preset.id === presetId
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPresetId(preset.id)}
                    className={cn(
                      "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "bg-active text-ink"
                        : "text-muted-ink hover:bg-hover hover:text-ink"
                    )}
                  >
                    <span>{preset.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="flex items-center gap-2">
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger
                  aria-label="Swarm model"
                  className="h-7 min-w-[144px] rounded-[8px] border-transparent bg-transparent px-2 text-[12px] text-muted-ink shadow-none hover:bg-hover hover:text-ink"
                >
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {LAUNCHPAD_MODELS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={busy}
                data-slot="launch-swarm-btn"
                className="h-8 rounded-[9px] px-3.5"
              >
                <span>{busy ? "Starting..." : "Start swarm"}</span>
                <ArrowUp className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        {/* Quiet Preview of What Will Launch + Custom Options Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-muted-ink">
          <div className="flex flex-wrap items-center gap-1.5">
            <Users className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            <span>
              Will start{" "}
              <span className="font-mono text-[11.5px] text-body">
                {activePreset.workers.map((w) => w.summary).join(" + ")}
              </span>
            </span>
          </div>

          <button
            type="button"
            data-slot="toggle-spawn-worker-btn"
            data-testid="swarm-toggle-spawn-btn"
            aria-expanded={showCustomBar}
            onClick={() => setShowCustomBar((prev) => !prev)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <SlidersHorizontal className="size-3" aria-hidden="true" />
            <span>Custom worker</span>
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
            className="rounded-[10px] border border-danger/35 bg-danger-soft px-3 py-2 text-xs text-danger"
          >
            {errorMessage}
          </div>
        )}
      </form>

      {/* Optional Advanced Single-Worker Form */}
      {showCustomBar && (
        <SpawnWorkerBar
          existingAgentNames={existingAgentNames}
          isSubmitting={isSubmitting}
          onSpawn={onSpawnWorker}
          onCancel={() => setShowCustomBar(false)}
        />
      )}

      {/* Compact Starter Templates */}
      <div className="flex flex-col gap-2">
        <div className="px-1 text-[12px] font-medium text-muted-ink">
          Quick templates
        </div>
        <div className="divide-y divide-hairline overflow-hidden rounded-[12px] border border-hairline bg-pane">
          {STARTER_TEMPLATES.map((template) => {
            const preset = TEAM_PRESETS.find((p) => p.id === template.presetId)
            return (
              <button
                key={template.id}
                type="button"
                data-slot="swarm-template-item"
                onClick={() => handleTemplatePick(template)}
                className="group flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <div className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-hairline bg-inset">
                  <TemplateIcon kind={template.icon} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink">
                    {template.title}
                  </div>
                  <div className="truncate text-[12px] text-muted-ink">
                    {template.subtitle}
                  </div>
                </div>
                {preset && (
                  <span className="shrink-0 rounded-full border border-hairline bg-inset px-2 py-0.5 text-[11px] text-muted-ink">
                    {preset.label}
                  </span>
                )}
                <ChevronRight
                  className="size-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* Subtle Footer Reassurance */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <GitBranch className="size-3" aria-hidden="true" />
          <span>Isolated git worktrees</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>Live command trace & direct steering</span>
        <span aria-hidden="true">·</span>
        <span>Inspect diffs before merging</span>
      </div>
    </div>
  )
}
