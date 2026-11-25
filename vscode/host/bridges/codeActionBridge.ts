import type * as vscode from "vscode";
import type {
  ComposerInjectionPayload,
  EditorSelectionView,
} from "../../shared/vscodeProtocol.js";

function getVscode(): typeof vscode {
  return require("vscode") as typeof vscode;
}

export interface DiagnosticLike {
  message: string;
  severity?: number;
  source?: string;
  code?: string | number | { value: string | number };
  range: {
    start: { line: number; character?: number };
    end: { line: number; character?: number };
  };
}

export interface BuildDiagnosticInjectionInput {
  id?: string;
  intent: "fix" | "explain";
  filePath: string;
  relativePath: string;
  languageId?: string;
  diagnostics: readonly DiagnosticLike[];
  documentLines?: readonly string[];
  documentText?: string;
  fallbackRange?: { startLine: number; endLine: number };
  workingDir?: string;
  autoSubmit?: boolean;
  contextPaddingLines?: number;
  maxSnippetChars?: number;
}

const DEFAULT_MAX_DIAGNOSTICS = 5;
const DEFAULT_CONTEXT_PADDING_LINES = 5;
const DEFAULT_MAX_SNIPPET_CHARS = 4_000;

const SEVERITY_ERROR = 0;
const SEVERITY_WARNING = 1;
const SEVERITY_INFO = 2;

function severityLabel(severity: number | undefined): string {
  switch (severity ?? SEVERITY_ERROR) {
    case SEVERITY_ERROR:
      return "Error";
    case SEVERITY_WARNING:
      return "Warning";
    case SEVERITY_INFO:
      return "Info";
    default:
      return "Hint";
  }
}

function formatDiagnosticCode(
  code: DiagnosticLike["code"],
): string | undefined {
  if (typeof code === "string" || typeof code === "number") {
    const str = String(code).trim();
    return str.length > 0 ? str : undefined;
  }
  if (code && typeof code === "object" && "value" in code) {
    const str = String(code.value).trim();
    return str.length > 0 ? str : undefined;
  }
  return undefined;
}

/**
 * Filter and prioritize diagnostics for RayuCode Quick Fixes:
 * - Prefers Error (0) and Warning (1); falls back to Information (2) when none exist.
 * - Sorts by severity ascending, then start line ascending.
 * - Deduplicates by `(startLine, trimmedMessage)`.
 * - Caps to `maxCount` (default 5).
 */
export function selectRelevantDiagnostics<T extends DiagnosticLike>(
  diagnostics: readonly T[],
  maxCount = DEFAULT_MAX_DIAGNOSTICS,
): T[] {
  if (!diagnostics.length || maxCount <= 0) {
    return [];
  }

  const errorsAndWarnings = diagnostics.filter((d) => {
    const sev = d.severity ?? SEVERITY_ERROR;
    return sev === SEVERITY_ERROR || sev === SEVERITY_WARNING;
  });

  const pool =
    errorsAndWarnings.length > 0
      ? errorsAndWarnings
      : diagnostics.filter((d) => d.severity === SEVERITY_INFO);

  if (pool.length === 0) {
    return [];
  }

  const ordered = [...pool].sort((a, b) => {
    const sevDiff =
      (a.severity ?? SEVERITY_ERROR) - (b.severity ?? SEVERITY_ERROR);
    if (sevDiff !== 0) return sevDiff;
    return a.range.start.line - b.range.start.line;
  });

  const seen = new Set<string>();
  const result: T[] = [];
  for (const diag of ordered) {
    const normalizedMessage = diag.message.trim();
    const key = `${diag.range.start.line}:${normalizedMessage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diag);
    if (result.length >= maxCount) break;
  }

  return result;
}

function buildBoundedSnippet(
  allLines: readonly string[],
  minLine0: number,
  maxLine0: number,
  paddingLines: number,
  maxChars: number,
): string {
  if (allLines.length === 0 || maxChars <= 0) {
    return "";
  }
  const start0 = Math.max(0, minLine0 - paddingLines);
  const end0 = Math.min(allLines.length - 1, maxLine0 + paddingLines);
  if (start0 > end0) {
    return "";
  }

  const numbered: string[] = [];
  for (let i = start0; i <= end0; i += 1) {
    numbered.push(`${i + 1}: ${allLines[i] ?? ""}`);
  }
  const joined = numbered.join("\n");
  if (joined.length <= maxChars) {
    return joined;
  }

  const suffix = "\n... (truncated)";
  if (maxChars <= suffix.length) {
    return joined.slice(0, maxChars);
  }
  return `${joined.slice(0, maxChars - suffix.length)}${suffix}`;
}

/**
 * Pure builder producing a typed `ComposerInjectionPayload` for
 * `Fix with RayuCode` and `Explain error with RayuCode` diagnostic actions.
 */
export function buildDiagnosticInjection(
  input: BuildDiagnosticInjectionInput,
): ComposerInjectionPayload {
  const selected = selectRelevantDiagnostics(
    input.diagnostics,
    DEFAULT_MAX_DIAGNOSTICS,
  );

  let minLine0 = 0;
  let maxLine0 = 0;
  if (selected.length > 0) {
    minLine0 = Math.min(...selected.map((d) => Math.max(0, d.range.start.line)));
    maxLine0 = Math.max(
      ...selected.map((d) =>
        Math.max(0, d.range.start.line, d.range.end.line),
      ),
    );
  } else if (input.fallbackRange) {
    minLine0 = Math.max(0, input.fallbackRange.startLine);
    maxLine0 = Math.max(minLine0, input.fallbackRange.endLine);
  }

  const lineStart = minLine0 + 1;
  const lineEnd = Math.max(lineStart, maxLine0 + 1);
  const lineRangeLabel =
    lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}-L${lineEnd}`;

  const allLines =
    input.documentLines ??
    (input.documentText !== undefined ? input.documentText.split(/\r?\n/) : []);
  const snippet = buildBoundedSnippet(
    allLines,
    minLine0,
    maxLine0,
    input.contextPaddingLines ?? DEFAULT_CONTEXT_PADDING_LINES,
    input.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS,
  );

  const diagLines = selected.map((d) => {
    const sev = severityLabel(d.severity);
    const code = formatDiagnosticCode(d.code);
    const metaParts = [d.source?.trim(), code].filter(Boolean);
    const meta = metaParts.length > 0 ? ` (${metaParts.join(" ")})` : "";
    const diagLine = Math.max(0, d.range.start.line) + 1;
    return `- [${sev}]${meta} L${diagLine}: ${d.message.trim()}`;
  });

  const heading =
    input.intent === "fix"
      ? `Fix the diagnostic${selected.length === 1 ? "" : "s"} in \`${input.relativePath}\` (${lineRangeLabel}):`
      : `Explain the root cause and fix for the diagnostic${selected.length === 1 ? "" : "s"} in \`${input.relativePath}\` (${lineRangeLabel}):`;

  const promptSections = [heading];
  if (diagLines.length > 0) {
    promptSections.push(diagLines.join("\n"));
  }
  if (snippet) {
    const lang = input.languageId?.trim() || "";
    promptSections.push(`\`\`\`${lang}\n${snippet}\n\`\`\``);
  }

  const selection: EditorSelectionView = {
    filePath: input.filePath,
    relativePath: input.relativePath,
    languageId: input.languageId,
    lineStart,
    lineEnd,
    lineCount: lineEnd - lineStart + 1,
    selectedText: snippet || undefined,
  };

  return {
    id:
      input.id ??
      `diag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mentions: input.relativePath ? [input.relativePath] : undefined,
    prompt: promptSections.join("\n\n"),
    mode: "append",
    selection,
    workingDir: input.workingDir,
    autoSubmit: input.autoSubmit ?? false,
    sourceLabel: input.intent === "fix" ? "Quick Fix" : "Explain Error",
  };
}

/**
 * Provides non-preferred Quick Fix actions (`Fix with RayuCode` and
 * `Explain error with RayuCode`) whenever diagnostics exist on the cursor/selection range.
 */
export class RayuCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (context.diagnostics.length === 0) {
      return [];
    }

    const selected = selectRelevantDiagnostics(
      context.diagnostics,
      DEFAULT_MAX_DIAGNOSTICS,
    );
    if (selected.length === 0) {
      return [];
    }

    const vscodeApi = getVscode();

    const fixAction = new vscodeApi.CodeAction(
      "Fix with RayuCode",
      vscodeApi.CodeActionKind.QuickFix,
    );
    fixAction.isPreferred = false;
    fixAction.diagnostics = selected;
    fixAction.command = {
      command: "rayucode.fixDiagnostic",
      title: "Fix with RayuCode",
      arguments: [document.uri, range, selected],
    };

    const explainAction = new vscodeApi.CodeAction(
      "Explain error with RayuCode",
      vscodeApi.CodeActionKind.QuickFix,
    );
    explainAction.isPreferred = false;
    explainAction.diagnostics = selected;
    explainAction.command = {
      command: "rayucode.explainDiagnostic",
      title: "Explain error with RayuCode",
      arguments: [document.uri, range, selected],
    };

    return [fixAction, explainAction];
  }
}
