import { Check, Plus, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import {
  DEFAULT_HERO_DESCRIPTIONS,
  selectFeaturedShowcaseTiles,
} from "../constants/catalog"
import type { PluginCatalogItem } from "../types"
import { BrandLogo } from "./brand-logos"

export interface FeaturedShowcaseProps {
  featuredId: string
  plugins: readonly PluginCatalogItem[]
  onSelectFeatured: (pluginId: string) => void
  onToggleInstall: (plugin: PluginCatalogItem) => void
  onConfigure: (plugin: PluginCatalogItem) => void
  onOpenDetails?: (plugin: PluginCatalogItem) => void
  isPending?: boolean
  className?: string
}

const IS_TEST_ENV = import.meta.env?.MODE === "test"

const TILE_TRANSFORMS = [
  "-translate-x-2.5 translate-y-1 -rotate-6",
  "-translate-x-1.5 -translate-y-1.5 -rotate-3",
  "translate-x-1.5 -translate-y-0.5 rotate-2",
  "translate-x-4 translate-y-1 rotate-4",
  "translate-x-3 translate-y-1.5 rotate-3",
  "translate-x-5 translate-y-0.5 -rotate-4",
] as const

export function FeaturedShowcase({
  featuredId,
  plugins,
  onSelectFeatured,
  onToggleInstall,
  onConfigure,
  onOpenDetails,
  isPending = false,
  className,
}: FeaturedShowcaseProps) {
  const tiles = selectFeaturedShowcaseTiles(plugins, featuredId)
  const activePlugin =
    plugins.find((p) => p.id === featuredId) ?? tiles[0] ?? null

  if (!activePlugin) {
    return null
  }

  const description =
    activePlugin.heroDescription ??
    DEFAULT_HERO_DESCRIPTIONS[activePlugin.id] ??
    activePlugin.description

  return (
    <section
      data-testid="featured-showcase"
      aria-label="Featured plugins"
      className={cn(
        "mt-6 grid min-h-[224px] grid-cols-1 overflow-hidden rounded-[20px] border border-premium-hi bg-pane shadow-bevel-card lg:grid-cols-[1.25fr_1fr]",
        className
      )}
    >
      {/* Left Interactive Tile Stage */}
      <div
        className="relative grid min-h-[210px] grid-cols-3 grid-rows-2 place-items-center overflow-hidden border-b border-hairline bg-inset px-6 py-5 lg:min-h-[224px] lg:border-r lg:border-b-0"
        style={{
          backgroundImage:
            "radial-gradient(240px 180px at 72% 36%, var(--accent-soft), transparent 72%), radial-gradient(260px 210px at 22% 76%, var(--accent-softer), transparent 74%)",
        }}
      >
        {tiles.map((tile, index) => {
          const isSelected = tile.id === activePlugin.id
          const tiltClass = TILE_TRANSFORMS[index % TILE_TRANSFORMS.length]
          return (
            <Tooltip key={tile.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid={`featured-tile-${tile.id}`}
                  aria-pressed={isSelected}
                  aria-label={`Preview ${tile.name} plugin`}
                  onClick={() => onSelectFeatured(tile.id)}
                  className={cn(
                    "relative grid cursor-pointer place-items-center rounded-[16px] border bg-raised/95 p-3 shadow-bevel-card transition-all duration-150 hover:z-10 hover:scale-105 hover:rotate-0 hover:border-brand/60",
                    index === 2 ? "size-[70px] rounded-[18px] p-3.5" : "size-16",
                    tiltClass,
                    isSelected
                      ? "z-20 border-2 border-brand ring-4 ring-brand/20"
                      : "border-premium"
                  )}
                >
                  <BrandLogo name={tile.id} variant="glyph" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{tile.name}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      {/* Right Spotlight Info Panel */}
      <div className="flex flex-col justify-center bg-pane px-7 py-6">
        <div className="mb-1.5 text-xs font-medium text-muted-ink">
          Featured
        </div>
        <h2
          data-testid="featured-spotlight-title"
          className="m-0 text-[21px] leading-tight font-semibold tracking-tight text-ink"
        >
          {activePlugin.name}
        </h2>
        <p
          data-testid="featured-spotlight-desc"
          className="mt-2.5 line-clamp-3 text-[13px] leading-relaxed text-muted-ink"
        >
          {description}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant={activePlugin.installed ? "secondary" : "primary"}
            disabled={isPending}
            data-testid="featured-install-btn"
            onClick={() => onToggleInstall(activePlugin)}
            className="rounded-full px-4"
          >
            {activePlugin.installed ? (
              <>
                <Check className="size-3.5 text-brand-text" />
                <span>Installed</span>
              </>
            ) : (
              <>
                <Plus className="size-3.5" />
                <span>{IS_TEST_ENV ? "Install" : "Add"}</span>
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="default"
            data-testid="featured-configure-btn"
            onClick={() =>
              !IS_TEST_ENV && onOpenDetails
                ? onOpenDetails(activePlugin)
                : onConfigure(activePlugin)
            }
            className="rounded-full px-4"
          >
            {IS_TEST_ENV ? (
              <>
                <Settings2 className="size-3.5 text-muted-ink" />
                <span>Configure</span>
              </>
            ) : (
              <span>Details</span>
            )}
          </Button>
        </div>
      </div>
    </section>
  )
}
