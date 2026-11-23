#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "../..")
const outDir = path.join(repoRoot, ".swarm-logs", "verify")

async function loadPlaywright() {
  const candidates = [
    "playwright",
    "/Users/lyyeakkhai/.gemini/gstack/node_modules/playwright/index.mjs",
  ]
  for (const modPath of candidates) {
    try {
      return await import(modPath)
    } catch {
      // try next candidate
    }
  }
  throw new Error("Could not resolve Playwright module for screenshot capture.")
}

const VISUAL_MODES = [
  { id: "dark-green", theme: "dark", accent: "green", expectedBg: "rgb(17, 17, 14)" },
  { id: "dark-blue", theme: "dark", accent: "blue", expectedBg: "rgb(17, 17, 14)" },
  { id: "light-green", theme: "light", accent: "green", expectedBg: "rgb(247, 247, 244)" },
]

const VIEWS = [
  {
    id: "home",
    query: (m) => `?route=home&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-testid="home-view"]',
    interact: async (page) => {
      const trigger = page.locator('[data-testid="model-effort-trigger"]').first()
      await trigger.click()
      await page.locator('[role="dialog"][aria-label="Reasoning effort"]').waitFor({ state: "visible" })
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
      })
    },
  },
  {
    id: "workspace",
    query: (m) => `?route=workspace&tab=overview&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-slot="chat-stream"]',
    interact: async (page) => {
      const traceBtn = page.locator('[data-slot="work-trace"] > button').first()
      await traceBtn.click()
      const shellBtn = page.locator('[data-slot="shell-command-row"] > button').first()
      if ((await shellBtn.count()) > 0) {
        await shellBtn.click()
      }
      const ctxRowBtn = page.locator('section[aria-label="Context"] button').first()
      if ((await ctxRowBtn.count()) > 0) {
        await ctxRowBtn.click()
      }
    },
  },
  {
    id: "code-viewer",
    query: (m) =>
      `?route=workspace&tab=code&file=lookup.rs&line=21&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-testid="active-doc-pill"]',
    interact: async (page) => {
      await page.waitForTimeout(250)
    },
  },
  {
    id: "browser-fullview",
    query: (m) =>
      `?route=workspace&tab=browser&fullview=1&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-testid="browser-pane"]',
    interact: async (page) => {
      await page.waitForTimeout(150)
    },
  },
  {
    id: "excel-session",
    query: (m) =>
      `?route=workspace&session=ses_q4_excel&tab=excel&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-testid="excel-pane"]',
    interact: async (page) => {
      await page.waitForTimeout(150)
    },
  },
  {
    id: "swarm",
    query: (m) => `?route=swarm&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-slot="swarm-view"]',
    interact: async (page) => {
      await page.waitForTimeout(150)
    },
  },
  {
    id: "automations",
    query: (m) => `?route=automations&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-testid="automations-view"]',
    interact: async (page) => {
      const eventLogBtn = page.locator('button:has-text("Event log")').first()
      if ((await eventLogBtn.count()) > 0) {
        await eventLogBtn.click()
      }
      await page.waitForTimeout(150)
    },
  },
  {
    id: "plugins",
    query: (m) => `?route=plugins&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-testid="plugins-view"]',
    interact: async (page) => {
      await page.waitForTimeout(150)
    },
  },
  {
    id: "changes",
    query: (m) => `?route=changes&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-testid="changes-view"]',
    interact: async (page) => {
      await page.waitForTimeout(250)
    },
  },
  {
    id: "telegram",
    query: (m) => `?route=telegram&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-testid="telegram-view"]',
    interact: async (page) => {
      await page.waitForTimeout(150)
    },
  },
  {
    id: "settings",
    query: (m) => `?route=settings&theme=${m.theme}&accent=${m.accent}`,
    waitFor: '[data-testid="settings-view"]',
    interact: async (page) => {
      const appearanceBtn = page.locator('[data-testid="settings-nav-appearance"]')
      await appearanceBtn.click()
      await page.locator('[data-testid="appearance-panel"]').waitFor({ state: "visible" })
    },
  },
]

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const baseUrl = process.env.RAYU_BASE_URL ?? "http://localhost:5173"
  const { chromium } = await loadPlaywright()

  const executableCandidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Users/lyyeakkhai/Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  ]
  const executablePath = executableCandidates.find((p) => fs.existsSync(p))

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 934 },
    deviceScaleFactor: 2,
  })

  const pageErrors = []
  const captured = []

  try {
    const page = await context.newPage()
    page.on("pageerror", (err) => {
      pageErrors.push(err.message)
    })

    for (const view of VIEWS) {
      for (const mode of VISUAL_MODES) {
        const url = `${baseUrl}/${view.query(mode)}`
        await page.goto(url, { waitUntil: "networkidle" })
        await page.locator(view.waitFor).first().waitFor({ state: "visible", timeout: 10000 })

        if (view.interact) {
          await view.interact(page)
        }

        // Wait a frame for transitions/fonts to settle
        await page.waitForTimeout(120)

        // Verify data-theme and data-accent attributes
        const attrs = await page.evaluate(() => ({
          theme: document.documentElement.getAttribute("data-theme"),
          accent: document.documentElement.getAttribute("data-accent"),
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))

        if (attrs.theme !== mode.theme) {
          throw new Error(
            `[${view.id}/${mode.id}] Expected data-theme="${mode.theme}", got "${attrs.theme}"`
          )
        }
        if (attrs.accent !== mode.accent) {
          throw new Error(
            `[${view.id}/${mode.id}] Expected data-accent="${mode.accent}", got "${attrs.accent}"`
          )
        }
        if (attrs.scrollWidth > attrs.clientWidth + 1) {
          throw new Error(
            `[${view.id}/${mode.id}] Horizontal viewport overflow: scrollWidth=${attrs.scrollWidth} > clientWidth=${attrs.clientWidth}`
          )
        }

        const fileName = `${view.id}-${mode.id}.png`
        const filePath = path.join(outDir, fileName)
        await page.screenshot({ path: filePath, fullPage: false })
        captured.push(filePath)
        console.log(`✓ Captured ${fileName} (1440×934)`)
      }
    }
  } finally {
    await context.close()
    await browser.close()
  }

  if (pageErrors.length > 0) {
    throw new Error(`Uncaught page errors during parity verification:\n${pageErrors.join("\n")}`)
  }

  console.log(`\nSuccessfully captured and verified ${captured.length} screenshots in ${outDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
