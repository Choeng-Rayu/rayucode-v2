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
  isStreaming?: boolean;
  signedIn?: boolean;
}

/**
 * Single compact VS Code Status Bar item showing active model, permission mode,
 * live streaming pulse, running/stalled background task count, and daemon health.
 * Clicking opens the RayuCode Quick Actions hub.
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
    const {
      daemonStatus,
      model,
      permissionMode,
      backgroundTasks,
      sessionCredits,
      isStreaming,
      signedIn,
    } = snapshot;
    const runningCount = backgroundTasks.filter(
      (task) => task.status === "running" || task.status === "stalled",
    ).length;
    const stalledCount = backgroundTasks.filter(
      (task) => task.status === "stalled",
    ).length;
    this.activeRunningTasks = runningCount;

    const isInstallingOrUpdating =
      daemonStatus.state === "downloading" ||
      (daemonStatus.downloadPhase !== undefined &&
        daemonStatus.downloadPhase !== "starting");

    if (isInstallingOrUpdating) {
      const pct =
        daemonStatus.downloadProgress !== undefined
          ? ` ${daemonStatus.downloadProgress}%`
          : "";
      const ver = daemonStatus.downloadVersion
        ? ` ${daemonStatus.downloadVersion}`
        : "";
      const verb = daemonStatus.state === "connected" ? "Updating" : "Installing";
      this.item.text = `$(sync~spin) ${verb} Rayu${pct}`;
      this.item.backgroundColor = undefined;
      this.item.tooltip = new vscode.MarkdownString(
        [
          "**RayuCode Engine — Please Wait**",
          `- ${daemonStatus.statusMessage ?? `Downloading Rayu engine${ver} — please wait...`}`,
          "- RayuCode will connect automatically once installation completes.",
          "- *Click for RayuCode Quick Actions*",
        ].join("\n"),
      );
      return;
    }

    if (daemonStatus.state === "disconnected" || daemonStatus.state === "error") {
      this.item.text = "$(rayucode) Offline";
      this.item.backgroundColor =
        daemonStatus.state === "error"
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
      const offlineLines = [
        "**RayuCode Runtime Offline**",
        ...(daemonStatus.error ? [daemonStatus.error] : []),
        ...(signedIn === false ? ["- **Account:** Signed out"] : []),
        "- *Click for RayuCode Quick Actions*",
      ];
      this.item.tooltip = new vscode.MarkdownString(offlineLines.join("\n"));
      return;
    }

    if (
      daemonStatus.state === "connecting" ||
      daemonStatus.state === "starting" ||
      daemonStatus.state === "reconnecting"
    ) {
      this.item.text = "$(sync~spin) Rayu · Connecting";
      this.item.backgroundColor = undefined;
      this.item.tooltip = new vscode.MarkdownString(
        [
          "**RayuCode**",
          "- Connecting to RayuCode Rust daemon...",
          "- *Click for RayuCode Quick Actions*",
        ].join("\n"),
      );
      return;
    }

    const modeLabel = PERMISSION_LABELS[permissionMode] ?? "Ask";
    const modelLabel = formatShortModel(model);

    if (isStreaming) {
      const parts = [`$(loading~spin) ${modelLabel} · Working`];
      if (runningCount > 0) {
        parts.push(`${runningCount} bg`);
      }
      this.item.text = parts.join(" · ");
    } else {
      const parts = [`$(rayucode) ${modelLabel}`, modeLabel];
      if (runningCount > 0) {
        parts.push(`${runningCount} bg`);
      }
      if (sessionCredits !== undefined && sessionCredits > 0) {
        parts.push(`${formatRayuCredits(sessionCredits)} cr`);
      }
      this.item.text = parts.join(" · ");
    }

    this.item.backgroundColor =
      stalledCount > 0
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;

    const tooltipLines = [
      `**RayuCode** (${daemonStatus.version ?? "v1.14"}${
        daemonStatus.latencyMs ? ` · ${daemonStatus.latencyMs}ms` : ""
      })`,
      `- **Status:** ${isStreaming ? "Working (streaming turn)" : "Ready"}`,
      `- **Model:** ${model ?? "Default"}`,
      `- **Permissions:** ${modeLabel}`,
    ];
    if (signedIn !== undefined) {
      tooltipLines.push(
        `- **Account:** ${signedIn ? "Signed in" : "Signed out"}`,
      );
    }
    if (runningCount > 0) {
      tooltipLines.push(
        `- **Background Processes:** ${runningCount} active${
          stalledCount > 0 ? ` (${stalledCount} stalled)` : ""
        }`,
      );
    }
    if (sessionCredits !== undefined && sessionCredits > 0) {
      tooltipLines.push(
        `- **Session Credits:** ${formatRayuCredits(sessionCredits)}`,
      );
    }
    tooltipLines.push("- *Click for RayuCode Quick Actions*");

    this.item.tooltip = new vscode.MarkdownString(tooltipLines.join("\n"));
  }

  dispose(): void {
    this.item.dispose();
  }
}
