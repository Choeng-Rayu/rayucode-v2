import type * as vscode from "vscode";
import { formatRayuCredits } from "@rayu-dev/rayucode-sdk";
import type {
  BackgroundProcessView,
  DaemonStatusView,
  PermissionModeId,
  SwarmStatusView,
} from "../../shared/vscodeProtocol.js";

function getVscode(): typeof vscode {
  return require("vscode") as typeof vscode;
}

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

export function formatStatusBarVersionLabel(
  daemonStatus: Pick<DaemonStatusView, "version" | "protocolVersion">,
): string {
  if (daemonStatus.version) return daemonStatus.version;
  if (daemonStatus.protocolVersion) {
    return daemonStatus.protocolVersion.startsWith("v")
      ? daemonStatus.protocolVersion
      : `v${daemonStatus.protocolVersion}`;
  }
  return "engine";
}

export interface StatusBarSnapshot {
  daemonStatus: DaemonStatusView;
  model?: string;
  permissionMode: PermissionModeId;
  backgroundTasks: readonly BackgroundProcessView[];
  activeSwarm?: SwarmStatusView | null;
  sessionCredits?: number;
  isStreaming?: boolean;
  signedIn?: boolean;
}

function summarizeSwarmCounts(swarm?: SwarmStatusView | null): {
  runningAgents: number;
  blockedAgents: number;
  totalWorkers: number;
} {
  if (!swarm || swarm.agents.length === 0) {
    return { runningAgents: 0, blockedAgents: 0, totalWorkers: 0 };
  }
  const workers = swarm.agents.filter((a) => a.role === "worker");
  const pool = workers.length > 0 ? workers : swarm.agents;
  const runningAgents = pool.filter(
    (a) => a.status === "running" || a.status === "spawned",
  ).length;
  const blockedAgents = pool.filter((a) => a.status === "blocked").length;
  return { runningAgents, blockedAgents, totalWorkers: pool.length };
}

export function buildConnectedStatusBarTooltipLines(
  snapshot: StatusBarSnapshot,
): string[] {
  const {
    daemonStatus,
    model,
    permissionMode,
    backgroundTasks,
    activeSwarm,
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
  const { runningAgents, blockedAgents, totalWorkers } =
    summarizeSwarmCounts(activeSwarm);
  const modeLabel = PERMISSION_LABELS[permissionMode] ?? "Ask";
  const versionLabel = formatStatusBarVersionLabel(daemonStatus);

  const tooltipLines = [
    `**RayuCode** (${versionLabel}${
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
  if (runningAgents > 0 || blockedAgents > 0) {
    tooltipLines.push(
      `- **Background Swarm:** ${runningAgents}/${totalWorkers} active${
        blockedAgents > 0 ? ` (${blockedAgents} blocked)` : ""
      }`,
    );
  }
  if (sessionCredits !== undefined && sessionCredits > 0) {
    tooltipLines.push(
      `- **Session Credits:** ${formatRayuCredits(sessionCredits)}`,
    );
  }
  tooltipLines.push("- *Click for RayuCode Quick Actions*");
  return tooltipLines;
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
    const vscodeApi = getVscode();
    this.item = vscodeApi.window.createStatusBarItem(
      "rayucode.status",
      vscodeApi.StatusBarAlignment.Right,
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
    const vscodeApi = getVscode();
    const {
      daemonStatus,
      model,
      permissionMode,
      backgroundTasks,
      activeSwarm,
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
    const { runningAgents, blockedAgents } = summarizeSwarmCounts(activeSwarm);
    this.activeRunningTasks = runningCount + runningAgents + blockedAgents;

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
      this.item.tooltip = new vscodeApi.MarkdownString(
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
          ? new vscodeApi.ThemeColor("statusBarItem.warningBackground")
          : undefined;
      const offlineLines = [
        "**RayuCode Runtime Offline**",
        ...(daemonStatus.error ? [daemonStatus.error] : []),
        ...(signedIn === false ? ["- **Account:** Signed out"] : []),
        "- *Click for RayuCode Quick Actions*",
      ];
      this.item.tooltip = new vscodeApi.MarkdownString(offlineLines.join("\n"));
      return;
    }

    if (
      daemonStatus.state === "connecting" ||
      daemonStatus.state === "starting" ||
      daemonStatus.state === "reconnecting"
    ) {
      this.item.text = "$(sync~spin) Rayu · Connecting";
      this.item.backgroundColor = undefined;
      this.item.tooltip = new vscodeApi.MarkdownString(
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
      if (runningAgents > 0) {
        parts.push(`${runningAgents} ${runningAgents === 1 ? "agent" : "agents"}`);
      }
      if (runningCount > 0) {
        parts.push(`${runningCount} bg`);
      }
      this.item.text = parts.join(" · ");
    } else {
      const parts = [`$(rayucode) ${modelLabel}`, modeLabel];
      if (runningAgents > 0) {
        parts.push(`${runningAgents} ${runningAgents === 1 ? "agent" : "agents"}`);
      }
      if (runningCount > 0) {
        parts.push(`${runningCount} bg`);
      }
      if (sessionCredits !== undefined && sessionCredits > 0) {
        parts.push(`${formatRayuCredits(sessionCredits)} cr`);
      }
      this.item.text = parts.join(" · ");
    }

    this.item.backgroundColor =
      stalledCount > 0 || blockedAgents > 0
        ? new vscodeApi.ThemeColor("statusBarItem.warningBackground")
        : undefined;

    this.item.tooltip = new vscodeApi.MarkdownString(
      buildConnectedStatusBarTooltipLines(snapshot).join("\n"),
    );
  }

  dispose(): void {
    this.item.dispose();
  }
}
