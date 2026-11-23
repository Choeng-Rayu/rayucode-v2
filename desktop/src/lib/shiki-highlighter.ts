import { createHighlighterCore, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

import type { ThemeMode } from "./app-store"

export interface HighlightedToken {
  content: string
  color?: string
  tokenClass?: string
}

const MAX_CACHE_ENTRIES = 200
const tokenCache = new Map<string, HighlightedToken[][]>()

const LANG_LOADERS = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
} as const

type SupportedLang = keyof typeof LANG_LOADERS

const LANG_ALIASES: Record<string, SupportedLang> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  rs: "rust",
  rust: "rust",
  py: "python",
  python: "python",
  json: "json",
  jsonc: "json",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  bash: "bash",
  css: "css",
  scss: "css",
  html: "html",
  xml: "html",
  svg: "html",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  go: "go",
  diff: "diff",
}

let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<SupportedLang>()

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import("shiki/themes/vitesse-dark.mjs"),
        import("shiki/themes/vitesse-light.mjs"),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}

export function detectLanguageFromPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : ""
  return LANG_ALIASES[ext] ?? "typescript"
}

function setCached(key: string, value: HighlightedToken[][]): void {
  if (tokenCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = tokenCache.keys().next().value
    if (oldest !== undefined) tokenCache.delete(oldest)
  }
  tokenCache.set(key, value)
}

export async function highlightCodeLines(
  lines: string[],
  language: string,
  theme: ThemeMode
): Promise<HighlightedToken[][]> {
  const normalizedLang: SupportedLang =
    LANG_ALIASES[language.toLowerCase().trim()] ?? "typescript"
  const shikiTheme = theme === "light" ? "vitesse-light" : "vitesse-dark"
  const source = lines.join("\n")
  const cacheKey = `${normalizedLang}::${shikiTheme}::${source}`

  const cached = tokenCache.get(cacheKey)
  if (cached) {
    // Refresh LRU order
    tokenCache.delete(cacheKey)
    tokenCache.set(cacheKey, cached)
    return cached
  }

  const highlighter = await getHighlighter()
  if (!loadedLangs.has(normalizedLang)) {
    const langMod = await LANG_LOADERS[normalizedLang]()
    await highlighter.loadLanguage(langMod)
    loadedLangs.add(normalizedLang)
  }

  const result = highlighter.codeToTokens(source, {
    lang: normalizedLang,
    theme: shikiTheme,
  })

  const mapped: HighlightedToken[][] = result.tokens.map((lineTokens) =>
    lineTokens.length > 0
      ? lineTokens.map((tok) => ({
          content: tok.content,
          color: tok.color,
        }))
      : [{ content: " ", tokenClass: "text-[var(--code-plain)]" }]
  )

  setCached(cacheKey, mapped)
  return mapped
}
