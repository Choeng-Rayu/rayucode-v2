import { describe, expect, it } from "vitest";
import {
  parseSlashInvocation,
  type SlashCommandDescriptor,
  type SlashSkillDescriptor,
} from "../../src/client/index.js";

const SAMPLE_COMMANDS: SlashCommandDescriptor[] = [
  {
    name: "compact",
    description: "Summarize earlier conversation history",
    category: "session",
    requires_session: true,
    dispatch: { kind: "api_request", req: "compact" },
  },
  {
    name: "effort",
    description: "Set reasoning effort",
    category: "model",
    arg_hint: "none|minimal|low|medium|high|xhigh|max",
    requires_session: true,
    dispatch: { kind: "api_request", req: "set_reasoning_effort" },
  },
  {
    name: "model",
    description: "Switch active model",
    category: "model",
    arg_hint: "<model-id>",
    requires_session: true,
    dispatch: { kind: "api_request", req: "set_model" },
  },
  {
    name: "mode",
    description: "Switch permission mode",
    category: "tools",
    requires_session: true,
    dispatch: { kind: "api_request", req: "set_permission_mode" },
  },
  {
    name: "rewind",
    description: "Rewind to message index",
    category: "session",
    requires_session: true,
    dispatch: { kind: "api_request", req: "rewind" },
  },
  {
    name: "rename",
    description: "Rename session",
    category: "session",
    requires_session: true,
    dispatch: { kind: "api_request", req: "rename_session" },
  },
  {
    name: "save",
    description: "Bookmark session",
    category: "session",
    requires_session: true,
    dispatch: { kind: "api_request", req: "set_session_saved" },
  },
  {
    name: "review",
    description: "Run automated code review",
    category: "quality",
    arg_hint: "[focus]",
    requires_session: true,
    dispatch: { kind: "runtime_command", command: "review" },
  },
  {
    name: "refresh-models",
    description: "Refresh provider model catalogs",
    category: "model",
    requires_session: true,
    dispatch: { kind: "runtime_command", command: "refresh_model_list" },
  },
  {
    name: "search",
    description: "Search transcripts",
    category: "session",
    requires_session: true,
    dispatch: { kind: "runtime_command", command: "session_search" },
  },
];

const SAMPLE_SKILLS: SlashSkillDescriptor[] = [
  { name: "my-skill", description: "Custom workspace skill" },
  { name: "deploy", description: "Deploy helper" },
  { name: "invalid skill name", description: "Should be ignored due to whitespace" },
];

describe("parseSlashInvocation", () => {
  it("dispatches api_request commands with structured params", () => {
    expect(parseSlashInvocation("/compact", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "api_request",
      req: "compact",
      slashName: "compact",
      rawArgs: "",
      params: {},
    });

    expect(parseSlashInvocation("/effort high", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "api_request",
      req: "set_reasoning_effort",
      slashName: "effort",
      rawArgs: "high",
      params: { effort: "high" },
    });

    expect(
      parseSlashInvocation("/model claude-sonnet-4-6", SAMPLE_COMMANDS, SAMPLE_SKILLS),
    ).toEqual({
      kind: "api_request",
      req: "set_model",
      slashName: "model",
      rawArgs: "claude-sonnet-4-6",
      params: { model: "claude-sonnet-4-6" },
    });

    expect(parseSlashInvocation("/mode accept_edits", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "api_request",
      req: "set_permission_mode",
      slashName: "mode",
      rawArgs: "accept_edits",
      params: { mode: "accept_edits" },
    });

    expect(parseSlashInvocation("/rewind 4", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "api_request",
      req: "rewind",
      slashName: "rewind",
      rawArgs: "4",
      params: { message_index: 4 },
    });

    expect(parseSlashInvocation("/rename Fix auth flow", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "api_request",
      req: "rename_session",
      slashName: "rename",
      rawArgs: "Fix auth flow",
      params: { title: "Fix auth flow" },
    });

    expect(parseSlashInvocation("/save v1.16 release", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "api_request",
      req: "set_session_saved",
      slashName: "save",
      rawArgs: "v1.16 release",
      params: { saved: true, label: "v1.16 release" },
    });
  });

  it("dispatches runtime_command commands with mapped engine command name and parsed args", () => {
    expect(parseSlashInvocation("/review", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "runtime_command",
      command: "review",
      slashName: "review",
      args: [],
      rawArgs: "",
    });

    expect(
      parseSlashInvocation('/review src/app.ts "focus on auth"', SAMPLE_COMMANDS, SAMPLE_SKILLS),
    ).toEqual({
      kind: "runtime_command",
      command: "review",
      slashName: "review",
      args: ["src/app.ts", "focus on auth"],
      rawArgs: 'src/app.ts "focus on auth"',
    });

    expect(parseSlashInvocation("/refresh-models", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "runtime_command",
      command: "refresh_model_list",
      slashName: "refresh-models",
      args: [],
      rawArgs: "",
    });
  });

  it("dispatches registered skills via /name and $name, preserving multiline prompts", () => {
    expect(
      parseSlashInvocation("/my-skill fix bug\nin parser", SAMPLE_COMMANDS, SAMPLE_SKILLS),
    ).toEqual({
      kind: "skill_prompt",
      skill: "my-skill",
      prompt: "fix bug\nin parser",
    });

    expect(parseSlashInvocation("$deploy staging", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "skill_prompt",
      skill: "deploy",
      prompt: "staging",
    });

    expect(parseSlashInvocation("/MY-SKILL", SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
      kind: "skill_prompt",
      skill: "my-skill",
      prompt: "",
    });
  });

  it("dispatches command descriptors whose dispatch kind is skill", () => {
    const skillCmds: SlashCommandDescriptor[] = [
      {
        name: "triage",
        dispatch: { kind: "skill", name: "issue-triage" },
      },
    ];
    expect(parseSlashInvocation("/triage #42", skillCmds, [])).toEqual({
      kind: "skill_prompt",
      skill: "issue-triage",
      prompt: "#42",
    });
  });

  it("keeps paths, leading-space escapes, unknown commands, and plain text as plain_prompt", () => {
    const plainCases = [
      "/usr/local/bin",
      "/etc/hosts check this file",
      " /model claude-sonnet-4-6",
      "\t/compact",
      " $my-skill literal",
      "/unknown-cmd arg1",
      "$100 budget",
      "/",
      "/ ",
      "   ",
      "",
      "Explain how /compact works in general",
    ];

    for (const input of plainCases) {
      expect(parseSlashInvocation(input, SAMPLE_COMMANDS, SAMPLE_SKILLS)).toEqual({
        kind: "plain_prompt",
        text: input,
      });
    }
  });
});
