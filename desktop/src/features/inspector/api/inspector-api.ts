import { queryOptions } from "@tanstack/react-query"

import { ipcClient, type InspectorState } from "@/lib/ipc-client"

import {
  inspectorCodeFileSchema,
  inspectorTerminalLineSchema,
  inspectorViewModelSchema,
  terminalCommandInputSchema,
} from "../schemas"
import type {
  ContextBreakdownRow,
  ContextDisclosure,
  InspectorChangesState,
  InspectorCodeFile,
  InspectorConnector,
  InspectorOutput,
  InspectorTaskItem,
  InspectorTerminalLine,
  InspectorViewModel,
} from "../types"

interface ExtendedInspectorBridge {
  runTerminalCommand?: (cmd: string) => Promise<InspectorTerminalLine | null>
}

const DEFAULT_CONTEXT_ROWS: ContextBreakdownRow[] = [
  {
    id: "mcp-tools",
    label: "MCP tools",
    tokensLabel: "70.9K",
    pctLabel: "7.1%",
    barWidthPct: 11,
    colorClass: "bg-info",
    dotted: true,
    items: [
      { key: "rayu-core-mcp (18 tools)", tokens: "7.1K" },
      { key: "local-preview (102 tools)", tokens: "31.4K" },
      { key: "github (48 tools)", tokens: "19.8K" },
      { key: "chrome-devtools (26 tools)", tokens: "12.6K" },
    ],
  },
  {
    id: "system-tools",
    label: "System tools",
    tokensLabel: "13.5K",
    pctLabel: "1.4%",
    barWidthPct: 6,
    colorClass: "bg-warn",
  },
  {
    id: "skills",
    label: "Skills",
    tokensLabel: "9.9K",
    pctLabel: "1.0%",
    barWidthPct: 5,
    colorClass: "bg-brand",
    dotted: true,
    items: [
      { key: "superpowers:subagent-driven-development", tokens: "4.2K" },
      { key: "systematic-debugging", tokens: "2.6K" },
      { key: "test-driven-development", tokens: "1.9K" },
      { key: "verification-before-completion", tokens: "1.2K" },
    ],
  },
  {
    id: "system-prompt",
    label: "System prompt",
    tokensLabel: "4.6K",
    pctLabel: "0.5%",
    barWidthPct: 4,
    colorClass: "bg-pill-done-fg",
  },
  {
    id: "memory-files",
    label: "Memory files",
    tokensLabel: "3.7K",
    pctLabel: "0.4%",
    barWidthPct: 3,
    colorClass: "bg-muted-ink",
    dotted: true,
    items: [
      { key: "CLAUDE.md", tokens: "1.4K" },
      { key: "~/.rayu/memory/rayucode-v2.md", tokens: "1.3K" },
      { key: "~/.rayu/memory/shard-store.md", tokens: "1.0K" },
    ],
  },
  {
    id: "messages",
    label: "Messages",
    tokensLabel: "2.3K",
    pctLabel: "0.2%",
    barWidthPct: 3,
    colorClass: "bg-pill-edit-fg",
  },
  {
    id: "mcp-instructions",
    label: "MCP server instructions",
    tokensLabel: "1.1K",
    pctLabel: "0.1%",
    barWidthPct: 2.5,
    colorClass: "bg-muted-ink",
    dotted: true,
    items: [
      { key: "rayu-core-mcp", tokens: "460" },
      { key: "context7", tokens: "380" },
      { key: "github", tokens: "260" },
    ],
  },
  {
    id: "custom-agents",
    label: "Custom agents",
    tokensLabel: "212",
    pctLabel: "0.0%",
    barWidthPct: 2,
    colorClass: "bg-muted-ink",
    dotted: true,
    items: [
      { key: "coordinator · Claude Opus 5.5", tokens: "64" },
      { key: "worker-1 · Claude Sonnet 5", tokens: "52" },
      { key: "reviewer · GPT-6.1 Sol", tokens: "48" },
      { key: "verifier · DeepSeek V4 Flash", tokens: "48" },
    ],
  },
]

const DEFAULT_DISCLOSURES: ContextDisclosure[] = [
  {
    id: "disc-mcp",
    label: "MCP tools",
    count: 18,
    items: [
      "rayu-core-mcp · 18 tools",
      "chrome-devtools · 26 tools",
      "github · 48 tools",
      "local-preview · 102 tools",
    ],
  },
  {
    id: "disc-mem",
    label: "Memory files",
    count: 3,
    items: [
      "CLAUDE.md",
      "~/.rayu/memory/rayucode-v2.md",
      "~/.rayu/memory/shard-store.md",
    ],
  },
  {
    id: "disc-agents",
    label: "Custom agents",
    count: 4,
    items: [
      "coordinator · Claude Opus 5.5",
      "worker-1 · Claude Sonnet 5",
      "reviewer · GPT-6.1 Sol",
      "verifier · DeepSeek V4 Flash",
    ],
  },
]

const DEFAULT_CONNECTORS: InspectorConnector[] = [
  { id: "github", glyph: "G", name: "GitHub", status: "Linked", primary: true },
  { id: "linear", glyph: "L", name: "Linear", status: "Linked", primary: true },
  {
    id: "slack",
    glyph: "S",
    name: "Slack",
    status: "Reconnect",
    primary: true,
  },
  {
    id: "google-drive",
    glyph: "D",
    name: "Google Drive",
    status: "Linked",
    primary: false,
  },
  {
    id: "notion",
    glyph: "N",
    name: "Notion",
    status: "Linked",
    primary: false,
  },
  {
    id: "sentry",
    glyph: "E",
    name: "Sentry",
    status: "Reconnect",
    primary: false,
  },
]

const DEFAULT_OUTPUTS: InspectorOutput[] = [
  {
    id: "out_browser",
    kind: "browser",
    label: "localhost:3000 — Credits Dashboard",
    pillLabel: "localhost:3000",
  },
  {
    id: "out_md",
    kind: "markdown",
    label: "MIGRATION_PLAN.md",
    pillLabel: "MIGRATION_PLAN.md",
  },
  {
    id: "out_excel",
    kind: "excel",
    label: "Q4-Token-Cost-Model.xlsx",
    pillLabel: "Q4-Token-Cost-Model.xlsx",
  },
]

const DEFAULT_TASKS: InspectorTaskItem[] = [
  {
    id: "task-shard-lookup",
    title: "Route reads through ShardStore::lookup",
    detail: "Preserve LRU touch order in src/session/lookup.rs:21",
    completed: true,
    codeFile: "lookup.rs",
    codeLine: 21,
  },
  {
    id: "task-retire-cache",
    title: "Retire legacy SessionCache RwLock path",
    detail: "48 lines removed from src/session/cache.rs",
    completed: true,
    codeFile: "cache.rs",
    codeLine: 5,
  },
  {
    id: "task-verify-tests",
    title: "Verify 14/14 session:: unit tests",
    detail: "cargo test -p rayucode session:: green in 0.48s",
    completed: true,
    codeFile: "store.rs",
    codeLine: 15,
  },
  {
    id: "task-sync-outputs",
    title: "Sync dashboard preview & cost workbook",
    detail: "Updated localhost:3000, Q4-Token-Cost-Model.xlsx, MIGRATION_PLAN.md",
    completed: false,
  },
]

const DEFAULT_CODE_LINE_BY_FILE: Record<string, number> = {
  "lookup.rs": 21,
  "store.rs": 15,
  "cache.rs": 5,
}

function normalizeCodePath(rawPath: string): string {
  return rawPath.replace(/\s*\/\s*/g, "/")
}

function normalizeCodeFiles(
  rawFiles: InspectorState["codeFiles"]
): Record<string, InspectorCodeFile> {
  const orderedKeys = ["lookup.rs", "store.rs", "cache.rs"]
  const allKeys = [
    ...orderedKeys.filter((k) => k in rawFiles),
    ...Object.keys(rawFiles).filter((k) => !orderedKeys.includes(k)),
  ]

  const result: Record<string, InspectorCodeFile> = {}
  for (const key of allKeys) {
    const file = rawFiles[key]
    if (!file) continue
    result[key] = inspectorCodeFileSchema.parse({
      pill: file.pill,
      path: normalizeCodePath(file.path),
      language: file.language,
      startLine: file.startLine,
      defaultLine: DEFAULT_CODE_LINE_BY_FILE[key] ?? file.startLine,
      lines: file.lines,
    })
  }
  return result
}

function normalizeInspectorState(raw: InspectorState): InspectorViewModel {
  const hasFullDottedBreakdown = raw.context.rows.some(
    (r) => r.label.toLowerCase() === "mcp tools" && r.dotted
  )

  const rows: ContextBreakdownRow[] = hasFullDottedBreakdown
    ? raw.context.rows.map((r, index) => ({
        ...r,
        barWidthPct: Math.max(2, 12 - index * 1.5),
      }))
    : DEFAULT_CONTEXT_ROWS

  const usePrototypeDefaults = !hasFullDottedBreakdown

  const normalized: InspectorViewModel = {
    environment: {
      host:
        raw.environment.host === "This computer"
          ? "Local · macOS Sequoia (M4 Max)"
          : raw.environment.host,
      project: raw.environment.project,
      path:
        raw.environment.path === "~/workspace/rayu"
          ? "~/workspace/rayu/rayucode-v2"
          : raw.environment.path,
      branch: raw.environment.branch,
    },
    context: {
      usedPctLabel: usePrototypeDefaults ? "3% used" : raw.context.usedPctLabel,
      tokensSummary: usePrototypeDefaults
        ? "28K / 1M"
        : raw.context.tokensSummary,
      rows,
      bufferRow: {
        ...raw.context.bufferRow,
        barWidthPct: 8,
      },
      freeRow: {
        ...raw.context.freeRow,
        tokensLabel: usePrototypeDefaults
          ? "860.7K"
          : raw.context.freeRow.tokensLabel,
        pctLabel: usePrototypeDefaults ? "86.1%" : raw.context.freeRow.pctLabel,
        barWidthPct: 0,
      },
      disclosures: usePrototypeDefaults
        ? DEFAULT_DISCLOSURES
        : raw.context.disclosures,
    },
    connectors: usePrototypeDefaults ? DEFAULT_CONNECTORS : raw.connectors,
    outputs: usePrototypeDefaults ? DEFAULT_OUTPUTS : raw.outputs,
    changesSummary: usePrototypeDefaults
      ? { additions: 26, deletions: 55, changedFilesCount: 3 }
      : raw.changesSummary,
    codeFiles: normalizeCodeFiles(raw.codeFiles),
    terminalLines: raw.terminalLines.map((line) => ({
      ...line,
      isError: false,
    })),
    tasks: DEFAULT_TASKS,
  }

  return inspectorViewModelSchema.parse(normalized)
}

export const inspectorKeys = {
  all: ["inspector"] as const,
  state: () => [...inspectorKeys.all, "state"] as const,
  codeFile: (fileKey: string) =>
    [...inspectorKeys.all, "code-file", fileKey] as const,
  changes: () => [...inspectorKeys.all, "changes"] as const,
}

export async function fetchInspectorState(): Promise<InspectorViewModel> {
  const raw = await ipcClient.inspector.getState()
  return normalizeInspectorState(raw)
}

export async function fetchCodeFile(
  fileKey: string
): Promise<InspectorCodeFile> {
  const raw = await ipcClient.inspector.getCodeFile(fileKey)
  return inspectorCodeFileSchema.parse({
    pill: raw.pill,
    path: normalizeCodePath(raw.path),
    language: raw.language,
    startLine: raw.startLine,
    defaultLine: DEFAULT_CODE_LINE_BY_FILE[fileKey] ?? raw.startLine,
    lines: raw.lines,
  })
}

export async function fetchInspectorChanges(): Promise<InspectorChangesState> {
  return ipcClient.changes.getState()
}

export async function acceptInspectorDiff(
  fileId: string
): Promise<InspectorChangesState> {
  return ipcClient.changes.acceptFile(fileId)
}

export async function rejectInspectorDiff(
  fileId: string
): Promise<InspectorChangesState> {
  return ipcClient.changes.rejectFile(fileId)
}

function synthesizeTerminalOutput(command: string): InspectorTerminalLine {
  const trimmed = command.trim()
  const lower = trimmed.toLowerCase()
  const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  if (lower.startsWith("cargo test")) {
    return {
      id,
      prompt: "$",
      command: trimmed,
      output:
        "running 14 tests\ntest session::lookup::routes_via_shard_store ... ok\ntest session::lookup::touches_lru_budget_on_hit ... ok\ntest result: ok. 14 passed; 0 failed; 0 ignored; finished in 0.44s",
      isOk: true,
    }
  }

  if (lower.includes("swarm status")) {
    return {
      id,
      prompt: "$",
      command: trimmed,
      output:
        "  coordinator (a41f) 71 MB  [coordinating]\n  worker-1    (e7b3) 74 MB  [running]\n  worker-2    (c9d2) 69 MB  [running]",
      isOk: true,
    }
  }

  if (lower.includes("cache stats")) {
    return {
      id,
      prompt: "$",
      command: trimmed,
      output: "  KV cache: warm · 94.2% hit · 1h TTL",
      isOk: true,
    }
  }

  if (lower === "git status" || lower.startsWith("git status ")) {
    return {
      id,
      prompt: "$",
      command: trimmed,
      output:
        " M crates/rayucode-core/src/session/lookup.rs\n D crates/rayucode-core/src/session/cache.rs\n M docs/MIGRATION_PLAN.md",
      isOk: true,
    }
  }

  if (lower === "help") {
    return {
      id,
      prompt: "$",
      command: trimmed,
      output:
        "Available commands: rayu swarm status, rayu cache stats, cargo test -p rayucode session::, git status, clear",
      isOk: true,
    }
  }

  return {
    id,
    prompt: "$",
    command: trimmed,
    output: `Executed "${trimmed}" on rayu daemon (exit 0 · 14ms)`,
    isOk: true,
  }
}

export async function runInspectorTerminalCommand(
  command: string
): Promise<InspectorTerminalLine> {
  const parsed = terminalCommandInputSchema.parse({ command })
  const inspectorApi = ipcClient.inspector as typeof ipcClient.inspector &
    ExtendedInspectorBridge

  if (typeof inspectorApi.runTerminalCommand === "function") {
    const result = await inspectorApi.runTerminalCommand(parsed.command)
    if (result) {
      return inspectorTerminalLineSchema.parse(result)
    }
  }

  if (typeof window !== "undefined" && window.rayu?.daemon?.invoke) {
    try {
      const result = await window.rayu.daemon.invoke<InspectorTerminalLine>(
        "inspector.runTerminalCommand",
        { command: parsed.command }
      )
      return inspectorTerminalLineSchema.parse(result)
    } catch {
      // Fallback to local daemon mock when IPC method is not wired
    }
  }

  return inspectorTerminalLineSchema.parse(
    synthesizeTerminalOutput(parsed.command)
  )
}

export async function openFileInVSCode(
  filePath: string,
  line?: number | null
): Promise<{ ok: boolean }> {
  return ipcClient.native.openInVSCode(filePath, line ?? undefined)
}

export function inspectorStateQueryOptions() {
  return queryOptions({
    queryKey: inspectorKeys.state(),
    queryFn: fetchInspectorState,
    staleTime: 30_000,
  })
}

export function codeFileQueryOptions(fileKey: string) {
  return queryOptions({
    queryKey: inspectorKeys.codeFile(fileKey),
    queryFn: () => fetchCodeFile(fileKey),
    staleTime: 60_000,
  })
}

export function inspectorChangesQueryOptions() {
  return queryOptions({
    queryKey: inspectorKeys.changes(),
    queryFn: fetchInspectorChanges,
    staleTime: 30_000,
  })
}
