# Product 4: RayuCode Web Developer Guide (Next.js + React)

RayuCode Web (`../rayucode-web`) is the browser-based AI coding agent workspace built with **Next.js (App Router) + React + Tailwind CSS**. It reuses the exact same React UI components, state reducer, sanitized Markdown/code renderer, diff viewer, and Harness `v1.12` protocol as the VS Code extension via **`@rayu-dev/rayucode-ui`** and **`@rayu-dev/rayucode-sdk`**.

> **Boundary vs. `../rayu-web`:** Keep `../rayu-web` focused on the public site, billing/credits (Stripe & KHQR), API key portal, and admin console (as documented in `../rayu-web/PRODUCT.md`), while **RayuCode Web** (`../rayucode-web`) runs the interactive coding agent workspace and shares `DESIGN.md` brand tokens (`#00d992` primary on `#101010` dark canvas, plus WCAG-AA light mode).

---

## Architecture: Next.js + Shared UI + Harness WebSocket Bridge

```text
┌──────────────────────────────────────────────────────────┐
│ Browser (Next.js Client Components, Zero Node Builtins)  │
│                                                          │
│ • packages/ui: @rayu-dev/rayucode-ui                     │
│   <RayucodeWorkspace adapter={wsAdapter} />              │
│   themes/web.css + rayucodeTailwindPreset                │
│ • @rayu-dev/rayucode-sdk/browser (types + rayuCredits)   │
│ • createWebSocketAdapter({ socket })                     │
└───────────────────────────┬──────────────────────────────┘
                            │ wss:// / ws:// /api/harness/ws
                            │ (JSON Protocol v1.12 + Origin & Token Auth)
┌───────────────────────────▼──────────────────────────────┐
│ Server Bridge (Node / Next.js Custom WS Server)          │
│                                                          │
│ • Verifies Origin header + bearer session token          │
│ • Imports `@rayu-dev/rayucode-sdk` (Node)                │
│ • Proxies JSON frames <-> NDJSON unix socket             │
│   (~/.rayu/rayu-api.sock -> rayucode-harness-api-bridge) │
└──────────────────────────────────────────────────────────┘
```

---

## Wiring a Next.js App Router Project (`../rayucode-web`)

### 1. Package Dependencies (`package.json`)
Link directly to `rayucode-v2` during local development:

```json
{
  "dependencies": {
    "@rayu-dev/rayucode-sdk": "file:../rayucode-v2/sdk/typescript",
    "@rayu-dev/rayucode-ui": "file:../rayucode-v2/packages/ui",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

### 2. Next.js Config (`next.config.ts`)

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@rayu-dev/rayucode-ui"],
};

export default nextConfig;
```

### 3. Tailwind Config (`tailwind.config.ts`) & Global CSS (`app/globals.css`)

```ts
import type { Config } from "tailwindcss";
import { rayucodeTailwindPreset } from "@rayu-dev/rayucode-ui/tailwind-preset";

const config: Config = {
  presets: [rayucodeTailwindPreset],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../rayucode-v2/packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
```

In `app/globals.css` (and include `<meta name="color-scheme" content="light dark" />` in `app/layout.tsx` to avoid theme flash):

```css
@import "@rayu-dev/rayucode-ui/styles/tokens.css";
@import "@rayu-dev/rayucode-ui/styles/themes/web.css";
@import "@rayu-dev/rayucode-ui/styles/components.css";

@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 4. Client Workspace Component (`components/WebAgentWorkspace.tsx`)

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  createWebSocketAdapter,
  RayucodeWorkspace,
  type RayucodePlatformAdapter,
} from "@rayu-dev/rayucode-ui";

export function WebAgentWorkspace({
  wsUrl,
  sessionId,
}: {
  wsUrl: string;
  sessionId?: string | null;
}) {
  const [adapter, setAdapter] = useState<RayucodePlatformAdapter | null>(null);

  useEffect(() => {
    const socket = new WebSocket(wsUrl);
    const { adapter: nextAdapter, dispose } = createWebSocketAdapter({ socket });
    const onOpen = () => setAdapter(nextAdapter);
    socket.addEventListener("open", onOpen);
    return () => {
      socket.removeEventListener("open", onOpen);
      dispose();
      socket.close();
    };
  }, [wsUrl]);

  if (!adapter) {
    return <div className="p-4 text-rc-muted">Connecting to RayuCode daemon...</div>;
  }

  return <RayucodeWorkspace adapter={adapter} initialSessionId={sessionId} />;
}
```

### 5. Recommended Next.js Routes
- `/` — Session launcher & workspace overview
- `/s/[sessionId]` — Active coding agent view (`<WebAgentWorkspace sessionId={params.sessionId} />`)
- `/settings` — Reuses `SettingsPanel` from `@rayu-dev/rayucode-ui`

---

## Security Requirements for the WebSocket Bridge

Browsers do not respect Unix file permissions (`0600`) when opening `ws://localhost` connections. Any WebSocket bridge fronting `rayucode-harness-api-bridge` MUST:
1. Bind to `127.0.0.1` by default for local dev (or sit behind authenticated TLS in cloud deployments).
2. Validate both the HTTP `Origin` header and a per-session bearer/query token during the WebSocket upgrade handshake before opening `net.connect(apiSocketPath())`.
3. Never expose raw `~/.rayu/` auth files or `RAYU_API_KEY` values to client browser bundles.

---

## Testing Web + Shared UI Integration

```bash
# Ensure local daemon + bridge are up:
rayu api-bridge

# Verify shared packages in rayucode-v2:
cd /home/rayu/rayu/rayucode-v2 && npm run check:ts
```
