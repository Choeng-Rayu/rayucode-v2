import * as React from "react";
import { GitBranch, Plus, X } from "lucide-react";

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { cn } from "@/lib";

import {
  DEFAULT_SWARM_MODELS,
  type SpawnWorkerInput,
  type SwarmAgentView,
} from "../hooks/useSwarm";

const WORKER_ROLES = [
  "Worker",
  "Verifier",
  "Reviewer",
  "Researcher",
  "Worktree Manager",
] as const;

export interface SpawnWorkerBarProps {
  existingAgentNames: string[];
  availableModels?: string[];
  isSubmitting?: boolean;
  onSpawn: (
    input: SpawnWorkerInput,
  ) => Promise<{ ok: boolean; error?: string; agent?: SwarmAgentView }>;
  onCancel?: () => void;
  className?: string;
}

function getDefaultWorkerName(existingNames: string[]): string {
  let index = Math.max(1, existingNames.length);
  while (existingNames.includes(`worker-${index}`)) {
    index += 1;
  }
  return `worker-${index}`;
}

export function SpawnWorkerBar({
  existingAgentNames,
  availableModels = [...DEFAULT_SWARM_MODELS],
  isSubmitting = false,
  onSpawn,
  onCancel,
  className,
}: SpawnWorkerBarProps) {
  const [label, setLabel] = React.useState(() =>
    getDefaultWorkerName(existingAgentNames),
  );
  const [role, setRole] = React.useState<string>("Worker");
  const [model, setModel] = React.useState<string>(
    availableModels[0] ?? "inherit",
  );
  const [useWorktree, setUseWorktree] = React.useState<boolean>(true);
  const [prompt, setPrompt] = React.useState<string>("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const promptInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    promptInputRef.current?.focus();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanLabel = label.trim();
    const cleanPrompt = prompt.trim();

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,31}$/.test(cleanLabel)) {
      setErrorMsg(
        "Worker name must be 2-32 letters, numbers, hyphens, or underscores.",
      );
      return;
    }

    if (existingAgentNames.includes(cleanLabel)) {
      setErrorMsg(`Worker "${cleanLabel}" already exists in this swarm.`);
      return;
    }

    if (cleanPrompt.length < 4) {
      setErrorMsg("Describe the worker assignment (at least 4 characters).");
      return;
    }

    setErrorMsg(null);
    const result = await onSpawn({
      label: cleanLabel,
      role,
      model,
      useWorktree,
      prompt: cleanPrompt,
    });

    if (!result.ok) {
      setErrorMsg(result.error ?? "Failed to spawn swarm worker.");
      return;
    }

    setPrompt("");
    setLabel(getDefaultWorkerName([...existingAgentNames, cleanLabel]));
    onCancel?.();
  };

  return (
    <form
      data-slot="spawn-worker-bar"
      data-testid="spawn-worker-bar"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      className={cn(
        "rayu-card-bevel flex flex-col gap-2.5 rounded-[14px] bg-pane px-4 py-3.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="sw-new-name"
          data-testid="spawn-worker-name"
          type="text"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (errorMsg) setErrorMsg(null);
          }}
          aria-label="Worker name"
          placeholder="worker-2"
          className="h-[32px] w-full max-w-full rounded-[8px] border border-premium bg-inset px-2.5 font-mono text-[12.5px] text-ink placeholder:text-muted-ink focus:border-brand focus:outline-none @min-[420px]/swarm:w-[138px] @min-[420px]/swarm:shrink-0"
        />

        <Select value={role} onValueChange={setRole}>
          <SelectTrigger
            aria-label="Worker role"
            data-testid="spawn-worker-role"
            className="h-[32px] min-w-0 max-w-full rounded-[8px] text-xs @min-[420px]/swarm:min-w-[124px]"
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
            data-testid="spawn-worker-model"
            className="h-[32px] min-w-0 max-w-full rounded-[8px] font-mono text-xs @min-[420px]/swarm:min-w-[152px]"
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
          aria-label="Isolated git worktree"
          data-testid="spawn-worker-worktree-toggle"
          onClick={() => setUseWorktree((prev) => !prev)}
          className={cn(
            "inline-flex h-[32px] cursor-pointer items-center gap-2 rounded-[8px] border px-2.5 text-xs transition-colors",
            useWorktree
              ? "border-brand/45 bg-brand-softer text-brand-text"
              : "border-hairline bg-inset text-muted-ink",
          )}
        >
          <GitBranch className="size-3.5" aria-hidden="true" />
          <span>Isolated worktree: {useWorktree ? "On" : "Off"}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={promptInputRef}
          id="sw-new-task"
          data-testid="spawn-worker-prompt"
          type="text"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (errorMsg) setErrorMsg(null);
          }}
          aria-label="Worker task"
          placeholder="Assign worker brief & owned files, e.g. Port SwarmMissionControl and add Vitest tests"
          className="h-[32px] min-w-0 flex-1 rounded-[8px] border border-premium bg-inset px-3 text-[12.5px] text-ink placeholder:text-muted-ink focus:border-brand focus:outline-none @min-[480px]/swarm:min-w-[210px]"
        />

        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSubmitting}
            data-testid="spawn-worker-cancel"
          >
            <X className="size-3.5" aria-hidden="true" />
            <span>Cancel</span>
          </Button>
        )}

        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={isSubmitting}
          data-testid="spawn-worker-submit"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          <span>{isSubmitting ? "Spawning..." : "Spawn"}</span>
        </Button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          data-slot="spawn-worker-error"
          data-testid="spawn-worker-error"
          className="rounded-md border border-danger/35 bg-danger-soft px-3 py-1.5 text-xs text-danger"
        >
          {errorMsg}
        </div>
      )}
    </form>
  );
}
