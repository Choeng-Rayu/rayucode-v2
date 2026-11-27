export interface WorkspaceRecord {
  id: string;
  name: string;
  path: string;
  canonicalPath: string;
  sessionIds: string[];
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  missingOnDisk?: boolean;
  hidden?: boolean;
}

export interface WorkspaceLedger {
  version: 1;
  updatedAt: number;
  workspaces: WorkspaceRecord[];
  pinnedSessionIds: string[];
  archivedSessionIds: string[];
  unarchiveSlotOrder: Record<string, number>;
  collapsedWorkspaceIds: string[];
  manualWorkspaceOrder: string[];
  migratedSources: string[];
}

export interface WorkspaceChangeEvent {
  ledger: WorkspaceLedger;
  source: "local" | "external";
}

export interface LegacyWorkspaceEntry {
  id?: string;
  name?: string;
  path: string;
  createdAt?: number;
  lastOpenedAt?: number;
  hidden?: boolean;
}

export interface LegacyMigrationInput {
  sourceKey: string;
  workspaces?: LegacyWorkspaceEntry[];
  pinnedSessionIds?: string[];
  archivedSessionIds?: string[];
  collapsedWorkspaceIds?: string[];
  manualWorkspaceOrder?: string[];
  hiddenWorkspacePaths?: string[];
  sessionAssignments?: Array<{ workspacePath: string; sessionId: string }>;
}

export interface WorkspaceRegistryOptions {
  filePath?: string;
  staleLockMs?: number;
  lockTimeoutMs?: number;
  watchDebounceMs?: number;
  enableWatch?: boolean;
}

export interface HarnessFrameLike {
  ev?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface SessionClientLike {
  on(event: "event", listener: (frame: HarnessFrameLike) => void): unknown;
  on(event: "error", listener: (err: unknown) => void): unknown;
  once(event: "close", listener: () => void): unknown;
  detachSession?(sessionId: string): Promise<unknown>;
  close(): void;
}

export interface SessionSocketPoolOptions<TClient extends SessionClientLike> {
  maxIdleClients?: number;
  dialClient: () => Promise<TClient>;
  onFrame?: (frame: HarnessFrameLike, sessionId: string, client: TClient) => void;
  onSessionClosed?: (
    sessionId: string,
    client: TClient,
    wasActiveTurn: boolean
  ) => void;
  onClientEvicted?: (sessionId: string, client: TClient) => void;
  disconnectMessage?: string;
}
