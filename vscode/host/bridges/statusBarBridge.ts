import * as vscode from "vscode";
import { formatRayuCredits } from "@rayu-dev/rayucode-sdk";
import type {
  BackgroundProcessView,
  DaemonStatusView,
  PermissionModeId,
} from "../../shared/vscodeProtocol.js";

const PERMISSION_LABELS: Record<PermissionModeId, string> = {
  default: "Ask",
  acceptEdits: "Auto-edit",
  plan: "Plan",
  fullManage: "Full Manage",
  orchestrator: "Orchestrator",
};

function formatShortModel(model?: string): string {
  if (!model) return "Rayu";
  const cleaned = model.split("/").pop() ?? model;
  if (cleaned.length <= 22) return cleaned;
  return `${cleaned.slice(0, 20)}…`;
}

export interface StatusBarSnapshot {
  daemonStatus: DaemonStatusView;
  model?: string;
  permissionMode: PermissionModeId;
  backgroundTasks: readonly BackgroundProcessView[];
  sessionCredits?: number;
}

/**
 * Single compact VS Code Status Bar item showing active model, permission mode,
 * live running/stalled background task count (clicking opens Background Processes drawer),
 * and daemon health.
 */
export class StatusBarBridge implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private activeRunningTasks = 0;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      "rayucode.status",
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = "RayuCode Status";
    this.item.command = "rayucode.statusBarAction";
    this.update({
      daemonStatus: {
        state: "disconnected",
        capabilities: [],
      },
      permissionMode: "default",
      backgroundTasks: [],
    });
    this.item.show();
  }

  get hasActiveBackgroundTasks(): boolean {
    return this.activeRunningTasks > 0;
  }

  update(snapshot: StatusBarSnapshot): void {
    const { daemonStatus, model, permissionMode, backgroundTasks, sessionCredits } = snapshot;
    const runningCount = backgroundTasks.filter(
      (task) => task.status === "running" || task.status === "stalled",
    ).length;
    const stalledCount = backgroundTasks.filter((task) => task.status === "stalled").length;
    this.activeRunningTasks = runningCount;

    if (daemonStatus.state === "disconnected" || daemonStatus.state === "error") {
      this.item.text = "$(circle-slash) Rayu · Offline";
      this.item.backgroundColor =
        daemonStatus.state === "error"
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
      this.item.tooltip = new vscode.MarkdownString(
        [
          "**RayuCode Runtime Offline**",
          daemonStatus.error ? `\n\n${daemonStatus.error}` : "",
          "\n\nClick to open RayuCode or reconnect.",
        ].join(""),
      );
      return;
    }

    if (
      daemonStatus.state === "connecting" ||
      daemonStatus.state === "starting" ||
      daemonStatus.state === "reconnecting"
    ) {
      this.item.text = "$(sync~spin) Rayu · Connecting";
      this.item.backgroundColor = undefined;
      this.item.tooltip = "Connecting to RayuCode Rust daemon...";
      return;
    }

    const modeLabel = PERMISSION_LABELS[permissionMode] ?? "Ask";
    const modelLabel = formatShortModel(model);
    const parts = [`$(sparkle) ${modelLabel}`, modeLabel];

    if (runningCount > 0) {
      parts.push(`${runningCount} bg`);
    }
    if (sessionCredits !== undefined && sessionCredits > 0) {
      parts.push(`${formatRayuCredits(sessionCredits)} cr`);
    }

    this.item.text = parts.join(" · ");
    this.item.backgroundColor =
      stalledCount > 0
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;

    const tooltipLines = [
      `**RayuCode** (${daemonStatus.version ?? "v1.14"}${
        daemonStatus.latencyMs ? ` · ${daemonStatus.latencyMs}ms` : ""
      })`,
      `- **Model:** ${model ?? "Default"}`,
      `- **Permissions:** ${modeLabel}`,
    ];
    if (runningCount > 0) {
      tooltipLines.push(
        `- **Background Processes:** ${runningCount} active${
          stalledCount > 0 ? ` (${stalledCount} stalled)` : ""
        } — *Click to open Background Processes*`,
      );
    } else {
      tooltipLines.push("- *Click to open RayuCode Mission Control*");
    }
    if (sessionCredits !== undefined && sessionCredits > 0) {
      tooltipLines.push(`- **Session Credits:** ${formatRayuCredits(sessionCredits)}`);
    }

    this.item.tooltip = new vscode.MarkdownString(tooltipLines.join("\n"));
  }

  dispose(): void {
    this.item.dispose();
  }
}
