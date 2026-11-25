import * as React from "react";
import {
  Box,
  Check,
  FileCode2,
  Play,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { Badge, Button } from "@/components/ui";
import { cn, postToHost, useAppStore } from "@/lib";

import { useSkillActions, useSkills } from "../hooks/usePlugins";
import { CreateSkillDialog } from "./CreateSkillDialog";

export function SkillsTab() {
  const { data } = useSkills();
  const {
    createSkillMutation,
    installSkillMutation,
    reloadSkillsMutation,
    runSkillMutation,
  } = useSkillActions();

  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [scopeFilter, setScopeFilter] = React.useState<
    "all" | "project" | "global"
  >("all");
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [lastTriggeredSkill, setLastTriggeredSkill] = React.useState<
    string | null
  >(null);
  const [skillError, setSkillError] = React.useState<string | null>(null);

  const skills = data?.skills ?? [];
  const endorsed = data?.endorsed ?? [];
  const q = searchQuery.trim().toLowerCase();

  const filteredSkills = skills.filter((skill) => {
    if (scopeFilter !== "all" && skill.scope !== scopeFilter) return false;
    if (!q) return true;
    return (
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      (skill.category ?? "").toLowerCase().includes(q)
    );
  });

  const handleOpenSkillFile = (path: string) => {
    postToHost({
      type: "rayucode.editor.openFile",
      path,
    });
  };

  const handleRunSkill = async (skillName: string) => {
    setSkillError(null);
    try {
      await runSkillMutation.mutateAsync({
        sessionId: activeSessionId ?? "ses_vscode_shell",
        name: skillName,
      });
      setLastTriggeredSkill(skillName);
    } catch (err) {
      setLastTriggeredSkill(null);
      setSkillError(
        err instanceof Error
          ? err.message
          : `Failed to run "/${skillName}".`,
      );
    }
  };

  return (
    <div data-testid="skills-tab" className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="m-0 text-xl font-semibold tracking-tight text-ink">
              Skills (SKILL.md)
            </h1>
            <p className="mt-0.5 text-xs text-muted-ink">
              Reusable instructions discovered from project{" "}
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                .agents/skills/
              </code>{" "}
              and global{" "}
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                ~/.rayu/skills/
              </code>
              .
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={reloadSkillsMutation.isPending}
              data-testid="reload-skills-btn"
              onClick={() => reloadSkillsMutation.mutate()}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  reloadSkillsMutation.isPending && "animate-spin",
                )}
                aria-hidden="true"
              />
              <span>Reload Skills</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="open-create-skill-dialog-btn"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>Create Skill</span>
            </Button>
          </div>
        </div>

        {/* Search & Scope Filter */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline bg-inset px-3 focus-within:border-premium-hi sm:min-w-[220px]">
            <Search
              className="size-3.5 shrink-0 text-muted-ink"
              aria-hidden="true"
            />
            <input
              data-testid="skills-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search installed skills by name or description..."
              aria-label="Search skills"
              className="w-full bg-transparent text-xs text-ink placeholder:text-muted-ink focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear skills search"
                onClick={() => setSearchQuery("")}
                className="cursor-pointer text-muted-ink hover:text-ink"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </label>

          <div className="inline-flex items-center rounded-lg border border-hairline bg-pane p-0.5 text-xs">
            {(["all", "project", "global"] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                data-testid={`skills-scope-${sc}`}
                onClick={() => setScopeFilter(sc)}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  scopeFilter === sc
                    ? "bg-active text-ink shadow-bevel-surface"
                    : "text-muted-ink hover:text-ink",
                )}
              >
                {sc}
              </button>
            ))}
          </div>
        </div>
      </header>

      {skillError && (
        <div
          role="alert"
          data-testid="skill-error-banner"
          className="flex items-center justify-between rounded-xl border border-danger/40 bg-danger-soft px-4 py-2.5 text-xs text-danger"
        >
          <span>{skillError}</span>
        </div>
      )}

      {lastTriggeredSkill && (
        <div
          data-testid="skill-triggered-banner"
          className="flex items-center justify-between rounded-xl border border-brand/40 bg-brand-soft px-4 py-2.5 text-xs text-brand-text"
        >
          <span>
            Attached <code className="font-mono">/{lastTriggeredSkill}</code> to
            active session.
          </span>
        </div>
      )}

      {/* Installed Skills List */}
      <section aria-label="Installed skills">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="m-0 text-sm font-semibold tracking-tight text-ink">
            Installed Skills ({filteredSkills.length})
          </h2>
        </div>

        <div
          data-testid="installed-skills-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-[14px] border border-premium bg-pane"
        >
          {filteredSkills.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-ink">
              No skills match the current filter.
            </div>
          ) : (
            filteredSkills.map((skill) => (
              <div
                key={skill.name}
                data-testid={`skill-row-${skill.name}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-xs"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-hairline bg-inset text-brand-text">
                    <Box className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink">
                        {skill.name}
                      </span>
                      <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[11px] text-brand-text">
                        /{skill.name}
                      </code>
                      <Badge variant="outline" className="capitalize">
                        {skill.scope}
                      </Badge>
                      {skill.allowedTools && skill.allowedTools.length > 0 && (
                        <Badge
                          variant="secondary"
                          className="font-mono text-[10px]"
                        >
                          {skill.allowedTools.length} allowed tools
                        </Badge>
                      )}
                      {skill.activeInSession && (
                        <Badge variant="brand">Active in session</Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-ink">
                      {skill.description}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    data-testid={`run-skill-btn-${skill.name}`}
                    onClick={() => {
                      void handleRunSkill(skill.name);
                    }}
                  >
                    <Play className="size-3" aria-hidden="true" />
                    <span>Run</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    data-testid={`open-skill-md-btn-${skill.name}`}
                    onClick={() => handleOpenSkillFile(skill.path)}
                  >
                    <FileCode2 className="size-3" aria-hidden="true" />
                    <span>Open SKILL.md</span>
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Endorsed Skills Catalog */}
      <section aria-label="Endorsed skills catalog">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="m-0 text-sm font-semibold tracking-tight text-ink">
              Endorsed Skills Catalog
            </h2>
            <p className="mt-0.5 text-xs text-muted-ink">
              Curated workflow templates synced with your workspace skill
              registry.
            </p>
          </div>
        </div>

        <div
          data-testid="endorsed-skills-list"
          className="grid grid-cols-1 gap-3 @min-[700px]/app:grid-cols-3"
        >
          {endorsed.map((item) => (
            <div
              key={item.name}
              data-testid={`endorsed-skill-${item.name}`}
              className="rayu-card-bevel flex flex-col justify-between gap-3 rounded-xl border border-premium bg-pane p-4 text-xs"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-xs font-semibold text-ink">
                    /{item.name}
                  </code>
                  {item.category && (
                    <Badge variant="outline" className="text-[10px]">
                      {item.category}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-ink">
                  {item.description}
                </p>
              </div>

              <div className="flex items-center justify-end border-t border-hairline pt-2.5">
                {item.installed ? (
                  <Badge variant="brand">
                    <Check className="size-3" aria-hidden="true" />
                    <span>Installed</span>
                  </Badge>
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    size="xs"
                    data-testid={`install-endorsed-skill-${item.name}`}
                    onClick={() => installSkillMutation.mutate(item)}
                  >
                    <Plus className="size-3" aria-hidden="true" />
                    <span>Install</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <CreateSkillDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        isSaving={createSkillMutation.isPending}
        onCreate={async (params) => createSkillMutation.mutateAsync(params)}
      />
    </div>
  );
}
