import type { RpcMethod } from "@shared/vscodeProtocol";
import { toast } from "sonner";
import { useAppStore } from "./app-store";
import { isVsCodeWebview } from "./rpc-client";

const permanentlyUnavailableMethods = new Set<string>([
  "swarm.setLabel",
  "swarm.salvage",
  "swarm.planDecide",
  "automations.overnight.pause",
  "automations.overnight.runNow",
  "plugins.mcp.login",
  "plugins.mcp.logout",
  "plugins.mcp.oauth",
  "plugins.skills.install",
  "plugins.skills.run",
  "plugins.memory.remember",
  "plugins.memory.forget",
  "plugins.memory.tag",
  "plugins.memory.link",
  "plugins.workspace.trigger",
  "remote.cloud.moveToCloud",
  "remote.cloud.returnLocal",
  "remote.cloud.attach",
  "remote.cloud.syncEnv",
  "settings.feedback.submit",
  "settings.voice.update",
]);

const capabilityGatedMethods: Record<string, string> = {
  "swarm.spawn": "swarm_mutations_v1",
  "swarm.kill": "swarm_mutations_v1",
  "swarm.pauseAll": "swarm_mutations_v1",
  "swarm.dm": "swarm_mutations_v1",
  "swarm.broadcast": "swarm_mutations_v1",
  "automations.schedules.toggle": "schedules_cron_v1",
  "automations.schedules.runNow": "schedules_cron_v1",
};

export function operationAvailable(
  method: RpcMethod,
  capabilitiesOverride?: readonly string[],
): boolean {
  // The browser preview has fixture operations for exercising independent components.
  if (!isVsCodeWebview()) return true;
  if (permanentlyUnavailableMethods.has(method)) return false;
  const requiredCap = capabilityGatedMethods[method];
  if (!requiredCap) return true;
  const caps = capabilitiesOverride ?? useAppStore.getState().capabilities;
  return caps.includes(requiredCap);
}

/**
 * Reactive React hook variant of `operationAvailable` that subscribes to live
 * negotiated engine capabilities so buttons unlock immediately after host init.
 */
export function useOperationAvailable(method: RpcMethod): boolean {
  const capabilities = useAppStore((s) => s.capabilities);
  return operationAvailable(method, capabilities);
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
