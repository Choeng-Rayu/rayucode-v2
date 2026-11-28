import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { SessionSocketPool } from "../../src/host/session-socket-pool.js";
import type {
  HarnessFrameLike,
  SessionClientLike,
} from "../../src/host/types.js";

class MockSessionClient extends EventEmitter implements SessionClientLike {
  closed = false;
  readonly id: string;

  constructor(id: string) {
    super();
    this.id = id;
  }

  emitFrame(frame: HarnessFrameLike): void {
    this.emit("event", frame);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
}

describe("SessionSocketPool", () => {
  it("keeps running session socket alive when switching to other sessions", async () => {
    let counter = 0;
    const emitted: HarnessFrameLike[] = [];
    const pool = new SessionSocketPool<MockSessionClient>({
      maxIdleClients: 2,
      dialClient: async () => new MockSessionClient(`sock-${++counter}`),
      onFrame: (frame) => emitted.push(frame),
    });

    const a = await pool.acquireForSession("session-a");
    pool.register("session-a", a.client);
    pool.markTurnActive("session-a");

    // Switch to B and C (exceeding cap=2)
    const b = await pool.acquireForSession("session-b");
    pool.register("session-b", b.client);
    pool.setFocusedSession("session-b");

    const c = await pool.acquireForSession("session-c");
    pool.register("session-c", c.client);
    pool.setFocusedSession("session-c");

    // Session A must NOT be evicted because it has an active turn
    expect(a.client.closed).toBe(false);
    expect(pool.get("session-a")).toBe(a.client);
    // Session B was idle and unfocused -> evicted
    expect(b.client.closed).toBe(true);
    expect(pool.get("session-b")).toBeUndefined();

    // Background stream frames for A keep arriving
    a.client.emitFrame({ ev: "text_delta", text: "still streaming" });
    expect(emitted.at(-1)).toEqual({
      ev: "text_delta",
      text: "still streaming",
      session_id: "session-a",
    });
  });

  it("stamps bound session_id on error frames missing session_id", async () => {
    const emitted: HarnessFrameLike[] = [];
    const pool = new SessionSocketPool<MockSessionClient>({
      dialClient: async () => new MockSessionClient("sock-err"),
      onFrame: (frame) => emitted.push(frame),
    });

    const client = await pool.dialFreshClient();
    pool.register("sess-err", client);
    pool.markTurnActive("sess-err");

    client.emitFrame({ ev: "error", message: "Upstream rate limit" });

    expect(emitted).toEqual([
      {
        ev: "error",
        message: "Upstream rate limit",
        session_id: "sess-err",
      },
    ]);
    expect(pool.getActiveTurnSessionIds()).toEqual([]);
  });

  it("synthesizes turn_stopped when a socket closes mid-turn", async () => {
    const emitted: HarnessFrameLike[] = [];
    const pool = new SessionSocketPool<MockSessionClient>({
      dialClient: async () => new MockSessionClient("sock-drop"),
      onFrame: (frame) => emitted.push(frame),
    });

    const client = await pool.dialFreshClient();
    pool.register("sess-drop", client);
    pool.markTurnActive("sess-drop");

    client.close();

    expect(emitted).toEqual([
      {
        ev: "turn_stopped",
        reason: "failure",
        session_id: "sess-drop",
        message: "Connection to Rayu daemon lost.",
      },
    ]);
    expect(pool.get("sess-drop")).toBeUndefined();
    expect(pool.getActiveTurnSessionIds()).toEqual([]);
  });

  it("temporarily exceeds cap when all sockets have active turns and drains when idle", async () => {
    let counter = 0;
    const pool = new SessionSocketPool<MockSessionClient>({
      maxIdleClients: 2,
      dialClient: async () => new MockSessionClient(`sock-${++counter}`),
    });

    const c1 = await pool.dialFreshClient();
    pool.register("s1", c1);
    pool.markTurnActive("s1");

    const c2 = await pool.dialFreshClient();
    pool.register("s2", c2);
    pool.markTurnActive("s2");

    const c3 = await pool.dialFreshClient();
    pool.register("s3", c3);
    pool.markTurnActive("s3");

    expect(pool.size()).toBe(3);
    expect(c1.closed).toBe(false);

    // Finish s1 -> pool drains back down to cap=2 by evicting s1
    c1.emitFrame({ ev: "turn_done" });
    expect(c1.closed).toBe(true);
    expect(pool.size()).toBe(2);
  });

  it("ignores unsolicited sessionless frames emitted by an unbound client", async () => {
    let counter = 0;
    const emitted: HarnessFrameLike[] = [];
    const pool = new SessionSocketPool<MockSessionClient>({
      dialClient: async () => new MockSessionClient(`sock-${++counter}`),
      onFrame: (frame) => emitted.push(frame),
    });

    const active = await pool.acquireForSession("active-sess");
    pool.register("active-sess", active.client);
    pool.markTurnActive("active-sess");

    // Dial a second client whose attachSession fails (never registered).
    const failed = await pool.acquireForSession("broken-sess");

    // Delayed daemon disconnect on the unbound socket arrives with no session_id.
    failed.client.emitFrame({
      ev: "error",
      code: "internal",
      message: "daemon connection closed",
    });

    expect(emitted).toEqual([]);
    expect(pool.getActiveTurnSessionIds()).toEqual(["active-sess"]);
  });

  it("forwards global sessionless broadcasts once from the primary control client only", async () => {
    let counter = 0;
    const sessionFrames: HarnessFrameLike[] = [];
    const globalFrames: HarnessFrameLike[] = [];
    const pool = new SessionSocketPool<MockSessionClient>({
      dialClient: async () => new MockSessionClient(`sock-${++counter}`),
      onFrame: (frame) => sessionFrames.push(frame),
      onGlobalFrame: (frame) => globalFrames.push(frame),
    });

    const primary = await pool.dialFreshClient();
    pool.setPrimaryControlClient(primary);
    const secondary = await pool.dialFreshClient();
    pool.register("sess-2", secondary);

    primary.emitFrame({ ev: "config_changed", changed_keys: ["provider.default_model"] });
    secondary.emitFrame({ ev: "config_changed", changed_keys: ["provider.default_model"] });
    primary.emitFrame({ ev: "credential_updated", provider: "rayu" });

    expect(globalFrames).toEqual([
      { ev: "config_changed", changed_keys: ["provider.default_model"] },
      { ev: "credential_updated", provider: "rayu" },
    ]);
    expect(sessionFrames).toEqual([]);
  });
});
