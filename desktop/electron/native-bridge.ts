import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { shell } from "electron"

import { getRayuConfigDir } from "./auth-bridge.js"

export async function openInExcel(filePath: string): Promise<{ ok: boolean }> {
  try {
    const errMsg = await shell.openPath(filePath)
    return { ok: errMsg === "" }
  } catch {
    return { ok: false }
  }
}

export interface PowerPointSlideInput {
  id: string
  kicker?: string
  title: string
  subtitle?: string
  body: string
  bullets?: string[]
  notes?: string
}

export async function openInPowerPoint(input: {
  fileName?: string
  title: string
  slides: PowerPointSlideInput[]
}): Promise<{ ok: boolean; filePath: string }> {
  try {
    const outDir = path.join(getRayuConfigDir(), "presentations")
    fs.mkdirSync(outDir, { recursive: true })
    const safeName =
      (input.fileName ?? input.title)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "") || "rayucode-deck"
    const filePath = path.join(outDir, `${safeName}.html`)

    const slidesHtml = input.slides
      .map(
        (s, idx) => `
      <section class="slide">
        <div class="kicker">${s.kicker ?? `Slide ${idx + 1}`}</div>
        <h1>${s.title}</h1>
        <hr />
        ${s.subtitle ? `<div class="subtitle">${s.subtitle}</div>` : ""}
        <p>${s.body}</p>
        ${
          s.bullets && s.bullets.length > 0
            ? `<ul>${s.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>`
            : ""
        }
      </section>`
      )
      .join("\n")

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${input.title}</title>
<style>
  body { margin: 0; background: rgb(17,17,14); font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: rgb(25,28,36); display: flex; flex-direction: column; align-items: center; gap: 32px; padding: 40px 20px; }
  .slide { width: 960px; min-height: 540px; background: rgb(255,255,255); border-radius: 8px; box-sizing: border-box; padding: 64px 72px; box-shadow: 0 20px 50px rgba(0,0,0,0.45); display: flex; flex-direction: column; }
  .kicker { font-size: 13px; color: rgb(148,163,184); margin-bottom: 28px; }
  h1 { font-size: 44px; line-height: 1.15; color: rgb(49,82,178); margin: 0 0 36px 0; max-width: 720px; }
  hr { border: none; border-top: 1px solid rgb(203,213,225); width: 100%; margin: 0 0 28px 0; }
  .subtitle { font-size: 14px; font-weight: 700; color: rgb(37,71,169); margin-bottom: 14px; }
  p { font-size: 15px; line-height: 1.6; color: rgb(71,85,105); max-width: 560px; margin: 0; }
  ul { margin: 18px 0 0 0; padding-left: 20px; color: rgb(51,65,85); font-size: 15px; line-height: 1.65; }
</style>
</head>
<body>
${slidesHtml}
</body>
</html>`

    fs.writeFileSync(filePath, html, "utf8")

    if (process.platform === "darwin") {
      await new Promise<void>((resolve) => {
        execFile(
          "open",
          ["-a", "Microsoft PowerPoint", filePath],
          (err) => {
            if (err) {
              void shell.openPath(filePath).then(() => resolve())
              return
            }
            resolve()
          }
        )
      })
    } else {
      await shell.openPath(filePath)
    }
    return { ok: true, filePath }
  } catch {
    return { ok: false, filePath: "" }
  }
}

export async function openInVSCode(
  targetPath: string,
  line?: number
): Promise<{ ok: boolean }> {
  const target = line ? `${targetPath}:${line}` : targetPath
  return new Promise((resolve) => {
    execFile("code", ["--goto", target], (err) => {
      if (err) {
        resolve({ ok: false })
        return
      }
      resolve({ ok: true })
    })
  })
}

export async function openExternal(url: string): Promise<{ ok: boolean }> {
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
