import * as React from "react"
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Globe,
  Minus,
  Plus,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

import type { BrowserChatMessage } from "../types"

export interface FloatingAskChatProps {
  title?: string
  contextLabel?: string
  contextKind?: "browser" | "excel"
  messages: BrowserChatMessage[]
  minimized?: boolean
  onMinimizedChange?: (minimized: boolean) => void
  onSendMessage: (question: string) => void | Promise<void>
  isSending?: boolean
  className?: string
}

export function FloatingAskChat({
  title = "Ask RayuCode",
  contextLabel = "localhost:3000",
  contextKind = "browser",
  messages,
  minimized: controlledMinimized,
  onMinimizedChange,
  onSendMessage,
  isSending = false,
  className,
}: FloatingAskChatProps) {
  const [internalMinimized, setInternalMinimized] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const endRef = React.useRef<HTMLDivElement | null>(null)

  const minimized =
    controlledMinimized !== undefined ? controlledMinimized : internalMinimized

  const setMinimized = React.useCallback(
    (next: boolean) => {
      if (controlledMinimized === undefined) {
        setInternalMinimized(next)
      }
      onMinimizedChange?.(next)
    },
    [controlledMinimized, onMinimizedChange]
  )

  React.useEffect(() => {
    if (!minimized && endRef.current && typeof endRef.current.scrollIntoView === "function") {
      endRef.current.scrollIntoView({ block: "end" })
    }
  }, [messages.length, minimized])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || isSending) return
    setDraft("")
    await onSendMessage(trimmed)
  }

  const ContextIcon = contextKind === "excel" ? FileSpreadsheet : Globe

  return (
    <section
      aria-label="Ask RayuCode"
      data-testid="floating-ask-chat"
      data-minimized={minimized ? "true" : "false"}
      className={cn(
        "rayu-card-bevel absolute right-4 bottom-4 z-30 flex flex-col overflow-hidden rounded-2xl border border-premium-hi bg-popover-solid shadow-rayu-2 transition-[width] duration-150",
        minimized
          ? "w-[280px] max-w-[calc(100%-2rem)]"
          : "max-h-[70%] w-[410px] max-w-[calc(100%-2rem)]",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-hairline bg-raised px-3.5 py-2.5 text-xs font-medium text-ink">
        <ContextIcon
          className="size-3.5 shrink-0 text-brand-text"
          strokeWidth={1.65}
          aria-hidden="true"
        />
        <span className="truncate">{title}</span>
        <span className="rounded-full border border-hairline bg-inset px-2 py-0.5 font-mono text-[10px] text-muted-ink">
          {contextLabel}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={minimized ? "Expand Ask RayuCode" : "Minimize Ask RayuCode"}
          onClick={() => {
            const next = !minimized
            setMinimized(next)
            if (!next) {
              setTimeout(() => inputRef.current?.focus(), 0)
            }
          }}
        >
          {minimized ? (
            <ChevronUp className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
          ) : (
            <Minus className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
          )}
        </Button>
      </div>

      {!minimized && (
        <>
          <ScrollArea className="max-h-[290px] min-h-[150px] flex-1 bg-popover-solid">
            <div className="flex flex-col gap-3 px-4 py-3 text-xs leading-relaxed text-body">
              {messages.length === 0 ? (
                <p className="text-muted-ink">
                  {contextKind === "browser" ? (
                    <>
                      Connected to{" "}
                      <strong className="font-semibold text-ink">
                        {contextLabel}
                      </strong>
                      . Ask RayuCode to inspect elements, debug errors, or act on
                      this page.
                    </>
                  ) : (
                    <>
                      Inspecting{" "}
                      <strong className="font-semibold text-ink">
                        {contextLabel}
                      </strong>{" "}
                      in Full View. Ask RayuCode to verify totals, add formulas, or
                      update cells.
                    </>
                  )}
                </p>
              ) : null}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  data-testid={`floating-chat-msg-${msg.sender}`}
                  className={cn(
                    "rounded-lg border px-2.5 py-2",
                    msg.sender === "user"
                      ? "ml-6 border-premium bg-active text-ink"
                      : "mr-3 border-hairline bg-pane text-body"
                  )}
                >
                  <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium text-muted-ink">
                    <span>{msg.sender === "user" ? "You" : "RayuCode"}</span>
                    {msg.timestamp && <span>· {msg.timestamp}</span>}
                  </div>
                  <p className="m-0 text-xs leading-relaxed">{msg.text}</p>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </ScrollArea>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-1.5 border-t border-hairline bg-pane px-2.5 py-2"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Attach page context"
              onClick={() =>
                toast(
                  contextKind === "excel"
                    ? "Attached active Excel range"
                    : "Attached live page context"
                )
              }
            >
              <Plus className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
            </Button>

            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                contextKind === "excel"
                  ? "Work with RayuCode on this sheet"
                  : "Ask RayuCode about this page..."
              }
              aria-label="Ask RayuCode message"
              className="min-w-0 flex-1 bg-transparent px-1 py-1 text-xs text-ink outline-none placeholder:text-muted-ink"
            />

            <Button
              type="submit"
              variant="primary"
              size="icon-xs"
              disabled={!draft.trim() || isSending}
              aria-label="Send to RayuCode"
              className="size-7 rounded-full"
            >
              {isSending ? (
                <ChevronDown
                  className="size-3.5 animate-pulse"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              ) : (
                <ArrowUp className="size-3.5" strokeWidth={2} aria-hidden="true" />
              )}
            </Button>
          </form>
        </>
      )}
    </section>
  )
}
