import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as vscode from "vscode";
import type { EditorSelectionView } from "../../shared/vscodeProtocol.js";

function getVscode(): typeof vscode {
  return require("vscode") as typeof vscode;
}

const SELECTION_DEBOUNCE_MS = 150;
const MAX_SELECTION_CHARS = 32_000;
export const ORIGINAL_DIFF_SCHEME = "rayucode-original";

/**
 * Pure helper resolving which editor column should host code files/diffs
 * without overwriting RayuCode's own editor tab.
 */
export function resolveTargetCodeColumn(
  lastTextEditorColumn: number | undefined,
  panelColumn: number | undefined,
): number {
  if (
    lastTextEditorColumn !== undefined &&
    lastTextEditorColumn > 0 &&
    lastTextEditorColumn !== panelColumn
  ) {
    return lastTextEditorColumn;
  }
  if (panelColumn === 1) {
    return 2;
  }
  return 1;
}

interface TrackedDiffTab {
  path: string;
  sessionId?: string;
  scope?: "session" | "git";
  leftKey: string;
  leftUri: vscode.Uri;
  rightKey?: string;
  rightUri?: vscode.Uri;
}

class VirtualDiffDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly uris = new Map<string, vscode.Uri>();
  private readonly emitter: vscode.EventEmitter<vscode.Uri>;
  readonly onDidChange: vscode.Event<vscode.Uri>;

  constructor() {
    const vscodeApi = getVscode();
    this.emitter = new vscodeApi.EventEmitter<vscode.Uri>();
    this.onDidChange = this.emitter.event;
  }

  set(key: string, content: string, displayName: string): vscode.Uri {
    const vscodeApi = getVscode();
    const safeName = encodeURIComponent(path.basename(displayName) || "document");
    const uri = vscodeApi.Uri.parse(
      `${ORIGINAL_DIFF_SCHEME}:/${safeName}?${encodeURIComponent(key)}`,
    );
    this.contents.set(key, content);
    this.uris.set(key, uri);
    this.emitter.fire(uri);
    return uri;
  }

  update(key: string, content: string): boolean {
    const uri = this.uris.get(key);
    if (!uri) return false;
    this.contents.set(key, content);
    this.emitter.fire(uri);
    return true;
  }

  delete(key: string): void {
    this.contents.delete(key);
    this.uris.delete(key);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = decodeURIComponent(uri.query);
    return this.contents.get(key) ?? "";
  }

  dispose(): void {
    this.contents.clear();
    this.uris.clear();
    this.emitter.dispose();
  }
}

function isAbsolutePath(filePath: string): boolean {
  return (
    filePath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(filePath) ||
    filePath.startsWith("\\\\")
  );
}

const BINARY_VIEWER_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".pdf",
  ".xlsx",
  ".xls",
  ".xlsm",
  ".pptx",
  ".ppt",
  ".docx",
  ".doc",
  ".zip",
  ".tar",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

const FIND_FILES_EXCLUDE_GLOB =
  "**/{node_modules,.git,dist,target,.next,build,coverage,.turbo}/**";

export interface SanitizedFileOpenTarget {
  path: string;
  line?: number;
  column?: number;
}

/**
 * Normalizes a raw file reference from markdown, citations, or user pills:
 * strips quotes/backticks, leading `@`, `file://` scheme, percent-encoding,
 * and trailing `:line`, `:line-end`, `:line:col`, or `#Lline-Lend` suffixes.
 */
export function sanitizeFileOpenTarget(rawPath: string): SanitizedFileOpenTarget {
  let text = rawPath.trim().replace(/^[`'"<]+|[`'">,;.!?]+$/g, "");
  if (text.startsWith("@") && !text.startsWith("@/")) {
    text = text.slice(1);
  }

  let line: number | undefined;
  let column: number | undefined;

  const hashMatch = text.match(/^(.+?)#L(\d+)(?:-L?\d+)?$/i);
  if (hashMatch && hashMatch[1]) {
    text = hashMatch[1];
    line = Number.parseInt(hashMatch[2] ?? "1", 10);
  } else {
    const colonMatch = text.match(/^(.+?):(\d+)(?:-(\d+)|:(\d+))?$/);
    if (colonMatch && colonMatch[1] && !/^[A-Za-z]$/.test(colonMatch[1])) {
      text = colonMatch[1];
      line = Number.parseInt(colonMatch[2] ?? "1", 10);
      if (colonMatch[4]) {
        column = Number.parseInt(colonMatch[4], 10);
      }
    }
  }

  if (/^file:\/\//i.test(text)) {
    let withoutScheme = text.replace(/^file:\/\//i, "");
    try {
      withoutScheme = decodeURIComponent(withoutScheme);
    } catch {
      // keep raw path if malformed escape sequence
    }
    // Windows file:///C:/path -> C:/path
    if (/^\/[A-Za-z]:[\\/]/.test(withoutScheme)) {
      withoutScheme = withoutScheme.slice(1);
    }
    text = withoutScheme;
  } else if (text.includes("%20")) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // keep raw path
    }
  }

  // Normalize leading ./ on relative paths
  while (text.startsWith("./") || text.startsWith(".\\")) {
    text = text.slice(2);
  }

  return {
    path: text.trim(),
    ...(line !== undefined && Number.isFinite(line) && line > 0 ? { line } : {}),
    ...(column !== undefined && Number.isFinite(column) && column > 0
      ? { column }
      : {}),
  };
}

/**
 * Pure helper generating ordered filesystem candidate paths for a file mention
 * given candidate root directories (active session workingDir, workspace folders,
 * and active editor directory). Handles:
 * - `~` / `~/...`
 * - absolute paths
 * - root-relative paths
 * - workspace-folder-name-prefixed paths (e.g. `rayucode-v2/desktop/MIGRATION_PLAN.md`
 *   when root is `/home/rayu/rayu/rayucode-v2`)
 * - sibling/parent-relative paths (`path.dirname(root)` + `rel`)
 */
export function buildFilePathCandidates(
  rawPath: string,
  roots: readonly string[],
): string[] {
  const { path: clean } = sanitizeFileOpenTarget(rawPath);
  if (!clean) return [];

  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  if (clean === "~") {
    add(os.homedir());
    return candidates;
  }
  if (clean.startsWith("~/") || clean.startsWith("~\\")) {
    add(path.join(os.homedir(), clean.slice(2)));
    return candidates;
  }
  if (isAbsolutePath(clean)) {
    add(clean);
    return candidates;
  }

  const normalizedRel = clean.replace(/\\/g, "/");
  for (const rawRoot of roots) {
    const root = rawRoot.trim();
    if (!root) continue;

    // 1. Direct root-relative match
    add(path.join(root, normalizedRel));

    // 2. Strip leading workspace folder name prefix (e.g. `rayucode-v2/how-to-run.md`)
    const rootBase = path.basename(root);
    if (
      rootBase &&
      normalizedRel.length > rootBase.length + 1 &&
      normalizedRel.slice(0, rootBase.length).toLowerCase() ===
        rootBase.toLowerCase() &&
      normalizedRel[rootBase.length] === "/"
    ) {
      add(path.join(root, normalizedRel.slice(rootBase.length + 1)));
    }

    // 3. Parent directory fallback (when AI prefixes the repo folder name)
    const parent = path.dirname(root);
    if (parent && parent !== root) {
      add(path.join(parent, normalizedRel));
    }
  }

  return candidates;
}

/**
 * Pure helper ranking workspace `findFiles` matches for a file mention.
 * Prefers exact suffix matches, matches inside `preferredDirs`, shallower paths,
 * and deterministic alphabetical ordering.
 */
export function rankWorkspaceFileMatches(
  rawTarget: string,
  candidatePaths: readonly string[],
  preferredDirs: readonly string[] = [],
): string[] {
  const { path: clean } = sanitizeFileOpenTarget(rawTarget);
  const targetNorm = clean.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  const targetBase = path.posix.basename(targetNorm);
  const targetSegments = targetNorm.split("/").filter(Boolean);
  const strippedFirst =
    targetSegments.length > 1 ? targetSegments.slice(1).join("/") : "";
  const normPreferred = preferredDirs
    .map((d) => d.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase())
    .filter(Boolean);

  const scored = candidatePaths.map((fsPath) => {
    const norm = fsPath.replace(/\\/g, "/").toLowerCase();
    let score = 0;
    if (norm === targetNorm || norm.endsWith(`/${targetNorm}`)) {
      score += 1000;
    } else if (
      strippedFirst &&
      (norm === strippedFirst || norm.endsWith(`/${strippedFirst}`))
    ) {
      score += 800;
    } else if (path.posix.basename(norm) === targetBase) {
      score += 500;
    }

    for (let i = 0; i < normPreferred.length; i += 1) {
      const pref = normPreferred[i]!;
      if (norm === pref || norm.startsWith(`${pref}/`)) {
        score += 120 - Math.min(i * 20, 80);
        break;
      }
    }

    const depth = norm.split("/").length;
    return { fsPath, score, depth };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.depth - b.depth ||
      a.fsPath.localeCompare(b.fsPath),
  );
  return scored.map((entry) => entry.fsPath);
}

/**
 * Normalizes a browser URL entered by a user or passed from the webview,
 * prepending `http://` when no scheme is specified (e.g. `localhost:3000`).
 */
export function normalizeBrowserUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function escapeGlobPattern(segment: string): string {
  return segment.replace(/[\[\]{}()*?!]/g, "\\$&");
}

function isExistingRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveWorkspaceFileUri(
  targetPath: string,
  baseDir?: string,
): vscode.Uri | null {
  const vscodeApi = getVscode();
  const { path: clean } = sanitizeFileOpenTarget(targetPath);
  if (!clean) return null;

  const roots: string[] = [];
  if (baseDir?.trim()) roots.push(baseDir.trim());
  for (const folder of vscodeApi.workspace.workspaceFolders ?? []) {
    roots.push(folder.uri.fsPath);
  }

  const candidates = buildFilePathCandidates(clean, roots);
  for (const candidate of candidates) {
    if (isExistingRegularFile(candidate)) {
      return vscodeApi.Uri.file(candidate);
    }
  }

  if (clean === "~") {
    return vscodeApi.Uri.file(os.homedir());
  }
  if (clean.startsWith("~/") || clean.startsWith("~\\")) {
    return vscodeApi.Uri.joinPath(
      vscodeApi.Uri.file(os.homedir()),
      clean.slice(2).replace(/\\/g, "/"),
    );
  }
  if (isAbsolutePath(clean)) {
    return vscodeApi.Uri.file(clean);
  }
  if (baseDir?.trim()) {
    return vscodeApi.Uri.file(path.resolve(baseDir.trim(), clean));
  }
  const primaryFolder = vscodeApi.workspace.workspaceFolders?.[0];
  if (!primaryFolder) {
    return vscodeApi.Uri.file(path.resolve(clean));
  }
  return vscodeApi.Uri.joinPath(primaryFolder.uri, clean);
}

export class EditorBridge implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly diffProvider = new VirtualDiffDocumentProvider();
  private readonly openDiffTabs = new Map<string, TrackedDiffTab>();
  private readonly terminals = new Map<string, vscode.Terminal>();
  private lastActiveEditor: vscode.TextEditor | undefined;
  private lastTextEditorColumn: vscode.ViewColumn | undefined;
  private panelViewColumnResolver:
    | (() => vscode.ViewColumn | undefined)
    | undefined;
  private currentSelection: EditorSelectionView | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastBrowserUrl = "http://localhost:3000";

  constructor(
    private readonly onSelectionChanged: (selection: EditorSelectionView | null) => void,
  ) {
    const vscodeApi = getVscode();
    this.disposables.push(
      this.diffProvider,
      vscodeApi.workspace.registerTextDocumentContentProvider(
        ORIGINAL_DIFF_SCHEME,
        this.diffProvider,
      ),
      vscodeApi.window.onDidChangeTextEditorSelection(() =>
        this.scheduleSelectionFlush(),
      ),
      vscodeApi.window.onDidChangeActiveTextEditor((editor) => {
        if (
          editor &&
          (editor.document.uri.scheme === "file" ||
            editor.document.uri.scheme === "untitled")
        ) {
          this.lastActiveEditor = editor;
          if (editor.viewColumn !== undefined && editor.viewColumn > 0) {
            this.lastTextEditorColumn = editor.viewColumn;
          }
        }
        this.scheduleSelectionFlush();
      }),
      vscodeApi.workspace.onDidChangeTextDocument(() =>
        this.scheduleSelectionFlush(),
      ),
      vscodeApi.workspace.onDidCloseTextDocument((closed) => {
        if (closed.uri.scheme === ORIGINAL_DIFF_SCHEME) {
          const closedKey = decodeURIComponent(closed.uri.query);
          for (const [tabKey, tab] of this.openDiffTabs.entries()) {
            if (tab.leftKey === closedKey || tab.rightKey === closedKey) {
              this.openDiffTabs.delete(tabKey);
              this.diffProvider.delete(tab.leftKey);
              if (tab.rightKey) this.diffProvider.delete(tab.rightKey);
            }
          }
        }
        this.scheduleSelectionFlush();
      }),
      vscodeApi.window.onDidCloseTerminal((closed) => {
        for (const [key, term] of this.terminals.entries()) {
          if (term === closed) this.terminals.delete(key);
        }
      }),
    );

    const active = vscodeApi.window.activeTextEditor;
    if (active) {
      this.lastActiveEditor = active;
      if (
        (active.document.uri.scheme === "file" ||
          active.document.uri.scheme === "untitled") &&
        active.viewColumn !== undefined &&
        active.viewColumn > 0
      ) {
        this.lastTextEditorColumn = active.viewColumn;
      }
    }
    this.scheduleSelectionFlush();
  }

  setPanelViewColumnResolver(fn: () => vscode.ViewColumn | undefined): void {
    this.panelViewColumnResolver = fn;
  }

  resolveCodeViewColumn(): vscode.ViewColumn {
    const vscodeApi = getVscode();
    const active = vscodeApi.window.activeTextEditor;
    const activeColumn =
      active &&
      (active.document.uri.scheme === "file" ||
        active.document.uri.scheme === "untitled") &&
      active.viewColumn !== undefined &&
      active.viewColumn > 0
        ? active.viewColumn
        : undefined;
    const preferred = activeColumn ?? this.lastTextEditorColumn;
    const panelColumn = this.panelViewColumnResolver?.();
    return resolveTargetCodeColumn(preferred, panelColumn) as vscode.ViewColumn;
  }

  getSelection(): EditorSelectionView | null {
    return this.currentSelection;
  }

  readActiveSelectionImmediate(): EditorSelectionView | null {
    const vscodeApi = getVscode();
    const editor =
      vscodeApi.window.activeTextEditor ?? this.lastActiveEditor;
    if (!editor) return null;
    const { document, selection } = editor;
    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
      return null;
    }

    const filePath = document.uri.fsPath || document.uri.path;
    const relativePath = vscodeApi.workspace.asRelativePath(document.uri, false);
    const languageId = document.languageId;

    if (selection.isEmpty) {
      const line = selection.active.line + 1;
      return {
        filePath,
        relativePath,
        languageId,
        lineStart: line,
        lineEnd: line,
        lineCount: 0,
      };
    }

    const startLine0 = selection.start.line;
    const endLine0 =
      selection.end.character === 0 && selection.end.line > selection.start.line
        ? selection.end.line - 1
        : selection.end.line;
    const lineStart = startLine0 + 1;
    const lineEnd = Math.max(lineStart, endLine0 + 1);
    const lineCount = lineEnd - lineStart + 1;
    const rawText = document.getText(selection);
    const selectedText =
      rawText.length > MAX_SELECTION_CHARS
        ? rawText.slice(0, MAX_SELECTION_CHARS)
        : rawText;

    return {
      filePath,
      relativePath,
      languageId,
      lineStart,
      lineEnd,
      lineCount,
      selectedText,
    };
  }

  private scheduleSelectionFlush(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const next = this.readActiveSelectionImmediate();
      this.currentSelection = next;
      this.onSelectionChanged(next);
    }, SELECTION_DEBOUNCE_MS);
  }

  private collectResolutionRoots(baseDir?: string): string[] {
    const vscodeApi = getVscode();
    const roots: string[] = [];
    const seen = new Set<string>();
    const push = (dir?: string) => {
      const trimmed = dir?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      roots.push(trimmed);
    };

    push(baseDir);
    for (const folder of vscodeApi.workspace.workspaceFolders ?? []) {
      push(folder.uri.fsPath);
    }

    const activeFile = vscodeApi.window.activeTextEditor?.document.uri;
    if (activeFile?.scheme === "file" && activeFile.fsPath) {
      push(path.dirname(activeFile.fsPath));
    }
    const lastFile = this.lastActiveEditor?.document.uri;
    if (lastFile?.scheme === "file" && lastFile.fsPath) {
      push(path.dirname(lastFile.fsPath));
    }

    return roots;
  }

  private async resolveExistingFileUri(
    rawPath: string,
    baseDir?: string,
  ): Promise<vscode.Uri | null> {
    const vscodeApi = getVscode();
    const { path: clean } = sanitizeFileOpenTarget(rawPath);
    if (!clean) return null;

    const roots = this.collectResolutionRoots(baseDir);
    const directCandidates = buildFilePathCandidates(clean, roots);
    for (const candidate of directCandidates) {
      if (isExistingRegularFile(candidate)) {
        return vscodeApi.Uri.file(candidate);
      }
    }

    // Fallback: search across all open workspace folders (handles bare filenames like
    // `MIGRATION_PLAN.md` or partial paths like `desktop/MIGRATION_PLAN.md` or
    // workspace-prefixed paths like `rayucode-v2/how-to-run.md`).
    if ((vscodeApi.workspace.workspaceFolders?.length ?? 0) > 0) {
      const normalizedSuffix = clean.replace(/\\/g, "/").replace(/^\/+/, "");
      const segments = normalizedSuffix.split("/").filter(Boolean);
      const globs: string[] = [];
      if (normalizedSuffix) {
        globs.push(`**/${escapeGlobPattern(normalizedSuffix)}`);
      }
      if (segments.length > 1) {
        const withoutFirst = segments.slice(1).join("/");
        globs.push(`**/${escapeGlobPattern(withoutFirst)}`);
      }
      const baseName = segments[segments.length - 1];
      if (baseName && segments.length > 1) {
        globs.push(`**/${escapeGlobPattern(baseName)}`);
      }

      for (const glob of globs) {
        try {
          const found = await vscodeApi.workspace.findFiles(
            glob,
            FIND_FILES_EXCLUDE_GLOB,
            25,
          );
          if (found.length > 0) {
            const ranked = rankWorkspaceFileMatches(
              normalizedSuffix,
              found.map((u) => u.fsPath),
              roots,
            );
            const best = ranked[0];
            if (best) {
              return vscodeApi.Uri.file(best);
            }
          }
        } catch {
          // ignore malformed glob or workspace search error and continue fallback
        }
      }
    }

    return null;
  }

  async openFile(options: {
    path: string;
    line?: number;
    column?: number;
    preview?: boolean;
    baseDir?: string;
  }): Promise<void> {
    const vscodeApi = getVscode();
    const parsed = sanitizeFileOpenTarget(options.path);
    if (!parsed.path) return;

    const uri = await this.resolveExistingFileUri(parsed.path, options.baseDir);
    if (!uri) {
      void vscodeApi.window.showWarningMessage(
        `File not found in workspace: ${options.path}`,
      );
      return;
    }

    const effectiveLine = options.line ?? parsed.line;
    const effectiveColumn = options.column ?? parsed.column;
    const line0 = effectiveLine && effectiveLine > 0 ? effectiveLine - 1 : undefined;
    const col0 = effectiveColumn && effectiveColumn > 0 ? effectiveColumn - 1 : 0;
    const selection =
      line0 !== undefined
        ? new vscodeApi.Range(line0, col0, line0, col0)
        : undefined;

    const viewColumn = this.resolveCodeViewColumn();
    const preview = options.preview ?? false;
    const ext = path.extname(uri.fsPath).toLowerCase();

    if (BINARY_VIEWER_EXTENSIONS.has(ext)) {
      await vscodeApi.commands.executeCommand("vscode.open", uri, {
        viewColumn,
        preview,
      });
      return;
    }

    try {
      const editor = await vscodeApi.window.showTextDocument(uri, {
        viewColumn,
        preview,
        selection,
      });
      if (selection) {
        editor.revealRange(
          selection,
          vscodeApi.TextEditorRevealType.InCenterIfOutsideViewport,
        );
      }
    } catch {
      await vscodeApi.commands.executeCommand("vscode.open", uri, {
        viewColumn,
        preview,
      });
    }
  }

  async openDiff(options: {
    path: string;
    originalContent: string;
    modifiedContent?: string;
    title?: string;
    sessionId?: string;
    scope?: "session" | "git";
    isCreated?: boolean;
    isDeleted?: boolean;
  }): Promise<void> {
    const vscodeApi = getVscode();
    const fileUri = resolveWorkspaceFileUri(options.path);
    if (!fileUri) return;

    const scopeKey = options.scope ?? "git";
    const sessionKey = options.sessionId ?? "ws";
    const tabKey = `${scopeKey}:${sessionKey}:${options.path}`;
    const leftKey = `orig:${tabKey}`;
    const leftContent = options.isCreated ? "" : options.originalContent;
    const leftUri = this.diffProvider.set(leftKey, leftContent, options.path);

    let diskFileExists = false;
    try {
      diskFileExists = fs.existsSync(fileUri.fsPath);
    } catch {
      diskFileExists = false;
    }

    let rightKey: string | undefined;
    let rightUri: vscode.Uri;
    if (options.isDeleted || !diskFileExists) {
      rightKey = `mod:${tabKey}`;
      const rightContent = options.isDeleted
        ? ""
        : (options.modifiedContent ?? "");
      rightUri = this.diffProvider.set(rightKey, rightContent, options.path);
    } else {
      rightUri = fileUri;
    }

    this.openDiffTabs.set(tabKey, {
      path: options.path,
      sessionId: options.sessionId,
      scope: options.scope,
      leftKey,
      leftUri,
      rightKey,
      rightUri: rightKey ? rightUri : undefined,
    });

    const baseName = path.basename(options.path) || options.path;
    const suffix = options.isCreated
      ? " (Created)"
      : options.isDeleted
        ? " (Deleted)"
        : "";
    const panelColumn = this.panelViewColumnResolver?.();
    const viewColumn =
      panelColumn !== undefined
        ? this.resolveCodeViewColumn()
        : vscodeApi.ViewColumn.Beside;
    await vscodeApi.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      options.title ?? `${baseName}${suffix} — RayuCode Diff`,
      {
        viewColumn,
        preview: false,
      },
    );
  }

  /**
   * Refresh any open virtual diff tabs belonging to `sessionId` after live
   * file-change state updates (edits, keep, undo, redo).
   */
  async refreshOpenDiffs(
    sessionId: string,
    resolveDiff: (filePath: string) => Promise<{
      originalContent: string;
      modifiedContent?: string;
      isCreated?: boolean;
      isDeleted?: boolean;
    } | null>,
  ): Promise<void> {
    const matching = [...this.openDiffTabs.values()].filter(
      (tab) => tab.sessionId === sessionId || (!tab.sessionId && tab.scope === "session"),
    );
    if (matching.length === 0) return;

    await Promise.all(
      matching.map(async (tab) => {
        try {
          const next = await resolveDiff(tab.path);
          if (!next) return;
          const leftContent = next.isCreated ? "" : next.originalContent;
          this.diffProvider.update(tab.leftKey, leftContent);
          if (tab.rightKey) {
            const rightContent = next.isDeleted
              ? ""
              : (next.modifiedContent ?? "");
            this.diffProvider.update(tab.rightKey, rightContent);
          }
        } catch {
          // Ignore refresh failure for removed/closed entries
        }
      }),
    );
  }

  async insertCode(options: {
    code: string;
    mode: "cursor" | "diff";
    languageId?: string;
  }): Promise<void> {
    const vscodeApi = getVscode();
    const panelColumn = this.panelViewColumnResolver?.();
    const targetColumn =
      panelColumn !== undefined
        ? this.resolveCodeViewColumn()
        : vscodeApi.ViewColumn.Beside;

    const editor = vscodeApi.window.activeTextEditor ?? this.lastActiveEditor;
    if (!editor) {
      const doc = await vscodeApi.workspace.openTextDocument({
        content: options.code,
        language: options.languageId ?? "plaintext",
      });
      await vscodeApi.window.showTextDocument(doc, {
        viewColumn: targetColumn,
      });
      return;
    }

    if (options.mode === "cursor") {
      await editor.edit((editBuilder) => {
        if (editor.selection.isEmpty) {
          editBuilder.insert(editor.selection.active, options.code);
        } else {
          editBuilder.replace(editor.selection, options.code);
        }
      });
      return;
    }

    const currentText = editor.document.getText();
    const startOffset = editor.document.offsetAt(editor.selection.start);
    const endOffset = editor.document.offsetAt(editor.selection.end);
    const proposedText =
      currentText.slice(0, startOffset) +
      options.code +
      currentText.slice(endOffset);

    const filePath = editor.document.uri.fsPath || editor.document.fileName;
    const leftUri = this.diffProvider.set(`insert-orig:${filePath}`, currentText, filePath);
    const rightUri = this.diffProvider.set(`insert-prop:${filePath}`, proposedText, filePath);
    const baseName = path.basename(filePath) || "Snippet";

    await vscodeApi.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      `${baseName} — Proposed Code`,
      {
        viewColumn: targetColumn,
        preview: true,
      },
    );
  }

  openTerminal(options: { cwd?: string; name?: string } = {}): void {
    const vscodeApi = getVscode();
    const defaultCwd = vscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cwd = options.cwd?.trim() || defaultCwd;
    const name = options.name?.trim() || "RayuCode";
    const key = `${name}:${cwd ?? ""}`;
    let terminal = this.terminals.get(key);
    if (!terminal || terminal.exitStatus !== undefined) {
      terminal = vscodeApi.window.createTerminal({
        name,
        cwd,
      });
      this.terminals.set(key, terminal);
    }
    terminal.show(false);
  }

  async openWorktreeWindow(folderPath: string): Promise<void> {
    const vscodeApi = getVscode();
    const uri = resolveWorkspaceFileUri(folderPath);
    if (!uri) return;
    await vscodeApi.commands.executeCommand("vscode.openFolder", uri, {
      forceNewWindow: true,
    });
  }

  async openMarkdownPreview(filePath: string): Promise<void> {
    const vscodeApi = getVscode();
    const uri = resolveWorkspaceFileUri(filePath);
    if (!uri) return;
    try {
      await vscodeApi.commands.executeCommand("markdown.showPreviewToSide", uri);
    } catch {
      await this.openFile({ path: filePath, preview: false });
    }
  }

  async openSimpleBrowser(url?: string): Promise<void> {
    const vscodeApi = getVscode();
    let targetRaw = url?.trim() ?? "";
    if (!targetRaw) {
      const input = await vscodeApi.window.showInputBox({
        title: "Open Browser in VS Code",
        prompt: "Enter a URL to open in VS Code Simple Browser",
        value: this.lastBrowserUrl,
        placeHolder: "http://localhost:3000",
        validateInput: (val) => {
          if (!val.trim()) return "Enter a URL (e.g. http://localhost:3000)";
          return normalizeBrowserUrl(val)
            ? undefined
            : "Enter a valid http:// or https:// URL";
        },
      });
      if (!input) return;
      targetRaw = input;
    }

    const normalized = normalizeBrowserUrl(targetRaw);
    if (!normalized) {
      void vscodeApi.window.showWarningMessage(
        `Invalid browser URL: ${targetRaw}`,
      );
      return;
    }

    this.lastBrowserUrl = normalized;
    try {
      await vscodeApi.commands.executeCommand("simpleBrowser.show", normalized);
    } catch {
      await this.openExternal(normalized);
    }
  }

  async openExternal(url: string): Promise<void> {
    const vscodeApi = getVscode();
    const trimmed = url.trim();
    if (!trimmed) return;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return;
    }
    if (
      parsed.protocol !== "https:" &&
      parsed.protocol !== "http:" &&
      parsed.protocol !== "mailto:"
    ) {
      return;
    }
    await vscodeApi.env.openExternal(vscodeApi.Uri.parse(parsed.toString()));
  }

  async copyToClipboard(text: string): Promise<void> {
    const vscodeApi = getVscode();
    if (text.length <= 2_000_000) {
      await vscodeApi.env.clipboard.writeText(text);
    }
  }

  async pickFiles(options: {
    canSelectMany?: boolean;
    filters?: Record<string, string[]>;
    canSelectFolders?: boolean;
  } = {}): Promise<string[]> {
    const vscodeApi = getVscode();
    const uris = await vscodeApi.window.showOpenDialog({
      canSelectMany: options.canSelectMany ?? true,
      canSelectFiles: !options.canSelectFolders,
      canSelectFolders: options.canSelectFolders ?? false,
      filters: options.filters,
      defaultUri: vscodeApi.workspace.workspaceFolders?.[0]?.uri,
    });
    return (uris ?? []).map((u) => u.fsPath);
  }

  async findWorkspaceFiles(query: string, limit = 50): Promise<string[]> {
    const vscodeApi = getVscode();
    const uris = await vscodeApi.workspace.findFiles(
      "**/*",
      "**/{node_modules,.git,dist,target,.next,build,coverage,.turbo}/**",
      1500,
    );
    const relativePaths = uris.map((u) =>
      vscodeApi.workspace.asRelativePath(u, false),
    );
    const q = query.trim().toLowerCase();
    if (!q) {
      return relativePaths.sort().slice(0, limit);
    }

    const scored: Array<{ path: string; score: number }> = [];
    for (const rel of relativePaths) {
      const lower = rel.toLowerCase();
      const base = path.basename(lower);
      if (base === q) {
        scored.push({ path: rel, score: 100 });
      } else if (base.startsWith(q)) {
        scored.push({ path: rel, score: 80 });
      } else if (base.includes(q)) {
        scored.push({ path: rel, score: 60 });
      } else if (lower.includes(q)) {
        scored.push({ path: rel, score: 40 });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return scored.slice(0, limit).map((item) => item.path);
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.openDiffTabs.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
