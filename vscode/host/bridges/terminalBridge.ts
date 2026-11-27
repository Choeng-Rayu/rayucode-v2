import type * as vscode from "vscode";
import type { ComposerInjectionPayload } from "../../shared/vscodeProtocol.js";

function getVscode(): typeof vscode {
  return require("vscode") as typeof vscode;
}

const MAX_HISTORY_PER_TERMINAL = 5;
const MAX_STORED_OUTPUT_CHARS = 16_000;
const MAX_SELECTION_CHARS = 12_000;
const MAX_PROMPT_OUTPUT_CHARS = 12_000;

export type TerminalCapture =
  | {
      kind: "selection";
      text: string;
      terminalName?: string;
    }
  | {
      kind: "lastCommand";
      commandLine: string;
      exitCode?: number;
      output: string;
      cwd?: string;
      terminalName?: string;
    };

export interface BuildTerminalInjectionOptions {
  id?: string;
  workingDir?: string;
  autoSubmit?: boolean;
}

interface StoredTerminalExecution {
  commandLine: string;
  exitCode?: number;
  cwd?: string;
  output: string;
  terminalName: string;
  finishedAtMs: number;
}

interface ActiveExecutionReader {
  rawChunks: string;
  done: Promise<void>;
}

// OSC sequences (including VS Code OSC 633 shell integration & OSC 8 hyperlinks),
// DCS/SOS/PM/APC strings, CSI sequences (7-bit and 8-bit), and 2-byte ESC sequences.
const OSC_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const DCS_APC_RE = /\u001b[PX^_][\s\S]*?\u001b\\/g;
const CSI_RE = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
const ESC_CHARSET_RE = /\u001b[()#%*+\-/][0-9A-Za-z]/g;
const ESC_SINGLE_RE = /\u001b[@-Z\\-_]/g;
const BELL_RE = /\u0007/g;

/**
 * Strip ANSI / VT100 / OSC (including VS Code Shell Integration OSC 633)
 * escape sequences from raw terminal output and normalize line endings.
 */
export function stripAnsiCodes(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(OSC_RE, "")
    .replace(DCS_APC_RE, "")
    .replace(CSI_RE, "")
    .replace(ESC_CHARSET_RE, "")
    .replace(ESC_SINGLE_RE, "")
    .replace(BELL_RE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "");
}

function truncateTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const prefix = "... (earlier output truncated)\n";
  if (maxChars <= prefix.length) {
    return text.slice(text.length - maxChars);
  }
  return `${prefix}${text.slice(text.length - (maxChars - prefix.length))}`;
}

/**
 * Pure builder converting a captured terminal selection or shell-integration
 * execution into a typed `ComposerInjectionPayload`.
 */
export function buildTerminalInjection(
  capture: TerminalCapture,
  intent: "ask" | "fix",
  options: BuildTerminalInjectionOptions = {},
): ComposerInjectionPayload {
  const id =
    options.id ??
    `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const termLabel = capture.terminalName?.trim()
    ? ` (${capture.terminalName.trim()})`
    : "";

  if (capture.kind === "selection") {
    const cleaned = stripAnsiCodes(capture.text)
      .trim()
      .slice(0, MAX_PROMPT_OUTPUT_CHARS);
    const heading =
      intent === "fix"
        ? `Diagnose and fix the error shown in this terminal output${termLabel}:`
        : `Explain and help with this terminal output${termLabel}:`;
    const prompt = `${heading}\n\n\`\`\`text\n${cleaned}\n\`\`\``;

    return {
      id,
      prompt,
      mode: "append",
      workingDir: options.workingDir,
      autoSubmit: options.autoSubmit ?? false,
      sourceLabel: intent === "fix" ? "Fix Terminal Error" : "Terminal Output",
    };
  }

  const commandLine = stripAnsiCodes(capture.commandLine).trim();
  const cleanedOutput = truncateTail(
    stripAnsiCodes(capture.output).trim(),
    MAX_PROMPT_OUTPUT_CHARS,
  );
  const heading =
    intent === "fix"
      ? `Diagnose and fix this terminal command error${termLabel}:`
      : `Explain and help with this terminal command output${termLabel}:`;

  const metaLines: string[] = [
    `- Command: \`${commandLine || "(unknown command)"}\``,
  ];
  if (capture.exitCode !== undefined) {
    metaLines.push(`- Exit code: ${capture.exitCode}`);
  }
  if (capture.cwd) {
    metaLines.push(`- Working directory: \`${capture.cwd}\``);
  }

  const sections = [heading, metaLines.join("\n")];
  if (cleanedOutput) {
    sections.push(`\`\`\`text\n${cleanedOutput}\n\`\`\``);
  } else {
    sections.push("_(No stdout/stderr output was captured by shell integration.)_");
  }

  return {
    id,
    prompt: sections.join("\n\n"),
    mode: "append",
    workingDir: options.workingDir ?? capture.cwd,
    autoSubmit: options.autoSubmit ?? false,
    sourceLabel: intent === "fix" ? "Fix Terminal Error" : "Terminal Output",
  };
}

/**
 * Captures integrated terminal context safely:
 * 1. Clipboard-preserving `workbench.action.terminal.copySelection` capture.
 * 2. Fallback to bounded per-terminal ring buffer populated via VS Code Terminal
 *    Shell Integration (`onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`).
 */
export class TerminalBridge implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly historyByTerminal = new Map<
    vscode.Terminal,
    StoredTerminalExecution[]
  >();
  private readonly inFlightReaders = new WeakMap<
    vscode.TerminalShellExecution,
    ActiveExecutionReader
  >();

  constructor() {
    const vscodeApi = getVscode();

    if (typeof vscodeApi.window.onDidStartTerminalShellExecution === "function") {
      this.disposables.push(
        vscodeApi.window.onDidStartTerminalShellExecution((event) => {
          this.startReadingExecution(event.execution);
        }),
      );
    }

    if (typeof vscodeApi.window.onDidEndTerminalShellExecution === "function") {
      this.disposables.push(
        vscodeApi.window.onDidEndTerminalShellExecution((event) => {
          void this.recordEndedExecution(event);
        }),
      );
    }

    this.disposables.push(
      vscodeApi.window.onDidCloseTerminal((terminal) => {
        this.historyByTerminal.delete(terminal);
      }),
    );
  }

  private startReadingExecution(
    execution: vscode.TerminalShellExecution,
  ): ActiveExecutionReader {
    const existing = this.inFlightReaders.get(execution);
    if (existing) return existing;

    const reader: ActiveExecutionReader = {
      rawChunks: "",
      done: Promise.resolve(),
    };

    const readStream = async (): Promise<void> => {
      try {
        if (typeof execution.read !== "function") return;
        for await (const chunk of execution.read()) {
          if (typeof chunk !== "string" || chunk.length === 0) continue;
          reader.rawChunks += chunk;
          // Keep an upper bound on raw buffered text while streaming so long builds stay bounded.
          if (reader.rawChunks.length > MAX_STORED_OUTPUT_CHARS * 4) {
            reader.rawChunks = reader.rawChunks.slice(
              reader.rawChunks.length - MAX_STORED_OUTPUT_CHARS * 2,
            );
          }
        }
      } catch {
        // Ignore stream errors when a terminal closes mid-command
      }
    };

    reader.done = readStream();
    this.inFlightReaders.set(execution, reader);
    return reader;
  }

  private async recordEndedExecution(
    event: vscode.TerminalShellExecutionEndEvent,
  ): Promise<void> {
    const reader = this.startReadingExecution(event.execution);

    // Record immediately with whatever chunks we already captured so fast callers
    // see the command right away, then update once the async stream closes.
    const entry: StoredTerminalExecution = {
      commandLine: event.execution.commandLine?.value ?? "",
      exitCode: event.exitCode,
      cwd: event.execution.cwd?.fsPath,
      output: truncateTail(
        stripAnsiCodes(reader.rawChunks).trim(),
        MAX_STORED_OUTPUT_CHARS,
      ),
      terminalName: event.terminal.name,
      finishedAtMs: Date.now(),
    };

    const list = this.historyByTerminal.get(event.terminal) ?? [];
    list.push(entry);
    if (list.length > MAX_HISTORY_PER_TERMINAL) {
      list.splice(0, list.length - MAX_HISTORY_PER_TERMINAL);
    }
    this.historyByTerminal.set(event.terminal, list);

    await Promise.race([
      reader.done,
      new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
    ]);

    entry.output = truncateTail(
      stripAnsiCodes(reader.rawChunks).trim(),
      MAX_STORED_OUTPUT_CHARS,
    );
    if (!entry.commandLine && event.execution.commandLine?.value) {
      entry.commandLine = event.execution.commandLine.value;
    }
  }

  async captureTerminalContext(
    terminal?: vscode.Terminal,
  ): Promise<TerminalCapture | null> {
    const vscodeApi = getVscode();
    const targetTerminal = terminal ?? vscodeApi.window.activeTerminal;
    const terminalName = targetTerminal?.name ?? "Terminal";

    // 1. Clipboard-preserving selection capture
    let capturedSelection: string | null = null;
    let prevClipboard: string | undefined;
    const probe = `__rayucode_term_probe_${Date.now()}_${Math.random().toString(36).slice(2)}__`;

    try {
      prevClipboard = await vscodeApi.env.clipboard.readText();
      await vscodeApi.env.clipboard.writeText(probe);
      await vscodeApi.commands.executeCommand(
        "workbench.action.terminal.copySelection",
      );
      const copied = await vscodeApi.env.clipboard.readText();
      if (copied && copied !== probe) {
        const cleaned = stripAnsiCodes(copied).trim();
        if (cleaned.length > 0) {
          capturedSelection = cleaned.slice(0, MAX_SELECTION_CHARS);
        }
      }
    } catch {
      // No active terminal selection or copySelection unavailable
    } finally {
      if (prevClipboard !== undefined) {
        try {
          await vscodeApi.env.clipboard.writeText(prevClipboard);
        } catch {
          // Best-effort clipboard restore
        }
      }
    }

    if (capturedSelection) {
      return {
        kind: "selection",
        text: capturedSelection,
        terminalName,
      };
    }

    // 2. Fallback to latest shell-integration execution for target terminal
    if (targetTerminal) {
      const history = this.historyByTerminal.get(targetTerminal);
      const latest = history?.[history.length - 1];
      if (latest) {
        return {
          kind: "lastCommand",
          commandLine: latest.commandLine,
          exitCode: latest.exitCode,
          output: latest.output,
          cwd: latest.cwd,
          terminalName: latest.terminalName || terminalName,
        };
      }
    }

    return null;
  }

  dispose(): void {
    this.historyByTerminal.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
