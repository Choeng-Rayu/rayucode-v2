import { Check } from "lucide-react";
import type {
  AccentPreference,
  DensityPreference,
  ThemePreference,
} from "@shared/vscodeProtocol";

import { Switch } from "@/components/ui/switch";
import {
  syncAccentToDom,
  syncDensityToDom,
  syncReduceMotionToDom,
  syncThemeToDom,
  useAppStore,
} from "@/lib/app-store";
import { postToHost } from "@/lib/rpc-client";
import { cn } from "@/lib/utils";

import { ConfigScopeBadge } from "./ConfigSyncChrome";

export interface AppearanceSectionProps {
  className?: string;
}

const THEME_OPTIONS: ReadonlyArray<{
  id: ThemePreference;
  label: string;
  description: string;
}> = [
  {
    id: "auto",
    label: "Auto (Follow VS Code)",
    description:
      "Rayu Signature Warm Graphite Dark or Warm Paper Light matching VS Code polarity",
  },
  {
    id: "dark",
    label: "Warm Graphite Dark",
    description: "Always Rayu Signature deep warm graphite canvas",
  },
  {
    id: "light",
    label: "Warm Paper Light",
    description: "Always Rayu Signature crisp warm paper canvas",
  },
  {
    id: "vscode",
    label: "Match VS Code Theme",
    description: "Inherits active VS Code editor and sidebar CSS variables directly",
  },
];

const ACCENT_OPTIONS: ReadonlyArray<{
  id: AccentPreference;
  label: string;
  description: string;
}> = [
  {
    id: "green",
    label: "Rayu Green (Default)",
    description: "Signature emerald brand accent",
  },
  {
    id: "blue",
    label: "Ocean Blue",
    description: "Cool cobalt focus, links, and primary buttons",
  },
];

const DENSITY_OPTIONS: ReadonlyArray<{
  id: DensityPreference;
  label: string;
}> = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
];

export function AppearanceSection({ className }: AppearanceSectionProps) {
  const theme = useAppStore((s) => s.theme);
  const accent = useAppStore((s) => s.accent);
  const density = useAppStore((s) => s.density);
  const reduceMotion = useAppStore((s) => s.reduceMotion);

  const setTheme = useAppStore((s) => s.setTheme);
  const setAccent = useAppStore((s) => s.setAccent);
  const setDensity = useAppStore((s) => s.setDensity);
  const setReduceMotion = useAppStore((s) => s.setReduceMotion);

  const handleSelectTheme = (nextTheme: ThemePreference) => {
    syncThemeToDom(nextTheme);
    setTheme(nextTheme, false);
    postToHost({
      type: "rayucode.ui.setAppearance",
      theme: nextTheme,
      accent,
      density,
      reduceMotion,
    });
  };

  const handleSelectAccent = (nextAccent: AccentPreference) => {
    syncAccentToDom(nextAccent);
    setAccent(nextAccent, false);
    postToHost({
      type: "rayucode.ui.setAppearance",
      theme,
      accent: nextAccent,
      density,
      reduceMotion,
    });
  };

  const handleSelectDensity = (nextDensity: DensityPreference) => {
    syncDensityToDom(nextDensity);
    setDensity(nextDensity, false);
    postToHost({
      type: "rayucode.ui.setAppearance",
      theme,
      accent,
      density: nextDensity,
      reduceMotion,
    });
  };

  const handleToggleReduceMotion = (nextReduce: boolean) => {
    syncReduceMotionToDom(nextReduce);
    setReduceMotion(nextReduce, false);
    postToHost({
      type: "rayucode.ui.setAppearance",
      theme,
      accent,
      density,
      reduceMotion: nextReduce,
    });
  };

  return (
    <section
      data-testid="settings-section-appearance"
      aria-labelledby="settings-h-appearance"
      className={cn("flex flex-col gap-6", className)}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1
            id="settings-h-appearance"
            className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink"
          >
            Appearance
          </h1>
          <ConfigScopeBadge scope="local" />
        </div>
        <p className="mt-1 text-xs text-muted-ink">
          Customize theme polarity, brand accent, and interface density across
          both the Compact Sidebar and Full Editor Panel.
        </p>
      </div>

      {/* 4 Theme Selector Cards */}
      <div>
        <h2 className="mb-3 border-b border-hairline-soft pb-2 text-xs font-semibold text-ink">
          Theme Mode
        </h2>
        <div
          role="group"
          aria-label="Theme mode"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {THEME_OPTIONS.map((opt) => {
            const isSelected = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`theme-card-${opt.id}`}
                aria-pressed={isSelected}
                onClick={() => handleSelectTheme(opt.id)}
                className={cn(
                  "flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-pane p-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "border-brand bg-brand-softer ring-1 ring-brand"
                    : "border-hairline hover:border-hairline-strong",
                )}
              >
                <div
                  data-theme={opt.id === "light" ? "light" : undefined}
                  className="flex h-14 gap-1.5 rounded-lg border border-hairline bg-canvas p-2"
                >
                  <div className="w-4 shrink-0 rounded-[4px] bg-pane" />
                  <div className="flex flex-1 flex-col justify-center gap-1.5 px-1">
                    <div className="h-1.5 w-[75%] rounded-full bg-active" />
                    <div className="h-1.5 w-[45%] rounded-full bg-brand" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-ink">
                      {opt.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-ink">
                      {opt.description}
                    </div>
                  </div>
                  {isSelected && (
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink">
                      <Check className="size-3" strokeWidth={2.4} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2 Accent Swatches */}
      <div>
        <h2 className="mb-3 border-b border-hairline-soft pb-2 text-xs font-semibold text-ink">
          Accent Color
        </h2>
        <div
          role="group"
          aria-label="Brand accent color"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {ACCENT_OPTIONS.map((opt) => {
            const isSelected = accent === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`accent-card-${opt.id}`}
                aria-pressed={isSelected}
                onClick={() => handleSelectAccent(opt.id)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-pane px-3.5 py-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "border-brand bg-brand-softer ring-1 ring-brand"
                    : "border-hairline hover:border-hairline-strong",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    data-accent={opt.id === "blue" ? "blue" : undefined}
                    aria-hidden="true"
                    className="size-6 shrink-0 rounded-full border border-premium bg-brand shadow-bevel-surface"
                  />
                  <div>
                    <div className="text-xs font-medium text-ink">
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-muted-ink">
                      {opt.description}
                    </div>
                  </div>
                </div>
                {isSelected && (
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink">
                    <Check className="size-3" strokeWidth={2.4} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Density & Motion */}
      <div>
        <h2 className="mb-2 border-b border-hairline-soft pb-2 text-xs font-semibold text-ink">
          Density &amp; Motion
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline-soft py-3">
          <div>
            <div className="text-xs font-medium text-ink">
              Interface density
            </div>
            <div className="mt-0.5 text-[11px] text-muted-ink">
              Adjust row spacing and top bar height across panels
            </div>
          </div>

          <div
            role="group"
            aria-label="Interface density"
            className="inline-flex items-center rounded-md border border-hairline bg-pane p-[2px]"
          >
            {DENSITY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`density-btn-${opt.id}`}
                aria-pressed={density === opt.id}
                onClick={() => handleSelectDensity(opt.id)}
                className={cn(
                  "cursor-pointer rounded-xs px-2.5 py-1 text-xs font-medium transition-colors",
                  density === opt.id
                    ? "border border-premium bg-active text-ink shadow-bevel-surface"
                    : "text-muted-ink hover:text-ink",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <div className="text-xs font-medium text-ink">Reduce motion</div>
            <div className="mt-0.5 text-[11px] text-muted-ink">
              Minimize popover, drawer, and orbital spinner animations
            </div>
          </div>
          <Switch
            checked={reduceMotion}
            onCheckedChange={handleToggleReduceMotion}
            aria-label="Reduce motion"
            data-testid="reduce-motion-switch"
          />
        </div>
      </div>
    </section>
  );
}
