import { randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";
import * as vscode from "vscode";
import { API_VERSION_MAJOR, HarnessError, type ServerFrame } from "@rayu-dev/rayucode-sdk";
import { HarnessSession } from "./harnessSession.js";

const VIEW_ID = "rayucode.chat";
const SESSIONS = "rayucode.preview.sessions";
const SELECTED_SESSION = "rayucode.preview.selectedSession";
type ViewCommand = "newSession" | "resumeSession";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatView(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("rayucode.newSession", () => provider.command("newSession")),
    vscode.commands.registerCommand("rayucode.resumeSession", () => provider.command("resumeSession")),
  );
}

async function chooseWorkspace(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders[0].uri.fsPath;
  if (folders.length === 0) {
    throw new HarnessError("invalid_request", "Open a workspace folder to start a Rayucode session.");
  }
  const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: "Choose the folder for this Rayucode session" });
  if (!folder) throw new HarnessError("cancelled", "Workspace selection cancelled.");
  return folder.uri.fsPath;
}

function socketPath(): string | undefined {
  const path = vscode.workspace.getConfiguration("rayucode").get<string>("runtime.socketPath")?.trim();
  if (path && !isAbsolute(path)) {
    throw new HarnessError("invalid_request", "The Rayucode runtime socket path must be absolute.");
  }
  return path || undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

class ChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private binding?: vscode.Disposable;
  private ready = false;
  private pendingCommand?: ViewCommand;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.binding?.dispose();
    this.view = view;
    const webview = view.webview;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    const postFrame = (frame: ServerFrame) => {
      if (this.view === view) void webview.postMessage({ type: "rayucode.harness.frame", frame });
    };
    const session = new HarnessSession({
      socketPath,
      chooseWorkspace,
      sessions: () => this.context.workspaceState.get<string[]>(SESSIONS, []),
      selected: () => this.context.workspaceState.get<string>(SELECTED_SESSION),
      remember: async (id, created) => {
        if (created) {
          const ids = this.context.workspaceState.get<string[]>(SESSIONS, []);
          await this.context.workspaceState.update(SESSIONS, [...ids, id]);
        }
        await this.context.workspaceState.update(SELECTED_SESSION, id);
      },
      emit: postFrame,
    });
    const messageListener = webview.onDidReceiveMessage(async (raw: unknown) => {
      const message = record(raw);
      if (!message || !vscode.workspace.isTrusted) return;
      if (message.type === "rayucode.webview.ready") {
        this.ready = true;
        this.deliverCommand();
      } else if (message.type === "rayucode.host.copyToClipboard") {
        if (typeof message.text === "string" && message.text.length <= 1_000_000) {
          await vscode.env.clipboard.writeText(message.text);
        }
      } else if (message.type === "rayucode.harness.request") {
        const frame = record(message.frame);
        if (!frame || frame.v !== API_VERSION_MAJOR || typeof frame.id !== "number" || !Number.isSafeInteger(frame.id)) return;
        const reply = { v: API_VERSION_MAJOR, reply_to: frame.id };
        try {
          postFrame({ ...await session.request(frame), ...reply });
        } catch (error) {
          postFrame({
            ...reply,
            ev: "error",
            code: "internal",
            message: error instanceof Error ? error.message : "Rayu could not complete the request.",
          });
        }
      }
    });
    const disposalListener = view.onDidDispose(() => {
      if (this.view === view) this.dispose();
    });
    const configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("rayucode.runtime.socketPath")) session.resetConnection();
    });
    this.binding = new vscode.Disposable(() => {
      messageListener.dispose();
      disposalListener.dispose();
      configurationListener.dispose();
      session.dispose();
      this.view = undefined;
      this.ready = false;
    });
    webview.html = chatHtml(webview, media);
  }

  async command(command: ViewCommand): Promise<void> {
    this.pendingCommand = command;
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    this.deliverCommand();
  }

  private deliverCommand(): void {
    if (!this.ready || !this.pendingCommand || !this.view) return;
    void this.view.webview.postMessage({ type: "rayucode.host.command", command: this.pendingCommand });
    this.pendingCommand = undefined;
  }

  dispose(): void {
    this.binding?.dispose();
    this.binding = undefined;
  }
}

function chatHtml(webview: vscode.Webview, media: vscode.Uri): string {
  const nonce = randomBytes(18).toString("base64");
  const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "webview.css"));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "webview.js"));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${css}">
    <title>Rayucode Sessions</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${js}"></script>
  </body>
</html>`;
}
