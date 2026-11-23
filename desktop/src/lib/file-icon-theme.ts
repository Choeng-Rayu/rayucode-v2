// Semantic chromatic helpers backed strictly by globals.css tokens (zero raw hex).

export type InlineCodeCategory =
  | "folder"
  | "file-ts"
  | "file-rust"
  | "file-doc"
  | "file-data"
  | "component"
  | "command"
  | "symbol"
  | "plain"

export function getFileColorClass(filenameOrPath: string): string {
  const lower = filenameOrPath.trim().toLowerCase()
  if (lower.endsWith("/")) return "text-folder"
  if (/\.(tsx?|jsx?|mjs|cjs)$/.test(lower)) return "text-code-fn"
  if (/\.(rs|toml|c|cpp|h|go|py)$/.test(lower)) return "text-code-num"
  if (/\.(json|ya?ml|env|lock)$/.test(lower)) return "text-code-str"
  if (/\.(md|mdx|txt)$/.test(lower)) return "text-code-type"
  if (/\.(xlsx|xlsm|xls|csv)$/.test(lower)) return "text-office-excel"
  if (/\.(pptx|ppt|key)$/.test(lower)) return "text-office-ppt"
  if (/\.(css|scss|html|svg)$/.test(lower)) return "text-info"
  if (/\.(sh|zsh|bash)$/.test(lower)) return "text-code-kw"
  return "text-code-fn"
}

export function classifyInlineCode(raw: string): InlineCodeCategory {
  const val = raw.trim()
  if (!val) return "plain"

  const hasWhitespace = /\s/.test(val)

  // Folders & directory paths (e.g., `desktop/src/`, `src/features/`)
  if (val.endsWith("/") && !val.startsWith("http") && !hasWhitespace) {
    return "folder"
  }

  // Known single-token file paths (never match multi-word shell commands like `markitdown file.xlsx`)
  if (!hasWhitespace && !val.startsWith(".")) {
    if (/\.(tsx?|jsx?|mjs|cjs|css|html|svg)(:\d+(-\d+)?)?$/i.test(val)) {
      return "file-ts"
    }
    if (/\.(rs|toml|go|py|sh|zsh)(:\d+(-\d+)?)?$/i.test(val)) {
      return "file-rust"
    }
    if (/\.(md|mdx|pptx|ppt)(:\d+(-\d+)?)?$/i.test(val)) {
      return "file-doc"
    }
    if (/\.(json|ya?ml|env|xlsx|xlsm|csv)(:\d+(-\d+)?)?$/i.test(val)) {
      return "file-data"
    }
  }

  // Commands, flags, IPC channels, slash commands, API routes
  if (
    /^(pnpm|npm|npx|yarn|bun|cargo|git|node|tsc|vite|vitest|eslint|pip3?|python3?|uv|brew|curl|gh|docker|make|markitdown|libreoffice|soffice|\/[a-z0-9_-]|rayu:|--[a-z]|GET |POST |PUT |DELETE )/i.test(
      val
    )
  ) {
    return "command"
  }

  // React JSX tags or PascalCase types/components (e.g., `<App/>`, `RayuDaemonClient`)
  if (
    /^<[A-Z][A-Za-z0-9]*[\s/>]/.test(val) ||
    /^[A-Z][a-zA-Z0-9]{2,}$/.test(val)
  ) {
    return "component"
  }

  // Functions, methods, snake_case identifiers, dot-prefixed extensions (`.xlsm`)
  if (
    !hasWhitespace &&
    (/^[a-z_][a-z0-9]*_[a-z0-9_]+$/i.test(val) ||
      /^[a-zA-Z_$][a-zA-Z0-9_$.]*\([^)]*\)$/.test(val) ||
      /^\.[a-z0-9]{2,6}$/i.test(val))
  ) {
    return "symbol"
  }

  return "plain"
}

export interface CodeSyntaxToken {
  text: string
  className: string
}

const CODE_KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "default",
  "const",
  "let",
  "var",
  "function",
  "return",
  "async",
  "await",
  "if",
  "else",
  "switch",
  "case",
  "break",
  "continue",
  "for",
  "while",
  "try",
  "catch",
  "finally",
  "throw",
  "new",
  "class",
  "extends",
  "implements",
  "interface",
  "type",
  "enum",
  "true",
  "false",
  "null",
  "undefined",
  "pub",
  "fn",
  "struct",
  "impl",
  "trait",
  "match",
  "use",
  "mod",
  "mut",
  "ref",
  "self",
  "Self",
  "subgraph",
  "end",
  "flowchart",
  "graph",
  "sequenceDiagram",
])

const TOKEN_PATTERN =
  /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b(?=\s*\()|\b[A-Z][A-Za-z0-9_]*\b|\b[a-z_][A-Za-z0-9_]*\b)/g

export function tokenizeCodeLine(line: string): CodeSyntaxToken[] {
  if (!line) return [{ text: " ", className: "text-code-plain" }]

  const tokens: CodeSyntaxToken[] = []
  let lastIndex = 0
  TOKEN_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = TOKEN_PATTERN.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        text: line.slice(lastIndex, match.index),
        className: "text-code-plain",
      })
    }

    const raw = match[0]
    let className = "text-code-plain"

    if (raw.startsWith("//") || raw.startsWith("#")) {
      className = "text-code-com italic"
    } else if (
      raw.startsWith('"') ||
      raw.startsWith("'") ||
      raw.startsWith("`")
    ) {
      className = "text-code-str"
    } else if (/^\d/.test(raw)) {
      className = "text-code-num"
    } else if (CODE_KEYWORDS.has(raw)) {
      className = "text-code-kw font-medium"
    } else if (/^[A-Z]/.test(raw)) {
      className = "text-code-type"
    } else {
      const nextChar = line[match.index + raw.length]
      if (nextChar === "(") {
        className = "text-code-fn"
      }
    }

    tokens.push({ text: raw, className })
    lastIndex = match.index + raw.length
  }

  if (lastIndex < line.length) {
    tokens.push({
      text: line.slice(lastIndex),
      className: "text-code-plain",
    })
  }

  return tokens
}
