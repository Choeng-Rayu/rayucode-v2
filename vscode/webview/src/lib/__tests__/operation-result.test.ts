import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { operationAvailable, requireOperation } from "../operation-result";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

afterEach(() => {
  delete window.acquireVsCodeApi;
  vi.clearAllMocks();
});

describe("packaged operation results", () => {
  it("rejects a successful RPC envelope whose operation failed", async () => {
    await expect(requireOperation(Promise.resolve({ ok: false, message: "Unsupported" })))
      .rejects.toThrow("Unsupported");
    expect(toast.error).toHaveBeenCalledWith("Unsupported");
  });

  it("gates unavailable operations in an actual webview", () => {
    window.acquireVsCodeApi = () => ({ postMessage() {}, getState: () => undefined, setState() {} });
    expect(operationAvailable("swarm.spawn")).toBe(false);
    expect(operationAvailable("settings.feedback.submit")).toBe(false);
    expect(operationAvailable("swarm.status")).toBe(true);
    expect(operationAvailable("automations.schedules.cancel")).toBe(true);
  });
});
