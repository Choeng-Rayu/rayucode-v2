/**
 * Resolves bundled extension media assets (`rayu-fox.png`, `app-icon.png`, fonts)
 * cleanly in both VS Code Webview (`window.__RAYU_MEDIA_BASE__` / `rayucode.host.init`)
 * and standalone Vite dev harness (`npm run dev:webview`).
 */

declare global {
  interface Window {
    __RAYU_MEDIA_BASE__?: string;
    __RAYU_SURFACE__?: "sidebar" | "editorPanel";
  }
}

let runtimeMediaBaseUri: string | null = null;

export function setMediaBaseUri(uri: string | null | undefined): void {
  if (!uri || !uri.trim()) return;
  runtimeMediaBaseUri = uri.replace(/\/+$/, "");
}

export function getMediaBaseUri(): string {
  if (runtimeMediaBaseUri) return runtimeMediaBaseUri;
  if (typeof window !== "undefined" && typeof window.__RAYU_MEDIA_BASE__ === "string") {
    const trimmed = window.__RAYU_MEDIA_BASE__.trim();
    if (trimmed) {
      return trimmed.replace(/\/+$/, "");
    }
  }
  return "./assets";
}

export function mediaUrl(relativePath: string): string {
  const cleaned = relativePath.replace(/^\/+/, "");
  if (/^(?:https?:|data:|vscode-webview-resource:|vscode-resource:)/i.test(cleaned)) {
    return cleaned;
  }
  const base = getMediaBaseUri();
  return `${base}/${cleaned}`;
}
