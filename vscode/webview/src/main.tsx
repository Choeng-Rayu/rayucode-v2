import * as React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import type { SurfaceKind } from "@shared/vscodeProtocol";

import "./styles/globals.css";

import { TooltipProvider } from "@/components/ui";
import {
  installVsCodePolarityObserver,
  onHostMessage,
  queryClient,
  setMediaBaseUri,
  signalWebviewReady,
  syncAccentToDom,
  syncThemeToDom,
  useAppStore,
} from "@/lib";

import { App } from "./App";

declare global {
  interface Window {
    __RAYU_INITIAL_SURFACE__?: SurfaceKind;
  }
}

function resolveInitialSurface(): SurfaceKind {
  if (typeof window !== "undefined") {
    const injected =
      window.__RAYU_SURFACE__ ?? window.__RAYU_INITIAL_SURFACE__;
    if (injected === "sidebar" || injected === "editorPanel") {
      return injected;
    }
  }
  return "editorPanel";
}

function bootstrapWebview(): void {
  if (typeof window !== "undefined" && window.__RAYU_MEDIA_BASE__) {
    setMediaBaseUri(window.__RAYU_MEDIA_BASE__);
  }

  const initialSurface = resolveInitialSurface();
  const store = useAppStore.getState();
  store.setSurface(initialSurface);
  syncThemeToDom(store.theme, store.resolvedTheme);
  syncAccentToDom(store.accent);

  installVsCodePolarityObserver();

  // Bind host message synchronization prior to signalling readiness so
  // immediate `rayucode.host.init` replies are never missed.
  onHostMessage((msg) => {
    useAppStore.getState().applyHostMessage(msg);
  });

  signalWebviewReady(initialSurface);
}

bootstrapWebview();

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={120}>
          <App />
          <Toaster
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast:
                  "rounded-lg border border-premium-hi bg-popover-solid text-ink shadow-popover text-xs",
                title: "font-medium text-ink",
                description: "text-xs text-muted-ink",
                actionButton:
                  "rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-ink",
                cancelButton:
                  "rounded-md bg-control px-2.5 py-1 text-xs font-medium text-ink",
              },
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
