/**
 * Rayu in VS Code's native Accounts menu (`contributes.authentication: id = "rayu"`).
 *
 * Exposes signed-in Rayu account status, Sign In, and Sign Out directly inside
 * VS Code's Accounts menu backed by `RayuHostAuthManager` (while preserving
 * legacy `registerRayuAuthProvider` compatibility).
 *
 * SECURITY: The VS Code `AuthenticationSession.accessToken` is ALWAYS a fixed
 * placeholder (`rayucode-account`) so Rayu's real OAuth JWT / API key never
 * leaves the extension host or leaks to third-party VS Code extensions.
 */

import * as vscode from "vscode";
import type { AccountStatusView } from "../../shared/vscodeProtocol.js";
import {
  PLACEHOLDER_ACCESS_TOKEN,
  RAYU_AUTH_PROVIDER_ID,
  RAYU_AUTH_PROVIDER_LABEL,
  diffSessions,
  sessionFor,
  type AccountSessionLike,
  type AccountUser,
} from "./authProviderCore.js";
import type { RayuHostAuthManager } from "./rayuHostAuthManager.js";

export { RAYU_AUTH_PROVIDER_ID, RAYU_AUTH_PROVIDER_LABEL };

export interface RayuAuthProviderDeps {
  currentUser(): AccountUser | null;
  /** Optional raw session builder when user id is non-numeric (e.g. API key). */
  currentSession?(): AccountSessionLike | null;
  /** The editor-native sign-in. Resolves once it has finished, successfully or not. */
  signIn(): Promise<void>;
  /** Sign out, without asking again: the Accounts menu has already asked. */
  signOut(): Promise<void>;
}

export function sessionFromAccountStatus(
  status: AccountStatusView,
): AccountSessionLike | null {
  if (!status.signedIn) return null;
  const numericId = status.userId ? Number(status.userId) : NaN;
  if (Number.isFinite(numericId) && numericId > 0) {
    return sessionFor({
      id: numericId,
      email: status.email ?? null,
      displayName: status.displayName ?? null,
    });
  }
  const accountId =
    status.userId?.trim() ||
    status.email?.trim() ||
    (status.authMethod === "apiKey" ? "api-key" : "rayu-user");
  const label =
    status.displayName?.trim() ||
    status.email?.trim() ||
    (status.authMethod === "apiKey" ? "Rayu API Key" : "Rayu account");
  return {
    id: `rayu-${accountId}`,
    accessToken: PLACEHOLDER_ACCESS_TOKEN,
    account: { id: accountId, label },
    scopes: [],
  };
}

export class RayuAuthProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  private readonly changes =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.changes.event;
  private last: AccountSessionLike | null;

  constructor(private readonly deps: RayuAuthProviderDeps) {
    this.last = this.current();
  }

  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    const session = this.current();
    return session ? [session] : [];
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    await this.deps.signIn();
    const session = this.current();
    if (!session) throw new Error("Sign-in to Rayu was not completed.");
    this.refresh();
    return session;
  }

  async removeSession(): Promise<void> {
    await this.deps.signOut();
    this.refresh();
  }

  /** Re-read the sign-in and tell VS Code what changed. */
  refresh(): void {
    const next = this.current();
    const change = diffSessions(this.last, next);
    this.last = next;
    if (change) this.changes.fire(change);
  }

  dispose(): void {
    this.changes.dispose();
  }

  private current(): AccountSessionLike | null {
    if (this.deps.currentSession) {
      return this.deps.currentSession();
    }
    const user = this.deps.currentUser();
    return user ? sessionFor(user) : null;
  }
}

/**
 * Register `RayuAuthProvider` and silently announce the session so VS Code's
 * native Accounts menu displays the signed-in Rayu account.
 */
export function registerRayuAuthProvider(
  context: vscode.ExtensionContext,
  deps: RayuAuthProviderDeps,
): RayuAuthProvider {
  const provider = new RayuAuthProvider(deps);
  const announce = (): void => {
    void Promise.resolve(
      vscode.authentication.getSession(RAYU_AUTH_PROVIDER_ID, [], {
        silent: true,
      }),
    ).catch(() => {
      // Only affects whether the Accounts menu lists the account.
    });
  };
  context.subscriptions.push(
    provider,
    vscode.authentication.registerAuthenticationProvider(
      RAYU_AUTH_PROVIDER_ID,
      RAYU_AUTH_PROVIDER_LABEL,
      provider,
      { supportsMultipleAccounts: false },
    ),
    provider.onDidChangeSessions(() => announce()),
  );
  announce();
  return provider;
}

/**
 * Register `RayuAuthProvider` wired directly to `RayuHostAuthManager`.
 */
export function registerHostRayuAuthProvider(
  context: vscode.ExtensionContext,
  authManager: RayuHostAuthManager,
  openExternal: (url: string) => Promise<void>,
): RayuAuthProvider {
  const provider = registerRayuAuthProvider(context, {
    currentUser: () => null,
    currentSession: () =>
      sessionFromAccountStatus(authManager.getAccountStatusSnapshot()),
    signIn: async () => {
      const started = await authManager.startBrowserSignIn("vscode");
      await openExternal(started.authUrl);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "RayuCode: Waiting for browser sign-in…",
          cancellable: true,
        },
        async (_progress, token) => {
          if (authManager.getAccountStatusSnapshot().signedIn) return;
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              authManager.removeListener("authChanged", onAuthChanged);
              cancelSub.dispose();
              resolve();
            };
            const onAuthChanged = (next: AccountStatusView) => {
              if (next.signedIn || !next.signingIn) {
                finish();
              }
            };
            const cancelSub = token.onCancellationRequested(() => {
              authManager.cancelSignIn();
              finish();
            });
            authManager.on("authChanged", onAuthChanged);
          });
        },
      );
    },
    signOut: async () => {
      await authManager.signOut();
    },
  });

  return provider;
}
