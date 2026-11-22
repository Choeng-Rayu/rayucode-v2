import * as React from "react"

import { syncBrowserBounds } from "../api/previews-api"
import type { BrowserBounds, BrowserDeviceMode } from "../types"

export interface UseBrowserBoundsOptions {
  enabled?: boolean
  url: string
  zoom: number
  deviceMode: BrowserDeviceMode
  fullView: boolean
  onBoundsChange?: (bounds: BrowserBounds) => void
}

export interface UseBrowserBoundsResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  bounds: BrowserBounds | null
  isNativeWebView: boolean
}

function measureElementBounds(element: HTMLElement): BrowserBounds {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  }
}

function areBoundsEqual(
  a: BrowserBounds | null,
  b: BrowserBounds | null
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  )
}

/**
 * Tracks the rendered viewport bounds via ResizeObserver + getBoundingClientRect()
 * and syncs them with Electron's WebContentsView bridge when running inside Electron.
 */
export function useBrowserBounds({
  enabled = true,
  url,
  zoom,
  deviceMode,
  fullView,
  onBoundsChange,
}: UseBrowserBoundsOptions): UseBrowserBoundsResult {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const lastBoundsRef = React.useRef<BrowserBounds | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const [bounds, setBounds] = React.useState<BrowserBounds | null>(null)

  const isNativeWebView =
    typeof window !== "undefined" && Boolean(window.rayu?.daemon?.invoke)

  React.useEffect(() => {
    const el = containerRef.current
    if (!enabled || !el) {
      if (isNativeWebView) {
        void syncBrowserBounds({
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          url,
          zoom,
          deviceMode,
          visible: false,
        })
      }
      return
    }

    const flushMeasurement = () => {
      rafRef.current = null
      const node = containerRef.current
      if (!node) return

      const next = measureElementBounds(node)
      if (!areBoundsEqual(lastBoundsRef.current, next)) {
        lastBoundsRef.current = next
        setBounds(next)
        onBoundsChange?.(next)
      }

      if (isNativeWebView) {
        void syncBrowserBounds({
          bounds: next,
          url,
          zoom,
          deviceMode,
          visible: next.width > 0 && next.height > 0,
        })
      }
    }

    const scheduleMeasurement = () => {
      if (rafRef.current !== null) return
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        rafRef.current = window.requestAnimationFrame(flushMeasurement)
      } else {
        flushMeasurement()
      }
    }

    scheduleMeasurement()

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleMeasurement)
      observer.observe(el)
    }

    window.addEventListener("resize", scheduleMeasurement, { passive: true })

    return () => {
      if (rafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      observer?.disconnect()
      window.removeEventListener("resize", scheduleMeasurement)
    }
  }, [enabled, url, zoom, deviceMode, fullView, isNativeWebView, onBoundsChange])

  return {
    containerRef,
    bounds,
    isNativeWebView,
  }
}
