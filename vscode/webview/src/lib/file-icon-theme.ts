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
  | "plain";

export function getFileColorClass(filenameOrPath: string): string {
  const lower = filenameOrPath.trim().toLowerCase();
  if (lower.endsWith("/")) return "text-folder";
  if (/\.(tsx?|jsx?|mjs|cjs)$/.test(lower)) return "text-code-fn";
  if (/\.(rs|toml|c|cpp|h|go|py)$/.test(lower)) return "text-code-num";
  if (/\.(json|ya?ml|env|lock)$/.test(lower)) return "text-code-str";
  if (/\.(md|mdx|txt)$/.test(lower)) return "text-code-type";
  if (/\.(xlsx|xlsm|xls|csv)$/.test(lower)) return "text-office-excel";
  if (/\.(pptx|ppt|key)$/.test(lower)) return "text-office-ppt";
  if (/\.(css|scss|html|svg)$/.test(lower)) return "text-info";
  if (/\.(sh|zsh|bash)$/.test(lower)) return "text-code-kw";
  return "text-code-fn";
}

const FILE_LINE_SUFFIX_RE =
  /(?::\d+(?:-\d+|:\d+)?|#L\d+(?:-L?\d+)?)$/i;

const EXTENSIONLESS_FILE_NAMES = new Set([
  "makefile",
  "dockerfile",
  "justfile",
  "procfile",
  "jenkinsfile",
  "vagrantfile",
  "gemfile",
  "rakefile",
  "brewfile",
  "license",
  "readme",
  "changelog",
  "cargo.lock",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".dockerignore",
  ".npmrc",
  ".nvmrc",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".env",
  ".env.local",
  ".env.example",
  ".env.development",
  ".env.production",
  ".env.test",
]);

function stripFileTokenDecorations(raw: string): string {
  let token = raw.trim();
  if (token.startsWith("@") && !token.startsWith("@/")) {
    token = token.slice(1);
  }
  if (/^file:\/\//i.test(token)) {
    token = token.replace(/^file:\/\//i, "");
  }
  return token.replace(FILE_LINE_SUFFIX_RE, "");
}

function classifyPathLikeFile(rawToken: string): InlineCodeCategory | null {
  if (!rawToken || /\s/.test(rawToken)) return null;
  if (/^https?:\/\//i.test(rawToken) || /^mailto:/i.test(rawToken)) return null;

  const cleaned = stripFileTokenDecorations(rawToken);
  if (!cleaned || cleaned.endsWith("/")) return null;

  // Reject bare extensions like `.tsx` or `.json` without a filename stem
  if (/^\.[a-z0-9]{1,8}$/i.test(cleaned)) {
    return null;
  }

  const baseName = cleaned.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (!baseName) return null;

  if (
    /\.(tsx?|jsx?|mjs|cjs|mts|cts|css|scss|sass|less|html?|svg|vue|svelte|astro)$/i.test(
      baseName,
    )
  ) {
    return "file-ts";
  }
  if (
    /\.(rs|toml|go|py|pyi|sh|zsh|bash|fish|ps1|bat|cmd|c|h|cc|cpp|hpp|java|kt|kts|swift|rb|php|zig|lua|ex|exs|dart|scala|r|jl|dockerfile|prisma|proto|tf|hcl|sql|graphql|gql)$/i.test(
      baseName,
    )
  ) {
    return "file-rust";
  }
  if (/\.(md|mdx|markdown|rst|txt|pdf|pptx?|key|docx?|png|jpe?g|gif|webp|ico)$/i.test(baseName)) {
    return "file-doc";
  }
  if (
    /\.(jsonc?|json5|ya?ml|env(?:\.[a-z0-9_-]+)?|ini|cfg|conf|xml|lock|log|xlsx?|xlsm|csv|tsv)$/i.test(
      baseName,
    )
  ) {
    return "file-data";
  }
  if (EXTENSIONLESS_FILE_NAMES.has(baseName)) {
    return baseName.startsWith(".env") || baseName.endsWith(".lock")
      ? "file-data"
      : "file-doc";
  }

  return null;
}

export function classifyInlineCode(raw: string): InlineCodeCategory {
  const val = raw.trim();
  if (!val) return "plain";

  const hasWhitespace = /\s/.test(val);

  if (val.endsWith("/") && !val.startsWith("http") && !hasWhitespace) {
    return "folder";
  }

  const fileCategory = classifyPathLikeFile(val);
  if (fileCategory) {
    return fileCategory;
  }

  if (
    /^(pnpm|npm|npx|yarn|bun|cargo|git|node|tsc|vite|vitest|eslint|pip3?|python3?|uv|brew|curl|gh|docker|make|markitdown|libreoffice|soffice|\/[a-z0-9_-]|rayu:|--[a-z]|GET |POST |PUT |DELETE )/i.test(
      val,
    )
  ) {
    return "command";
  }

  if (
    /^<[A-Z][A-Za-z0-9]*[\s/>]/.test(val) ||
    /^[A-Z][a-zA-Z0-9]{2,}$/.test(val)
  ) {
    return "component";
  }

  if (
    !hasWhitespace &&
    (/^[a-z_][a-z0-9]*_[a-z0-9_]+$/i.test(val) ||
      /^[a-zA-Z_$][a-zA-Z0-9_$.]*\([^)]*\)$/.test(val) ||
      /^\.[a-z0-9]{2,6}$/i.test(val))
  ) {
    return "symbol";
  }

  return "plain";
}

export interface CodeSyntaxToken {
  text: string;
  className: string;
}

const CODE_KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "default",
  "as",
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
  "readonly",
  "private",
  "public",
  "protected",
  "static",
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
  "where",
  "crate",
  "def",
  "pass",
  "in",
  "of",
  "package",
  "func",
  "defer",
  "go",
  "chan",
  "subgraph",
  "end",
  "flowchart",
  "graph",
  "sequenceDiagram",
]);

const TOKEN_PATTERN =
  /(\/\/.*$|#\[[^\]]+\]|#.*$|@[A-Za-z_][A-Za-z0-9_]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b(?=\s*\()|\b[a-z_$][A-Za-z0-9_$]*\b(?=\s*:)|\b[A-Z][A-Za-z0-9_]*\b|\b[a-z_][A-Za-z0-9_]*\b)/g;

export function tokenizeCodeLine(line: string): CodeSyntaxToken[] {
  if (!line) return [{ text: " ", className: "text-code-plain" }];

  const tokens: CodeSyntaxToken[] = [];
  let lastIndex = 0;
  TOKEN_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        text: line.slice(lastIndex, match.index),
        className: "text-code-plain",
      });
    }

    const raw = match[0];
    let className = "text-code-plain";

    if (raw.startsWith("#[")) {
      className = "text-code-fn";
    } else if (raw.startsWith("//") || raw.startsWith("#")) {
      className = "text-code-com italic";
    } else if (raw.startsWith("@")) {
      className = "text-code-fn font-medium";
    } else if (
      raw.startsWith('"') ||
      raw.startsWith("'") ||
      raw.startsWith("`")
    ) {
      className = "text-code-str";
    } else if (/^\d/.test(raw)) {
      className = "text-code-num";
    } else if (CODE_KEYWORDS.has(raw)) {
      className = "text-code-kw";
    } else if (/^[A-Z]/.test(raw)) {
      className = "text-code-type";
    } else {
      const nextSlice = line.slice(match.index + raw.length);
      if (/^\s*\(/.test(nextSlice)) {
        className = "text-code-fn";
      } else if (/^\s*:/.test(nextSlice)) {
        className = "text-code-prop";
      }
    }

    tokens.push({ text: raw, className });
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < line.length) {
    tokens.push({
      text: line.slice(lastIndex),
      className: "text-code-plain",
    });
  }

  return tokens;
}
