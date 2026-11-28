import { Check, Info, Plus, Settings2 } from "lucide-react";

import {
  Badge,
  BrandLogo,
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { cn } from "@/lib";

import type { CatalogConnectorTemplate } from "../hooks/usePlugins";

export interface FeaturedShowcaseProps {
  featuredId: string;
  templates: readonly CatalogConnectorTemplate[];
  installedIds: ReadonlySet<string>;
  onSelectFeatured: (id: string) => void;
  onInstallTemplate: (template: CatalogConnectorTemplate) => void;
  onConfigureTemplate: (template: CatalogConnectorTemplate) => void;
  onOpenDetails: (template: CatalogConnectorTemplate) => void;
  isPending?: boolean;
  className?: string;
}

const SHOWCASE_ORDER = [
  "github",
  "linear",
  "context7-docs",
  "sentry",
  "postgresql",
  "playwright",
] as const;

const TILE_TRANSFORMS = [
  "-translate-x-2 translate-y-1 -rotate-6",
  "-translate-x-1 -translate-y-1 -rotate-3",
  "translate-x-1 -translate-y-0.5 rotate-2",
  "translate-x-2.5 translate-y-1 rotate-4",
  "translate-x-2 translate-y-1 rotate-3",
  "translate-x-3 translate-y-0.5 -rotate-4",
] as const;

export function FeaturedShowcase({
  featuredId,
  templates,
  installedIds,
  onSelectFeatured,
  onInstallTemplate,
  onConfigureTemplate,
  onOpenDetails,
  isPending = false,
  className,
}: FeaturedShowcaseProps) {
  const tiles = SHOWCASE_ORDER.map((id) =>
    templates.find((t) => t.id === id),
  ).filter((t): t is CatalogConnectorTemplate => Boolean(t));

  const activeTemplate =
    templates.find((t) => t.id === featuredId) ?? tiles[0] ?? templates[0];

  if (!activeTemplate) {
    return null;
  }

  const isInstalled = installedIds.has(activeTemplate.id);

  return (
    <section
      data-testid="featured-showcase"
      aria-label="Featured MCP connectors"
      className={cn(
        "rayu-card-bevel grid min-h-[212px] grid-cols-1 overflow-hidden rounded-[18px] border border-premium-hi bg-pane @min-[640px]/plugins-stage:grid-cols-[1.2fr_1fr]",
        className,
      )}
    >
      {/* Left Interactive BrandLogo Tile Stage */}
      <div
        className="relative grid min-h-[196px] grid-cols-3 grid-rows-2 place-items-center overflow-hidden border-b border-hairline bg-inset px-5 py-4 @min-[640px]/plugins-stage:min-h-[212px] @min-[640px]/plugins-stage:border-r @min-[640px]/plugins-stage:border-b-0"
        style={{
          backgroundImage:
            "radial-gradient(220px 160px at 72% 36%, var(--accent-soft), transparent 72%), radial-gradient(240px 190px at 22% 76%, var(--accent-softer), transparent 74%)",
        }}
      >
        {tiles.map((tile, index) => {
          const isSelected = tile.id === activeTemplate.id;
          const tiltClass = TILE_TRANSFORMS[index % TILE_TRANSFORMS.length];
          return (
            <Tooltip key={tile.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid={`featured-tile-${tile.id}`}
                  aria-pressed={isSelected}
                  aria-label={`Preview ${tile.name} MCP connector`}
                  onClick={() => onSelectFeatured(tile.id)}
                  className={cn(
                    "relative grid cursor-pointer place-items-center rounded-[15px] border bg-raised/95 p-2.5 shadow-bevel-card transition-all duration-150 hover:z-10 hover:scale-105 hover:rotate-0 hover:border-brand/60",
                    index === 2 ? "size-16 rounded-[17px] p-3" : "size-14",
                    tiltClass,
                    isSelected
                      ? "z-20 border-2 border-brand ring-4 ring-brand/20"
                      : "border-premium",
                  )}
                >
                  <BrandLogo name={tile.brandId} variant="glyph" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{tile.name}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Right Spotlight Info Panel */}
      <div className="flex flex-col justify-center bg-pane px-6 py-5">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-ink">
          <span>Featured Connector</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {activeTemplate.transport}
          </Badge>
        </div>

        <h2
          data-testid="featured-spotlight-title"
          className="m-0 text-lg leading-tight font-semibold tracking-tight text-ink"
        >
          {activeTemplate.name}
        </h2>

        <p
          data-testid="featured-spotlight-desc"
          className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-ink"
        >
          {activeTemplate.heroDescription}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isInstalled ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="featured-install-btn"
              onClick={() => onConfigureTemplate(activeTemplate)}
              className="rounded-full px-3.5"
            >
              <Check className="size-3.5 text-brand-text" aria-hidden="true" />
              <span>Configured</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isPending}
              data-testid="featured-install-btn"
              onClick={() => onInstallTemplate(activeTemplate)}
              className="rounded-full px-4"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>Install</span>
            </Button>
          )}

          <Button
            type="button"
            variant="default"
            size="sm"
            data-testid="featured-configure-btn"
            onClick={() => onConfigureTemplate(activeTemplate)}
            className="rounded-full px-3.5"
          >
            <Settings2 className="size-3.5 text-muted-ink" aria-hidden="true" />
            <span>Configure</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="featured-details-btn"
            onClick={() => onOpenDetails(activeTemplate)}
            className="rounded-full px-3"
          >
            <Info className="size-3.5 text-muted-ink" aria-hidden="true" />
            <span>Tools &amp; Schema</span>
          </Button>
        </div>
      </div>
    </section>
  );
}
