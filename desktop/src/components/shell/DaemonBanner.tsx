import * as React from "react"

import { ipcClient, type DaemonStatus } from "@/lib/ipc-client"

export function DaemonBanner() {
  const [status, setStatus] = React.useState<DaemonStatus | null>(null)

  React.useEffect(() => {
    void ipcClient.daemon.getStatus().then(setStatus)
    const unsubscribe = ipcClient.daemon.onStatusChange(setStatus)
    return () => {
      unsubscribe()
    }
  }, [])

  if (!status || !status.reconnecting) {
    return null
  }

  const displaySocket = status.socketPath.includes("/.rayu/")
    ? `~/.rayu/${status.socketPath.split("/.rayu/")[1]}`
    : status.socketPath.split("/").slice(-2).join("/")

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-warn/30 bg-warn-soft px-4 py-1.5 text-xs text-warn"
    >
      <div className="flex items-center gap-2">
        <span className="size-2 animate-pulse rounded-full bg-warn" />
        <span className="font-medium">
          Reconnecting to Rayu daemon ({displaySocket})...
        </span>
      </div>
      <span className="font-mono text-[11px] text-muted-ink">
        Drafts &amp; session state preserved
      </span>
    </div>
  )
}
