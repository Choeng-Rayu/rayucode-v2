import * as React from "react"
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  type ComposerTemplateItem,
  type ComposerTemplateKind,
} from "@/lib/composer-templates"
import type { PersistedComposerTemplate } from "@/lib/ipc-client"
import { cn } from "@/lib/utils"

interface TemplateCarouselProps {
  kind: ComposerTemplateKind
  templates: ComposerTemplateItem[]
  onSelectTemplate: (template: ComposerTemplateItem) => void
  onCreateTemplateClick: () => void
  onDeleteCustomTemplate?: (id: string) => void
  onClose: () => void
}

function SpreadsheetPreviewThumb({
  template,
}: {
  template: ComposerTemplateItem
}) {
  if (template.previewVariant === "sheet-analytics") {
    return (
      <div
        className="flex h-[112px] w-full flex-col overflow-hidden rounded-[8px] border border-hairline shadow-sm"
        style={{ backgroundColor: "rgb(17, 25, 40)", color: "rgb(241, 245, 249)" }}
      >
        <div
          className="flex items-center justify-between px-2.5 py-1.5"
          style={{ borderBottom: "1px solid rgba(148, 163, 184, 0.16)" }}
        >
          <span className="truncate text-[7.5px] font-semibold tracking-tight">
            Website Analytics Dashboard
          </span>
          <span
            className="rounded px-1 py-0.5 text-[6px] font-medium"
            style={{
              backgroundColor: "rgba(56, 189, 248, 0.18)",
              color: "rgb(125, 211, 252)",
            }}
          >
            LIVE
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 px-2.5 pt-2">
          <div
            className="rounded px-1.5 py-1"
            style={{ backgroundColor: "rgba(30, 41, 59, 0.85)" }}
          >
            <div className="text-[5.5px] opacity-65">ACTIVE USERS</div>
            <div className="text-[10px] font-bold tabular-nums">31,500</div>
          </div>
          <div
            className="rounded px-1.5 py-1"
            style={{ backgroundColor: "rgba(30, 41, 59, 0.85)" }}
          >
            <div className="text-[5.5px] opacity-65">NEW USERS</div>
            <div className="text-[10px] font-bold tabular-nums">4,480</div>
          </div>
          <div
            className="rounded px-1.5 py-1"
            style={{ backgroundColor: "rgba(30, 41, 59, 0.85)" }}
          >
            <div className="text-[5.5px] opacity-65">SESSIONS / USER</div>
            <div className="text-[9.5px] font-bold tabular-nums">6.2</div>
          </div>
          <div
            className="rounded px-1.5 py-1"
            style={{ backgroundColor: "rgba(30, 41, 59, 0.85)" }}
          >
            <div className="text-[5.5px] opacity-65">MRR</div>
            <div className="text-[9.5px] font-bold tabular-nums">$403,700</div>
          </div>
        </div>
        <div className="mt-auto px-2.5 pb-1.5">
          <svg
            viewBox="0 0 180 18"
            className="h-3.5 w-full"
            aria-hidden="true"
          >
            <polyline
              fill="none"
              stroke="rgb(56, 189, 248)"
              strokeWidth="1.8"
              points="0,15 36,13 72,11 108,8 144,6 180,3"
            />
            <polyline
              fill="none"
              stroke="rgb(250, 204, 21)"
              strokeWidth="1.2"
              strokeDasharray="3 2"
              points="0,16 36,14 72,12 108,10 144,8 180,6"
            />
          </svg>
        </div>
      </div>
    )
  }

  if (template.previewVariant === "sheet-budget") {
    return (
      <div
        className="flex h-[112px] w-full flex-col overflow-hidden rounded-[8px] border border-hairline shadow-sm"
        style={{ backgroundColor: "rgb(250, 250, 252)", color: "rgb(15, 23, 42)" }}
      >
        <div
          className="px-2.5 py-1.5"
          style={{ backgroundColor: "rgb(26, 46, 76)", color: "rgb(255, 255, 255)" }}
        >
          <div className="truncate text-[7.5px] font-semibold">
            Financial Budget and Forecast
          </div>
          <div className="text-[5.5px] opacity-75">Summary · Base Scenario</div>
        </div>
        <div className="grid grid-cols-2 gap-1.5 px-2.5 py-2">
          <div
            className="rounded border px-1.5 py-1 text-center"
            style={{ borderColor: "rgb(226, 232, 240)" }}
          >
            <div className="text-[5px] font-semibold uppercase opacity-60">
              FY Bookings
            </div>
            <div className="text-[10px] font-bold tabular-nums">$26,114</div>
          </div>
          <div
            className="rounded border px-1.5 py-1 text-center"
            style={{ borderColor: "rgb(226, 232, 240)" }}
          >
            <div className="text-[5px] font-semibold uppercase opacity-60">
              FY Revenue
            </div>
            <div className="text-[10px] font-bold tabular-nums">$21,540</div>
          </div>
        </div>
        <div className="mt-auto px-2.5 pb-2">
          <div
            className="grid grid-cols-4 rounded-t px-1.5 py-0.5 text-[5.5px] font-semibold"
            style={{ backgroundColor: "rgb(26, 46, 76)", color: "rgb(255, 255, 255)" }}
          >
            <span>Month</span>
            <span className="text-right">Book</span>
            <span className="text-right">Rev</span>
            <span className="text-right">EBITDA</span>
          </div>
          <div
            className="grid grid-cols-4 border-x border-b px-1.5 py-0.5 font-mono text-[5.5px] tabular-nums"
            style={{ borderColor: "rgb(226, 232, 240)" }}
          >
            <span>Jan-27</span>
            <span className="text-right">$1,845</span>
            <span className="text-right">$1,500</span>
            <span className="text-right" style={{ color: "rgb(220, 38, 38)" }}>
              ($1,262)
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (template.previewVariant === "sheet-calendar") {
    return (
      <div
        className="flex h-[112px] w-full flex-col overflow-hidden rounded-[8px] border border-hairline shadow-sm"
        style={{ backgroundColor: "rgb(255, 255, 255)", color: "rgb(28, 25, 23)" }}
      >
        <div
          className="px-2.5 py-1.5"
          style={{ backgroundColor: "rgb(224, 98, 28)", color: "rgb(255, 255, 255)" }}
        >
          <div className="truncate text-[7.5px] font-semibold">
            Annual Planning Calendar
          </div>
          <div className="text-[5.5px] opacity-85">Annual · Q1-Q4 Milestones</div>
        </div>
        <div className="flex flex-1 flex-col gap-1 px-2.5 py-1.5">
          <div
            className="rounded-sm py-0.5 text-center text-[6px] font-semibold"
            style={{ backgroundColor: "rgb(234, 114, 42)", color: "rgb(255, 255, 255)" }}
          >
            January
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center font-mono text-[5.5px] opacity-75">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <span key={i} className="font-semibold">
                {d}
              </span>
            ))}
            {Array.from({ length: 14 }, (_, idx) => (
              <span
                key={idx}
                className="rounded-xs py-px"
                style={{
                  backgroundColor:
                    idx === 4 || idx === 11
                      ? "rgb(254, 240, 138)"
                      : "rgb(255, 247, 237)",
                }}
              >
                {idx + 1}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // SaaS or custom spreadsheet preview
  const headerBg =
    template.accent === "forest"
      ? "rgb(20, 62, 42)"
      : template.accent === "amber"
        ? "rgb(180, 83, 9)"
        : template.accent === "obsidian"
          ? "rgb(24, 24, 27)"
          : "rgb(22, 101, 52)"

  return (
    <div
      className="flex h-[112px] w-full flex-col overflow-hidden rounded-[8px] border border-hairline shadow-sm"
      style={{ backgroundColor: "rgb(248, 250, 252)", color: "rgb(15, 23, 42)" }}
    >
      <div
        className="px-2.5 py-1.5"
        style={{ backgroundColor: headerBg, color: "rgb(255, 255, 255)" }}
      >
        <div className="truncate text-[7.5px] font-semibold">
          {template.name}
        </div>
        <div className="truncate text-[5.5px] opacity-80">
          {template.description}
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-1 p-2 font-mono text-[6px]">
        {["Q1", "Q2", "Q3", "$124k", "$158k", "$196k", "+18%", "+27%", "+24%"].map(
          (cell, idx) => (
            <div
              key={idx}
              className="flex items-center justify-center rounded border px-1 py-0.5 tabular-nums"
              style={{
                borderColor: "rgb(226, 232, 240)",
                backgroundColor:
                  idx < 3 ? "rgb(241, 245, 249)" : "rgb(255, 255, 255)",
                fontWeight: idx < 3 ? 600 : 500,
              }}
            >
              {cell}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function PresentationPreviewThumb({
  template,
}: {
  template: ComposerTemplateItem
}) {
  let cardBg = "rgb(10, 10, 12)"
  let titleColor = "rgb(255, 255, 255)"
  let kickerColor = "rgb(239, 68, 68)"
  let kickerText = "2026 Report"
  let slideTitle = template.name
  let footerText = template.description

  if (template.previewVariant === "slide-market") {
    cardBg = "rgb(8, 8, 10)"
    titleColor = "rgb(255, 255, 255)"
    kickerColor = "rgb(239, 68, 68)"
    kickerText = "2026 Report"
    slideTitle = "Market Industry Trends Report"
    footerText = "Signals, shifts, and strategic implications"
  } else if (template.previewVariant === "slide-operating") {
    cardBg = "linear-gradient(135deg, rgb(22, 43, 88), rgb(17, 35, 74))"
    titleColor = "rgb(248, 250, 252)"
    kickerColor = "rgb(147, 197, 253)"
    kickerText = "Company Name · Q2 2026"
    slideTitle = "Weekly Business Operating Review"
    footerText = "Metrics, decisions & operating cadence"
  } else if (template.previewVariant === "slide-kickoff") {
    cardBg = "rgb(13, 44, 24)"
    titleColor = "rgb(190, 242, 100)"
    kickerColor = "rgb(187, 247, 208)"
    kickerText = "H2 Planning"
    slideTitle = "Team Project Kickoff Session"
    footerText = "Aligning on vision, plan, and path to success"
  } else if (template.accent === "forest") {
    cardBg = "rgb(13, 44, 24)"
    titleColor = "rgb(190, 242, 100)"
    kickerColor = "rgb(187, 247, 208)"
    kickerText = "Custom Deck"
  } else if (template.accent === "amber") {
    cardBg = "linear-gradient(135deg, rgb(120, 53, 15), rgb(69, 26, 3))"
    titleColor = "rgb(254, 243, 199)"
    kickerColor = "rgb(252, 211, 77)"
    kickerText = "Custom Deck"
  } else if (template.accent === "navy") {
    cardBg = "linear-gradient(135deg, rgb(22, 43, 88), rgb(17, 35, 74))"
    titleColor = "rgb(248, 250, 252)"
    kickerColor = "rgb(147, 197, 253)"
    kickerText = "Deep Dive"
  }

  return (
    <div className="relative flex h-[112px] w-full flex-col justify-end pt-3">
      {/* Stacked back slides */}
      <div
        className="mx-3 h-2 rounded-t-[6px]"
        style={{ backgroundColor: "rgba(214, 211, 209, 0.72)" }}
      />
      <div
        className="mx-1.5 -mt-0.5 h-2 rounded-t-[6px]"
        style={{ backgroundColor: "rgba(231, 229, 228, 0.85)" }}
      />
      {/* Front slide */}
      <div
        className={cn(
          "-mt-0.5 flex h-[96px] w-full flex-col justify-between rounded-[8px] border border-hairline px-3 py-2.5 shadow-sm",
          template.previewVariant === "slide-operating"
            ? "items-start text-left"
            : "items-center text-center"
        )}
        style={{ background: cardBg }}
      >
        <div
          className="w-full truncate text-[6px] font-medium tracking-wide"
          style={{ color: kickerColor }}
        >
          {kickerText}
        </div>
        <div
          className="line-clamp-2 text-[11px] leading-tight font-semibold tracking-tight"
          style={{ color: titleColor }}
        >
          {slideTitle}
        </div>
        <div
          className="w-full truncate text-[5.5px]"
          style={{ color: "rgba(226, 232, 240, 0.72)" }}
        >
          {footerText}
        </div>
      </div>
    </div>
  )
}

export function TemplateCarousel({
  kind,
  templates,
  onSelectTemplate,
  onCreateTemplateClick,
  onDeleteCustomTemplate,
  onClose,
}: TemplateCarouselProps) {
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(true)

  const syncScrollButtons = React.useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  React.useEffect(() => {
    syncScrollButtons()
  }, [templates.length, syncScrollButtons])

  const scrollByCards = (direction: -1 | 1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * 236, behavior: "smooth" })
  }

  return (
    <div
      data-testid={`template-carousel-${kind}`}
      className="rayu-card-bevel mb-2.5 w-full max-w-[732px] rounded-[20px] border border-premium-hi bg-popover-solid p-4 shadow-rayu-2"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[13.5px] font-medium text-ink">Templates</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="create-template-btn"
            onClick={onCreateTemplateClick}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline-hi bg-raised px-3.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-hover"
          >
            <span>Create template</span>
          </button>
          <button
            type="button"
            aria-label="Scroll templates left"
            disabled={!canScrollLeft}
            onClick={() => scrollByCards(-1)}
            className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-35"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Scroll templates right"
            disabled={!canScrollRight}
            onClick={() => scrollByCards(1)}
            className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-35"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Close templates"
            onClick={onClose}
            className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-ink transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={syncScrollButtons}
        className="flex gap-3.5 overflow-x-auto scroll-smooth pb-1"
      >
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            className="group relative flex w-[216px] shrink-0 flex-col items-center gap-2"
          >
            <button
              type="button"
              data-testid={`template-card-${tpl.id}`}
              onClick={() => onSelectTemplate(tpl)}
              className="flex w-full cursor-pointer flex-col items-center rounded-[14px] border border-hairline bg-inset/70 p-3 text-left transition-all hover:border-premium-hi hover:bg-hover/70 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
            >
              {kind === "presentation" ? (
                <PresentationPreviewThumb template={tpl} />
              ) : (
                <SpreadsheetPreviewThumb template={tpl} />
              )}
            </button>

            <button
              type="button"
              onClick={() => onSelectTemplate(tpl)}
              className="max-w-full cursor-pointer truncate text-[13px] font-medium text-ink transition-colors group-hover:text-brand-text"
            >
              {tpl.name}
            </button>

            {tpl.isCustom && onDeleteCustomTemplate ? (
              <button
                type="button"
                aria-label={`Delete ${tpl.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteCustomTemplate(tpl.id)
                }}
                className="absolute top-2 right-2 grid size-6 cursor-pointer place-items-center rounded-full border border-hairline bg-popover-solid/90 text-muted-ink opacity-0 transition-all group-hover:opacity-100 hover:text-danger"
              >
                <Trash2 className="size-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

interface TemplateCreatorDialogProps {
  open: boolean
  defaultKind: ComposerTemplateKind
  onOpenChange: (open: boolean) => void
  onSave: (input: {
    kind: ComposerTemplateKind
    name: string
    description: string
    promptSpec: string
    accent: PersistedComposerTemplate["accent"]
  }) => Promise<void>
}

export function TemplateCreatorDialog({
  open,
  defaultKind,
  onOpenChange,
  onSave,
}: TemplateCreatorDialogProps) {
  const [kind, setKind] = React.useState<ComposerTemplateKind>(defaultKind)
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [promptSpec, setPromptSpec] = React.useState("")
  const [accent, setAccent] =
    React.useState<PersistedComposerTemplate["accent"]>(
      defaultKind === "presentation" ? "navy" : "emerald"
    )
  const [saving, setSaving] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !promptSpec.trim()) return
    setSaving(true)
    try {
      await onSave({
        kind,
        name: name.trim(),
        description:
          description.trim() || `Reusable ${kind} template`,
        promptSpec: promptSpec.trim(),
        accent,
      })
      setName("")
      setDescription("")
      setPromptSpec("")
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-premium-hi bg-popover-solid text-ink sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Plus className="size-4 text-brand-text" aria-hidden="true" />
            <span>Create reusable template</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-ink">
            Saved locally to <code className="font-mono">~/.rayu/templates.json</code>{" "}
            so you can launch it directly from the Templates carousel.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="tpl-kind" className="block text-xs font-medium text-body">
                Type
              </label>
              <select
                id="tpl-kind"
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as ComposerTemplateKind)
                }
                className="flex h-9 w-full rounded-md border border-hairline bg-inset px-2.5 text-xs text-ink outline-none focus:border-brand"
              >
                <option value="spreadsheet">Spreadsheets</option>
                <option value="presentation">Presentations</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="tpl-accent" className="block text-xs font-medium text-body">
                Theme
              </label>
              <select
                id="tpl-accent"
                value={accent}
                onChange={(e) =>
                  setAccent(
                    e.target.value as PersistedComposerTemplate["accent"]
                  )
                }
                className="flex h-9 w-full rounded-md border border-hairline bg-inset px-2.5 text-xs text-ink outline-none focus:border-brand"
              >
                <option value="emerald">Emerald</option>
                <option value="navy">Executive Navy</option>
                <option value="forest">Forest</option>
                <option value="amber">Warm Amber</option>
                <option value="obsidian">Obsidian Dark</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tpl-name" className="block text-xs font-medium text-body">
              Template name
            </label>
            <input
              id="tpl-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === "presentation"
                  ? "e.g., Quarterly Board Update"
                  : "e.g., Hiring Capacity Plan"
              }
              className="flex h-9 w-full rounded-md border border-hairline bg-inset px-3 text-xs text-ink placeholder:text-muted-ink outline-none focus:border-brand"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tpl-desc" className="block text-xs font-medium text-body">
              Short summary
            </label>
            <input
              id="tpl-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Executive metrics, key wins, and Q3 hiring plan"
              className="flex h-9 w-full rounded-md border border-hairline bg-inset px-3 text-xs text-ink placeholder:text-muted-ink outline-none focus:border-brand"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tpl-spec" className="block text-xs font-medium text-body">
              Template structure &amp; instructions
            </label>
            <textarea
              id="tpl-spec"
              required
              rows={4}
              value={promptSpec}
              onChange={(e) => setPromptSpec(e.target.value)}
              placeholder={
                kind === "presentation"
                  ? "List slides, narrative tone, required tables/charts, and speaker note guidelines..."
                  : "List worksheet tabs, KPIs, formulas, scenario selectors, and formatting rules..."
              }
              className="w-full resize-none rounded-md border border-hairline bg-inset p-2.5 text-xs text-ink placeholder:text-muted-ink outline-none focus:border-brand"
            />
          </div>

          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !name.trim() || !promptSpec.trim()}
            >
              {saving ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
