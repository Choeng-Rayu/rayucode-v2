import * as React from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileDiff,
  Terminal,
} from "lucide-react";

import {
  Button,
  ScrollArea,
  TechFileBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import {
  basenameOf,
  cn,
  detectLanguageFromPath,
  highlightCodeLines,
  postToHost,
  tokenizeCodeLine,
  useAppStore,
  type HighlightedToken,
} from "@/lib";

export interface CodeFileSpec {
  pill: string;
  path: string;
  language: string;
  startLine: number;
  defaultLine: number;
  lines: string[];
}

const DEFAULT_CODE_FILES: Record<string, CodeFileSpec> = {
  "crates/rayu-harness/src/lookup.rs": {
    pill: "lookup.rs",
    path: "crates/rayu-harness/src/lookup.rs",
    language: "rust",
    startLine: 38,
    defaultLine: 42,
    lines: [
      "use std::collections::HashMap;",
      "",
      "impl ShardStore {",
      "    pub fn lookup(&self, key: &str) -> Option<&ShardEntry> {",
      "        self.entries.get(key)",
      "    }",
      "}",
    ],
  },
  "vscode/webview/src/features/shell/components/AppShell.tsx": {
    pill: "AppShell.tsx",
    path: "vscode/webview/src/features/shell/components/AppShell.tsx",
    language: "tsx",
    startLine: 1,
    defaultLine: 24,
    lines: [
      'import * as React from "react";',
      'import { useAppStore } from "@/lib/app-store";',
      "",
      "export function AppShell({ children }: { children?: React.ReactNode }) {",
      '  return <div className="@container/app flex h-screen w-screen">{children}</div>;',
      "}",
    ],
  },
  "vscode/webview/src/styles/globals.css": {
    pill: "globals.css",
    path: "vscode/webview/src/styles/globals.css",
    language: "css",
    startLine: 116,
    defaultLine: 119,
    lines: [
      ":root {",
      "  color-scheme: dark;",
      "  --bg-chrome: var(--vscode-sideBar-background);",
      "  --bg-canvas: var(--vscode-editor-background);",
      "  --bg-pane: var(--vscode-sideBarSectionHeader-background);",
      "  --accent: rgb(61, 189, 132);",
      "}",
    ],
  },
};

function resolveCodeSpec(
  filePath: string,
  customFiles?: Record<string, CodeFileSpec>,
): CodeFileSpec {
  const catalog = { ...DEFAULT_CODE_FILES, ...(customFiles ?? {}) };
  if (catalog[filePath]) {
    return catalog[filePath];
  }
  const byBasename = Object.values(catalog).find(
    (s) => s.pill.toLowerCase() === basenameOf(filePath).toLowerCase(),
  );
  if (byBasename) {
    return byBasename;
  }
  return {
    pill: basenameOf(filePath),
    path: filePath,
    language: detectLanguageFromPath(filePath),
    startLine: 1,
    defaultLine: 1,
    lines: [
      `// ${filePath}`,
      "// Select Open in VS Code to edit this file directly in the native editor.",
    ],
  };
}

function tokenizeLineFallback(line: string): HighlightedToken[] {
  return tokenizeCodeLine(line).map((tok) => ({
    content: tok.text,
    tokenClass: tok.className,
  }));
}

export interface CodeViewerProps {
  filePath?: string | null;
  line?: number | null;
  filesCatalog?: Record<string, CodeFileSpec>;
  className?: string;
}

export function CodeViewer({
  filePath: filePathProp,
  line: lineProp,
  filesCatalog,
  className,
}: CodeViewerProps) {
  const storeCodeFile = useAppStore((s) => s.activeCodeFile);
  const storeCodeLine = useAppStore((s) => s.activeCodeLine);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const openCodeFile = useAppStore((s) => s.openCodeFile);

  const activeFilePath =
    filePathProp ??
    storeCodeFile ??
    "crates/rayu-harness/src/lookup.rs";
  const activeLine = lineProp !== undefined ? lineProp : storeCodeLine;

  const codeSpec = React.useMemo(
    () => resolveCodeSpec(activeFilePath, filesCatalog),
    [activeFilePath, filesCatalog],
  );

  const availableFiles = React.useMemo(
    () => Object.keys({ ...DEFAULT_CODE_FILES, ...(filesCatalog ?? {}) }),
    [filesCatalog],
  );

  const [copiedPath, setCopiedPath] = React.useState(false);
  const [shikiTokens, setShikiTokens] = React.useState<HighlightedToken[][] | null>(
    null,
  );

  const fallbackTokens = React.useMemo<HighlightedToken[][]>(
    () => codeSpec.lines.map(tokenizeLineFallback),
    [codeSpec.lines],
  );

  React.useEffect(() => {
    let cancelled = false;
    void highlightCodeLines(
      codeSpec.lines,
      codeSpec.language,
      resolvedTheme,
    )
      .then((tokens) => {
        if (!cancelled && tokens.length === codeSpec.lines.length) {
          setShikiTokens(tokens);
        }
      })
      .catch(() => {
        // Keep synchronous fallback tokenizer
      });
    return () => {
      cancelled = true;
    };
  }, [codeSpec.language, codeSpec.lines, resolvedTheme]);

  const renderedLines = shikiTokens ?? fallbackTokens;

  const handleCopyPath = async () => {
    postToHost({ type: "rayucode.editor.copy", text: codeSpec.path });
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(codeSpec.path);
      }
    } catch {
      // ignore clipboard errors
    }
    setCopiedPath(true);
    window.setTimeout(() => setCopiedPath(false), 1400);
  };

  const handleOpenInVSCode = () => {
    postToHost({
      type: "rayucode.editor.openFile",
      path: codeSpec.path,
      line: activeLine ?? codeSpec.defaultLine,
    });
  };

  const handleOpenDiff = () => {
    postToHost({
      type: "rayucode.editor.openDiff",
      path: codeSpec.path,
      sessionId: activeSessionId ?? undefined,
      scope: "session",
    });
  };

  const handleOpenTerminal = () => {
    postToHost({
      type: "rayucode.editor.openTerminal",
      name: "RayuCode Workspace",
    });
  };

  return (
    <div
      data-slot="inspector-code-viewer"
        data-testid="inspector-code-viewer"
        className={cn("flex min-h-0 flex-1 flex-col bg-pane", className)}
      >
        {/* Referenced file tab switcher */}
        <div
          role="tablist"
          aria-label="Referenced code files"
          className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-hairline px-3 py-2"
        >
          {availableFiles.map((fileKey) => {
            const spec = resolveCodeSpec(fileKey, filesCatalog);
            const isActive = spec.path === codeSpec.path;
            return (
              <button
                key={fileKey}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => openCodeFile(spec.path, spec.defaultLine)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border px-2 py-1 font-mono text-[11px] whitespace-nowrap transition-colors",
                  isActive
                    ? "border-premium bg-active text-ink"
                    : "border-transparent text-muted-ink hover:bg-hover hover:text-ink",
                )}
              >
                <TechFileBadge path={spec.path} className="size-3.5" />
                <span>{spec.pill}</span>
              </button>
            );
          })}
        </div>

        {/* File path bar & VS Code IDE actions */}
        <div className="flex flex-wrap shrink-0 items-center gap-1.5 border-b border-hairline bg-canvas px-3 py-2 text-xs text-muted-ink">
          <TechFileBadge path={codeSpec.path} />
          <span
            data-testid="code-viewer-path"
            title={codeSpec.path}
            className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-body"
          >
            {codeSpec.path}
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Copy file path"
                onClick={() => void handleCopyPath()}
                className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-ink transition-colors hover:bg-hover hover:text-ink"
              >
                {copiedPath ? (
                  <Check className="size-3 text-brand-text" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Copy path</TooltipContent>
          </Tooltip>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="code-viewer-open-vscode"
            onClick={handleOpenInVSCode}
          >
            <ExternalLink className="size-3" />
            <span>Open in VS Code</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="code-viewer-open-diff"
            onClick={handleOpenDiff}
          >
            <FileDiff className="size-3" />
            <span>Open Diff</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="code-viewer-open-terminal"
            onClick={handleOpenTerminal}
          >
            <Terminal className="size-3" />
            <span>Open Terminal</span>
          </Button>
        </div>

        {/* Code viewport */}
        <ScrollArea className="min-h-0 flex-1">
          <div
            role="region"
            aria-label={`Source code for ${codeSpec.pill}`}
            className="py-2.5 pb-4 font-mono text-xs leading-[1.62]"
          >
            {codeSpec.lines.map((_, index) => {
              const lineNumber = codeSpec.startLine + index;
              const isHighlighted =
                (activeLine ?? codeSpec.defaultLine) === lineNumber;
              const tokens = renderedLines[index] ?? [];

              return (
                <div
                  key={`${codeSpec.pill}-${lineNumber}`}
                  data-line-number={lineNumber}
                  data-highlighted={isHighlighted ? "true" : "false"}
                  onClick={() => openCodeFile(codeSpec.path, lineNumber)}
                  className={cn(
                    "grid cursor-pointer grid-cols-[42px_minmax(0,1fr)] border-l-2 pr-3.5 whitespace-pre transition-colors",
                    isHighlighted
                      ? "border-l-brand bg-brand-softer"
                      : "border-l-transparent hover:bg-hover",
                  )}
                >
                  <span
                    className={cn(
                      "pr-3 pl-2 text-right select-none tabular-nums",
                      isHighlighted
                        ? "font-semibold text-brand-text"
                        : "text-faint",
                    )}
                  >
                    {lineNumber}
                  </span>
                  <span className="overflow-x-visible text-code-plain">
                    {tokens.map((tok, tokenIdx) => (
                      <span
                        key={tokenIdx}
                        className={tok.tokenClass}
                        style={tok.color ? { color: tok.color } : undefined}
                      >
                        {tok.content}
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
  );
}
