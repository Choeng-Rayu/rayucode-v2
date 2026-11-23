import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  Columns2,
  ExternalLink,
  FileCode2,
  Globe,
  Layers,
  ListTodo,
  PanelLeftOpen,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { BrandLogo } from "@/components/ui/brand-logos";
import { Button } from "@/components/ui/button";
import { MermaidDiagramSvg } from "@/components/ui/mermaid-diagram";
import { ContextSkeleton } from "@/components/ui/page-skeletons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SectionErrorBoundary } from "@/components/ui/section-error-boundary";
import { TechFileBadge } from "@/components/ui/tech-file-badge";
import { useAppStore, type RightTabId } from "@/lib/app-store";
import { callRpc, isVsCodeWebview, postToHost } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

import { RightSidebarTopBar } from "./TopBar";

export interface RightInspectorHostProps {
  contextSlot?: React.ReactNode;
  toolsSlot?: React.ReactNode;
  artifactsSlot?: React.ReactNode;
  filesSlot?: React.ReactNode;
  documentSlot?: React.ReactNode;
  previewFallback?:
    | React.ReactNode
    | ((tab: RightTabId) => React.ReactNode);
  sheetMode?: boolean;
}

const MIN_CHAT_WIDTH_PX = 320;
const SNAP_CLIP_CHAT_THRESHOLD_PX = 210;
const MIN_RIGHT_PANEL_WIDTH_PX = 280;

function getDefaultWidthClass(
  rightMode: "context" | "document",
  activeRightTab: RightTabId,
): string {
  if (rightMode === "context") {
    return "w-[332px] max-w-[calc(100%-320px)]";
  }
  switch (activeRightTab) {
    case "diff":
      return "w-[440px] max-w-[calc(100%-320px)]";
    case "files":
    case "code":
    case "markdown":
    case "diagram":
    case "sidePanel":
    case "browser":
      return "w-[420px] max-w-[calc(100%-320px)]";
    default:
      return "w-[332px] max-w-[calc(100%-320px)]";
  }
}

function DefaultInspectorContextView() {
  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSessionId =
    storeSessionId ?? (!isVsCodeWebview() ? "ses_vscode_shell" : null);
  const inspectorTab = useAppStore((s) => s.inspectorTab);
  const workspaces = useAppStore((s) => s.workspaces);
  const backgroundTasks = useAppStore((s) => s.backgroundTasks);
  const toggleBackgroundDrawer = useAppStore((s) => s.toggleBackgroundDrawer);
  const openCodeFile = useAppStore((s) => s.openCodeFile);

  const contextQuery = useQuery({
    queryKey: ["shell", "inspector", "context", activeSessionId],
    queryFn: () =>
      callRpc("workspace.contextSnapshot", { sessionId: activeSessionId! }),
    enabled: Boolean(activeSessionId),
    staleTime: 15_000,
  });

  const todosQuery = useQuery({
    queryKey: ["shell", "inspector", "todos", activeSessionId],
    queryFn: () =>
      callRpc("inspector.todos.get", { sessionId: activeSessionId! }),
    enabled: Boolean(activeSessionId),
    staleTime: 15_000,
  });

  const sidePanelQuery = useQuery({
    queryKey: ["shell", "inspector", "sidePanel", activeSessionId],
    queryFn: () =>
      callRpc("inspector.sidePanel.get", { sessionId: activeSessionId! }),
    enabled: Boolean(activeSessionId),
    staleTime: 15_000,
  });

  const mcpQuery = useQuery({
    queryKey: ["shell", "inspector", "mcp"],
    queryFn: () => callRpc("plugins.mcp.list"),
    staleTime: 30_000,
  });

  const changesQuery = useQuery({
    queryKey: ["shell", "inspector", "changes", activeSessionId],
    queryFn: () =>
      callRpc("changes.status", {
        sessionId: activeSessionId ?? undefined,
      }),
    staleTime: 15_000,
  });

  const ctx = contextQuery.data;
  const todos = todosQuery.data?.todos ?? [];
  const pages = sidePanelQuery.data?.pages ?? [];
  const servers = (mcpQuery.data?.servers ?? []).filter((s) => s.enabled);
  const changedFiles = changesQuery.data?.files ?? [];

  if (inspectorTab === "tools") {
    return (
      <ScrollArea className="min-h-0 flex-1 p-3.5">
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider text-muted-ink uppercase">
                Session Todos ({todos.filter((t) => t.status === "completed").length}/
                {todos.length})
              </span>
              <ListTodo className="size-3.5 text-muted-ink" />
            </div>
            {todos.length === 0 ? (
              <div className="rounded-lg border border-hairline-soft bg-pane p-3 text-xs text-muted-ink">
                No active tasks in this session.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {todos.map((todo, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 rounded-md border border-hairline-soft bg-pane px-2.5 py-2 text-xs"
                  >
                    {todo.status === "completed" ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand-text" />
                    ) : (
                      <Circle
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          todo.status === "in_progress"
                            ? "text-warn"
                            : "text-muted-ink",
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "leading-snug",
                        todo.status === "completed"
                          ? "text-muted-ink line-through"
                          : "text-ink",
                      )}
                    >
                      {todo.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider text-muted-ink uppercase">
                Background Processes ({backgroundTasks.length})
              </span>
              {backgroundTasks.length > 0 && (
                <button
                  type="button"
                  onClick={toggleBackgroundDrawer}
                  className="cursor-pointer text-[11px] text-brand-text hover:underline"
                >
                  Open viewer
                </button>
              )}
            </div>
            {backgroundTasks.length === 0 ? (
              <div className="rounded-lg border border-hairline-soft bg-pane p-3 text-xs text-muted-ink">
                No background shells or agents running.
              </div>
            ) : (
              backgroundTasks.map((task) => (
                <div
                  key={task.taskId}
                  className="flex flex-col gap-1 rounded-lg border border-hairline bg-pane p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono font-medium text-ink">
                      {task.displayName}
                    </span>
                    <Badge variant="brand">{task.status}</Badge>
                  </div>
                  <span className="text-[11px] text-muted-ink">
                    {task.summary}
                  </span>
                </div>
              ))
            )}
          </section>
        </div>
      </ScrollArea>
    );
  }

  if (inspectorTab === "artifacts") {
    return (
      <ScrollArea className="min-h-0 flex-1 p-3.5">
        <div className="flex flex-col gap-3">
          <div className="text-[11px] font-semibold tracking-wider text-muted-ink uppercase">
            Outputs &amp; Side Panel ({pages.length})
          </div>
          {pages.length === 0 ? (
            <div className="rounded-lg border border-hairline-soft bg-pane p-3 text-xs text-muted-ink">
              Artifacts, SidePanel pages, and interactive applets emitted by the agent appear here.
            </div>
          ) : (
            pages.map((page) => (
              <div
                key={page.id}
                className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-pane p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{page.title}</span>
                  <Badge variant="outline">{page.kind}</Badge>
                </div>
                {page.content && (
                  <p className="line-clamp-3 font-mono text-[11px] text-muted-ink">
                    {page.content}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1 p-3.5">
      <div className="flex flex-col gap-4">
        {/* Environment */}
        <section className="flex flex-col gap-2">
          <div className="text-[11px] font-semibold tracking-wider text-muted-ink uppercase">
            Environment
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-pane p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-ink">Workspace</span>
              <span className="truncate font-mono text-ink">
                {workspaces[0]?.name ?? "rayucode-v2"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-ink">Branch</span>
              <Badge variant="outline" className="font-mono text-[10.5px]">
                {workspaces[0]?.branch ?? changesQuery.data?.branch ?? "main"}
              </Badge>
            </div>
          </div>
        </section>

        {/* Context Breakdown */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="border-b border-dotted border-muted-ink text-[11px] font-semibold tracking-wider text-muted-ink uppercase">
              Context Window
            </span>
            <span className="font-mono text-[11px] text-ink tabular-nums">
              {ctx
                ? `${Math.round(ctx.usedTokens / 1000)}k / ${Math.round(ctx.maxTokens / 1000)}k (${ctx.usedPercent.toFixed(1)}%)`
                : "35k / 200k"}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-inset border border-hairline-soft">
            <div
              className="rayu-effort-bar h-full transition-all"
              style={{ width: `${Math.min(100, ctx?.usedPercent ?? 17)}%` }}
            />
          </div>
          {ctx?.kvCacheHitPercent !== undefined && (
            <div className="flex items-center justify-between text-[11px] text-muted-ink">
              <span>Warm KV Cache Hit Rate</span>
              <span className="font-mono text-brand-text tabular-nums">
                {ctx.kvCacheHitPercent}%
              </span>
            </div>
          )}
        </section>

        {/* Active MCP Connectors */}
        <section className="flex flex-col gap-2">
          <div className="text-[11px] font-semibold tracking-wider text-muted-ink uppercase">
            Connectors ({servers.length})
          </div>
          <div className="flex flex-col gap-1.5">
            {servers.map((srv) => (
              <div
                key={srv.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-hairline-soft bg-pane px-2.5 py-1.5 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <BrandLogo name={srv.brandId ?? srv.id} size="sm" />
                  <span className="truncate font-medium text-ink">
                    {srv.name}
                  </span>
                </div>
                <span className="font-mono text-[10.5px] text-muted-ink tabular-nums">
                  {srv.cachedToolCount ?? 0} tools
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Session Changes */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-muted-ink uppercase">
              Modified Files ({changedFiles.length})
            </span>
            {changesQuery.data && (
              <span className="font-mono text-[11px] tabular-nums">
                <span className="text-brand-text">
                  +{changesQuery.data.totalAdditions}
                </span>{" "}
                <span className="text-danger">
                  -{changesQuery.data.totalDeletions}
                </span>
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {changedFiles.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => openCodeFile(f.path)}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-hover"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <TechFileBadge path={f.path} />
                  <span className="truncate font-mono text-[11.5px] text-ink">
                    {f.path.split("/").pop()}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
                  <span className="text-brand-text">+{f.additions}</span>{" "}
                  <span className="text-danger">-{f.deletions}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}

function DefaultInspectorDocumentView({ tab }: { tab: RightTabId }) {
  const activeCodeFile = useAppStore((s) => s.activeCodeFile);
  const activeDiagram = useAppStore((s) => s.activeDiagram);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const [previewUrl, setPreviewUrl] = React.useState("http://localhost:3000");

  if (tab === "diagram") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-ink">
            {activeDiagram.title}
          </span>
          <Badge variant="brand">Mermaid SVG</Badge>
        </div>
        <MermaidDiagramSvg source={activeDiagram.source} />
      </div>
    );
  }

  if (tab === "browser") {
    const handleLaunchBrowser = (url: string) => {
      const target = url.trim();
      if (!target) return;
      postToHost({
        type: "rayucode.editor.openSimpleBrowser",
        url: target,
      });
    };

    return (
      <div
        data-testid="inspector-browser-view"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4"
      >
        <div className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-pane p-3">
          <div className="flex min-w-0 items-center gap-2">
            <Globe className="size-4 shrink-0 text-brand-text" aria-hidden="true" />
            <span className="truncate text-xs font-semibold text-ink">
              Simple Browser Preview
            </span>
          </div>
          <Badge variant="outline">VS Code</Badge>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleLaunchBrowser(previewUrl);
          }}
          className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-pane p-3.5"
        >
          <label
            htmlFor="inspector-browser-url"
            className="text-[11px] font-medium text-muted-ink"
          >
            Local dev server or preview URL
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="inspector-browser-url"
              type="url"
              value={previewUrl}
              onChange={(e) => setPreviewUrl(e.target.value)}
              placeholder="http://localhost:3000"
              data-testid="inspector-browser-url-input"
              className="h-8 min-w-0 flex-1 rounded-md border border-control-border bg-inset px-2.5 font-mono text-xs text-ink focus-visible:border-ring focus-visible:outline-none"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              data-testid="inspector-open-simple-browser-btn"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span>Open Preview</span>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {[
              "http://localhost:3000",
              "http://localhost:5173",
              "http://localhost:5174",
              "http://localhost:8080",
            ].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setPreviewUrl(preset);
                  handleLaunchBrowser(preset);
                }}
                className="cursor-pointer rounded-md border border-hairline bg-inset px-2 py-0.5 font-mono text-[10.5px] text-muted-ink transition-colors hover:border-premium hover:text-ink"
              >
                {preset.replace("http://", "")}
              </button>
            ))}
          </div>
        </form>
      </div>
    );
  }

  if (tab === "diff") {
    return (
      <div
        data-testid="inspector-diff-fallback"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4"
      >
        <div className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-pane p-3">
          <div className="flex min-w-0 items-center gap-2">
            <Columns2 className="size-4 shrink-0 text-brand-text" aria-hidden="true" />
            <span className="truncate text-xs font-semibold text-ink">
              Changes &amp; Diff
            </span>
          </div>
          <Button
            type="button"
            variant="default"
            size="xs"
            onClick={() => setActiveRoute("changes")}
          >
            <span>Open Changes</span>
          </Button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-hairline-soft bg-inset/60 p-6 text-center text-xs text-muted-ink">
          <Columns2 className="mb-2 size-5 text-muted-ink" />
          <span>
            Review modified files, stage hunks, or open native side-by-side diffs in VS Code.
          </span>
        </div>
      </div>
    );
  }

  const showCodeHeader = tab === "code" && Boolean(activeCodeFile);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-pane p-3">
        <div className="flex min-w-0 items-center gap-2">
          {showCodeHeader && activeCodeFile ? (
            <TechFileBadge path={activeCodeFile} />
          ) : (
            <FileCode2 className="size-4 shrink-0 text-muted-ink" />
          )}
          <span className="truncate font-mono text-xs font-medium text-ink">
            {showCodeHeader && activeCodeFile
              ? activeCodeFile
              : `Inspector (${tab})`}
          </span>
        </div>
        {showCodeHeader && activeCodeFile && (
          <Button
            type="button"
            variant="default"
            size="xs"
            onClick={() =>
              postToHost({
                type: "rayucode.editor.openFile",
                path: activeCodeFile,
              })
            }
          >
            <ExternalLink className="size-3" />
            <span>Open in VS Code</span>
          </Button>
        )}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-hairline-soft bg-inset/60 p-6 text-center text-xs text-muted-ink">
        <Layers className="mb-2 size-5 text-muted-ink" />
        <span>
          Select a file or diff to inspect inline or open beside in the native VS Code editor.
        </span>
      </div>
    </div>
  );
}

export function RightInspectorHost({
  contextSlot,
  toolsSlot,
  artifactsSlot,
  filesSlot,
  documentSlot,
  previewFallback,
  sheetMode = false,
}: RightInspectorHostProps) {
  const inspectorOpen = useAppStore((s) => s.inspectorOpen);
  const rightMode = useAppStore((s) => s.rightMode);
  const inspectorTab = useAppStore((s) => s.inspectorTab);
  const activeRightTab = useAppStore((s) => s.activeRightTab);
  const fullView = useAppStore((s) => s.fullView);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const rightWidthPx = useAppStore((s) => s.rightWidthPx);
  const chatCollapsedByRight = useAppStore((s) => s.chatCollapsedByRight);
  const setRightWidthPx = useAppStore((s) => s.setRightWidthPx);
  const setChatCollapsedByRight = useAppStore((s) => s.setChatCollapsedByRight);

  const asideRef = React.useRef<HTMLElement | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleResizeStart = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (fullView || sheetMode) return;
      event.preventDefault();
      setIsDragging(true);

      const stageEl = asideRef.current?.parentElement;
      const stageRect = stageEl?.getBoundingClientRect();
      const stageLeft = stageRect ? stageRect.left : sidebarCollapsed ? 52 : 296;
      const stageWidth = stageRect
        ? stageRect.width
        : Math.max(600, window.innerWidth - stageLeft);

      const onMouseMove = (moveEvent: MouseEvent) => {
        const remainingChatWidth = moveEvent.clientX - stageLeft;
        const desiredRightWidth = stageLeft + stageWidth - moveEvent.clientX;

        if (remainingChatWidth < SNAP_CLIP_CHAT_THRESHOLD_PX) {
          setChatCollapsedByRight(true);
          setRightWidthPx(null);
          return;
        }

        setChatCollapsedByRight(false);
        const maxSplitRightWidth = Math.max(
          MIN_RIGHT_PANEL_WIDTH_PX,
          stageWidth - MIN_CHAT_WIDTH_PX,
        );
        const clamped = Math.max(
          MIN_RIGHT_PANEL_WIDTH_PX,
          Math.min(maxSplitRightWidth, desiredRightWidth),
        );
        setRightWidthPx(clamped);
      };

      const onMouseUp = () => {
        setIsDragging(false);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [fullView, sheetMode, sidebarCollapsed, setChatCollapsedByRight, setRightWidthPx],
  );

  if (!inspectorOpen && !sheetMode) {
    return null;
  }

  const isSeamlessContextHeader =
    !sheetMode && rightMode === "context" && !fullView && !chatCollapsedByRight;

  const renderBody = () => {
    if (rightMode === "context") {
      if (inspectorTab === "tools" && toolsSlot) return toolsSlot;
      if (inspectorTab === "artifacts" && artifactsSlot) return artifactsSlot;
      if (contextSlot) return contextSlot;
      return <DefaultInspectorContextView />;
    }
    if (activeRightTab === "files" && filesSlot) {
      return filesSlot;
    }
    if (documentSlot) {
      return documentSlot;
    }
    if (typeof previewFallback === "function") {
      return previewFallback(activeRightTab);
    }
    if (previewFallback) {
      return previewFallback;
    }
    return <DefaultInspectorDocumentView tab={activeRightTab} />;
  };

  return (
    <aside
      ref={asideRef}
      aria-label="Environment, context and previews"
      data-slot="right-inspector-host"
      data-testid="right-inspector-host"
      data-chat-clipped={chatCollapsedByRight ? "true" : "false"}
      style={
        !sheetMode && !fullView && !chatCollapsedByRight && rightWidthPx !== null
          ? { width: `${rightWidthPx}px` }
          : undefined
      }
      className={cn(
        "relative flex h-full shrink-0 flex-col border-hairline bg-canvas",
        !isDragging && "transition-[width] duration-150",
        sheetMode
          ? "w-full border-l"
          : fullView
            ? "fixed inset-0 z-40 w-full border-l"
            : chatCollapsedByRight
              ? cn("min-w-0 flex-1 border-l-0", !sidebarCollapsed && "border-t")
              : cn(
                  !isSeamlessContextHeader && "border-l",
                  !sidebarCollapsed && "border-t",
                  rightWidthPx === null
                    ? getDefaultWidthClass(rightMode, activeRightTab)
                    : "min-w-[280px] max-w-[calc(100%-320px)]",
                ),
      )}
    >
      {/* Interactive Drag-Resize & Snap-Clip Divider Handle */}
      {!fullView && !sheetMode && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right panel"
          title={
            chatCollapsedByRight
              ? "Drag right to restore chat session"
              : "Drag left to expand (drag further to hide chat · double-click to reset)"
          }
          onMouseDown={handleResizeStart}
          onDoubleClick={() => {
            setChatCollapsedByRight(false);
            setRightWidthPx(null);
          }}
          className={cn(
            "absolute bottom-0 -left-[3px] z-30 w-[6px] cursor-col-resize transition-colors",
            isSeamlessContextHeader ? "top-[46px]" : "top-0",
            isDragging ? "bg-brand/55" : "hover:bg-info/45",
          )}
        />
      )}

      {/* Restore Chat Session Banner when chat was clipped by dragging left */}
      {!fullView && !sheetMode && chatCollapsedByRight && (
        <div
          data-testid="restore-chat-bar"
          className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-hairline-soft bg-chrome px-3 text-xs select-none"
        >
          <button
            type="button"
            onClick={() => setChatCollapsedByRight(false)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-hover"
          >
            <PanelLeftOpen
              className="size-3.5 text-brand-text"
              strokeWidth={1.65}
              aria-hidden="true"
            />
            <span>Show chat session</span>
            <kbd className="ml-1 rounded bg-active px-1.5 py-0.5 font-mono text-[10px] text-muted-ink">
              ⌘1
            </kbd>
          </button>
          <span className="text-[11px] text-muted-ink">
            Drag left edge right to split
          </span>
        </div>
      )}

      <RightSidebarTopBar sheetMode={sheetMode} />

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          isSeamlessContextHeader && "border-l border-hairline",
        )}
      >
        <SectionErrorBoundary title="Right inspector failed to load">
          <React.Suspense fallback={<ContextSkeleton />}>
            {renderBody()}
          </React.Suspense>
        </SectionErrorBoundary>
      </div>
    </aside>
  );
}

export { Sparkles };
