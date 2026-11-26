/**
 * Pure history provenance filter shared by Desktop and VS Code.
 *
 * Drops synthetic engine-internal recovery/reconsideration rows
 * (`origin === "engine_internal"` or `visibility === "hidden"`) while
 * preserving `user_typed` and legacy (`origin === undefined`) history rows.
 */

export type ProvenanceOrigin =
  | "user_typed"
  | "engine_internal"
  | "legacy_unknown";

export type ProvenanceVisibility = "visible" | "hidden";

export interface ProvenanceTaggedMessage {
  origin?: ProvenanceOrigin | (string & {}) | null;
  visibility?: ProvenanceVisibility | (string & {}) | null;
}

/**
 * Return `true` when a history message should be rendered in thin-client chat
 * transcripts, and `false` when it is marked engine-internal or hidden.
 */
export function isVisibleHistoryMessage(
  message: ProvenanceTaggedMessage,
): boolean {
  if (message.visibility === "hidden") return false;
  if (message.origin === "engine_internal") return false;
  return true;
}

/**
 * Filter a persisted history array down to user-visible transcript entries.
 */
export function filterVisibleHistory<T extends ProvenanceTaggedMessage>(
  messages: readonly T[],
): T[] {
  return messages.filter(isVisibleHistoryMessage);
}
