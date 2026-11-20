/**
 * Defense-in-depth Markdown & code block renderer shared by RayuCode Web
 * (Next.js) and the VS Code Extension Webview.
 *
 * Uses `marked` + `highlight.js` (14 common engineering languages) + strict
 * `xss` allowlist sanitization so untrusted LLM or file outputs can never
 * inject `<script>`, `<img onerror>`, `<form>`, or `javascript:` URLs.
 */

import { Marked, type Tokens } from "marked";
import { FilterXSS } from "xss";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import diff from "highlight.js/lib/languages/diff";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("zsh", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("patch", diff);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  return (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("#")
  );
}

const xssFilter = new FilterXSS({
  whiteList: {
    p: [],
    br: [],
    strong: [],
    em: [],
    del: [],
    code: ["class"],
    pre: ["class"],
    div: ["class", "data-code-lang"],
    span: ["class"],
    button: ["type", "class", "data-copy-code", "aria-label"],
    blockquote: [],
    ul: [],
    ol: ["start"],
    li: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    hr: [],
    table: [],
    thead: [],
    tbody: [],
    tr: [],
    th: ["align"],
    td: ["align"],
    a: ["href", "title", "target", "rel"],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style", "iframe", "object", "embed", "form"],
  onTagAttr(tag, name, value) {
    if (tag === "a" && name === "href") {
      return isSafeHref(value) ? `href="${escapeHtml(value)}"` : "";
    }
    return undefined;
  },
});

const markedInstance = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: Tokens.Code): string {
      const normalizedLang = (lang ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
      let highlighted: string;
      if (normalizedLang && hljs.getLanguage(normalizedLang)) {
        highlighted = hljs.highlight(text, { language: normalizedLang }).value;
      } else {
        highlighted = escapeHtml(text);
      }
      const langLabel = normalizedLang || "text";
      const encodedCopy = encodeURIComponent(text);
      return (
        `<div class="rc-code-block" data-code-lang="${escapeHtml(langLabel)}">` +
        `<div class="rc-code-header">` +
        `<span class="rc-code-lang">${escapeHtml(langLabel)}</span>` +
        `<button type="button" class="rc-code-copy" data-copy-code="${escapeHtml(encodedCopy)}" aria-label="Copy code">Copy</button>` +
        `</div>` +
        `<pre class="rc-code-pre"><code class="hljs language-${escapeHtml(langLabel)}">${highlighted}</code></pre>` +
        `</div>`
      );
    },
    link({ href, title, tokens }: Tokens.Link): string {
      const label = this.parser.parseInline(tokens);
      if (!href || !isSafeHref(href)) {
        return label;
      }
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  },
});

/** Render untrusted Markdown to sanitized HTML with syntax-highlighted code fences. */
export function renderSafeMarkdown(markdownText: string): string {
  if (!markdownText) return "";
  const rawHtml = markedInstance.parse(markdownText, { async: false });
  return xssFilter.process(typeof rawHtml === "string" ? rawHtml : "");
}
