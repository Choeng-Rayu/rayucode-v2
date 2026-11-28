import { operationAvailable } from "@/lib/operation-result";
import * as React from "react";
import {
  Brain,
  FileText,
  Link2,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  RayuProcessingMark,
  Switch,
} from "@/components/ui";
import { cn, formatRelativeTime, postToHost } from "@/lib";

import { useMemoryActions, useMemoryStatus } from "../hooks/usePlugins";

export function MemoryGraphTab() {
  const { data: memory } = useMemoryStatus();
  const {
    toggleMemoryMutation,
    togglePersistInjectionsMutation,
    extractMemoryMutation,
    rememberFactMutation,
    forgetFactMutation,
    tagFactMutation,
    linkFactsMutation,
  } = useMemoryActions();

  const [scopeFilter, setScopeFilter] = React.useState<
    "all" | "project" | "global"
  >("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedTag, setSelectedTag] = React.useState<string | null>(null);

  const [rememberOpen, setRememberOpen] = React.useState(false);
  const [newFactText, setNewFactText] = React.useState("");
  const [newFactScope, setNewFactScope] = React.useState<"project" | "global">(
    "project",
  );
  const [newFactTagsText, setNewFactTagsText] = React.useState("architecture");

  const [expandedLinks, setExpandedLinks] = React.useState<
    Record<string, boolean>
  >({});

  const facts = memory?.facts ?? [];
  const instructionFiles = memory?.instructionFiles ?? [];

  const allTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const f of facts) {
      for (const t of f.tags) set.add(t);
    }
    return Array.from(set);
  }, [facts]);

  const q = searchQuery.trim().toLowerCase();

  const filteredFacts = facts.filter((fact) => {
    if (scopeFilter !== "all" && fact.scope !== scopeFilter) return false;
    if (selectedTag && !fact.tags.includes(selectedTag)) return false;
    if (!q) return true;
    return (
      fact.content.toLowerCase().includes(q) ||
      fact.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const handleRememberSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newFactText.trim()) return;
    const tags = newFactTagsText
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    await rememberFactMutation.mutateAsync({
      content: newFactText.trim(),
      scope: newFactScope,
      tags: tags.length > 0 ? tags : ["general"],
    });
    setNewFactText("");
    setRememberOpen(false);
  };

  return (
    <div data-testid="memory-graph-tab" className="flex flex-col gap-6">
      {/* Top Control Strip */}
      <section
        data-testid="memory-control-strip"
        className="rayu-card-bevel flex flex-wrap items-center justify-between gap-4 rounded-xl border border-premium bg-pane p-4"
      >
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-2.5">
            <Switch
              checked={Boolean(memory?.enabled)}
              onCheckedChange={(checked) =>
                toggleMemoryMutation.mutate(checked)
              }
              aria-label="Memory Enabled"
              data-testid="memory-enabled-switch"
            />
            <div>
              <div className="text-xs font-semibold text-ink">
                Memory Graph Enabled
              </div>
              <div className="text-[11px] text-muted-ink">
                Jev + Semantic Graph (
                <code className="font-mono">memory.rs</code>)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Switch
              checked={Boolean(memory?.persistInjections)}
              onCheckedChange={(checked) =>
                togglePersistInjectionsMutation.mutate(checked)
              }
              aria-label="Persist Memory Injections"
              data-testid="memory-persist-injections-switch"
            />
            <div>
              <div className="text-xs font-medium text-ink">
                Persist Memory Injections
              </div>
              <div className="text-[11px] text-muted-ink">
                Keep KV-cache prefix stable across turns
              </div>
            </div>
          </div>

          {(memory?.pipelineActive || extractMemoryMutation.isPending) && (
            <div
              data-testid="memory-pipeline-active-badge"
              className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand-text"
            >
              <RayuProcessingMark className="size-3.5" />
              <span>Extracting graph nodes...</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={extractMemoryMutation.isPending}
            data-testid="extract-memory-now-btn"
            onClick={() => extractMemoryMutation.mutate(undefined)}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span>Extract Memory Now</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="toggle-remember-fact-btn"
            disabled={!operationAvailable("plugins.memory.remember")}
            onClick={() => setRememberOpen((prev) => !prev)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>Remember Fact</span>
          </Button>
        </div>
      </section>

      {/* Inline Add Memory Form */}
      {rememberOpen && (
        <form
          data-testid="remember-fact-form"
          onSubmit={(e) => {
            void handleRememberSubmit(e);
          }}
          className="rayu-card-bevel flex flex-col gap-3 rounded-xl border border-premium-hi bg-pane p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">
              Add Semantic Memory Node
            </span>
            <div className="inline-flex rounded-md border border-hairline bg-inset p-0.5 text-xs">
              {(["project", "global"] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  data-testid={`remember-scope-${sc}`}
                  onClick={() => setNewFactScope(sc)}
                  className={cn(
                    "cursor-pointer rounded px-2.5 py-0.5 text-[11px] font-medium capitalize",
                    newFactScope === sc
                      ? "bg-active text-ink"
                      : "text-muted-ink hover:text-ink",
                  )}
                >
                  {sc}
                </button>
              ))}
            </div>
          </div>

          <input
            data-testid="remember-fact-content-input"
            type="text"
            value={newFactText}
            onChange={(e) => setNewFactText(e.target.value)}
            placeholder="Enter durable fact or architectural invariant..."
            aria-label="Memory fact content"
            className="h-8 w-full rounded-md border border-control-border bg-inset px-2.5 text-xs text-ink placeholder:text-muted-ink focus:border-ring focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              data-testid="remember-fact-tags-input"
              type="text"
              value={newFactTagsText}
              onChange={(e) => setNewFactTagsText(e.target.value)}
              placeholder="Tags (comma-separated, e.g. rust, daemon)"
              aria-label="Memory tags"
              className="h-7 min-w-0 flex-1 rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus:border-ring focus:outline-none @min-[480px]/plugins-stage:min-w-[200px] @min-[480px]/plugins-stage:flex-none"
            />

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={!operationAvailable("plugins.memory.remember")}
            onClick={() => setRememberOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="xs"
                disabled={rememberFactMutation.isPending}
                data-testid="submit-remember-fact-btn"
              >
                Save Node
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Search & Scope / Tag Filter Bar */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline bg-inset px-3 focus-within:border-premium-hi @min-[480px]/plugins-stage:min-w-[220px]">
            <Search
              className="size-3.5 shrink-0 text-muted-ink"
              aria-hidden="true"
            />
            <input
              data-testid="memory-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or recall semantic memory facts..."
              aria-label="Search memory graph"
              className="w-full bg-transparent text-xs text-ink placeholder:text-muted-ink focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear memory search"
                onClick={() => setSearchQuery("")}
                className="cursor-pointer text-muted-ink hover:text-ink"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </label>

          <div className="flex max-w-full flex-wrap items-center rounded-lg border border-hairline bg-pane p-0.5 text-xs">
            {(["all", "project", "global"] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                data-testid={`memory-scope-${sc}`}
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

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-ink">Tags:</span>
            <button
              type="button"
              onClick={() => setSelectedTag(null)}
              className={cn(
                "cursor-pointer rounded-full border px-2 py-0.5 font-mono text-[10.5px] transition-colors",
                selectedTag === null
                  ? "border-brand/50 bg-brand-soft text-brand-text"
                  : "border-hairline bg-pane text-muted-ink hover:text-ink",
              )}
            >
              all
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                data-testid={`memory-tag-chip-${tag}`}
                onClick={() =>
                  setSelectedTag((prev) => (prev === tag ? null : tag))
                }
                className={cn(
                  "cursor-pointer rounded-full border px-2 py-0.5 font-mono text-[10.5px] transition-colors",
                  selectedTag === tag
                    ? "border-brand/50 bg-brand-soft text-brand-text"
                    : "border-hairline bg-pane text-muted-ink hover:text-ink",
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Instruction Files (AGENTS.md / RAYU.md) discovered by Rust engine */}
      {instructionFiles.length > 0 && (
        <section
          aria-label="Instruction files"
          data-testid="memory-instruction-files"
          className="flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-xs font-semibold tracking-tight text-ink">
              Instruction Files ({instructionFiles.length})
            </h2>
            <span className="font-mono text-[10.5px] text-muted-ink tabular-nums">
              {instructionFiles
                .reduce((acc, f) => acc + f.tokens, 0)
                .toLocaleString()}{" "}
              tokens
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 @min-[520px]/plugins-stage:grid-cols-2">
            {instructionFiles.map((file) => (
              <button
                key={file.path || file.name}
                type="button"
                onClick={() =>
                  file.path &&
                  postToHost({
                    type: "rayucode.editor.openFile",
                    path: file.path,
                  })
                }
                className="rayu-card-bevel flex cursor-pointer flex-col gap-1 rounded-xl border border-hairline bg-pane p-3 text-left transition-colors hover:border-premium hover:bg-hover"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs font-medium text-ink">
                    <FileText className="size-3.5 shrink-0 text-brand-text" aria-hidden="true" />
                    <span className="truncate">{file.name}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {file.scope}
                    </Badge>
                    <span className="font-mono text-[10.5px] text-muted-ink tabular-nums">
                      ~{file.tokens} tok
                    </span>
                  </div>
                </div>
                {file.preview && (
                  <p className="m-0 line-clamp-2 text-[11px] text-muted-ink">
                    {file.preview}
                  </p>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Memory Nodes Explorer */}
      <div
        data-testid="memory-nodes-list"
        className="flex flex-col gap-3"
      >
        {filteredFacts.length === 0 ? (
          <div className="rayu-card-bevel rounded-xl border border-hairline bg-pane px-4 py-8 text-center text-xs text-muted-ink">
            No memory nodes match the current scope or search filter.
          </div>
        ) : (
          filteredFacts.map((fact) => {
            const linksExpanded = Boolean(expandedLinks[fact.id]);
            const relatedIds = fact.relatedIds ?? [];
            const otherFact = facts.find((f) => f.id !== fact.id);

            return (
              <article
                key={fact.id}
                data-testid={`memory-node-${fact.id}`}
                className="rayu-card-bevel rounded-xl border border-premium bg-pane p-4 text-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <Brain
                      className="mt-0.5 size-4 shrink-0 text-brand-text"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[13px] leading-relaxed font-medium text-ink">
                        {fact.content}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="capitalize">
                          {fact.scope}
                        </Badge>
                        {fact.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10.5px] text-body"
                          >
                            {tag}
                          </span>
                        ))}
                        {fact.confidence !== undefined && (
                          <span className="font-mono text-[10.5px] text-brand-text tabular-nums">
                            {Math.round(fact.confidence * 100)}% confidence
                          </span>
                        )}
                        <span className="text-[11px] text-muted-ink tabular-nums">
                          · {formatRelativeTime(fact.updatedAtMs)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Node Actions: Related Links, Tag, Link, Forget */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      data-testid={`memory-toggle-links-${fact.id}`}
                      onClick={() =>
                        setExpandedLinks((prev) => ({
                          ...prev,
                          [fact.id]: !prev[fact.id],
                        }))
                      }
                    >
                      <Link2 className="size-3" aria-hidden="true" />
                      <span>Relations ({relatedIds.length})</span>
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      data-testid={`memory-add-tag-${fact.id}`}
                      disabled={!operationAvailable("plugins.memory.tag")}
                      onClick={() =>
                        tagFactMutation.mutate({
                          id: fact.id,
                          tags: Array.from(
                            new Set([...fact.tags, "verified"]),
                          ),
                        })
                      }
                    >
                      <Tag className="size-3" aria-hidden="true" />
                      <span>Tag</span>
                    </Button>

                    {otherFact && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        data-testid={`memory-link-btn-${fact.id}`}
                        disabled={!operationAvailable("plugins.memory.link")}
                        onClick={() =>
                          linkFactsMutation.mutate({
                            sourceId: fact.id,
                            targetId: otherFact.id,
                            relation: "reinforces",
                          })
                        }
                      >
                        <Link2 className="size-3" aria-hidden="true" />
                        <span>Link</span>
                      </Button>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      data-testid={`memory-forget-btn-${fact.id}`}
                      disabled={!operationAvailable("plugins.memory.forget")}
                      onClick={() => forgetFactMutation.mutate(fact.id)}
                      className="text-muted-ink hover:text-danger"
                    >
                      <Trash2 className="size-3" aria-hidden="true" />
                      <span>Forget</span>
                    </Button>
                  </div>
                </div>

                {linksExpanded && (
                  <div
                    data-testid={`memory-links-drawer-${fact.id}`}
                    className="mt-3 rounded-lg border border-hairline bg-inset px-3 py-2.5"
                  >
                    <div className="text-[11px] font-medium text-muted-ink">
                      Related Graph Links
                    </div>
                    {relatedIds.length === 0 ? (
                      <div className="mt-1 text-xs text-muted-ink">
                        No linked graph neighbors yet. Click &ldquo;Link&rdquo;
                        to connect related memory nodes.
                      </div>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {relatedIds.map((relId) => {
                          const neighbor = facts.find((f) => f.id === relId);
                          return (
                            <span
                              key={relId}
                              className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-pane px-2 py-1 font-mono text-[11px] text-body"
                            >
                              <Link2
                                className="size-3 text-brand-text"
                                aria-hidden="true"
                              />
                              <span>
                                {relId}:{" "}
                                {neighbor
                                  ? neighbor.content.slice(0, 44)
                                  : "linked node"}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
