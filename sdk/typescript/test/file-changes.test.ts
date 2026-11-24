import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RayucodeClient,
  HarnessError,
  NdjsonDecoder,
  encodeFrame,
  isKnownEvent,
  KNOWN_EVENT_KINDS,
  KNOWN_REQUEST_KINDS,
  type ApiEvent,
  type ApiRequest,
  type FileChangeActionKind,
  type FileChangeActionResponse,
  type FileChangeConflict,
  type FileChangeDiffPayload,
  type FileChangeEntrySummary,
  type FileChangeHunk,
  type FileChangeKind,
  type FileChangeStatus,
  type FileChangesSnapshot,
} from "../dist/index.js";
import * as browserSdk from "../dist/browser.js";
import { startMockHarness } from "./mock-harness.ts";

const sampleHunk: FileChangeHunk = {
  old_start: 1,
  old_lines: 1,
  new_start: 1,
  new_lines: 2,
  header: "@@ -1,1 +1,2 @@",
  lines: ["-old", "+new", "+added"],
};

const sampleEntry: FileChangeEntrySummary = {
  path: "/repo/src/lib.rs",
  display_path: "src/lib.rs",
  kind: "modified",
  status: "pending",
  additions: 2,
  deletions: 1,
  changed_in_latest_turn: true,
  turn_id: 3,
  edit_count: 2,
  is_binary: false,
  undoable: true,
  can_redo: false,
  preview_hunks: [sampleHunk],
  preview_truncated: false,
  updated_at_ms: 1_700_000_000_000,
};

const sampleSnapshot: FileChangesSnapshot = {
  session_id: "ses_1",
  latest_turn_id: 3,
  total_pending_files: 1,
  total_additions: 2,
  total_deletions: 1,
  files: [sampleEntry],
};

const sampleDiff: FileChangeDiffPayload = {
  path: "/repo/src/lib.rs",
  display_path: "src/lib.rs",
  old_path: "/repo/src/old.rs",
  kind: "renamed",
  status: "pending",
  additions: 2,
  deletions: 1,
  is_binary: false,
  original_content: "old\n",
  modified_content: "new\nadded\n",
  unified_diff: "--- a/src/old.rs\n+++ b/src/lib.rs\n@@ -1,1 +1,2 @@\n-old\n+new\n+added\n",
  hunks: [sampleHunk],
};

const sampleConflict: FileChangeConflict = {
  path: "/repo/src/lib.rs",
  display_path: "src/lib.rs",
  reason: "file modified outside AI session",
};

const sampleActionResponse: FileChangeActionResponse = {
  ok: false,
  message: "1 conflict",
  conflicts: [sampleConflict],
  snapshot: sampleSnapshot,
};

test("file-change request and event tags are registered in main and browser entrypoints", () => {
  for (const req of ["get_file_changes", "get_file_change_diff", "file_change_action"] as const) {
    assert.ok(KNOWN_REQUEST_KINDS.includes(req), `missing request kind ${req}`);
    assert.ok(browserSdk.KNOWN_REQUEST_KINDS.includes(req), `missing browser request kind ${req}`);
  }
  for (const ev of ["file_changes_state", "file_change_diff", "file_change_action_result"] as const) {
    assert.ok(KNOWN_EVENT_KINDS.includes(ev), `missing event kind ${ev}`);
    assert.ok(browserSdk.KNOWN_EVENT_KINDS.includes(ev), `missing browser event kind ${ev}`);
  }
});

test("file-change frames serialize and parse losslessly through NDJSON framing", () => {
  const kinds: FileChangeKind[] = ["created", "modified", "deleted", "renamed"];
  const statuses: FileChangeStatus[] = ["pending", "kept", "undone"];
  const actions: FileChangeActionKind[] = [
    "keep",
    "undo",
    "redo",
    "keep_all",
    "undo_all",
    "redo_all",
  ];
  assert.equal(kinds.length, 4);
  assert.equal(statuses.length, 3);
  assert.equal(actions.length, 6);

  const requests: ApiRequest[] = [
    { req: "get_file_changes", session_id: "ses_1" },
    { req: "get_file_change_diff", session_id: "ses_1", path: "/repo/src/lib.rs" },
    { req: "file_change_action", session_id: "ses_1", action: "undo", path: "/repo/src/lib.rs", force: true },
    { req: "file_change_action", session_id: "ses_1", action: "keep_all" },
  ];

  const events: ApiEvent[] = [
    { ev: "file_changes_state", session_id: "ses_1", snapshot: sampleSnapshot },
    { ev: "file_change_diff", session_id: "ses_1", diff: sampleDiff },
    { ev: "file_change_action_result", session_id: "ses_1", response: sampleActionResponse },
  ];

  const decoder = new NdjsonDecoder();
  const wire = [
    ...requests.map((request, idx) => encodeFrame({ v: 1, id: idx + 1, ...request })),
    ...events.map((event) => encodeFrame({ v: 1, ...event })),
  ].join("");

  const decoded = decoder.push(wire);
  assert.equal(decoded.length, requests.length + events.length);

  const decodedRequests = decoded.slice(0, requests.length) as Array<Record<string, unknown>>;
  assert.equal(decodedRequests[0].req, "get_file_changes");
  assert.equal(decodedRequests[1].req, "get_file_change_diff");
  assert.equal(decodedRequests[1].path, "/repo/src/lib.rs");
  assert.equal(decodedRequests[2].req, "file_change_action");
  assert.equal(decodedRequests[2].action, "undo");
  assert.equal(decodedRequests[2].force, true);
  assert.equal(decodedRequests[3].action, "keep_all");
  assert.equal("path" in decodedRequests[3], false);

  const decodedEvents = decoded.slice(requests.length) as ApiEvent[];
  for (const event of decodedEvents) {
    assert.equal(isKnownEvent(event), true);
  }
  assert.deepEqual(
    decodedEvents[0].ev === "file_changes_state" ? decodedEvents[0].snapshot : null,
    sampleSnapshot,
  );
  assert.deepEqual(
    decodedEvents[1].ev === "file_change_diff" ? decodedEvents[1].diff : null,
    sampleDiff,
  );
  assert.deepEqual(
    decodedEvents[2].ev === "file_change_action_result" ? decodedEvents[2].response : null,
    sampleActionResponse,
  );
});

test("entry without optional old_path or preview_hunks parses cleanly", () => {
  const raw = JSON.stringify({
    v: 1,
    ev: "file_changes_state",
    session_id: "ses_1",
    snapshot: {
      session_id: "ses_1",
      latest_turn_id: 1,
      total_pending_files: 1,
      total_additions: 0,
      total_deletions: 0,
      files: [
        {
          path: "/repo/logo.png",
          display_path: "logo.png",
          kind: "created",
          status: "pending",
          additions: 0,
          deletions: 0,
          changed_in_latest_turn: true,
          turn_id: 1,
          edit_count: 1,
          is_binary: true,
          undoable: true,
          can_redo: false,
          preview_truncated: false,
          updated_at_ms: 1_700_000_000_001,
        },
      ],
    },
  });
  const [frame] = new NdjsonDecoder().push(`${raw}\n`) as ApiEvent[];
  assert.equal(isKnownEvent(frame), true);
  assert.equal(frame.ev, "file_changes_state");
  if (frame.ev === "file_changes_state") {
    assert.equal(frame.snapshot.files[0].old_path, undefined);
    assert.equal(frame.snapshot.files[0].preview_hunks, undefined);
    assert.equal(frame.snapshot.files[0].is_binary, true);
  }
});

test("client round-trips getFileChanges, getFileChangeDiff, fileChangeAction, and helpers", async () => {
  const seenRequests: Array<Record<string, unknown>> = [];
  const server = await startMockHarness({
    capabilities: ["sessions", "streaming", "file_changes"],
    onRequest(request, send) {
      seenRequests.push(request);
      const reply = (frame: Record<string, unknown>) =>
        send({ v: 1, reply_to: request.id, ...frame });
      switch (request.req) {
        case "get_file_changes":
          reply({
            ev: "file_changes_state",
            session_id: request.session_id,
            snapshot: sampleSnapshot,
          });
          break;
        case "get_file_change_diff":
          reply({
            ev: "file_change_diff",
            session_id: request.session_id,
            diff: { ...sampleDiff, path: request.path },
          });
          break;
        case "file_change_action": {
          const isConflict = request.action === "undo" && !request.force;
          reply({
            ev: "file_change_action_result",
            session_id: request.session_id,
            response: isConflict
              ? sampleActionResponse
              : {
                  ok: true,
                  message: `${String(request.action)} applied`,
                  conflicts: [],
                  snapshot: {
                    ...sampleSnapshot,
                    total_pending_files: 0,
                  },
                },
          });
          break;
        }
      }
    },
  });

  const client = await RayucodeClient.connect({ socketPath: server.socketPath });
  try {
    assert.equal(client.supports("file_changes"), true);

    const snapshot = await client.getFileChanges("ses_1");
    assert.deepEqual(snapshot, sampleSnapshot);

    const diff = await client.getFileChangeDiff("ses_1", "/repo/src/lib.rs");
    assert.deepEqual(diff, sampleDiff);

    const conflictResp = await client.fileChangeAction("ses_1", "undo", {
      path: "/repo/src/lib.rs",
    });
    assert.equal(conflictResp.ok, false);
    assert.deepEqual(conflictResp.conflicts, [sampleConflict]);

    const forcedResp = await client.fileChangeAction("ses_1", "undo", {
      path: "/repo/src/lib.rs",
      force: true,
    });
    assert.equal(forcedResp.ok, true);
    assert.equal(forcedResp.snapshot.total_pending_files, 0);

    // Convenience helpers
    await client.keepFileChange("ses_1", "/repo/src/lib.rs");
    await client.keepFileChange("ses_1");
    await client.undoFileChange("ses_1", "/repo/src/lib.rs");
    await client.undoFileChange("ses_1", "/repo/src/lib.rs", { force: true });
    await client.undoFileChange("ses_1");
    await client.undoFileChange("ses_1", undefined, { force: true });
    await client.redoFileChange("ses_1", "/repo/src/lib.rs");
    await client.redoFileChange("ses_1", "/repo/src/lib.rs", { force: true });
    await client.redoFileChange("ses_1");
    await client.redoFileChange("ses_1", undefined, { force: true });

    const stripped = seenRequests.map(({ v, id, ...rest }) => rest);
    assert.deepEqual(stripped, [
      { req: "get_file_changes", session_id: "ses_1" },
      { req: "get_file_change_diff", session_id: "ses_1", path: "/repo/src/lib.rs" },
      { req: "file_change_action", session_id: "ses_1", action: "undo", path: "/repo/src/lib.rs" },
      {
        req: "file_change_action",
        session_id: "ses_1",
        action: "undo",
        path: "/repo/src/lib.rs",
        force: true,
      },
      { req: "file_change_action", session_id: "ses_1", action: "keep", path: "/repo/src/lib.rs" },
      { req: "file_change_action", session_id: "ses_1", action: "keep_all" },
      { req: "file_change_action", session_id: "ses_1", action: "undo", path: "/repo/src/lib.rs" },
      {
        req: "file_change_action",
        session_id: "ses_1",
        action: "undo",
        path: "/repo/src/lib.rs",
        force: true,
      },
      { req: "file_change_action", session_id: "ses_1", action: "undo_all" },
      { req: "file_change_action", session_id: "ses_1", action: "undo_all", force: true },
      { req: "file_change_action", session_id: "ses_1", action: "redo", path: "/repo/src/lib.rs" },
      {
        req: "file_change_action",
        session_id: "ses_1",
        action: "redo",
        path: "/repo/src/lib.rs",
        force: true,
      },
      { req: "file_change_action", session_id: "ses_1", action: "redo_all" },
      { req: "file_change_action", session_id: "ses_1", action: "redo_all", force: true },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("live file_changes_state stream events are filtered by session and error replies reject", async () => {
  const server = await startMockHarness({
    capabilities: ["sessions", "streaming", "file_changes"],
    onRequest(request, send) {
      if (request.req === "get_file_change_diff") {
        send({
          v: 1,
          reply_to: request.id,
          ev: "error",
          code: "invalid_request",
          message: "unknown tracked file",
        });
      }
    },
  });
  const client = await RayucodeClient.connect({ socketPath: server.socketPath });
  const stream = client.events("ses_1");
  try {
    server.broadcast({
      v: 1,
      ev: "file_changes_state",
      session_id: "other_session",
      snapshot: { ...sampleSnapshot, session_id: "other_session" },
    });
    server.broadcast({
      v: 1,
      ev: "file_changes_state",
      session_id: "ses_1",
      snapshot: sampleSnapshot,
    });

    const received = (await stream.next()).value;
    assert.equal(received?.ev, "file_changes_state");
    if (received?.ev === "file_changes_state") {
      assert.equal(received.session_id, "ses_1");
      assert.deepEqual(received.snapshot, sampleSnapshot);
    }

    await assert.rejects(
      () => client.getFileChangeDiff("ses_1", "/repo/missing.rs"),
      (error: unknown) => {
        assert.ok(error instanceof HarnessError);
        assert.equal(error.code, "invalid_request");
        assert.match(error.message, /unknown tracked file/);
        return true;
      },
    );
  } finally {
    await stream.return?.(undefined as never);
    await client.close();
    await server.close();
  }
});
