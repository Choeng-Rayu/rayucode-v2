/**
 * Shared pure slash-command & skill invocation parser for RayuCode thin clients
 * (Desktop and VS Code).
 *
 * Mirrors the boundary rules in `src/cli/acp.rs`:
 * - A leading space (or any leading whitespace) escapes slash/skill parsing so
 *   the input is sent literally as a `plain_prompt`.
 * - Path-like inputs (`/usr/local/bin`, `/etc/hosts`) contain `/` inside the
 *   first token and stay `plain_prompt`.
 * - Unknown `/something` tokens stay `plain_prompt` rather than failing locally.
 */

export type SlashCommandCategory =
  | "session"
  | "model"
  | "quality"
  | "tools"
  | "runtime"
  | (string & {});

export type SlashCommandDispatch =
  | { kind: "api_request"; req: string }
  | { kind: "runtime_command"; command: string }
  | { kind: "skill"; name: string };

export interface SlashCommandDescriptor {
  name: string;
  description?: string;
  category?: SlashCommandCategory;
  arg_hint?: string;
  requires_session?: boolean;
  dispatch: SlashCommandDispatch;
}

export interface SlashSkillDescriptor {
  name: string;
  description?: string;
}

export type SlashInvocation =
  | {
      kind: "api_request";
      req: string;
      slashName: string;
      rawArgs: string;
      params: Record<string, unknown>;
    }
  | {
      kind: "runtime_command";
      command: string;
      slashName: string;
      args: string[];
      rawArgs: string;
    }
  | {
      kind: "skill_prompt";
      skill: string;
      prompt: string;
    }
  | {
      kind: "plain_prompt";
      text: string;
    };

function normalizeCanonicalName(name: string): string {
  return name.trim().replace(/^[/\$]+/, "").toLowerCase();
}

/**
 * Split runtime-command arguments on whitespace while respecting simple single
 * and double quotes.
 */
function splitSlashArgs(rawArgs: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const ch = rawArgs[i];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (tokenStarted) {
        args.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }
    current += ch;
    tokenStarted = true;
  }

  if (tokenStarted) {
    args.push(current);
  }
  return args;
}

function buildApiRequestParams(req: string, rawArgs: string): Record<string, unknown> {
  switch (req) {
    case "set_model":
      return rawArgs ? { model: rawArgs } : {};
    case "set_reasoning_effort":
      return rawArgs ? { effort: rawArgs } : {};
    case "set_permission_mode":
      return rawArgs ? { mode: rawArgs } : {};
    case "rename_session":
      return rawArgs ? { title: rawArgs } : {};
    case "set_session_saved":
      return rawArgs ? { saved: true, label: rawArgs } : { saved: true };
    case "rewind": {
      if (/^\d+$/.test(rawArgs)) {
        return { message_index: Number.parseInt(rawArgs, 10) };
      }
      return {};
    }
    default:
      return rawArgs ? { args: rawArgs } : {};
  }
}

function findMatchingSkill(
  tokenLower: string,
  skills: readonly SlashSkillDescriptor[],
): SlashSkillDescriptor | undefined {
  return skills.find((skill) => {
    const trimmed = skill.name.trim();
    if (!trimmed || /\s/.test(trimmed)) return false;
    return normalizeCanonicalName(trimmed) === tokenLower;
  });
}

/**
 * Parse raw composer input against the engine's live `CommandDescriptor[]` and
 * active `skills` list into a typed dispatch action.
 */
export function parseSlashInvocation(
  input: string,
  commands: readonly SlashCommandDescriptor[],
  skills: readonly SlashSkillDescriptor[] = [],
): SlashInvocation {
  const plain: SlashInvocation = { kind: "plain_prompt", text: input };

  // Preserve leading whitespace as an explicit escape (matching src/cli/acp.rs).
  const trimmedEnd = input.trimEnd();
  if (trimmedEnd.length === 0) return plain;

  const prefix = trimmedEnd[0];
  if (prefix !== "/" && prefix !== "$") {
    return plain;
  }

  const body = trimmedEnd.slice(1);
  if (body.length === 0 || /^\s/.test(body)) {
    return plain;
  }

  const match = /^([^\s]+)(?:\s+([\s\S]*))?$/.exec(body);
  if (!match) return plain;

  const token = match[1];
  const rawArgs = (match[2] ?? "").trim();

  // Reject path-like tokens such as `/usr/local/bin` or `/etc/hosts`.
  if (!token || token.includes("/")) {
    return plain;
  }

  const tokenLower = token.toLowerCase();

  if (prefix === "/") {
    const matchedCommand = commands.find(
      (cmd) => normalizeCanonicalName(cmd.name) === tokenLower,
    );
    if (matchedCommand) {
      const dispatch = matchedCommand.dispatch;
      if (dispatch.kind === "api_request") {
        return {
          kind: "api_request",
          req: dispatch.req,
          slashName: matchedCommand.name,
          rawArgs,
          params: buildApiRequestParams(dispatch.req, rawArgs),
        };
      }
      if (dispatch.kind === "runtime_command") {
        return {
          kind: "runtime_command",
          command: dispatch.command,
          slashName: matchedCommand.name,
          args: rawArgs ? splitSlashArgs(rawArgs) : [],
          rawArgs,
        };
      }
      if (dispatch.kind === "skill") {
        return {
          kind: "skill_prompt",
          skill: dispatch.name,
          prompt: rawArgs,
        };
      }
    }
  }

  const matchedSkill = findMatchingSkill(tokenLower, skills);
  if (matchedSkill) {
    return {
      kind: "skill_prompt",
      skill: matchedSkill.name,
      prompt: rawArgs,
    };
  }

  return plain;
}
