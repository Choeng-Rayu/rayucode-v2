import * as React from "react"
import { Plus, X } from "lucide-react"

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

import { spawnWorkerInputSchema } from "../schemas"
import type { SpawnWorkerInput, SwarmState } from "../types"

const WORKER_ROLES = [
  "Worker",
  "Verifier",
  "Reviewer",
  "Researcher",
  "Worktree Manager",
] as const

const WORKER_MODELS = [
  "Claude Sonnet 5",
  "Claude Opus 5.5",
  "GPT-6.1 Sol",
  "DeepSeek V4 Flash",
  "Gemini 3.1 Pro",
] as const

const WORKTREE_SCOPES = [
  { value: "new git worktree", label: "New git worktree" },
  { value: "wt/retry-budget", label: "wt/retry-budget" },
  { value: "wt/session-shards", label: "wt/session-shards" },
  { value: "local checkout", label: "Local checkout (read-only)" },
] as const

export interface SpawnWorkerBarProps {
  existingAgentNames: string[]
  isSubmitting?: boolean
  onSpawn: (input: SpawnWorkerInput) => Promise<ActionResult<SwarmState>>
  onCancel: () => void
  className?: string
}

function getDefaultWorkerName(existingNames: string[]): string {
  const start = existingNames.length === 0 ? 1 : 3
  let index = start
  while (existingNames.includes(`worker-${index}`)) {
    index += 1
  }
  return `worker-${index}`
}

export function SpawnWorkerBar({
  existingAgentNames,
  isSubmitting = false,
  onSpawn,
  onCancel,
  className,
}: SpawnWorkerBarProps) {
  const [name, setName] = React.useState(() =>
    getDefaultWorkerName(existingAgentNames)
  )
  const [role, setRole] = React.useState<string>("Worker")
  const [model, setModel] = React.useState<string>("Claude Sonnet 5")
  const [worktree, setWorktree] = React.useState<string>("new git worktree")
  const [task, setTask] = React.useState<string>("")
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>(
    {}
  )

  const taskInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    taskInputRef.current?.focus()
  }, [])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const candidate: SpawnWorkerInput = {
      name,
      role,
      model,
      worktree,
      task,
    }

    const parsed = spawnWorkerInputSchema.safeParse(candidate)
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form")
        if (!nextErrors[key]) {
          nextErrors[key] = issue.message
        }
      }
      setFieldErrors(nextErrors)
      return
    }

    if (existingAgentNames.includes(parsed.data.name)) {
      setFieldErrors({
        name: `Worker "${parsed.data.name}" already exists in this swarm`,
      })
      return
    }

    setFieldErrors({})
    const result = await onSpawn(parsed.data)
    if (!result.ok) {
      const nextErrors: Record<string, string> = {}
      if (result.fieldErrors) {
        for (const [key, messages] of Object.entries(result.fieldErrors)) {
          if (messages[0]) nextErrors[key] = messages[0]
        }
      } else {
        nextErrors.form = result.error
      }
      setFieldErrors(nextErrors)
      return
    }

    setTask("")
    setName(getDefaultWorkerName([...existingAgentNames, parsed.data.name]))
    onCancel()
  }

  const errorList = Object.values(fieldErrors)

  return (
    <form
      data-slot="spawn-worker-bar"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      className={cn(
        "rayu-card-bevel flex flex-col gap-2.5 rounded-[14px] bg-pane px-4 py-3.5",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="sw-new-name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (fieldErrors.name) {
              setFieldErrors((prev) => {
                const next = { ...prev }
                delete next.name
                return next
              })
            }
          }}
          aria-label="Worker name"
          aria-invalid={Boolean(fieldErrors.name)}
          placeholder="worker-3"
          className={cn(
            "h-[34px] w-[144px] shrink-0 rounded-[9px] border bg-inset px-2.5 font-mono text-[13px] text-ink placeholder:text-muted-ink focus:border-brand focus:outline-none",
            fieldErrors.name ? "border-danger" : "border-premium"
          )}
        />

        <Select value={role} onValueChange={setRole}>
          <SelectTrigger
            aria-label="Worker role"
            className="h-[34px] min-w-[126px] rounded-[9px]"
          >
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent position="popper">
            {WORKER_ROLES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={model} onValueChange={setModel}>
          <SelectTrigger
            aria-label="Model"
            className="h-[34px] min-w-[156px] rounded-[9px]"
          >
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent position="popper">
            {WORKER_MODELS.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={worktree} onValueChange={setWorktree}>
          <SelectTrigger
            aria-label="Workspace scope"
            className="h-[34px] min-w-[172px] rounded-[9px]"
          >
            <SelectValue placeholder="Worktree" />
          </SelectTrigger>
          <SelectContent position="popper">
            {WORKTREE_SCOPES.map((scope) => (
              <SelectItem key={scope.value} value={scope.value}>
                {scope.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={taskInputRef}
          id="sw-new-task"
          type="text"
          value={task}
          onChange={(e) => {
            setTask(e.target.value)
            if (fieldErrors.task) {
              setFieldErrors((prev) => {
                const next = { ...prev }
                delete next.task
                return next
              })
            }
          }}
          aria-label="Worker task"
          aria-invalid={Boolean(fieldErrors.task)}
          placeholder="Assign todo lane task, e.g. Add mid-flight streaming retry dedup regression test"
          className={cn(
            "h-[34px] min-w-[220px] flex-1 rounded-[9px] border bg-inset px-3 text-[13px] text-ink placeholder:text-muted-ink focus:border-brand focus:outline-none",
            fieldErrors.task ? "border-danger" : "border-premium"
          )}
        />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          <X className="size-3.5" aria-hidden="true" />
          <span>Cancel</span>
        </Button>

        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={isSubmitting}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          <span>{isSubmitting ? "Spawning..." : "Spawn"}</span>
        </Button>
      </div>

      {errorList.length > 0 && (
        <div
          role="alert"
          data-slot="spawn-worker-error"
          className="rounded-md border border-danger/35 bg-danger-soft px-3 py-1.5 text-xs text-danger"
        >
          {errorList[0]}
        </div>
      )}
    </form>
  )
}
