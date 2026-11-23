import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
  LayoutPanelLeft,
  X,
} from "lucide-react";

import { Badge, Button, ScrollArea } from "@/components/ui";
import { callRpc, cn, postToHost, useAppStore } from "@/lib";
import type {
  AppletStateView,
  SidePanelPageView,
} from "@shared/vscodeProtocol";

import { AppletRenderer } from "./AppletRenderer";

export interface ArtifactsPanelProps {
  sessionId?: string;
  pagesOverride?: SidePanelPageView[];
  appletsOverride?: AppletStateView[];
  className?: string;
}

export function ArtifactsPanel({
  sessionId: sessionIdProp,
  pagesOverride,
  appletsOverride,
  className,
}: ArtifactsPanelProps) {
  const queryClient = useQueryClient();
  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionId = sessionIdProp ?? storeSessionId ?? "ses_vscode_shell";

  const sidePanelQuery = useQuery({
    queryKey: ["inspector", "sidePanel", sessionId],
    queryFn: () => callRpc("inspector.sidePanel.get", { sessionId }),
    enabled: !pagesOverride,
    staleTime: 15_000,
  });

  const appletsQuery = useQuery({
    queryKey: ["inspector", "applets", sessionId],
    queryFn: () => callRpc("inspector.applet.get", { sessionId }),
    enabled: !appletsOverride,
    staleTime: 15_000,
  });

  const pages = pagesOverride ?? sidePanelQuery.data?.pages ?? [];
  const applets = appletsOverride ?? appletsQuery.data?.applets ?? [];

  const [selectedPageId, setSelectedPageId] = React.useState<string | null>(
    null,
  );

  const activePage =
    pages.find((p) => p.id === selectedPageId) ?? pages[0] ?? null;

  const handleClosePage = async (pageId: string) => {
    try {
      await callRpc("inspector.sidePanel.close", { sessionId, pageId });
      await queryClient.invalidateQueries({
        queryKey: ["inspector", "sidePanel", sessionId],
      });
    } catch {
      // ignore offline error
    }
  };

  const handleOpenInVSCode = (page: SidePanelPageView) => {
    const targetPath = page.filePath ?? page.title;
    if (page.kind === "markdown") {
      postToHost({
        type: "rayucode.editor.openMarkdownPreview",
        path: targetPath,
      });
    } else {
      postToHost({
        type: "rayucode.editor.openFile",
        path: targetPath,
      });
    }
  };

  return (
    <ScrollArea
      data-slot="artifacts-panel"
      data-testid="inspector-artifacts-panel"
      className={cn("min-h-0 flex-1 bg-canvas", className)}
    >
      <div className="flex flex-col divide-y divide-hairline-soft">
        {/* 1. SidePanel / Document Artifacts Viewer */}
        <section aria-label="SidePanel Artifacts" className="px-[18px] py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LayoutPanelLeft
                className="size-4 text-code-type"
                aria-hidden="true"
              />
              <h2 className="m-0 text-[12.5px] font-medium text-ink">
                SidePanel &amp; Artifacts ({pages.length})
              </h2>
            </div>
          </div>

          {pages.length === 0 ? (
            <div className="rounded-lg border border-hairline-soft bg-pane p-3.5 text-xs text-muted-ink">
              Markdown documents, PDF reports, and HTML panels emitted by{" "}
              <code className="font-mono text-[11px]">panel</code> or{" "}
              <code className="font-mono text-[11px]">side_panel</code> tools
              appear here.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Page Selector Tabs */}
              <div className="flex flex-wrap items-center gap-1.5">
                {pages.map((page) => {
                  const isActive = activePage?.id === page.id;
                  return (
                    <button
                      key={page.id}
                      type="button"
                      data-testid={`artifact-page-tab-${page.id}`}
                      onClick={() => setSelectedPageId(page.id)}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                        isActive
                          ? "border-premium bg-active text-ink"
                          : "border-hairline-soft bg-pane text-muted-ink hover:bg-hover hover:text-ink",
                      )}
                    >
                      <FileText className="size-3 text-code-type" />
                      <span className="max-w-[160px] truncate">
                        {page.title}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {page.kind}
                      </Badge>
                    </button>
                  );
                })}
              </div>

              {/* Active Page Viewer */}
              {activePage && (
                <div
                  data-testid={`artifact-viewer-${activePage.id}`}
                  className="overflow-hidden rounded-xl border border-hairline bg-pane shadow-bevel-surface"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-hairline-soft bg-inset px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileCode2 className="size-3.5 shrink-0 text-code-type" />
                      <span className="truncate text-xs font-semibold text-ink">
                        {activePage.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        data-testid={`artifact-open-vscode-${activePage.id}`}
                        onClick={() => handleOpenInVSCode(activePage)}
                      >
                        {activePage.kind === "markdown" ? (
                          <>
                            <Eye className="size-3" />
                            <span>Preview in VS Code</span>
                          </>
                        ) : (
                          <>
                            <ExternalLink className="size-3" />
                            <span>Open in VS Code</span>
                          </>
                        )}
                      </Button>

                      <button
                        type="button"
                        aria-label={`Close ${activePage.title}`}
                        onClick={() => void handleClosePage(activePage.id)}
                        className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink hover:bg-hover hover:text-ink"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[320px] overflow-auto p-3.5">
                    {activePage.content ? (
                      <pre className="rayu-prose m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap text-body">
                        {activePage.content}
                      </pre>
                    ) : (
                      <p className="m-0 text-xs text-muted-ink">
                        Document saved at{" "}
                        <code className="font-mono">
                          {activePage.filePath ?? activePage.title}
                        </code>
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 2. Sandboxed Interactive Applets */}
        <section aria-label="Interactive Applets" className="px-[18px] py-4">
          <h2 className="mb-3 text-[12.5px] font-medium text-ink">
            Interactive Applets ({applets.length})
          </h2>

          {applets.length === 0 ? (
            <div className="rounded-lg border border-hairline-soft bg-pane p-3.5 text-xs text-muted-ink">
              No active React applets mounted in this session.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {applets.map((applet) => (
                <AppletRenderer
                  key={applet.appletId}
                  applet={applet}
                  sessionId={sessionId}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
