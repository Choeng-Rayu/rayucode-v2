import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { isKnownEvent, type SessionInfo } from "@rayu-dev/rayucode-sdk/browser";
import {
  AgentActivityBar,
  ChatTranscript,
  Composer,
  SessionHeader,
  appendLocalUserMessage,
  applyApiEvent,
  createInitialSessionState,
  createPostMessageAdapter,
} from "@rayu-dev/rayucode-ui";
import "@rayu-dev/rayucode-ui/styles/tokens.css";
import "@rayu-dev/rayucode-ui/styles/themes/vscode.css";
import "@rayu-dev/rayucode-ui/styles/components.css";
import "./harnessApp.css";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const { adapter, dispose } = createPostMessageAdapter({
  bridge: {
    postMessage: (message) => vscode.postMessage(message),
    onMessage: (receive) => {
      const listener = (event: MessageEvent) => receive(event.data);
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  },
  capabilities: {
    canOpenLocalFile: false,
    canShowNativeDiff: false,
    canPickWorkspaceFolder: false,
    supportsNativeAccountMenu: false,
  },
});

function Chat() {
  const [state, setState] = useState(() => createInitialSessionState());
  const [sessions, setSessions] = useState<SessionInfo[]>();
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const action = useRef(false);
  const prompt = useRef<{ sessionId: string; text: string } | undefined>(undefined);
  const picker = useRef<HTMLSelectElement>(null);
  const transcript = useRef<HTMLDivElement>(null);

  function report(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "Rayu could not complete the request.");
  }

  async function perform(operation: () => Promise<void>): Promise<boolean> {
    if (action.current) return false;
    action.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      return true;
    } catch (cause) {
      report(cause);
      return false;
    } finally {
      action.current = false;
      setBusy(false);
    }
  }

  async function resume(sessionId: string) {
    await adapter.attachSession(sessionId);
    await adapter.getRuntimeInfo(sessionId);
  }

  function connect() {
    return perform(async () => {
      setConnected(false);
      const available = await adapter.listSessions();
      setSessions(available);
      if (available[0]) await resume(available[0].session_id);
      else setState(createInitialSessionState());
      setConnected(true);
    });
  }

  async function newSession() {
    const session = await adapter.createSession();
    setSessions((previous) => [session, ...(previous ?? [])]);
    setConnected(true);
    await adapter.getRuntimeInfo(session.session_id);
    return session.session_id;
  }

  useEffect(() => {
    const stop = adapter.subscribe((frame) => {
      if (!isKnownEvent(frame)) return;
      if (frame.ev === "error" && "reply_to" in frame) return;
      const disconnected = frame.ev === "connection_phase" && frame.phase === "disconnected";
      if (disconnected) {
        setConnected(false);
        setError("The Rayu connection closed. Reconnect to recover the conversation.");
      }
      if (frame.ev === "session_renamed") {
        const title = frame.display_title || frame.title;
        setSessions((previous) => previous?.map((session) =>
          session.session_id === frame.session_id ? { ...session, title } : session));
      }
      const accepted = prompt.current;
      if (frame.ev === "message_accepted" && accepted?.sessionId === frame.session_id) {
        prompt.current = undefined;
      }
      setState((previous) => {
        let next = previous;
        if (frame.ev === "attached") {
          next = createInitialSessionState();
        }
        if (frame.ev === "message_accepted" && accepted && accepted.sessionId === frame.session_id) {
          next = appendLocalUserMessage(next, accepted.text);
        }
        if (disconnected && next.isStreaming) {
          next = {
            ...next,
            isStreaming: false,
            entries: next.entries.map((entry) => entry.streaming ? { ...entry, streaming: false } : entry),
          };
        }
        return applyApiEvent(next, frame);
      });
    });
    const command = (event: MessageEvent) => {
      if (event.data?.type !== "rayucode.host.command") return;
      if (event.data.command === "newSession") {
        void perform(async () => { await newSession(); });
      } else if (event.data.command === "resumeSession") {
        if (picker.current) picker.current.focus();
        else setError("There are no Rayucode sessions in this workspace yet.");
      }
    };
    window.addEventListener("message", command);
    void connect().finally(() => vscode.postMessage({ type: "rayucode.webview.ready" }));
    return () => {
      stop();
      window.removeEventListener("message", command);
    };
  }, []);

  useEffect(() => {
    const scroller = transcript.current?.querySelector(".rc-transcript");
    if (scroller && (state.isStreaming || state.entries.length === 1)) scroller.scrollTop = scroller.scrollHeight;
  }, [state.entries, state.isStreaming]);

  async function submit(text: string): Promise<boolean> {
    return perform(async () => {
      const id = state.sessionId ?? await newSession();
      prompt.current = { sessionId: id, text };
      try {
        await adapter.sendMessage(id, text);
      } finally {
        prompt.current = undefined;
      }
    });
  }

  return (
    <div className="rc-workspace" data-platform="vscode">
      <main className="rc-main">
        <SessionHeader
          title={state.sessionTitle}
          routes={state.routes}
          currentModel={state.model}
          currentProvider={state.provider}
          modelDisabled={!state.sessionId || !connected || busy || state.isStreaming}
          onSelectModel={(model) => void perform(async () => {
            if (state.sessionId) {
              await adapter.setModel(state.sessionId, model);
              await adapter.getRuntimeInfo(state.sessionId);
            }
          })}
        />
        {sessions?.length ? (
          <select
            className="rc-btn rayu-session-picker"
            ref={picker}
            aria-label="Resume session"
            disabled={busy || state.isStreaming}
            value={state.sessionId ?? ""}
            onChange={(event) => {
              const id = event.target.value;
              if (id) void perform(() => resume(id));
            }}
          >
            <option value="" disabled>Choose a session</option>
            {sessions.map((session) => (
              <option key={session.session_id} value={session.session_id}>
                {session.session_id === state.sessionId ? state.sessionTitle : session.title || "Untitled session"}
              </option>
            ))}
          </select>
        ) : null}
        {(error || state.lastError || !connected) && (
          <div className="rayu-runtime-status" role={error || state.lastError ? "alert" : "status"}>
            <span>{error ?? state.lastError ?? "Connecting to Rayu…"}</span>
            {!busy && <button className="rc-btn" onClick={() => void connect()}>Reconnect</button>}
          </div>
        )}
        <div className="rayu-transcript" ref={transcript}>
          <ChatTranscript
            entries={state.entries}
            liveTurnCredits={state.liveTurnCredits}
            onCopyCode={(text) => adapter.copyToClipboard(text)}
            welcomeSubtitle="Ask a question in this workspace. File and shell tools are disabled in this preview."
          />
        </div>
        <AgentActivityBar
          isStreaming={connected && state.isStreaming}
          status={state.status}
          connectionPhase={connected ? "connected" : "disconnected"}
          subagents={[]}
          backgroundTasks={Object.values(state.backgroundTasks)}
        />
        <Composer
          isStreaming={connected && state.isStreaming}
          disabled={!connected || busy || state.isStreaming}
          placeholder="Message Rayucode"
          slashCommands={[]}
          onSubmit={submit}
          onCancel={() => {
            if (state.sessionId) void adapter.cancelTurn(state.sessionId).catch(report);
          }}
        />
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Chat />);
window.addEventListener("pagehide", () => { root.unmount(); dispose(); }, { once: true });
