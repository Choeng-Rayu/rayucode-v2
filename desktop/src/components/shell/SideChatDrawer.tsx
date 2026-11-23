import * as React from "react"
import { ArrowUp, MessageSquareDashed, X } from "lucide-react"

import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

interface SideMessage {
  id: string
  role: "user" | "assistant"
  text: string
}

export function SideChatDrawer() {
  const sideChatOpen = useAppStore((s) => s.sideChatOpen)
  const setSideChatOpen = useAppStore((s) => s.setSideChatOpen)
  const activeSessionTitle = useAppStore((s) => s.activeSessionTitle)

  const [input, setInput] = React.useState("")
  const [messages, setMessages] = React.useState<SideMessage[]>([])
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const listEndRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (sideChatOpen) {
      window.setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [sideChatOpen])

  React.useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length])

  if (!sideChatOpen) {
    return null
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return

    const userMsg: SideMessage = {
      id: `side_u_${Date.now()}`,
      role: "user",
      text: trimmed,
    }
    const replyMsg: SideMessage = {
      id: `side_a_${Date.now() + 1}`,
      role: "assistant",
      text: `Side note kept off the main transcript (${activeSessionTitle ?? "current session"}): "${trimmed}". Press Esc or ⌘; anytime to dismiss.`,
    }
    setMessages((prev) => [...prev, userMsg, replyMsg])
    setInput("")
  }

  return (
    <section
      aria-label="Side chat"
      data-testid="side-chat-drawer"
      className="absolute right-4 bottom-24 z-30 flex w-[348px] max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-xl border border-premium bg-popover-solid shadow-rayu-2"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3 select-none">
        <MessageSquareDashed
          className="size-3.5 text-muted-ink"
          strokeWidth={1.65}
          aria-hidden="true"
        />
        <span className="text-xs font-medium text-ink">Side chat</span>
        <span className="rounded bg-active px-1.5 py-0.5 font-mono text-[10px] text-muted-ink">
          ⌘;
        </span>
        <button
          type="button"
          aria-label="Close side chat"
          onClick={() => setSideChatOpen(false)}
          className="ml-auto grid size-6 cursor-pointer place-items-center rounded-md text-muted-ink transition-colors hover:bg-hover hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={1.65} aria-hidden="true" />
        </button>
      </div>

      <div className="flex max-h-[240px] min-h-[120px] flex-col gap-2.5 overflow-y-auto px-3 py-3 text-xs">
        {messages.length === 0 ? (
          <p className="my-auto text-center text-muted-ink">
            Ask a quick side question without adding noise to the main thread.
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "max-w-[88%] rounded-xl px-3 py-2 leading-relaxed",
                msg.role === "user"
                  ? "self-end bg-active text-ink"
                  : "self-start border border-hairline bg-inset text-body"
              )}
            >
              {msg.text}
            </div>
          ))
        )}
        <div ref={listEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-hairline bg-pane px-2.5 py-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              setSideChatOpen(false)
            }
          }}
          placeholder="Ask a quick side question..."
          aria-label="Side chat input"
          className="min-w-0 flex-1 bg-transparent px-1 text-xs text-ink outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          aria-label="Send side chat message"
          disabled={!input.trim()}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full transition-colors",
            input.trim()
              ? "cursor-pointer bg-brand text-brand-ink hover:bg-brand-bright"
              : "bg-active text-faint"
          )}
        >
          <ArrowUp className="size-3.5" strokeWidth={2} aria-hidden="true" />
        </button>
      </form>
    </section>
  )
}
