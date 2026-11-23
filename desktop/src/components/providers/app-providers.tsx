import * as React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"

import { TooltipProvider } from "@/components/ui/tooltip"
import {
  syncAccentToDom,
  syncThemeToDom,
  useAppStore,
} from "@/lib/app-store"
import { queryClient as defaultQueryClient } from "@/lib/query-client"

export interface AppProvidersProps {
  children: React.ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  const theme = useAppStore((s) => s.theme)
  const accent = useAppStore((s) => s.accent)

  React.useEffect(() => {
    syncThemeToDom(theme)
  }, [theme])

  React.useEffect(() => {
    syncAccentToDom(accent)
  }, [accent])

  return (
    <QueryClientProvider client={defaultQueryClient}>
      <TooltipProvider delayDuration={120}>
        {children}
        <Toaster
          position="bottom-right"
          theme={theme}
          toastOptions={{
            className:
              "border border-premium-hi bg-popover text-ink text-xs shadow-rayu-2",
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
