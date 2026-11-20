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
