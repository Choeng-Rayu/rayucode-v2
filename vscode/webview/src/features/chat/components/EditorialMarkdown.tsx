import * as React from "react";
import {
  Check,
  Code2,
  Copy,
  Eye,
  FileDiff,
  Folder,
  Network,
  TextCursorInput,
} from "lucide-react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { MermaidDiagramSvg, TechFileBadge } from "@/components/ui";
import {
  classifyInlineCode,
  cn,
  highlightCodeLines,
  layoutMermaidFlowchart,
  postToHost,
  tokenizeCodeLine,
  useAppStore,
  type HighlightedToken,
  type InlineCodeCategory,
} from "@/lib";

import { CiteLink, parseFileLineTarget } from "./CiteLink";

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  depth?: number;
  ordered?: boolean;
  lang?: string | null;
  align?: Array<"left" | "right" | "center" | null>;
  children?: MdastNode[];
}

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

function getInlineCodeClasses(category: InlineCodeCategory): string {
  switch (category) {
    case "folder":
    case "file-ts":
    case "file-rust":
    case "file-doc":
    case "file-data":
      return "text-brand-text hover:bg-brand-soft/60";
    case "component":
    case "command":
    case "symbol":
    default:
      return "bg-hover/55 text-ink";
  }
}

function getLanguageBadgeClass(_lang?: string | null): string {
  return "text-muted-ink bg-active/70";
}

function CodeBlockView({
  value,
  lang,
}: {
  value: string;
  lang?: string | null;
}) {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const [copied, setCopied] = React.useState(false);
  const [shikiTokens, setShikiTokens] = React.useState<HighlightedToken[][] | null>(
    null,
  );
  const lines = React.useMemo(() => value.split(/\r?\n/), [value]);
  const langLabel = lang?.trim() || "code";

  React.useEffect(() => {
    let cancelled = false;
    void highlightCodeLines(lines, langLabel, resolvedTheme)
      .then((tokens) => {
        if (!cancelled && tokens.length === lines.length) {
          setShikiTokens(tokens);
        }
      })
      .catch(() => {
        // Fallback to instant synchronous tokenizeCodeLine
      });
    return () => {
      cancelled = true;
    };
  }, [lines, langLabel, resolvedTheme]);

  const handleCopy = async () => {
    postToHost({ type: "rayucode.editor.copy", text: value });
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
    } catch {
      // ignore clipboard errors in restricted webview contexts
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const handleInsertAtCursor = () => {
    postToHost({
      type: "rayucode.editor.insertCode",
      code: value,
      mode: "cursor",
      languageId: langLabel,
    });
  };

  const handleApplyAsDiff = () => {
    postToHost({
      type: "rayucode.editor.insertCode",
      code: value,
      mode: "diff",
      languageId: langLabel,
    });
  };

  return (
    <div
      data-slot="markdown-code-block"
      className="my-1.5 overflow-hidden rounded-xl border border-hairline bg-inset/80"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline-soft bg-pane/50 px-3 py-1.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-[11px] font-medium",
            getLanguageBadgeClass(lang),
          )}
        >
          {langLabel}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="code-block-insert-cursor"
            onClick={handleInsertAtCursor}
            title="Insert code at active VS Code cursor"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <TextCursorInput className="size-3" aria-hidden="true" />
            <span>Insert at Cursor</span>
          </button>

          <button
            type="button"
            data-testid="code-block-apply-diff"
            onClick={handleApplyAsDiff}
            title="Compare or apply as diff against active VS Code editor"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <FileDiff className="size-3" aria-hidden="true" />
            <span>Apply as Diff</span>
          </button>

          <button
            type="button"
            data-testid="code-block-copy"
            onClick={() => void handleCopy()}
            aria-label="Copy code"
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-ink transition-colors hover:bg-hover hover:text-ink",
              copied && "text-brand-text",
            )}
          >
            {copied ? (
              <>
                <Check className="size-3" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      <pre className="m-0 max-h-[320px] overflow-auto px-3.5 py-3 font-mono text-[12.2px] leading-[1.6] tabular-nums">
        <code>
          {lines.map((line, lineIdx) => {
            const shikiLine = shikiTokens?.[lineIdx];
            if (shikiLine) {
              return (
                <span key={lineIdx} className="block">
                  {shikiLine.map((tok, tokIdx) => (
                    <span
                      key={tokIdx}
                      className={tok.tokenClass}
                      style={tok.color ? { color: tok.color } : undefined}
                    >
                      {tok.content}
                    </span>
                  ))}
                </span>
              );
            }
            return (
              <span key={lineIdx} className="block">
                {tokenizeCodeLine(line).map((tok, tokIdx) => (
                  <span key={tokIdx} className={tok.className}>
                    {tok.text}
                  </span>
                ))}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

function isMermaidCodeBlock(value: string, lang?: string | null): boolean {
  const lower = (lang ?? "").trim().toLowerCase();
  if (lower === "mermaid" || lower === "mmd") {
    return true;
  }
  if (!lower || lower === "text" || lower === "txt") {
    return /^(?:flowchart|graph)\s+(?:LR|RL|TD|TB|BT)\b/im.test(value.trim());
  }
  return false;
}

function isDiagramInlineToken(raw: string): boolean {
  const trimmed = raw.trim();
  return (
    /\.(?:mmd|mermaid)$/i.test(trimmed) ||
    /^(?:flowchart(?:\s+(?:LR|RL|TD|TB|BT))?|mermaid(?:\s+diagram)?|architecture\s+diagram|diagram)$/i.test(
      trimmed,
    )
  );
}

function findFirstMermaidInTree(node: MdastNode): string | null {
  if (node.type === "code" && isMermaidCodeBlock(node.value ?? "", node.lang)) {
    return node.value ?? null;
  }
  if (node.children) {
    for (const child of node.children) {
      const found = findFirstMermaidInTree(child);
      if (found) return found;
    }
  }
  return null;
}

function MermaidCodeBlockCard({ value }: { value: string }) {
  const [viewMode, setViewMode] = React.useState<"preview" | "code">("preview");
  const [copied, setCopied] = React.useState(false);
  const layout = React.useMemo(() => layoutMermaidFlowchart(value), [value]);
  const lines = React.useMemo(() => value.split(/\r?\n/), [value]);

  const handleCopy = async () => {
    postToHost({ type: "rayucode.editor.copy", text: value });
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
    } catch {
      // ignore clipboard errors
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      data-slot="markdown-mermaid-block"
      data-view-mode={viewMode}
      className="my-1.5 overflow-hidden rounded-[12px] border border-premium bg-pane shadow-bevel-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline-soft bg-inset/80 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-pill-edit-bg px-2 py-0.5 font-mono text-[10.5px] font-medium tracking-wide text-code-type uppercase">
            <Network className="size-3 shrink-0" aria-hidden="true" />
            <span>mermaid</span>
          </span>
          <span className="truncate text-xs font-medium text-ink">
            {layout.title}
          </span>
          <span className="hidden font-mono text-[10px] text-muted-ink sm:inline">
            {layout.direction}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div
            role="tablist"
            aria-label="Diagram view mode"
            className="inline-flex items-center rounded-md border border-hairline bg-pane p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "preview"}
              data-testid="inline-mermaid-preview-btn"
              onClick={() => setViewMode("preview")}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-xs px-2 py-0.5 text-[11px] font-medium transition-colors",
                viewMode === "preview"
                  ? "bg-active text-ink shadow-xs"
                  : "text-muted-ink hover:text-ink",
              )}
            >
              <Eye className="size-3" aria-hidden="true" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "code"}
              data-testid="inline-mermaid-code-btn"
              onClick={() => setViewMode("code")}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-xs px-2 py-0.5 text-[11px] font-medium transition-colors",
                viewMode === "code"
                  ? "bg-active text-ink shadow-xs"
                  : "text-muted-ink hover:text-ink",
              )}
            >
              <Code2 className="size-3" aria-hidden="true" />
              <span>Code</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy Mermaid diagram source"
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-ink transition-colors hover:bg-hover hover:text-ink",
              copied && "text-brand-text",
            )}
          >
            {copied ? (
              <>
                <Check className="size-3" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {viewMode === "preview" ? (
        <div className="p-2">
          <MermaidDiagramSvg source={value} />
        </div>
      ) : (
        <pre className="m-0 max-h-[320px] overflow-auto bg-inset px-3.5 py-3 font-mono text-[12.2px] leading-[1.6] tabular-nums">
          <code>
            {lines.map((line, lineIdx) => (
              <span key={lineIdx} className="block">
                {tokenizeCodeLine(line).map((tok, tokIdx) => (
                  <span key={tokIdx} className={tok.className}>
                    {tok.text}
                  </span>
                ))}
              </span>
            ))}
          </code>
        </pre>
      )}
    </div>
  );
}

const AT_FILE_MENTION_RE =
  /(^|[\s([{"'])(@[A-Za-z0-9._\\/-]+(?::\d+(?:-\d+|:\d+)?|#L\d+(?:-L?\d+)?)?)/g;

function isLocalhostBrowserUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "0.0.0.0" ||
        parsed.hostname === "::1")
    );
  } catch {
    return false;
  }
}

function renderTextWithFileMentions(
  text: string,
  keyPrefix: string,
): React.ReactNode {
  if (!text.includes("@")) {
    return text;
  }
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchIdx = 0;
  AT_FILE_MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AT_FILE_MENTION_RE.exec(text)) !== null) {
    const lead = match[1] ?? "";
    const rawToken = match[2] ?? "";
    const trimmedToken = rawToken.replace(/[.,;!?)]+$/, "");
    const trailingPunct = rawToken.slice(trimmedToken.length);
    const category = classifyInlineCode(trimmedToken);
    const isFileMention =
      category === "file-ts" ||
      category === "file-rust" ||
      category === "file-doc" ||
      category === "file-data";
    if (!isFileMention) continue;

    const tokenStart = match.index + lead.length;
    if (tokenStart > lastIndex) {
      nodes.push(text.slice(lastIndex, tokenStart));
    }
    const parsed = parseFileLineTarget(trimmedToken);
    nodes.push(
      <CiteLink
        key={`${keyPrefix}-mention-${matchIdx++}`}
        citation={{
          label: trimmedToken,
          file: parsed.path,
          line: parsed.line,
          endLine: parsed.endLine,
          column: parsed.column,
          kind:
            category === "file-doc"
              ? "markdown"
              : category === "file-data" && /\.(xlsx|csv)$/i.test(parsed.path)
                ? "excel"
                : "code",
        }}
      />,
    );
    if (trailingPunct) {
      nodes.push(trailingPunct);
    }
    lastIndex = match.index + match[0].length;
  }

  if (nodes.length === 0) return text;
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return <React.Fragment key={keyPrefix}>{nodes}</React.Fragment>;
}

function renderMdastChildren(
  nodes: MdastNode[] | undefined,
  keyPrefix: string,
  contextDiagramSource: string | null,
  insideLink = false,
): React.ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, index) =>
    renderMdastNode(
      node,
      `${keyPrefix}-${index}`,
      contextDiagramSource,
      insideLink,
    ),
  );
}

function renderMdastNode(
  node: MdastNode,
  key: string,
  contextDiagramSource: string | null,
  insideLink = false,
): React.ReactNode {
  switch (node.type) {
    case "root":
      return (
        <React.Fragment key={key}>
          {renderMdastChildren(node.children, key, contextDiagramSource, insideLink)}
        </React.Fragment>
      );
    case "paragraph":
      return (
        <p key={key} className="rayu-prose m-0 max-w-[72ch] text-body">
          {renderMdastChildren(node.children, key, contextDiagramSource, insideLink)}
        </p>
      );
    case "heading": {
      if (node.depth && node.depth <= 2) {
        return (
          <h3
            key={key}
            className="mt-4 mb-0.5 text-[15.5px] font-semibold tracking-tight text-ink"
          >
            {renderMdastChildren(node.children, key, contextDiagramSource, insideLink)}
          </h3>
        );
      }
      return (
        <h4
          key={key}
          className="mt-2.5 -mb-0.5 text-[14.5px] font-semibold tracking-tight text-ink"
        >
          {renderMdastChildren(node.children, key, contextDiagramSource, insideLink)}
        </h4>
      );
    }
    case "strong":
      return (
        <strong key={key} className="font-semibold text-ink">
          {renderMdastChildren(node.children, key, contextDiagramSource, insideLink)}
        </strong>
      );
    case "emphasis":
      return (
        <em key={key} className="italic">
          {renderMdastChildren(node.children, key, contextDiagramSource, insideLink)}
        </em>
      );
    case "delete":
      return (
        <del key={key} className="text-muted-ink line-through">
          {renderMdastChildren(node.children, key, contextDiagramSource, insideLink)}
        </del>
      );
    case "inlineCode": {
      const value = node.value ?? "";
      if (insideLink) {
        return (
          <code
            key={key}
            className="font-mono text-[0.92em] break-all"
          >
            {value}
          </code>
        );
      }
      if (isDiagramInlineToken(value)) {
        return (
          <code
            key={key}
            data-code-kind="diagram"
            className="inline-flex max-w-full items-center gap-1 rounded px-1 py-[0.5px] text-left align-baseline font-mono text-[0.88em] font-medium break-all text-code-type"
          >
            <Network className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-all">{value}</span>
          </code>
        );
      }

      const category = classifyInlineCode(value);
      const isClickableFile =
        category === "file-ts" ||
        category === "file-rust" ||
        category === "file-doc" ||
        category === "file-data";

      if (isClickableFile) {
        const parsed = parseFileLineTarget(value);
        return (
          <CiteLink
            key={key}
            citation={{
              label: value,
              file: parsed.path,
              line: parsed.line,
              endLine: parsed.endLine,
              column: parsed.column,
              kind:
                category === "file-doc"
                  ? "markdown"
                  : category === "file-data" && /\.(xlsx|csv)$/i.test(parsed.path)
                    ? "excel"
                    : "code",
            }}
          />
        );
      }

      if (category === "folder") {
        return (
          <code
            key={key}
            data-code-kind="folder"
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded px-1 py-[0.5px] text-left align-baseline font-mono text-[0.88em] font-medium break-all",
              getInlineCodeClasses(category),
            )}
          >
            <Folder className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-all">{value}</span>
          </code>
        );
      }

      return (
        <code
          key={key}
          data-code-kind={category}
          className={cn(
            "inline-flex max-w-full items-center rounded px-1 py-[0.5px] align-baseline font-mono text-[0.88em] break-all",
            getInlineCodeClasses(category),
          )}
        >
          <span className="min-w-0 break-all">{value}</span>
        </code>
      );
    }
    case "code": {
      const rawValue = node.value ?? "";
      if (isMermaidCodeBlock(rawValue, node.lang)) {
        return <MermaidCodeBlockCard key={key} value={rawValue} />;
      }
      return <CodeBlockView key={key} value={rawValue} lang={node.lang} />;
    }
    case "table": {
      const rows = node.children ?? [];
      const [headerRow, ...bodyRows] = rows;
      const alignList = node.align ?? [];
      const isNumericCell = (cell?: MdastNode): boolean => {
        if (!cell?.children?.length) return false;
        const text = cell.children
          .map((c) => c.value ?? "")
          .join("")
          .trim();
        return /^[$€£¥+\-−]?\d[\d,._]*%?$/.test(text);
      };
      const numericCols = (headerRow?.children ?? []).map((_, cIdx) => {
        if (alignList[cIdx] === "right") return true;
        if (alignList[cIdx] === "left" || alignList[cIdx] === "center") {
          return false;
        }
        return (
          bodyRows.length > 0 &&
          bodyRows.every((r) => isNumericCell(r.children?.[cIdx]))
        );
      });
      return (
        <div
          key={key}
          data-slot="markdown-table"
          className="my-2 overflow-x-auto"
        >
          <table className="w-full border-collapse text-left text-[13.5px] leading-[1.6] tabular-nums">
            {headerRow ? (
              <thead>
                <tr className="border-b border-hairline">
                  {(headerRow.children ?? []).map((cell, cIdx) => (
                    <th
                      key={`${key}-th-${cIdx}`}
                      className={cn(
                        "py-2.5 pr-5 pl-0 text-[13px] font-semibold text-ink last:pr-0",
                        (alignList[cIdx] === "right" || numericCols[cIdx]) &&
                          "text-right",
                        alignList[cIdx] === "center" && "text-center",
                      )}
                    >
                      {renderMdastChildren(
                        cell.children,
                        `${key}-th-${cIdx}`,
                        contextDiagramSource,
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            {bodyRows.length > 0 ? (
              <tbody className="divide-y divide-hairline-soft">
                {bodyRows.map((row, rIdx) => (
                  <tr key={`${key}-tr-${rIdx}`}>
                    {(row.children ?? []).map((cell, cIdx) => (
                      <td
                        key={`${key}-td-${rIdx}-${cIdx}`}
                        className={cn(
                          "py-3 pr-5 pl-0 align-top text-body last:pr-0",
                          (alignList[cIdx] === "right" || numericCols[cIdx]) &&
                            "text-right font-mono text-[13px] text-ink",
                          alignList[cIdx] === "center" && "text-center",
                        )}
                      >
                        {renderMdastChildren(
                          cell.children,
                          `${key}-td-${rIdx}-${cIdx}`,
                          contextDiagramSource,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
      );
    }
    case "list":
      if (node.ordered) {
        return (
          <ol
            key={key}
            className="rayu-prose m-0 flex max-w-[72ch] list-decimal flex-col gap-2 pl-5 text-body marker:font-medium marker:text-muted-ink"
          >
            {renderMdastChildren(node.children, key, contextDiagramSource)}
          </ol>
        );
      }
      return (
        <ul
          key={key}
          className="rayu-prose m-0 flex max-w-[72ch] list-disc flex-col gap-2 pl-5 text-body marker:text-muted-ink"
        >
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </ul>
      );
    case "listItem":
      return (
        <li key={key} className="pl-0.5 text-body">
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </li>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="m-0 border-l-2 border-hairline-strong py-0.5 pl-3.5 text-[13.5px] leading-[1.6] text-muted-ink"
        >
          {renderMdastChildren(node.children, key, contextDiagramSource)}
        </blockquote>
      );
    case "link": {
      const href = (node.url ?? "").trim();
      const isLocalFile =
        Boolean(href) &&
        !href.startsWith("#") &&
        !href.startsWith("http://") &&
        !href.startsWith("https://") &&
        !href.startsWith("mailto:");
      if (isLocalFile) {
        const parsed = parseFileLineTarget(href);
        return <CiteLink key={key} citation={{
          file: parsed.path,
          label: node.children?.map((child) => child.value ?? "").join("") || parsed.path,
          line: parsed.line,
          column: parsed.column,
        }} />;
      }
      const opensInSimpleBrowser = isLocalhostBrowserUrl(href);
      return (
        <a
          key={key}
          href={href || "#"}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (href.startsWith("http://") || href.startsWith("https://")) {
              e.preventDefault();
              if (opensInSimpleBrowser) {
                postToHost({
                  type: "rayucode.editor.openSimpleBrowser",
                  url: href,
                });
              } else {
                postToHost({ type: "rayucode.editor.openExternal", url: href });
              }
            }
          }}
          title={
            opensInSimpleBrowser
              ? `Open ${href} in VS Code Simple Browser`
              : undefined
          }
          className="font-medium text-code-fn underline-offset-3 hover:text-brand-bright hover:underline"
        >
          {renderMdastChildren(node.children, key, contextDiagramSource, true)}
        </a>
      );
    }
    case "break":
      return <br key={key} />;
    case "thematicBreak":
      return <hr key={key} className="my-2 border-hairline" />;
    case "text":
      if (insideLink) {
        return <React.Fragment key={key}>{node.value ?? ""}</React.Fragment>;
      }
      return (
        <React.Fragment key={key}>
          {renderTextWithFileMentions(node.value ?? "", key)}
        </React.Fragment>
      );
    default:
      if (node.children) {
        return (
          <React.Fragment key={key}>
            {renderMdastChildren(node.children, key, contextDiagramSource)}
          </React.Fragment>
        );
      }
      return <React.Fragment key={key}>{node.value ?? ""}</React.Fragment>;
  }
}

export interface EditorialMarkdownProps {
  content: string;
  inline?: boolean;
  className?: string;
}

export function EditorialMarkdown({
  content,
  inline = false,
  className,
}: EditorialMarkdownProps) {
  const tree = React.useMemo(
    () => markdownProcessor.parse(content) as unknown as MdastNode,
    [content],
  );
  const contextDiagramSource = React.useMemo(
    () => findFirstMermaidInTree(tree),
    [tree],
  );

  if (inline) {
    const firstChild = tree.children?.[0];
    if (
      tree.children?.length === 1 &&
      firstChild?.type === "paragraph" &&
      firstChild.children
    ) {
      return (
        <span className={cn("rayu-prose", className)}>
          {renderMdastChildren(
            firstChild.children,
            "md-inline",
            contextDiagramSource,
          )}
        </span>
      );
    }
  }

  return (
    <div
      data-slot="editorial-markdown"
      className={cn(
        "rayu-prose flex min-w-0 flex-col gap-3 break-words",
        className,
      )}
    >
      {renderMdastNode(tree, "md-root", contextDiagramSource)}
    </div>
  );
}
