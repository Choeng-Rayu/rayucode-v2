import { formatSessionSourceLabel } from "@rayu-dev/rayucode-session-core/client";
import type {
  SessionSourceId,
  SessionSummaryView,
} from "@shared/vscodeProtocol";

import { callRpc } from "./rpc-client";

const SYNTHETIC_EXTERNAL_SESSION_RE =
  /^(claude_code|claude_desktop|codex|codex_desktop|cursor|opencode|pi):(.+)$/;

export function parseSyntheticExternalSessionId(
  sessionId: string,
): { source: SessionSourceId; externalSessionId: string } | null {
  const match = SYNTHETIC_EXTERNAL_SESSION_RE.exec(sessionId.trim());
  if (!match) return null;
  const source = match[1] as SessionSourceId;
  const externalSessionId = match[2]?.trim() ?? "";
  if (!externalSessionId) return null;
  return { source, externalSessionId };
}

export type ExternalSessionOpenTarget = Pick<
  SessionSummaryView,
  | "sessionId"
  | "title"
  | "workingDir"
  | "source"
  | "sourceTool"
  | "externalSessionId"
  | "externalPath"
  | "imported"
  | "syncStale"
>;

export function needsExternalImportOrSync(
  session: ExternalSessionOpenTarget,
): boolean {
  if (parseSyntheticExternalSessionId(session.sessionId) !== null) {
    return true;
  }
  return (
    Boolean(session.externalSessionId) &&
    (session.imported === false || Boolean(session.syncStale))
  );
}

export type ResolveSessionForOpenResult =
  | {
      kind: "open";
      sessionId: string;
      title: string;
      workingDir?: string;
      importedSession?: SessionSummaryView;
      wasImported: boolean;
    }
  | {
      kind: "conflict";
      sessionId: string;
      title: string;
      workingDir?: string;
      message: string;
    }
  | {
      kind: "error";
      message: string;
    };

/**
 * Mirror RayuCode Desktop's external session open/sync contract:
 * - Unimported synthetic sessions (`codex_desktop:<id>`, `claude_code:<id>`, etc.)
 *   and stale imported sessions are materialized via `sessions.importExternal` first.
 * - Conflicts preserve local Rayu turns and offer an "Open synced copy" fork.
 * - Synthetic unimported sessions NEVER fall through into a raw `sessions.attach`
 *   call that would fail with `unknown_session`.
 */
export async function resolveSessionForOpen(
  session: ExternalSessionOpenTarget,
): Promise<ResolveSessionForOpenResult> {
  const parsedSynthetic = parseSyntheticExternalSessionId(session.sessionId);
  const isSyntheticUnimported = parsedSynthetic !== null;
  const shouldImport = needsExternalImportOrSync(session);

  if (!shouldImport) {
    return {
      kind: "open",
      sessionId: session.sessionId,
      title: session.title,
      workingDir: session.workingDir,
      wasImported: false,
    };
  }

  const source =
    session.source ??
    parsedSynthetic?.source ??
    session.sourceTool ??
    "claude_code";
  const externalSessionId =
    session.externalSessionId ??
    parsedSynthetic?.externalSessionId ??
    session.sessionId;

  try {
    const result = await callRpc("sessions.importExternal", {
      items: [
        {
          source,
          externalSessionId,
          ...(session.externalPath ? { externalPath: session.externalPath } : {}),
          ...(session.workingDir ? { workingDir: session.workingDir } : {}),
        },
      ],
    });

    const imported = result.sessions[0];
    if (imported) {
      return {
        kind: "open",
        sessionId: imported.sessionId,
        title: imported.title || session.title,
        workingDir: imported.workingDir ?? session.workingDir,
        importedSession: imported,
        wasImported: true,
      };
    }

    const conflictSkip = result.skipped.find((s) => s.reason === "conflict");
    if (conflictSkip) {
      const targetId = conflictSkip.existingSessionId ?? session.sessionId;
      if (!parseSyntheticExternalSessionId(targetId)) {
        return {
          kind: "conflict",
          sessionId: targetId,
          title: session.title,
          workingDir: session.workingDir,
          message: `Newer messages in ${formatSessionSourceLabel(source)}`,
        };
      }
    }

    const existingSkip = result.skipped.find((s) =>
      Boolean(s.existingSessionId),
    );
    if (existingSkip?.existingSessionId) {
      return {
        kind: "open",
        sessionId: existingSkip.existingSessionId,
        title: session.title,
        workingDir: session.workingDir,
        wasImported: true,
      };
    }

    if (isSyntheticUnimported) {
      const detail = result.skipped[0]?.message || result.skipped[0]?.reason;
      return {
        kind: "error",
        message: detail
          ? `Could not import ${formatSessionSourceLabel(source)} session: ${detail}`
          : `Could not import ${formatSessionSourceLabel(source)} session. Update or reload the RayuCode daemon and try again.`,
      };
    }
  } catch (err) {
    if (isSyntheticUnimported) {
      const msg =
        err instanceof Error ? err.message : "External session import failed.";
      return {
        kind: "error",
        message: `Could not import ${formatSessionSourceLabel(source)} session: ${msg}`,
      };
    }
  }

  // Already-imported session whose background resync was unavailable: open local copy.
  return {
    kind: "open",
    sessionId: session.sessionId,
    title: session.title,
    workingDir: session.workingDir,
    wasImported: false,
  };
}
