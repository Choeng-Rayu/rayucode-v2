import { useMemo, type MouseEvent } from "react";
import { renderSafeMarkdown } from "../markdown/renderMarkdown.js";

export interface MarkdownRendererProps {
  content: string;
  onCopyCode?: (code: string) => void | Promise<void>;
  className?: string;
}

export function MarkdownRenderer({ content, onCopyCode, className }: MarkdownRendererProps) {
  const html = useMemo(() => renderSafeMarkdown(content), [content]);

  const handleClick = (ev: MouseEvent<HTMLDivElement>) => {
    const target = ev.target as HTMLElement | null;
    const button = target?.closest?.("button[data-copy-code]") as HTMLButtonElement | null;
    if (!button) return;
    const encoded = button.getAttribute("data-copy-code");
    if (!encoded) return;
    try {
      const code = decodeURIComponent(encoded);
      void onCopyCode?.(code);
    } catch {
      // Ignore malformed attribute
    }
  };

  return (
    <div
      className={className ? `rc-markdown ${className}` : "rc-markdown"}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
