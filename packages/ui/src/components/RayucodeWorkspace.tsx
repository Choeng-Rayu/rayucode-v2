import { useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { AnyApiEvent, PermissionDecision } from "@rayu-dev/rayucode-sdk/browser";
import { RayucodePlatformProvider } from "../adapter/context.js";
import type { RayucodePlatformAdapter, SettingsAccountSummary } from "../adapter/types.js";
import {
  appendLocalUserMessage,
  applyApiEvent,
  createInitialSessionState,
  resolveLocalPermission,
  type ChatSessionState,
} from "../state/sessionReducer.js";
import { AgentActivityBar } from "./AgentActivityBar.js";
import { ChatTranscript } from "./ChatTranscript.js";
import { Composer } from "./Composer.js";
import { PermissionCard } from "./PermissionCard.js";
import { SessionHeader } from "./SessionHeader.js";
import { SessionSidebar } from "./SessionSidebar.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { TodoListCard } from "./TodoListCard.js";

type Action =
  | { type: "event"; frame: AnyApiEvent }
  | { type: "local_user"; content: string }
  | { type: "permission_resolved"; requestId: string }
  | { type: "hydrate"; patch: Partial<ChatSessionState> };

function workspaceReducer(state: ChatSessionState, action: Action): ChatSessionState {
  switch (action.type) {
    case "event":
      return applyApiEvent(state, action.frame);
    case "local_user":
      return appendLocalUserMessage(state, action.content);
    case "permission_resolved":
      return resolveLocalPermission(state, action.requestId);
    case "hydrate":
      return { ...state, ...action.patch };
  }
}

export interface RayucodeWorkspaceProps {
  adapter: RayucodePlatformAdapter;
  initialSessionId?: string | null;
  showSidebar?: boolean;
  extraSettingsSections?: ReactNode;
}

/**
 * Full shared RayuCode chat workspace rendered identically inside Next.js Web
 * and the VS Code Extension Webview via `RayucodePlatformAdapter`.
 */
export function RayucodeWorkspace({
  adapter,
  initialSessionId = null,
  showSidebar = true,
  extraSettingsSections,
}: RayucodeWorkspaceProps) {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    initialSessionId,
    createInitialSessionState,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [account, setAccount] = useState<SettingsAccountSummary | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = adapter.subscribe((frame) => {
      dispatch({ type: "event", frame });
    });

    let cancelled = false;
    void (async () => {
      try {
        const [sessions, acc] = await Promise.all([
          adapter.listSessions(),
          adapter.getAccountSummary?.() ?? Promise.resolve(undefined),
        ]);
        if (cancelled) return;
        dispatch({ type: "hydrate", patch: { sessions } });
        setAccount(acc);

        const targetId = initialSessionId ?? sessions[0]?.session_id;
        if (targetId) {
          const history = await adapter.attachSession(targetId);
          const runtime = await adapter.getRuntimeInfo(targetId);
          if (cancelled) return;
          dispatch({
            type: "event",
            frame: {
              ev: "history",
              session_id: history.sessionId,
              messages: history.messages,
              images: history.images,
            },
          });
          dispatch({
            type: "event",
            frame: {
              ev: "runtime_info",
              session_id: runtime.sessionId,
              provider: runtime.provider,
              model: runtime.model,
              reasoning_effort: runtime.reasoningEffort,
              auth_method: runtime.authMethod,
              account_label: runtime.accountLabel,
              routes: runtime.routes,
            },
          });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "hydrate",
            patch: { lastError: err instanceof Error ? err.message : String(err) },
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [adapter, initialSessionId]);

  const activeSession = useMemo(
    () => state.sessions.find((s) => s.session_id === state.sessionId),
    [state.sessions, state.sessionId],
  );

  const subagents = useMemo(
    () =>
      state.sessionId
        ? state.sessions.filter((s) => s.parent_session_id === state.sessionId)
        : [],
    [state.sessions, state.sessionId],
  );

  const ensureSessionId = async (): Promise<string> => {
    if (state.sessionId) return state.sessionId;
    const created = await adapter.createSession();
    dispatch({ type: "event", frame: { ev: "attached", session: created } });
    return created.session_id;
  };

  const handleSelectSession = async (sessionId: string) => {
    const history = await adapter.attachSession(sessionId);
    const runtime = await adapter.getRuntimeInfo(sessionId);
    dispatch({
      type: "event",
      frame: {
        ev: "history",
        session_id: history.sessionId,
        messages: history.messages,
        images: history.images,
      },
    });
    dispatch({
      type: "event",
      frame: {
        ev: "runtime_info",
        session_id: runtime.sessionId,
        provider: runtime.provider,
        model: runtime.model,
        reasoning_effort: runtime.reasoningEffort,
        auth_method: runtime.authMethod,
        account_label: runtime.accountLabel,
        routes: runtime.routes,
      },
    });
  };

  const handleNewSession = async () => {
    const created = await adapter.createSession();
    dispatch({ type: "event", frame: { ev: "attached", session: created } });
    dispatch({
      type: "event",
      frame: { ev: "history", session_id: created.session_id, messages: [] },
    });
    const runtime = await adapter.getRuntimeInfo(created.session_id);
    dispatch({
      type: "event",
      frame: {
        ev: "runtime_info",
        session_id: runtime.sessionId,
        provider: runtime.provider,
        model: runtime.model,
        reasoning_effort: runtime.reasoningEffort,
        auth_method: runtime.authMethod,
        account_label: runtime.accountLabel,
        routes: runtime.routes,
      },
    });
  };

  const handleSubmit = async (text: string) => {
    const sid = await ensureSessionId();
    dispatch({ type: "local_user", content: text });
    await adapter.sendMessage(sid, text);
  };

  const handleCancel = async () => {
    if (!state.sessionId) return;
    await adapter.cancelTurn(state.sessionId);
  };

  const handleSelectModel = async (model: string) => {
    const sid = await ensureSessionId();
    await adapter.setModel(sid, model);
  };

  const handlePermission = async (requestId: string, decision: PermissionDecision) => {
    if (!state.sessionId) return;
    dispatch({ type: "permission_resolved", requestId });
    await adapter.respondPermission(state.sessionId, requestId, decision);
  };

  const handleSlashCommand = async (cmd: string) => {
    if (cmd === "/settings") {
      setSettingsOpen(true);
      return;
    }
    if (cmd === "/new") {
      await handleNewSession();
      return;
    }
    if (cmd === "/clear" && state.sessionId && adapter.clearSession) {
      await adapter.clearSession(state.sessionId);
      dispatch({
        type: "event",
        frame: { ev: "history", session_id: state.sessionId, messages: [] },
      });
      return;
    }
    if (cmd === "/compact" && state.sessionId && adapter.compactSession) {
      await adapter.compactSession(state.sessionId);
    }
  };

  return (
    <RayucodePlatformProvider adapter={adapter}>
      <div className="rc-workspace" data-platform={adapter.capabilities.platform}>
        {showSidebar ? (
          <SessionSidebar
            sessions={state.sessions}
            activeSessionId={state.sessionId}
            onSelectSession={(sid) => void handleSelectSession(sid)}
            onNewSession={() => void handleNewSession()}
          />
        ) : null}
        <main className="rc-main">
          <SessionHeader
            title={state.sessionTitle}
            routes={state.routes}
            currentModel={state.model}
            currentProvider={state.provider}
            editStats={activeSession?.edit_stats}
            onSelectModel={(model) => void handleSelectModel(model)}
            onNewSession={() => void handleNewSession()}
            onOpenSettings={() => setSettingsOpen((prev) => !prev)}
          />
          {settingsOpen ? (
            <SettingsPanel
              platform={adapter.capabilities.platform}
              account={account}
              routes={state.routes}
              currentModel={state.model}
              currentProvider={state.provider}
              reasoningEffort={state.reasoningEffort}
              onSelectModel={(model) => void handleSelectModel(model)}
              onSetReasoningEffort={(effort) => {
                if (state.sessionId && adapter.setReasoningEffort) {
                  void adapter.setReasoningEffort(state.sessionId, effort);
                }
              }}
              onSignIn={() => void adapter.startSignIn?.()}
              onSignOut={() => void adapter.signOut?.()}
              onSaveApiKey={
                adapter.setApiKey
                  ? (provider, key) => void adapter.setApiKey?.(provider, key)
                  : undefined
              }
              onClose={() => setSettingsOpen(false)}
              extraSections={extraSettingsSections}
            />
          ) : null}
          {state.lastError ? (
            <div
              role="alert"
              style={{
                padding: "8px 12px",
                borderBlockEnd: "1px solid var(--rc-danger)",
                color: "var(--rc-danger)",
              }}
            >
              {state.lastError}
            </div>
          ) : null}
          <ChatTranscript
            entries={state.entries}
            liveTurnCredits={state.liveTurnCredits}
            onCopyCode={(code) => adapter.copyToClipboard(code)}
          />
          {state.todoState && state.todoState.todos.length > 0 ? (
            <div style={{ paddingInline: "16px", paddingBlockEnd: "8px" }}>
              <TodoListCard snapshot={state.todoState} />
            </div>
          ) : null}
          {state.pendingPermissions.length > 0 ? (
            <div style={{ paddingInline: "16px", paddingBlockEnd: "8px", display: "grid", gap: "8px" }}>
              {state.pendingPermissions.map((perm) => (
                <PermissionCard
                  key={perm.requestId}
                  permission={perm}
                  onRespond={(id, decision) => void handlePermission(id, decision)}
                />
              ))}
            </div>
          ) : null}
          <AgentActivityBar
            isStreaming={state.isStreaming}
            status={state.status}
            connectionPhase={state.connectionPhase}
            subagents={subagents}
            backgroundTasks={Object.values(state.backgroundTasks)}
          />
          <Composer
            isStreaming={state.isStreaming}
            onSubmit={(text) => void handleSubmit(text)}
            onCancel={() => void handleCancel()}
            onSlashCommand={(cmd) => void handleSlashCommand(cmd)}
          />
        </main>
      </div>
    </RayucodePlatformProvider>
  );
}
