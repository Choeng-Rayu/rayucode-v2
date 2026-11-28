import type { RpcMethod } from "@shared/vscodeProtocol";
import { toast } from "sonner";
import { isVsCodeWebview } from "./rpc-client";

const unavailableMethods = new Set<string>([
  "swarm.setLabel", "swarm.spawn", "swarm.kill", "swarm.salvage", "swarm.pauseAll",
  "swarm.planDecide", "swarm.dm", "automations.overnight.pause",
  "automations.overnight.runNow", "automations.schedules.toggle", "automations.schedules.runNow",
  "plugins.mcp.login", "plugins.mcp.logout", "plugins.mcp.oauth", "plugins.skills.install",
  "plugins.skills.run", "plugins.memory.remember", "plugins.memory.forget",
  "plugins.memory.tag", "plugins.memory.link", "plugins.workspace.trigger",
  "remote.cloud.moveToCloud", "remote.cloud.returnLocal", "remote.cloud.attach", "remote.cloud.syncEnv",
  "settings.feedback.submit", "settings.voice.update",
]);

export function operationAvailable(method: RpcMethod): boolean {
  // The browser preview has fixture operations for exercising independent components.
  return !isVsCodeWebview() || !unavailableMethods.has(method);
}

export async function requireOperation<T extends { ok: boolean; message?: string; error?: string }>(
  operation: Promise<T>,
): Promise<T> {
  try {
    const result = await operation;
    if (!result.ok) throw new Error(result.message || result.error || "Rayu could not complete this action.");
    return result;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Rayu could not complete this action.");
    throw error;
  }
}
