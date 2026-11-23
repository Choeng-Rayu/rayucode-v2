import * as React from "react";
import {
  FileCode2,
  FileSpreadsheet,
  FileText,
  Globe,
  Presentation,
} from "lucide-react";

import { TechFileBadge } from "@/components/ui";
import { basenameOf, cn, postToHost, useAppStore } from "@/lib";

export type CitationKind =
  | "code"
  | "browser"
  | "excel"
  | "markdown"
  | "slide"
  | "pdf"
  | "html";

export interface CitationItem {
  label: string;
  file: string;
  line?: number;
  endLine?: number;
  column?: number;
  kind?: CitationKind;
}

export interface ParsedFileLineTarget {
  path: string;
  line?: number;
  endLine?: number;
  column?: number;
}

/**
 * Parses `path/to/file.ts:42`, `path/to/file.rs:10-25`, or `path/to/file.ts#L12-L20`
 * into a clean file path and 1-based line numbers.
 */
export function parseFileLineTarget(raw: string): ParsedFileLineTarget {
  const trimmed = raw.trim().replace(/^`+|`+$/g, "");
  const hashMatch = trimmed.match(/^(.+?)#L(\d+)(?:-L?(\d+))?$/i);
  if (hashMatch) {
    const path = hashMatch[1] ?? trimmed;
    const line = Number.parseInt(hashMatch[2] ?? "1", 10);
    const endLine = hashMatch[3]
      ? Number.parseInt(hashMatch[3], 10)
      : undefined;
    return { path, line, endLine };
  }

  const colonMatch = trimmed.match(
    /^(.+?):(\d+)(?:-(\d+)|:(\d+))?$/,
  );
  if (colonMatch) {
    const path = colonMatch[1] ?? trimmed;
    const line = Number.parseInt(colonMatch[2] ?? "1", 10);
    const endLine = colonMatch[3]
      ? Number.parseInt(colonMatch[3], 10)
      : undefined;
    const column = colonMatch[4]
      ? Number.parseInt(colonMatch[4], 10)
      : undefined;
    return { path, line, endLine, column };
  }

  return { path: trimmed };
}

export interface CiteLinkProps {
  citation: CitationItem;
  onNavigate?: (citation: CitationItem) => void;
  openInInspector?: boolean;
  className?: string;
}

export function CiteLink({
  citation,
  onNavigate,
  openInInspector = false,
  className,
}: CiteLinkProps) {
  const parsed = React.useMemo(
    () => parseFileLineTarget(citation.file),
    [citation.file],
  );
  const resolvedPath = parsed.path;
  const resolvedLine = citation.line ?? parsed.line;
  const resolvedColumn = citation.column ?? parsed.column;
  const kind = citation.kind ?? "code";

  const handleClick = () => {
    const store = useAppStore.getState();

    if (kind === "code") {
      postToHost({
        type: "rayucode.editor.openFile",
        path: resolvedPath,
        line: resolvedLine,
        column: resolvedColumn,
      });
      if (openInInspector || store.inspectorOpen) {
        store.openCodeFile(resolvedPath, resolvedLine ?? null);
      }
    } else if (kind === "browser") {
      if (/^https?:\/\//i.test(resolvedPath)) {
        postToHost({
          type: "rayucode.editor.openSimpleBrowser",
          url: resolvedPath,
        });
      } else {
        store.openRightTab("browser", basenameOf(resolvedPath));
      }
    } else if (kind === "markdown") {
      postToHost({
        type: "rayucode.editor.openFile",
        path: resolvedPath,
        line: resolvedLine,
      });
      store.openRightTab("markdown", basenameOf(resolvedPath));
    } else {
      postToHost({
        type: "rayucode.editor.openFile",
        path: resolvedPath,
        line: resolvedLine,
      });
    }

    onNavigate?.({
      ...citation,
      file: resolvedPath,
      line: resolvedLine,
      column: resolvedColumn,
    });
  };

  const displayLabel =
    citation.label ||
    (resolvedLine
      ? `${basenameOf(resolvedPath)}:${resolvedLine}${
          (citation.endLine ?? parsed.endLine)
            ? `-${citation.endLine ?? parsed.endLine}`
            : ""
        }`
      : basenameOf(resolvedPath));

  return (
    <button
      type="button"
      data-slot="cite-link"
      data-testid={`cite-link-${resolvedPath}${resolvedLine ? `:${resolvedLine}` : ""}`}
      data-cite-kind={kind}
      onClick={handleClick}
      title={`Open ${resolvedPath}${resolvedLine ? `:${resolvedLine}` : ""} in VS Code Editor`}
      className={cn(
        "cite-link inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-[5px] px-1.5 py-0.5 align-baseline font-mono text-[12px] font-medium text-brand-text no-underline transition-colors hover:bg-brand-soft hover:text-brand-bright hover:underline hover:underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {kind === "code" ? (
        <TechFileBadge path={resolvedPath} className="size-3.5 shrink-0" />
      ) : kind === "browser" ? (
        <Globe className="size-3 shrink-0 text-info" aria-hidden="true" />
      ) : kind === "excel" ? (
        <FileSpreadsheet
          className="size-3 shrink-0 text-office-excel"
          aria-hidden="true"
        />
      ) : kind === "markdown" || kind === "pdf" || kind === "html" ? (
        <FileText
          className="size-3 shrink-0 text-code-type"
          aria-hidden="true"
        />
      ) : kind === "slide" ? (
        <Presentation
          className="size-3 shrink-0 text-office-ppt"
          aria-hidden="true"
        />
      ) : (
        <FileCode2
          className="size-3 shrink-0 text-code-fn"
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 truncate">{displayLabel}</span>
    </button>
  );
}
