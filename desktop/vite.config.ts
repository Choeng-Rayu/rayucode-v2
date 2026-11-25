import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

import { RayuAgentsManager } from "./electron/agents-bridge"
import {
  RayuAuthManager,
  type CloudChatMessage,
  type RayuAuthState,
} from "./electron/auth-bridge"
import { RayuDaemonClient } from "./electron/daemon-client"
import {
  AgentsDeleteProfileSchema,
  AgentsSetRoleModelSchema,
  AgentsSetSubagentModelSchema,
  AgentsUpsertProfileSchema,
  TelegramConnectBotTokenSchema,
  TelegramDisconnectSchema,
  TelegramResolveApprovalSchema,
  TelegramSelectSessionSchema,
  TelegramSetRemoteUninstallSchema,
  TelegramStartHostedSchema,
} from "./electron/ipc-schemas"
import { RayuTelegramManager } from "./electron/telegram-bridge"

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim()
        resolve((raw ? JSON.parse(raw) : {}) as T)
      } catch (err) {
        reject(err)
      }
    })
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

/**
 * Dev-only Node middleware bridging `/__rayu_dev/*` to the exact same
 * `RayuAuthManager` used by Electron Main so Rayu Cloud sign-in, API key
 * verification, callback paste, and live SSE streaming work seamlessly in
 * BOTH Electron (`pnpm dev:electron`) and Vite dev (`http://localhost:5173`).
 */
function rayuDevAuthPlugin(): Plugin {
  return {
    name: "rayu-dev-auth-bridge",
    apply: "serve",
    configureServer(server) {
      const authManager = new RayuAuthManager()
      const daemonClient = new RayuDaemonClient()
      const workspaceDir = path.resolve(import.meta.dirname, "..")
      const telegramManager = new RayuTelegramManager(
        daemonClient,
        () => workspaceDir
      )
      const agentsManager = new RayuAgentsManager(
        daemonClient,
        () => workspaceDir
      )
      const sseClients = new Set<ServerResponse>()

      authManager.on("auth-changed", (state: RayuAuthState) => {
        const frame = `data: ${JSON.stringify(state)}\n\n`
        for (const client of sseClients) {
          try {
            client.write(frame)
          } catch {
            sseClients.delete(client)
          }
        }
      })

      server.httpServer?.once("close", () => {
        authManager.dispose()
        daemonClient.dispose()
        for (const client of sseClients) {
          try {
            client.end()
          } catch {
            // ignore
          }
        }
        sseClients.clear()
      })

      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url ?? "").split("?")[0]
        if (!urlPath.startsWith("/__rayu_dev/")) {
          next()
          return
        }

        try {
          if (req.method === "GET" && urlPath === "/__rayu_dev/auth/state") {
            sendJson(res, 200, authManager.getState())
            return
          }

          if (req.method === "GET" && urlPath === "/__rayu_dev/auth/events") {
            res.statusCode = 200
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
            res.setHeader("Cache-Control", "no-cache")
            res.setHeader("Connection", "keep-alive")
            res.write(`data: ${JSON.stringify(authManager.getState())}\n\n`)
            sseClients.add(res)
            req.on("close", () => {
              sseClients.delete(res)
            })
            return
          }

          if (req.method === "POST" && urlPath === "/__rayu_dev/auth/refresh") {
            const state = await authManager.refreshAccountDetails()
            sendJson(res, 200, state)
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/auth/sign-in-browser"
          ) {
            const state = await authManager.signInWithBrowser()
            sendJson(res, 200, state)
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/auth/cancel-sign-in"
          ) {
            const state = authManager.cancelBrowserSignIn()
            sendJson(res, 200, state)
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/auth/sign-in-apikey"
          ) {
            const body = await readJsonBody<{ apiKey?: string }>(req)
            const state = await authManager.signInWithApiKey(body.apiKey ?? "")
            sendJson(res, 200, state)
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/auth/complete-callback"
          ) {
            const body = await readJsonBody<{ callbackUrl?: string }>(req)
            const state = await authManager.completeManualCallback(
              body.callbackUrl ?? ""
            )
            sendJson(res, 200, state)
            return
          }

          if (req.method === "POST" && urlPath === "/__rayu_dev/auth/sign-out") {
            const state = await authManager.signOut()
            sendJson(res, 200, state)
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/cloud/stream-chat"
          ) {
            const body = await readJsonBody<{
              sessionId: string
              model: string
              messages: CloudChatMessage[]
            }>(req)
            res.statusCode = 200
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
            res.setHeader("Cache-Control", "no-cache")
            res.setHeader("Connection", "keep-alive")
            try {
              await authManager.streamCloudChat({
                sessionId: body.sessionId,
                model: body.model,
                messages: body.messages,
                workspaceDir: path.resolve(import.meta.dirname, ".."),
                onEvent: (frame) => {
                  res.write(`data: ${JSON.stringify(frame)}\n\n`)
                },
              })
            } catch (err) {
              res.write(
                `data: ${JSON.stringify({
                  ev: "turn_stopped",
                  session_id: body.sessionId,
                  reason: "failure",
                  message:
                    err instanceof Error
                      ? err.message
                      : "Rayu Cloud stream failed",
                })}\n\n`
              )
            }
            res.end()
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/cloud/cancel-stream"
          ) {
            const body = await readJsonBody<{ sessionId?: string }>(req)
            if (body.sessionId) authManager.cancelStream(body.sessionId)
            sendJson(res, 200, { ok: true })
            return
          }

          if (req.method === "GET" && urlPath === "/__rayu_dev/telegram/state") {
            sendJson(res, 200, await telegramManager.getState())
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/telegram/start-hosted"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = TelegramStartHostedSchema.parse(raw ?? {})
            sendJson(
              res,
              200,
              await telegramManager.startHosted(Boolean(parsed.replaceExisting))
            )
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/telegram/connect-bot-token"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = TelegramConnectBotTokenSchema.parse(raw)
            sendJson(res, 200, await telegramManager.connectBotToken(parsed))
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/telegram/disconnect"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = TelegramDisconnectSchema.parse(raw ?? {})
            sendJson(
              res,
              200,
              await telegramManager.disconnect(Boolean(parsed.localOnly))
            )
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/telegram/resolve-approval"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = TelegramResolveApprovalSchema.parse(raw)
            sendJson(
              res,
              200,
              await telegramManager.resolveApproval(
                parsed.approvalId,
                parsed.decision
              )
            )
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/telegram/set-remote-uninstall"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = TelegramSetRemoteUninstallSchema.parse(raw)
            sendJson(
              res,
              200,
              await telegramManager.setRemoteUninstall(parsed.enabled)
            )
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/telegram/select-session"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = TelegramSelectSessionSchema.parse(raw)
            sendJson(
              res,
              200,
              await telegramManager.selectSession(parsed.sessionId)
            )
            return
          }

          if (req.method === "POST" && urlPath === "/__rayu_dev/telegram/ping") {
            sendJson(res, 200, await telegramManager.sendTestPing())
            return
          }

          if (req.method === "GET" && urlPath === "/__rayu_dev/agents/state") {
            const urlObj = new URL(req.url ?? "", "http://localhost")
            const sessionId = urlObj.searchParams.get("sessionId") ?? undefined
            sendJson(res, 200, await agentsManager.getState(sessionId))
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/agents/set-role-model"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = AgentsSetRoleModelSchema.parse(raw)
            sendJson(res, 200, await agentsManager.setRoleModel(parsed))
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/agents/set-subagent-model"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = AgentsSetSubagentModelSchema.parse(raw)
            sendJson(res, 200, await agentsManager.setSubagentModel(parsed))
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/agents/upsert-profile"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = AgentsUpsertProfileSchema.parse(raw)
            sendJson(res, 200, await agentsManager.upsertProfile(parsed))
            return
          }

          if (
            req.method === "POST" &&
            urlPath === "/__rayu_dev/agents/delete-profile"
          ) {
            const raw = await readJsonBody<unknown>(req)
            const parsed = AgentsDeleteProfileSchema.parse(raw)
            sendJson(res, 200, await agentsManager.deleteProfile(parsed))
            return
          }

          sendJson(res, 404, { error: "Unknown dev bridge route" })
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : "Dev bridge error",
          })
        }
      })
    },
  }
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), rayuDevAuthPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: Boolean(process.env.RAYU_SOURCEMAP),
    chunkSizeWarningLimit: 1500,
  },
})
