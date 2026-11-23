import * as React from "react"
import { Eraser, Pencil, RotateCcw, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export interface SketchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAttach: (sketch: { name: string; dataUrl: string }) => void
}

const STROKE_SWATCHES = [
  { id: "ink", label: "Ink", cssVar: "--text-1", dotClass: "bg-ink" },
  { id: "brand", label: "Brand", cssVar: "--accent", dotClass: "bg-brand" },
  { id: "info", label: "Info", cssVar: "--info", dotClass: "bg-info" },
  { id: "warn", label: "Warn", cssVar: "--warn", dotClass: "bg-warn" },
  { id: "danger", label: "Danger", cssVar: "--danger", dotClass: "bg-danger" },
] as const

function resolveThemeColor(cssVar: string): string {
  if (typeof window === "undefined") return "currentColor"
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar)
    .trim()
  return val || "currentColor"
}

export function SketchDialog({
  open,
  onOpenChange,
  onAttach,
}: SketchDialogProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const drawingRef = React.useRef(false)
  const lastPointRef = React.useRef<{ x: number; y: number } | null>(null)
  const historyRef = React.useRef<ImageData[]>([])

  const [tool, setTool] = React.useState<"pen" | "eraser">("pen")
  const [swatchId, setSwatchId] =
    React.useState<(typeof STROKE_SWATCHES)[number]["id"]>("brand")
  const [strokeWidth, setStrokeWidth] = React.useState(3)
  const [hasStrokes, setHasStrokes] = React.useState(false)

  const fillCanvasBackground = React.useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = resolveThemeColor("--bg-inset")
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  React.useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      fillCanvasBackground(canvas)
      historyRef.current = []
      setHasStrokes(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [fillCanvasBackground, open])

  const getCoords = (
    event: React.PointerEvent<HTMLCanvasElement>
  ): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    canvas.setPointerCapture(event.pointerId)
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (historyRef.current.length > 20) historyRef.current.shift()
    drawingRef.current = true
    lastPointRef.current = getCoords(event)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx || !lastPointRef.current) return

    const next = getCoords(event)
    const swatch =
      STROKE_SWATCHES.find((s) => s.id === swatchId) ?? STROKE_SWATCHES[1]

    ctx.beginPath()
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(next.x, next.y)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = tool === "eraser" ? strokeWidth * 4 : strokeWidth
    ctx.strokeStyle =
      tool === "eraser"
        ? resolveThemeColor("--bg-inset")
        : resolveThemeColor(swatch.cssVar)
    ctx.stroke()

    lastPointRef.current = next
    setHasStrokes(true)
  }

  const handlePointerUp = () => {
    drawingRef.current = false
    lastPointRef.current = null
  }

  const handleUndo = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    const prev = historyRef.current.pop()
    if (!canvas || !ctx || !prev) return
    ctx.putImageData(prev, 0, 0)
    setHasStrokes(historyRef.current.length > 0)
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    fillCanvasBackground(canvas)
    historyRef.current = []
    setHasStrokes(false)
  }

  const handleAttach = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL("image/png")
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "")
    onAttach({ name: `sketch-${stamp}.png`, dataUrl })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Draw a sketch</DialogTitle>
          <DialogDescription>
            Sketch a layout, diagram, or UI change to attach directly to your
            prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-inset p-1">
            <button
              type="button"
              onClick={() => setTool("pen")}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                tool === "pen"
                  ? "bg-active text-ink"
                  : "text-muted-ink hover:text-ink"
              )}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              <span>Pen</span>
            </button>
            <button
              type="button"
              onClick={() => setTool("eraser")}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                tool === "eraser"
                  ? "bg-active text-ink"
                  : "text-muted-ink hover:text-ink"
              )}
            >
              <Eraser className="size-3.5" aria-hidden="true" />
              <span>Eraser</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {STROKE_SWATCHES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-label={`${s.label} ink`}
                onClick={() => {
                  setSwatchId(s.id)
                  setTool("pen")
                }}
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-full border transition-transform hover:scale-105",
                  swatchId === s.id && tool === "pen"
                    ? "border-premium-hi bg-active"
                    : "border-transparent"
                )}
              >
                <span className={cn("size-3.5 rounded-full", s.dotClass)} />
              </button>
            ))}

            <div className="mx-1 h-4 w-px bg-hairline" />

            {([2, 4, 7] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-label={`Stroke ${w}px`}
                onClick={() => setStrokeWidth(w)}
                className={cn(
                  "grid size-6 cursor-pointer place-items-center rounded-md border text-[10px] font-mono",
                  strokeWidth === w
                    ? "border-premium bg-active text-ink"
                    : "border-transparent text-muted-ink hover:text-ink"
                )}
              >
                {w}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleUndo}
              aria-label="Undo stroke"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              <span>Undo</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleClear}
              aria-label="Clear sketch"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span>Clear</span>
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-hairline bg-inset">
          <canvas
            ref={canvasRef}
            width={640}
            height={340}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="block h-[300px] w-full cursor-crosshair touch-none"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!hasStrokes}
            onClick={handleAttach}
          >
            Attach sketch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
