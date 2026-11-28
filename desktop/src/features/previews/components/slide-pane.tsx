import * as React from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize2,
  MessageSquare,
  Plus,
  Presentation,
  Sparkles,
  X,
} from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useAppStore, type SlideItem } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

export interface SlidePaneProps {
  className?: string
}

type SlideZoomOption = "fit" | "75" | "100" | "125"

export function SlidePane({ className }: SlidePaneProps) {
  const slideDeck = useAppStore((s) => s.slideDeck)
  const setActiveSlideIndex = useAppStore((s) => s.setActiveSlideIndex)
  const updateSlide = useAppStore((s) => s.updateSlide)
  const addSlide = useAppStore((s) => s.addSlide)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const setPendingStreamPrompt = useAppStore((s) => s.setPendingStreamPrompt)

  const [zoomMode, setZoomMode] = React.useState<SlideZoomOption>("fit")
  const [showNotes, setShowNotes] = React.useState(false)
  const [isPresenting, setIsPresenting] = React.useState(false)
  const [requestEditsOpen, setRequestEditsOpen] = React.useState(false)
  const [editPrompt, setEditPrompt] = React.useState("")
  const [editingField, setEditingField] = React.useState<
    "title" | "subtitle" | "body" | null
  >(null)

  const slides = React.useMemo(() => slideDeck?.slides ?? [], [slideDeck])
  const activeIndex = Math.max(
    0,
    Math.min(slideDeck?.activeSlideIndex ?? 0, slides.length - 1)
  )
  const activeSlide: SlideItem | undefined = slides[activeIndex]

  const goPrev = React.useCallback(() => {
    setActiveSlideIndex(Math.max(0, activeIndex - 1))
  }, [activeIndex, setActiveSlideIndex])

  const goNext = React.useCallback(() => {
    setActiveSlideIndex(Math.min(slides.length - 1, activeIndex + 1))
  }, [activeIndex, setActiveSlideIndex, slides.length])

  React.useEffect(() => {
    if (!isPresenting) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setIsPresenting(false)
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault()
        goNext()
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault()
        goPrev()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [goNext, goPrev, isPresenting])

  const handleOpenInPowerPoint = async () => {
    if (!slideDeck) return
    const res = await ipcClient.native.openInPowerPoint({
      filePath: slideDeck.filePath,
      title: slideDeck.title,
      slides: slideDeck.slides,
    })
    if (res.ok) {
      toast(`Opened "${slideDeck.title}" in Microsoft PowerPoint`)
    } else {
      toast.error("Could not launch Microsoft PowerPoint")
    }
  }

  const handleRequestEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = editPrompt.trim()
    if (!trimmed || !activeSlide || !slideDeck) return

    if (!activeSessionId) {
      toast.error("Open a conversation first so RayuCode can edit this deck")
      return
    }

    const target = slideDeck.filePath
      ? `the PowerPoint file at ${slideDeck.filePath}`
      : `the presentation "${slideDeck.title}"`
    const prompt = [
      `Edit ${target} (deck title: "${slideDeck.title}").`,
      `Slide ${activeIndex + 1} of ${slides.length}, currently titled "${activeSlide.title}".`,
      `Requested change: ${trimmed}`,
      slideDeck.filePath
        ? `Apply the change, then call create_powerpoint again with file_path "${slideDeck.filePath}" so the updated deck is saved and the Slide Studio refreshes.`
        : "Apply the change, then call create_powerpoint so the updated deck is saved and the Slide Studio refreshes.",
    ].join("\n")

    setPendingStreamPrompt({
      sessionId: activeSessionId,
      prompt,
      modelLabel: "Claude Opus 5.5",
    })

    setEditPrompt("")
    setRequestEditsOpen(false)
    toast(`Sent edit request for Slide ${activeIndex + 1} to RayuCode`)
  }

  const zoomScale =
    zoomMode === "75"
      ? 0.85
      : zoomMode === "125"
        ? 1.08
        : 1

  if (!slideDeck || !activeSlide) {
    return (
      <div
        data-testid="slide-pane"
        data-empty="true"
        className={cn(
          "relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-canvas px-8 text-center text-ink select-none",
          className
        )}
      >
        <span className="grid size-10 place-items-center rounded-xl border border-hairline bg-inset text-muted-ink">
          <Presentation className="size-5" aria-hidden="true" />
        </span>
        <div className="text-[14px] font-medium text-ink">
          No presentation open yet
        </div>
        <p className="max-w-[320px] text-xs leading-relaxed text-muted-ink">
          Ask RayuCode to create slides or open a .pptx. The deck appears here
          as soon as it is generated.
        </p>
      </div>
    )
  }

  return (
    <div
      data-testid="slide-pane"
      className={cn(
        "relative flex min-h-0 flex-1 flex-col bg-canvas text-ink select-none",
        className
      )}
    >
      {/* Top Slide Studio Sub-Header Bar (Matching Screenshot 2) */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-medium text-ink">Slide</span>

          <Popover open={requestEditsOpen} onOpenChange={setRequestEditsOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="slide-request-edits-btn"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-raised px-3 py-1 text-xs font-medium text-body transition-colors hover:border-premium-hi hover:bg-hover hover:text-ink"
              >
                <Sparkles className="size-3.5 text-muted-ink" aria-hidden="true" />
                <span>Request edits</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={8}
              className="w-80 rounded-xl border border-premium-hi bg-popover-solid p-3 shadow-rayu-2"
            >
              <form onSubmit={handleRequestEditSubmit} className="space-y-2.5">
                <div className="text-xs font-medium text-ink">
                  Request edits for Slide {activeIndex + 1}
                </div>
                <input
                  type="text"
                  data-testid="slide-request-edits-input"
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="Describe layout, copy, or metric changes..."
                  className="flex h-8 w-full rounded-md border border-hairline bg-inset px-2.5 text-xs text-ink placeholder:text-muted-ink outline-none focus:border-brand"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setRequestEditsOpen(false)}
                    className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted-ink hover:bg-hover hover:text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="cursor-pointer rounded-md bg-brand px-3 py-1 text-xs font-medium text-brand-ink hover:bg-brand-bright"
                  >
                    Apply edit
                  </button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Speaker Notes / Comments Toggle */}
          <button
            type="button"
            aria-label="Toggle speaker notes"
            aria-pressed={showNotes}
            onClick={() => setShowNotes((prev) => !prev)}
            className={cn(
              "grid size-7 cursor-pointer place-items-center rounded-full border border-hairline bg-raised text-muted-ink transition-colors hover:bg-hover hover:text-ink",
              showNotes && "border-brand bg-brand-soft text-brand-text"
            )}
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
          </button>

          {/* Fit Zoom Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="slide-zoom-trigger"
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-hairline bg-raised px-2.5 text-xs font-medium text-ink transition-colors hover:bg-hover"
              >
                <span>{zoomMode === "fit" ? "Fit" : `${zoomMode}%`}</span>
                <ChevronDown className="size-3 text-muted-ink" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem onClick={() => setZoomMode("fit")}>
                Fit to stage
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setZoomMode("75")}>
                75%
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setZoomMode("100")}>
                100%
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setZoomMode("125")}>
                125%
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Present Dropdown / Button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="slide-present-trigger"
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-hairline bg-raised px-3 text-xs font-medium text-ink transition-colors hover:bg-hover"
              >
                <span>Present</span>
                <ChevronDown className="size-3 text-muted-ink" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setIsPresenting(true)}>
                <Maximize2 className="mr-2 size-3.5" aria-hidden="true" />
                <span>Present from current slide</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setActiveSlideIndex(0)
                  setIsPresenting(true)
                }}
              >
                <Presentation className="mr-2 size-3.5" aria-hidden="true" />
                <span>Present from beginning</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Open in PowerPoint / Export Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="slide-open-trigger"
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-hairline bg-raised px-3 text-xs font-medium text-ink transition-colors hover:bg-hover"
              >
                <span>Open</span>
                <ChevronDown className="size-3 text-muted-ink" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                data-testid="open-in-powerpoint-item"
                onClick={() => void handleOpenInPowerPoint()}
              >
                <ExternalLink className="mr-2 size-3.5" aria-hidden="true" />
                <span>Open in Microsoft PowerPoint</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  addSlide()
                  toast("Added new slide to deck")
                }}
              >
                <Plus className="mr-2 size-3.5" aria-hidden="true" />
                <span>Add new slide</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleOpenInPowerPoint()}>
                <span>Export standalone HTML deck</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main Slide Stage + Left Vertical Slide Tick Rail (Matching Screenshot 2) */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto px-7 py-6">
        {/* Left Vertical Tick Indicator Rail */}
        <div
          role="tablist"
          aria-label="Slide navigation rail"
          className="absolute left-2.5 top-1/2 z-10 flex -translate-y-1/2 flex-col items-start gap-2 py-2"
        >
          {Array.from({ length: Math.max(slides.length, 10) }, (_, idx) => {
            const isRealSlide = idx < slides.length
            const isCurrent = idx === activeIndex
            return (
              <button
                key={idx}
                type="button"
                role="tab"
                aria-label={`Slide ${idx + 1}`}
                aria-selected={isCurrent}
                onClick={() => {
                  if (isRealSlide) {
                    setActiveSlideIndex(idx)
                  } else {
                    addSlide({
                      title: `Slide ${idx + 1} · Operating Detail`,
                    })
                  }
                }}
                className="group flex cursor-pointer items-center py-0.5 focus:outline-none"
              >
                <span
                  className={cn(
                    "block h-[2px] rounded-full transition-all",
                    isCurrent
                      ? "w-4 bg-ink"
                      : isRealSlide
                        ? "w-2.5 bg-muted-ink/60 group-hover:w-3.5 group-hover:bg-body"
                        : "w-2 bg-muted-ink/25 group-hover:w-3 group-hover:bg-muted-ink/60"
                  )}
                />
              </button>
            )
          })}
        </div>

        {/* 16:9 Crisp Editorial White Slide Canvas (Matching Screenshot 2) */}
        <div
          data-testid="slide-canvas-card"
          style={{
            transform: `scale(${zoomScale})`,
            backgroundColor: "rgb(255, 255, 255)",
            color: "rgb(30, 41, 59)",
          }}
          className="relative flex aspect-[16/9] w-full max-w-[640px] flex-col justify-between overflow-hidden rounded-[4px] border border-hairline shadow-rayu-2 transition-transform"
        >
          {/* Top Section: Kicker + Headline */}
          <div className="flex flex-col px-9 pt-8 pb-4">
            <div
              className="mb-3 text-[10.5px] font-medium"
              style={{ color: "rgb(148, 163, 184)" }}
            >
              {activeSlide.kicker}
            </div>

            {editingField === "title" ? (
              <input
                type="text"
                autoFocus
                value={activeSlide.title}
                onChange={(e) =>
                  updateSlide(activeSlide.id, { title: e.target.value })
                }
                onBlur={() => setEditingField(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingField(null)
                }}
                style={{ color: "rgb(53, 88, 186)" }}
                className="w-full border-b border-info bg-transparent text-[26px] leading-[1.16] font-bold tracking-tight outline-none"
              />
            ) : (
              <h2
                onClick={() => setEditingField("title")}
                title="Click to edit slide title"
                style={{ color: "rgb(53, 88, 186)" }}
                className="max-w-[88%] cursor-text text-[26px] leading-[1.16] font-bold tracking-tight"
              >
                {activeSlide.title}
              </h2>
            )}
          </div>

          {/* Full-bleed horizontal rule matching Screenshot 2 */}
          <div
            className="h-px w-full shrink-0"
            style={{ backgroundColor: "rgb(148, 163, 184)" }}
          />

          {/* Bottom Section: Subtitle + Body / Metrics / Bullets */}
          <div className="flex flex-1 flex-col justify-start px-9 pt-4 pb-6">
            {editingField === "subtitle" ? (
              <input
                type="text"
                autoFocus
                value={activeSlide.subtitle}
                onChange={(e) =>
                  updateSlide(activeSlide.id, { subtitle: e.target.value })
                }
                onBlur={() => setEditingField(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingField(null)
                }}
                style={{ color: "rgb(37, 71, 169)" }}
                className="mb-2 w-48 border-b border-info bg-transparent text-[10.5px] font-bold outline-none"
              />
            ) : (
              <div
                onClick={() => setEditingField("subtitle")}
                style={{ color: "rgb(37, 71, 169)" }}
                className="mb-2 cursor-text text-[10.5px] font-bold"
              >
                {activeSlide.subtitle}
              </div>
            )}

            {editingField === "body" ? (
              <textarea
                rows={3}
                autoFocus
                value={activeSlide.body}
                onChange={(e) =>
                  updateSlide(activeSlide.id, { body: e.target.value })
                }
                onBlur={() => setEditingField(null)}
                style={{ color: "rgb(71, 85, 105)" }}
                className="w-full max-w-[440px] resize-none border border-info/50 bg-transparent p-1 text-[10.5px] leading-[1.55] outline-none"
              />
            ) : (
              <p
                onClick={() => setEditingField("body")}
                title="Click to edit slide body"
                style={{ color: "rgb(71, 85, 105)" }}
                className="max-w-[420px] cursor-text text-[10.5px] leading-[1.55]"
              >
                {activeSlide.body}
              </p>
            )}

            {activeSlide.metrics && activeSlide.metrics.length > 0 ? (
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                {activeSlide.metrics.map((m) => (
                  <div
                    key={m.label}
                    className="rounded border px-2.5 py-1.5"
                    style={{
                      borderColor: "rgb(226, 232, 240)",
                      backgroundColor: "rgb(248, 250, 252)",
                    }}
                  >
                    <div
                      className="text-[8px] font-semibold uppercase"
                      style={{ color: "rgb(100, 116, 139)" }}
                    >
                      {m.label}
                    </div>
                    <div
                      className="mt-0.5 text-[12px] font-bold tabular-nums"
                      style={{ color: "rgb(37, 71, 169)" }}
                    >
                      {m.value}
                    </div>
                    <div
                      className="truncate text-[8px]"
                      style={{ color: "rgb(100, 116, 139)" }}
                    >
                      {m.note}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {activeSlide.bullets && activeSlide.bullets.length > 0 ? (
              <ul
                className="mt-2.5 list-disc space-y-1 pl-4 text-[10px] leading-snug"
                style={{ color: "rgb(51, 65, 85)" }}
              >
                {activeSlide.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bottom Slide Counter & Quick Prev/Next Bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-hairline bg-chrome px-4 text-xs text-muted-ink">
        <span className="font-mono text-[11px]">
          Slide {activeIndex + 1} of {slides.length} · {slideDeck.templateName}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous slide"
            disabled={activeIndex === 0}
            onClick={goPrev}
            className="grid size-6 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink disabled:opacity-35"
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            disabled={activeIndex >= slides.length - 1}
            onClick={goNext}
            className="grid size-6 cursor-pointer place-items-center rounded text-muted-ink hover:bg-hover hover:text-ink disabled:opacity-35"
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Optional Speaker Notes Drawer */}
      {showNotes ? (
        <div className="border-t border-hairline bg-inset px-4 py-2.5">
          <div className="mb-1 text-[10.5px] font-semibold tracking-wider text-muted-ink uppercase">
            Speaker Notes
          </div>
          <textarea
            rows={2}
            value={activeSlide.notes ?? ""}
            onChange={(e) =>
              updateSlide(activeSlide.id, { notes: e.target.value })
            }
            placeholder="Add speaker notes or data citations for this slide..."
            className="w-full resize-none bg-transparent text-xs text-body placeholder:text-muted-ink focus:outline-none"
          />
        </div>
      ) : null}

      {/* Fullscreen Slideshow Presentation Overlay */}
      {isPresenting ? (
        <div
          data-testid="slide-fullscreen-overlay"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas/95 p-10"
        >
          <div className="mb-4 flex w-full max-w-[960px] items-center justify-between text-xs text-muted-ink">
            <span>
              {slideDeck.title} — Slide {activeIndex + 1} of {slides.length}
            </span>
            <button
              type="button"
              onClick={() => setIsPresenting(false)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-raised px-3 py-1 text-xs text-ink hover:bg-hover"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span>Exit presentation (Esc)</span>
            </button>
          </div>
          <div
            style={{
              backgroundColor: "rgb(255, 255, 255)",
              color: "rgb(30, 41, 59)",
            }}
            className="flex aspect-[16/9] w-full max-w-[960px] flex-col justify-between rounded-md p-14 shadow-rayu-2"
          >
            <div>
              <div
                className="mb-4 text-sm font-medium"
                style={{ color: "rgb(148, 163, 184)" }}
              >
                {activeSlide.kicker}
              </div>
              <h1
                className="text-4xl leading-tight font-bold"
                style={{ color: "rgb(53, 88, 186)" }}
              >
                {activeSlide.title}
              </h1>
            </div>
            <div
              className="my-6 h-px w-full"
              style={{ backgroundColor: "rgb(148, 163, 184)" }}
            />
            <div className="flex-1">
              <div
                className="mb-3 text-sm font-bold"
                style={{ color: "rgb(37, 71, 169)" }}
              >
                {activeSlide.subtitle}
              </div>
              <p
                className="max-w-2xl text-base leading-relaxed"
                style={{ color: "rgb(71, 85, 105)" }}
              >
                {activeSlide.body}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
