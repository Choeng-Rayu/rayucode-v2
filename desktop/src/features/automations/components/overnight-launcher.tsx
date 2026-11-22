import * as React from "react"
import { Rocket } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import { useLaunchOvernightMission } from "../hooks/use-automations"
import {
  OVERNIGHT_AGENT_CAP_OPTIONS,
  OVERNIGHT_DURATION_OPTIONS,
  OVERNIGHT_HANDOFF_TIME_OPTIONS,
  OVERNIGHT_PERMISSION_OPTIONS,
  OVERNIGHT_REPO_OPTIONS,
  launchOvernightInputSchema,
} from "../schemas"
import type { AutomationsState, LaunchOvernightInput } from "../types"

export interface OvernightLauncherProps {
  open: boolean
  onClose: () => void
  onLaunched?: (nextState: AutomationsState) => void
  className?: string
}

const DEFAULT_FORM_STATE: LaunchOvernightInput = {
  mission: "",
  repo: OVERNIGHT_REPO_OPTIONS[0],
  duration: "8h",
  maxAgents: "4 agents",
  permissionMode: "Auto-edit",
  handoffTime: "07:30 AM",
}

export function OvernightLauncher({
  open,
  onClose,
  onLaunched,
  className,
}: OvernightLauncherProps) {
  const [form, setForm] = React.useState<LaunchOvernightInput>(DEFAULT_FORM_STATE)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const launchMutation = useLaunchOvernightMission()

  React.useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  if (!open) {
    return null
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const parsed = launchOvernightInputSchema.safeParse(form)
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Check overnight mission fields"
      setErrorMessage(message)
      inputRef.current?.focus()
      return
    }

    setErrorMessage(null)
    const result = await launchMutation.mutateAsync(parsed.data)
    if (!result.ok) {
      setErrorMessage(result.error)
      toast.error(result.error)
      return
    }

    toast.success(`Launched overnight run (${parsed.data.duration})`)
    setForm(DEFAULT_FORM_STATE)
    onLaunched?.(result.data)
    onClose()
  }

  const handleCancel = () => {
    setErrorMessage(null)
    onClose()
  }

  return (
    <form
      id="overnight-launcher"
      data-testid="overnight-launcher"
      aria-label="Start overnight mission"
      onSubmit={handleSubmit}
      className={cn(
        "rayu-card-bevel mt-4.5 flex flex-col gap-3.5 rounded-[14px] border border-premium-hi bg-raised p-5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium text-ink">
          Start overnight mission
        </div>
        <span className="font-mono text-[11px] text-muted-ink">
          rayucode-overnight-core
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <input
          ref={inputRef}
          id="ovn-mission"
          data-testid="overnight-mission-input"
          type="text"
          value={form.mission}
          onChange={(e) => {
            const nextMission = e.target.value
            setForm((prev) => ({ ...prev, mission: nextMission }))
            if (errorMessage) setErrorMessage(null)
          }}
          placeholder="Describe mission, e.g. Harden retry_budget edge cases and stage validation report"
          aria-label="Overnight mission prompt"
          aria-invalid={errorMessage ? "true" : "false"}
          className={cn(
            "w-full rounded-[10px] border bg-inset px-3 py-2 font-mono text-xs text-ink placeholder:text-muted-ink focus:outline-none",
            errorMessage
              ? "border-danger focus:border-danger"
              : "border-premium focus:border-brand/60"
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

      <div className="flex flex-wrap items-center gap-2.5">
        <Select
          value={form.repo}
          onValueChange={(value) =>
            setForm((prev) => ({ ...prev, repo: value }))
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Target repository"
            data-testid="overnight-repo-select"
          >
            <SelectValue placeholder="Repository" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {OVERNIGHT_REPO_OPTIONS.map((repo) => (
              <SelectItem key={repo} value={repo}>
                {repo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={form.duration}
          onValueChange={(value) =>
            setForm((prev) => ({ ...prev, duration: value }))
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Duration budget"
            data-testid="overnight-duration-select"
          >
            <SelectValue placeholder="Duration" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {OVERNIGHT_DURATION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={form.maxAgents}
          onValueChange={(value) =>
            setForm((prev) => ({ ...prev, maxAgents: value }))
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Max parallel agents"
            data-testid="overnight-agents-select"
          >
            <SelectValue placeholder="Parallel agents" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {OVERNIGHT_AGENT_CAP_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={form.permissionMode}
          onValueChange={(value) =>
            setForm((prev) => ({ ...prev, permissionMode: value }))
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Permissions"
            data-testid="overnight-permission-select"
          >
            <SelectValue placeholder="Permissions" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {OVERNIGHT_PERMISSION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={form.handoffTime}
          onValueChange={(value) =>
            setForm((prev) => ({ ...prev, handoffTime: value }))
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Morning handoff time"
            data-testid="overnight-handoff-select"
          >
            <SelectValue placeholder="Handoff time" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {OVERNIGHT_HANDOFF_TIME_OPTIONS.map((time) => (
              <SelectItem key={time} value={time}>
                Handoff {time}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={launchMutation.isPending}
          data-testid="launch-overnight-btn"
        >
          <Rocket className="size-3.5" aria-hidden="true" />
          {launchMutation.isPending ? "Launching..." : "Launch overnight mission"}
        </Button>
      </div>
    </form>
  )
}
