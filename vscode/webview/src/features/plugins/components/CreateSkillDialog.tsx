import * as React from "react";
import type { SkillView } from "@shared/vscodeProtocol";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { cn, postToHost } from "@/lib";

export interface CreateSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (params: {
    name: string;
    description: string;
    content?: string;
    scope: "project" | "global";
  }) => Promise<SkillView>;
  isSaving?: boolean;
}

export function CreateSkillDialog({
  open,
  onOpenChange,
  onCreate,
  isSaving = false,
}: CreateSkillDialogProps) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [scope, setScope] = React.useState<"project" | "global">("project");
  const [content, setContent] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-");
    if (!cleanName || !description.trim()) {
      setErrorMessage("Provide both a skill name and description.");
      return;
    }

    setErrorMessage(null);
    try {
      const created = await onCreate({
        name: cleanName,
        description: description.trim(),
        content: content.trim() || undefined,
        scope,
      });
      setName("");
      setDescription("");
      setContent("");
      onOpenChange(false);

      postToHost({
        type: "rayucode.editor.openFile",
        path: created.path,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create skill.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="create-skill-dialog"
        className="sm:max-w-[480px]"
      >
        <DialogHeader>
          <DialogTitle>Create Skill (SKILL.md)</DialogTitle>
          <DialogDescription>
            Writes{" "}
            <code className="font-mono text-xs text-body">
              {scope === "project"
                ? ".agents/skills/<name>/SKILL.md"
                : "~/.rayu/skills/<name>/SKILL.md"}
            </code>{" "}
            and opens it directly in the VS Code Editor.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="min-w-0 space-y-3.5"
        >
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="create-skill-name"
                className="text-xs font-medium text-muted-ink"
              >
                Skill Slug
              </label>
              <input
                id="create-skill-name"
                data-testid="create-skill-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="api-migration-checklist"
                className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-ink">Scope</span>
              <div className="grid grid-cols-2 gap-1 rounded-md border border-hairline bg-inset p-0.5 text-xs">
                {(["project", "global"] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    data-testid={`create-skill-scope-${sc}`}
                    onClick={() => setScope(sc)}
                    className={cn(
                      "cursor-pointer rounded py-1 text-center font-medium transition-colors",
                      scope === sc
                        ? "bg-active text-ink"
                        : "text-muted-ink hover:text-ink",
                    )}
                  >
                    {sc === "project" ? "Project" : "Global"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="create-skill-desc"
              className="text-xs font-medium text-muted-ink"
            >
              Description (when RayuCode should activate this skill)
            </label>
            <input
              id="create-skill-desc"
              data-testid="create-skill-desc-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enforce zero-downtime SQL migration standards..."
              className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 text-xs text-ink focus:border-ring focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="create-skill-body"
              className="text-xs font-medium text-muted-ink"
            >
              Instructions Body (optional Markdown)
            </label>
            <textarea
              id="create-skill-body"
              data-testid="create-skill-content-input"
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="1. Read schema files first&#10;2. Verify rollback safety..."
              className="w-full rounded-md border border-control-border bg-inset px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-muted-ink focus:border-ring focus:outline-none"
            />
          </div>

          {errorMessage && (
            <p
              role="alert"
              data-testid="create-skill-error"
              className="text-xs text-danger"
            >
              {errorMessage}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSaving}
              data-testid="submit-create-skill-btn"
            >
              {isSaving ? "Creating..." : "Create & Open SKILL.md"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
