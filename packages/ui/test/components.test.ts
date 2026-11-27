import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentActivityBar,
  ChatTranscript,
  Composer,
  DiffViewer,
  ModelSelector,
  PermissionCard,
  SettingsPanel,
  TaskChecklistCard,
  TodoListCard,
  TurnCreditsFooter,
  computeDiffRows,
  renderSafeMarkdown,
} from "../dist/index.js";

test("renderSafeMarkdown sanitizes dangerous HTML and highlights Rust/TS code fences", () => {
  const malicious = [
    "# Heading",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(2)>",
    "[click](javascript:alert(3))",
    "[docs](https://rayu.dev)",
    "```rust",
    "fn main() { println!(\"ok\"); }",
    "```",
  ].join("\n\n");

  const html = renderSafeMarkdown(malicious);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /href="https:\/\/rayu\.dev"/);
  assert.match(html, /language-rust/);
  assert.match(html, /data-copy-code=/);
});

test("TurnCreditsFooter renders canonical CLI-matching credits label and tooltip", () => {
  const completedHtml = renderToStaticMarkup(
    createElement(TurnCreditsFooter, {
      stats: { rayu_credits: 443.76, duration_secs: 3.2, input_tokens: 1500, output_tokens: 240 },
    }),
  );
  assert.match(completedHtml, /Credits: 443\.76/);
  assert.match(completedHtml, /Rayu credits charged for this request: 443\.76/);
  assert.match(completedHtml, /3\.2s/);
  assert.match(completedHtml, /1\.5k in/);

  const streamingHtml = renderToStaticMarkup(
    createElement(TurnCreditsFooter, {
      liveCredits: 12.5,
      streaming: true,
    }),
  );
  assert.match(streamingHtml, /Credits so far: 12\.50/);
});

test("DiffViewer computes line diffs and renders optional native diff action", () => {
  const { added, removed } = computeDiffRows("a\nb\n", "a\nc\nd\n");
  assert.equal(added, 2);
  assert.equal(removed, 1);

  const html = renderToStaticMarkup(
    createElement(DiffViewer, {
      filePath: "src/lib.rs",
      before: "old\n",
      after: "new\n",
      canOpenNativeDiff: true,
      onOpenNativeDiff: () => {},
    }),
  );
  assert.match(html, /src\/lib\.rs/);
  assert.match(html, /\+1/);
  assert.match(html, /-1/);
  assert.match(html, /Open Diff/);
});

test("core shared components render cleanly via SSR for Next.js and VS Code", () => {
  const modelHtml = renderToStaticMarkup(
    createElement(ModelSelector, {
      currentModel: "rayu/claude-sonnet-4",
      currentProvider: "rayu",
      routes: [
        {
          model: "rayu/claude-sonnet-4",
          provider: "rayu",
          api_method: "rayu",
          available: true,
          detail: "Rayu Auth",
        },
      ],
      onSelectModel: () => {},
    }),
  );
  assert.match(modelHtml, /rayu\/claude-sonnet-4 \(rayu\)/);

  const permHtml = renderToStaticMarkup(
    createElement(PermissionCard, {
      permission: {
        requestId: "r1",
        sessionId: "s1",
        toolName: "bash",
        description: "Run tests",
      },
      onRespond: () => {},
    }),
  );
  assert.match(permHtml, /Approve tool: bash/);
  assert.match(permHtml, /Allow always/);

  const activityHtml = renderToStaticMarkup(
    createElement(AgentActivityBar, {
      isStreaming: true,
      status: "running",
      connectionPhase: "connected",
      subagents: [{ session_id: "sub-1", agent_label: "reviewer", status: "running" }],
      backgroundTasks: [{ taskId: "bg-1", label: "Index", summary: "Scanning", percent: 50, done: false }],
    }),
  );
  assert.match(activityHtml, /Subagent reviewer: running/);
  assert.match(activityHtml, /Index \(50%\): Scanning/);

  const transcriptHtml = renderToStaticMarkup(
    createElement(ChatTranscript, {
      entries: [
        { id: "u1", role: "user", content: "Hello", tools: [] },
        {
          id: "a1",
          role: "assistant",
          content: "**Hi!**",
          tools: [{ callId: "t1", name: "read", inputText: "{}", output: "ok", status: "done" }],
          responseStats: { rayu_credits: 1.25 },
        },
      ],
    }),
  );
  assert.match(transcriptHtml, /Credits: 1\.25/);
  assert.match(transcriptHtml, /<code>read<\/code>/);

  const todoHtml = renderToStaticMarkup(
    createElement(TodoListCard, {
      snapshot: {
        todos: [{ content: "Ship Phase 0", status: "in_progress" }],
        plan: {},
        goals: [],
        gate_observations: [],
        long_session_review_due: false,
      },
    }),
  );
  assert.match(todoHtml, /Ship Phase 0/);

  const composerHtml = renderToStaticMarkup(
    createElement(Composer, {
      isStreaming: true,
      onSubmit: () => {},
      onCancel: () => {},
    }),
  );
  assert.match(composerHtml, /Stop/);
  assert.match(composerHtml, /Send/);

  const settingsHtml = renderToStaticMarkup(
    createElement(SettingsPanel, {
      platform: "web",
      routes: [],
      reasoningEffort: "high",
    }),
  );
  assert.match(settingsHtml, /Reasoning Effort/);
});

test("TaskChecklistCard renders empty state, ordered tasks, activeForm, blockers, cancelled exclusion, and completion receipt", () => {
  // Empty list returns empty markup
  const emptyHtml = renderToStaticMarkup(
    createElement(TaskChecklistCard, {
      sessionId: "sess-empty",
      todos: [],
    }),
  );
  assert.equal(emptyHtml, "");

  // Active list preserves 1 -> N order, highlights in_progress + activeForm, excludes cancelled from denominator, renders blockedReason
  const activeHtml = renderToStaticMarkup(
    createElement(TaskChecklistCard, {
      sessionId: "sess-active",
      todos: [
        { id: "1", content: "Audit schema", status: "completed", stage: 1 },
        {
          id: "2",
          content: "Build checklist UI",
          status: "in_progress",
          activeForm: "Building checklist UI",
          stage: 1,
        },
        {
          id: "3",
          content: "Run end-to-end check",
          status: "pending",
          blockedReason: "Waiting on test fixture",
          stage: 2,
        },
        { id: "4", content: "Legacy cleanup", status: "cancelled" },
      ],
    }),
  );

  assert.match(activeHtml, /data-slot="task-checklist-card"/);
  assert.match(activeHtml, /data-testid="task-checklist-card"/);
  assert.match(activeHtml, /data-expanded="true"/);
  assert.match(activeHtml, /data-all-completed="false"/);
  assert.match(activeHtml, /data-testid="task-checklist-toggle"/);
  assert.match(activeHtml, /data-testid="task-checklist-list"/);
  // 1 completed out of 3 active (cancelled excluded)
  assert.match(activeHtml, /data-testid="task-checklist-progress"[^>]*>1\/3</);
  assert.match(activeHtml, /Building checklist UI/);
  assert.match(activeHtml, /Waiting on test fixture/);
  assert.match(activeHtml, /data-todo-status="completed"/);
  assert.match(activeHtml, /data-todo-status="in_progress"/);
  assert.match(activeHtml, /data-todo-status="pending"/);
  assert.match(activeHtml, /data-todo-status="cancelled"/);
  assert.doesNotMatch(activeHtml, /data-testid="task-checklist-dismiss"/);

  // Verify exact 1 -> N DOM order
  const pos1 = activeHtml.indexOf("Audit schema");
  const pos2 = activeHtml.indexOf("Build checklist UI");
  const pos3 = activeHtml.indexOf("Run end-to-end check");
  const pos4 = activeHtml.indexOf("Legacy cleanup");
  assert.ok(pos1 > 0 && pos1 < pos2 && pos2 < pos3 && pos3 < pos4);

  // Collapsed active state shows activeForm in header
  const collapsedActiveHtml = renderToStaticMarkup(
    createElement(TaskChecklistCard, {
      sessionId: "sess-active",
      defaultExpanded: false,
      todos: [
        {
          id: "1",
          content: "Build checklist UI",
          status: "in_progress",
          activeForm: "Building checklist UI",
        },
      ],
    }),
  );
  assert.match(collapsedActiveHtml, /data-expanded="false"/);
  assert.match(collapsedActiveHtml, /Building checklist UI/);
  assert.doesNotMatch(collapsedActiveHtml, /data-testid="task-checklist-list"/);

  // All completed settles into 1-line completion receipt with dismiss control
  const doneHtml = renderToStaticMarkup(
    createElement(TaskChecklistCard, {
      sessionId: "sess-done",
      todos: [
        { id: "1", content: "Step one", status: "completed" },
        { id: "2", content: "Step two", status: "completed" },
        { id: "3", content: "Skipped", status: "cancelled" },
      ],
    }),
  );
  assert.match(doneHtml, /data-all-completed="true"/);
  assert.match(doneHtml, /data-expanded="false"/);
  assert.match(doneHtml, /Completed 2 tasks/);
  assert.match(doneHtml, /data-testid="task-checklist-progress"[^>]*>2\/2</);
  assert.match(doneHtml, /data-testid="task-checklist-dismiss"/);

  // TodoListCard delegates cleanly to TaskChecklistCard
  const wrappedHtml = renderToStaticMarkup(
    createElement(TodoListCard, {
      sessionId: "sess-wrap",
      snapshot: {
        todos: [
          { content: "Legacy snapshot item", status: "done" },
          { title: "In-flight item", status: "in-progress" },
        ],
        plan: {},
        goals: [],
        gate_observations: [],
        long_session_review_due: false,
      },
    }),
  );
  assert.match(wrappedHtml, /data-testid="task-checklist-card"/);
  assert.match(wrappedHtml, /Legacy snapshot item/);
  assert.match(wrappedHtml, /In-flight item/);
  assert.match(wrappedHtml, /data-testid="task-checklist-progress"[^>]*>1\/2</);
});
