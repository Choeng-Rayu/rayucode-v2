import * as React from "react"
import { Check } from "lucide-react"
import { toast } from "sonner"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useAppStore } from "@/lib/app-store"
import { cn } from "@/lib/utils"

import { CODE_FONT_OPTIONS } from "../schemas"
import type { CodeFontFamily, FontScale } from "../types"

export interface AppearancePanelProps {
  className?: string
}

const FONT_SCALE_OPTIONS: Array<{ value: FontScale; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
]

export function AppearancePanel({ className }: AppearancePanelProps) {
  const theme = useAppStore((s) => s.theme)
  const accent = useAppStore((s) => s.accent)
  const setTheme = useAppStore((s) => s.setTheme)
  const setAccent = useAppStore((s) => s.setAccent)

  const [codeFont, setCodeFont] =
    React.useState<CodeFontFamily>("JetBrains Mono")
  const [fontScale, setFontScale] = React.useState<FontScale>("default")
  const [reduceMotion, setReduceMotion] = React.useState(false)

  const handleSelectTheme = (nextTheme: "dark" | "light") => {
    setTheme(nextTheme)
    toast(
      nextTheme === "dark"
        ? "Theme: Warm Graphite Dark"
        : "Theme: Warm Paper Light"
    )
  }

  const handleSelectAccent = (nextAccent: "green" | "blue") => {
    setAccent(nextAccent)
    toast(
      nextAccent === "green"
        ? "Accent: Rayu Green (Default)"
        : "Accent: Ocean Blue"
    )
  }

  return (
    <section
      data-testid="appearance-panel"
      aria-labelledby="sp-h-appearance"
      className={cn("flex flex-col", className)}
    >
      <h1
        id="sp-h-appearance"
        className="mb-1.5 text-2xl font-medium tracking-[-0.025em] text-ink"
      >
        Appearance
      </h1>
      <p className="mb-8 text-[13px] leading-[1.45] text-muted-ink">
        Customize theme, brand accent, typography, and interface density
      </p>

      {/* Theme Mode Picker */}
      <h2 className="border-b border-hairline-soft pb-3 text-[13px] font-medium text-ink">
        Theme
      </h2>
      <div
        role="group"
        aria-label="Theme mode"
        className="mt-3.5 mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {/* Warm Graphite Dark */}
        <button
          type="button"
          data-testid="theme-card-dark"
          data-theme-set="dark"
          aria-pressed={theme === "dark"}
          onClick={() => handleSelectTheme("dark")}
          className={cn(
            "group flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-pane p-2.5 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
            theme === "dark"
              ? "border-brand ring-1 ring-brand"
              : "border-hairline hover:border-hairline-strong"
          )}
        >
          <div className="flex h-[70px] gap-1.5 rounded-lg border border-hairline bg-ink p-2 dark:bg-canvas">
            <div className="w-4.5 shrink-0 rounded-[4px] bg-body/25 dark:bg-pane" />
            <div className="flex flex-1 flex-col justify-center gap-1.5 px-1">
              <div className="h-1.5 w-[78%] rounded-full bg-hairline/30 dark:bg-active" />
              <div className="h-1.5 w-[48%] rounded-full bg-brand opacity-90" />
            </div>
          </div>
          <div className="flex items-center justify-between px-0.5">
            <div>
              <div className="text-xs font-medium text-ink">
                Warm Graphite Dark
              </div>
              <div className="text-[11px] text-muted-ink">
                Deep warm charcoal canvas
              </div>
            </div>
            {theme === "dark" ? (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand text-brand-ink">
                <Check className="size-3" strokeWidth={2.2} />
              </span>
            ) : null}
          </div>
        </button>

        {/* Warm Paper Light */}
        <button
          type="button"
          data-testid="theme-card-light"
          data-theme-set="light"
          aria-pressed={theme === "light"}
          onClick={() => handleSelectTheme("light")}
          className={cn(
            "group flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-pane p-2.5 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
            theme === "light"
              ? "border-brand ring-1 ring-brand"
              : "border-hairline hover:border-hairline-strong"
          )}
        >
          <div
            data-theme="light"
            className="flex h-[70px] gap-1.5 rounded-lg border border-hairline bg-canvas p-2"
          >
            <div className="w-4.5 shrink-0 rounded-[4px] bg-inset" />
            <div className="flex flex-1 flex-col justify-center gap-1.5 px-1">
              <div className="h-1.5 w-[78%] rounded-full bg-hairline" />
              <div className="h-1.5 w-[48%] rounded-full bg-brand opacity-90" />
            </div>
          </div>
          <div className="flex items-center justify-between px-0.5">
            <div>
              <div className="text-xs font-medium text-ink">
                Warm Paper Light
              </div>
              <div className="text-[11px] text-muted-ink">
                Crisp warm paper surface
              </div>
            </div>
            {theme === "light" ? (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand text-brand-ink">
                <Check className="size-3" strokeWidth={2.2} />
              </span>
            ) : null}
          </div>
        </button>
      </div>

      {/* Brand Accent Swatch Picker */}
      <h2 className="border-b border-hairline-soft pb-3 text-[13px] font-medium text-ink">
        Accent color
      </h2>
      <p className="mt-2.5 mb-3.5 text-xs text-muted-ink">
        Choose Rayu Green (brand default) or Ocean Blue for clickable code
        references, highlights, and primary actions.
      </p>
      <div
        role="group"
        aria-label="Brand accent color"
        className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {/* Rayu Green (Default) */}
        <button
          type="button"
          data-testid="accent-card-green"
          data-accent-set="green"
          aria-pressed={accent === "green"}
          onClick={() => handleSelectAccent("green")}
          className={cn(
            "flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-pane px-3.5 py-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
            accent === "green"
              ? "border-brand bg-brand-softer ring-1 ring-brand"
              : "border-hairline hover:border-hairline-strong"
          )}
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="size-6 shrink-0 rounded-full border border-premium shadow-bevel-surface"
              style={{ backgroundColor: "var(--office-excel)" }}
            />
            <div>
              <div className="text-[13px] font-medium text-ink">
                Rayu Green (Default)
              </div>
              <div className="text-[11px] text-muted-ink">
                Signature emerald accent
              </div>
            </div>
          </div>
          {accent === "green" ? (
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink">
              <Check className="size-3" strokeWidth={2.2} />
            </span>
          ) : null}
        </button>

        {/* Ocean Blue */}
        <button
          type="button"
          data-testid="accent-card-blue"
          data-accent-set="blue"
          aria-pressed={accent === "blue"}
          onClick={() => handleSelectAccent("blue")}
          className={cn(
            "flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-pane px-3.5 py-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
            accent === "blue"
              ? "border-brand bg-brand-softer ring-1 ring-brand"
              : "border-hairline hover:border-hairline-strong"
          )}
        >
          <div className="flex items-center gap-3">
            <span
              data-accent="blue"
              aria-hidden="true"
              className="size-6 shrink-0 rounded-full border border-premium bg-brand shadow-bevel-surface"
            />
            <div>
              <div className="text-[13px] font-medium text-ink">Ocean Blue</div>
              <div className="text-[11px] text-muted-ink">
                Cool cobalt focus &amp; links
              </div>
            </div>
          </div>
          {accent === "blue" ? (
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink">
              <Check className="size-3" strokeWidth={2.2} />
            </span>
          ) : null}
        </button>
      </div>

      {/* Typography & Layout */}
      <h2 className="border-b border-hairline-soft pb-3 text-[13px] font-medium text-ink">
        Typography &amp; layout
      </h2>

      <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink">Code font</div>
          <div className="mt-0.5 text-xs text-muted-ink">
            Monospace typeface for diffs, terminal, and inline snippets
          </div>
        </div>
        <Select
          value={codeFont}
          onValueChange={(value) => {
            setCodeFont(value as CodeFontFamily)
            toast(`Code font: ${value}`)
          }}
        >
          <SelectTrigger aria-label="Code font" className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {CODE_FONT_OPTIONS.map((font) => (
              <SelectItem key={font} value={font}>
                {font}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-6 border-b border-hairline-soft py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink">Font size</div>
          <div className="mt-0.5 text-xs text-muted-ink">
            Base UI and conversation reading scale
          </div>
        </div>
        <div
          role="group"
          aria-label="Font size"
          className="inline-flex items-center rounded-md border border-hairline bg-pane p-[3px]"
        >
          {FONT_SCALE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={fontScale === opt.value}
              onClick={() => {
                setFontScale(opt.value)
                toast(`Font size: ${opt.label}`)
              }}
              className={cn(
                "cursor-pointer rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                fontScale === opt.value
                  ? "border border-premium bg-active text-ink shadow-bevel-surface"
                  : "border border-transparent text-muted-ink hover:text-ink"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-6 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink">Reduce motion</div>
          <div className="mt-0.5 text-xs text-muted-ink">
            Minimize popover and sidebar transition animations
          </div>
        </div>
        <Switch
          aria-label="Reduce motion"
          checked={reduceMotion}
          onCheckedChange={(checked) => {
            setReduceMotion(checked)
            toast(
              checked ? "Reduced motion enabled" : "Reduced motion disabled"
            )
          }}
        />
      </div>
    </section>
  )
}
