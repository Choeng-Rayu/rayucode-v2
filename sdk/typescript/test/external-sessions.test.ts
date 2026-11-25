import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RayucodeClient,
  type ExternalProjectInfo,
  type ImportExternalSessionItem,
  type ImportExternalSessionsResult,
  type ImportSkipInfo,
  type SessionInfo,
} from "../dist/index.js";
import { startMockHarness } from "./mock-harness.ts";

test("listSessions serializes include_external and sources and decodes external SessionInfo fields", async (t) => {
  const received: any[] = [];
  const externalSession: SessionInfo = {
    session_id: "imported_claude_code_abc",
    status: "idle",
    title: "Refactor auth flow",
    working_dir: "/Users/dev/app",
    updated_at_ms: 1_730_000_000_000,
    source: "claude_code",
    external_session_id: "abc",
    external_path: "/Users/dev/.claude/projects/app/abc.jsonl",
    external_project_name: "app",
    imported: true,
    sync_stale: true,
  };

  const server = await startMockHarness({
    capabilities: ["sessions", "streaming", "external_sessions"],
    onRequest(request, send) {
      received.push(request);
      if (request.req === "list_sessions") {
        send({
          v: 1,
          reply_to: request.id,
          ev: "sessions",
          sessions: [externalSession],
        });
      }
    },
  });
  t.after(() => server.close());

  const client = await RayucodeClient.connect({ socketPath: server.socketPath });
  t.after(() => client.close());

  assert.equal(client.supports("external_sessions"), true);

  const sessions = await client.listSessions({
    includeArchived: false,
    limit: 50,
    includeExternal: true,
    sources: ["claude_code", "codex_desktop"],
  });

  assert.deepEqual(sessions, [externalSession]);
  const { v, id, ...wireReq } = received[0];
  assert.equal(v, 1);
  assert.equal(typeof id, "number");
  assert.deepEqual(wireReq, {
    req: "list_sessions",
    include_archived: false,
    limit: 50,
    include_external: true,
    sources: ["claude_code", "codex_desktop"],
  });
});

test("listExternalProjects sends optional source filter and returns typed ExternalProjectInfo[]", async (t) => {
  const received: any[] = [];
  const projects: ExternalProjectInfo[] = [
    {
      id: "codex_desktop:/Users/dev/repo",
      source: "codex_desktop",
      name: "repo",
      working_dir: "/Users/dev/repo",
      session_count: 1,
      updated_at_ms: 1_730_000_100_000,
      sessions: [
        {
          session_id: "ext_codex_1",
          status: "idle",
          title: "Fix build",
          working_dir: "/Users/dev/repo",
          source: "codex_desktop",
          external_session_id: "thread-1",
          external_path: "/Users/dev/.codex/sessions/thread-1.jsonl",
          external_project_name: "repo",
          imported: false,
          sync_stale: false,
        },
      ],
    },
  ];

  const server = await startMockHarness({
    capabilities: ["sessions", "external_sessions"],
    onRequest(request, send) {
      received.push(request);
      if (request.req === "list_external_projects") {
        send({
          v: 1,
          reply_to: request.id,
          ev: "external_projects",
          projects,
        });
      }
    },
  });
  t.after(() => server.close());

  const client = await RayucodeClient.connect({ socketPath: server.socketPath });
  t.after(() => client.close());

  const allProjects = await client.listExternalProjects();
  assert.deepEqual(allProjects, projects);

  const filtered = await client.listExternalProjects({ source: "codex_desktop" });
  assert.deepEqual(filtered, projects);

  assert.deepEqual(
    received.map(({ v, id, ...req }) => req),
    [
      { req: "list_external_projects" },
      { req: "list_external_projects", source: "codex_desktop" },
    ],
  );
});

test("importExternalSessions serializes items & options and decodes sessions + skipped", async (t) => {
  const received: any[] = [];
  const items: ImportExternalSessionItem[] = [
    {
      source: "claude_desktop",
      external_session_id: "sess-1",
      external_path: "/tmp/claude/sess-1.jsonl",
      working_dir: "/Users/dev/repo",
    },
    {
      source: "codex",
      external_session_id: "sess-2",
    },
  ];

  const importedSession: SessionInfo = {
    session_id: "imported_claude_desktop_sess-1",
    status: "idle",
    title: "Claude Desktop chat",
    working_dir: "/Users/dev/repo",
    source: "claude_desktop",
    external_session_id: "sess-1",
    external_path: "/tmp/claude/sess-1.jsonl",
    imported: true,
    sync_stale: false,
  };

  const skippedItem: ImportSkipInfo = {
    external_session_id: "sess-2",
    source: "codex",
    reason: "conflict",
    message: "Local RayuCode turns exist after import",
    existing_session_id: "imported_codex_sess-2",
  };

  const server = await startMockHarness({
    capabilities: ["sessions", "external_sessions"],
    onRequest(request, send) {
      received.push(request);
      if (request.req === "import_external_sessions") {
        send({
          v: 1,
          reply_to: request.id,
          ev: "external_sessions_imported",
          sessions: [importedSession],
          skipped: [skippedItem],
        });
      }
    },
  });
  t.after(() => server.close());

  const client = await RayucodeClient.connect({ socketPath: server.socketPath });
  t.after(() => client.close());

  const result: ImportExternalSessionsResult = await client.importExternalSessions(
    items,
    { forceResync: true, forkOnConflict: false },
  );

  assert.deepEqual(result, {
    sessions: [importedSession],
    skipped: [skippedItem],
  });

  const { v, id, ...wireReq } = received[0];
  assert.equal(v, 1);
  assert.equal(typeof id, "number");
  assert.deepEqual(wireReq, {
    req: "import_external_sessions",
    items,
    force_resync: true,
    fork_on_conflict: false,
  });
});
