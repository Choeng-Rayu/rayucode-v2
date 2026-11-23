import * as React from "react";
import {
  BookOpen,
  Briefcase,
  Code2,
  Database,
  Folder,
  FolderOpen,
  Globe,
  Layers,
  Rocket,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { ProjectIconColor, ProjectIconView } from "@shared/vscodeProtocol";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ProjectIconSpec {
  iconKind: "icon" | "emoji";
  iconValue: string;
  iconColor: ProjectIconColor;
}

export function toProjectIconSpec(view?: ProjectIconView | null): ProjectIconSpec {
  if (!view) {
    return { iconKind: "icon", iconValue: "folder", iconColor: "folder" };
  }
  return {
    iconKind: view.kind,
    iconValue: view.value || "folder",
    iconColor: view.color ?? "folder",
  };
}

export function toProjectIconView(spec: ProjectIconSpec): ProjectIconView {
  return {
    kind: spec.iconKind,
    value: spec.iconValue,
    color: spec.iconColor,
  };
}

const COLOR_CLASS_MAP: Record<ProjectIconColor, string> = {
  folder: "text-folder",
  brand: "text-brand-text",
  info: "text-code-fn",
  type: "text-code-type",
  num: "text-code-num",
  danger: "text-danger",
};

const COLOR_DOT_MAP: Record<ProjectIconColor, string> = {
  folder: "bg-folder",
  brand: "bg-brand",
  info: "bg-code-fn",
  type: "bg-code-type",
  num: "bg-code-num",
  danger: "bg-danger",
};

export const PROJECT_ICON_OPTIONS = [
  { id: "folder", label: "Folder" },
  { id: "code", label: "Code" },
  { id: "terminal", label: "Terminal" },
  { id: "rocket", label: "Launch" },
  { id: "sparkles", label: "AI" },
  { id: "database", label: "Data" },
  { id: "globe", label: "Web" },
  { id: "layers", label: "Stack" },
  { id: "briefcase", label: "Work" },
  { id: "book", label: "Docs" },
] as const;

export const PROJECT_COLOR_OPTIONS: ReadonlyArray<{
  id: ProjectIconColor;
  label: string;
}> = [
  { id: "folder", label: "Gold" },
  { id: "brand", label: "Green" },
  { id: "info", label: "Blue" },
  { id: "type", label: "Violet" },
  { id: "num", label: "Coral" },
  { id: "danger", label: "Rose" },
];

// Built via code points so source stays 100% ASCII-clean (0 lint:design violations).
export const EMOJI_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  glyph: string;
}> = [
  { id: "folder", label: "Folder", glyph: String.fromCodePoint(0x1f4c1) },
  { id: "rocket", label: "Rocket", glyph: String.fromCodePoint(0x1f680) },
  { id: "seedling", label: "Farm", glyph: String.fromCodePoint(0x1f331) },
  { id: "clapper", label: "Studio", glyph: String.fromCodePoint(0x1f3ac) },
  { id: "brain", label: "AI Lab", glyph: String.fromCodePoint(0x1f9e0) },
  { id: "bolt", label: "Fast", glyph: String.fromCodePoint(0x26a1) },
  { id: "package", label: "Package", glyph: String.fromCodePoint(0x1f4e6) },
  { id: "palette", label: "Design", glyph: String.fromCodePoint(0x1f3a8) },
  { id: "chart", label: "Analytics", glyph: String.fromCodePoint(0x1f4ca) },
  { id: "globe", label: "Web", glyph: String.fromCodePoint(0x1f310) },
  { id: "wrench", label: "Tools", glyph: String.fromCodePoint(0x1f6e0, 0xfe0f) },
  { id: "sparkles", label: "Sparkles", glyph: String.fromCodePoint(0x2728) },
];

function VectorGlyph({
  iconValue,
  expanded = false,
  className,
}: {
  iconValue: string;
  expanded?: boolean;
  className?: string;
}) {
  const props = {
    className: cn("size-[14.5px] shrink-0", className),
    strokeWidth: 1.65,
    "aria-hidden": true as const,
  };
  switch (iconValue) {
    case "code":
      return <Code2 {...props} />;
    case "terminal":
      return <Terminal {...props} />;
    case "rocket":
      return <Rocket {...props} />;
    case "sparkles":
      return <Sparkles {...props} />;
    case "database":
      return <Database {...props} />;
    case "globe":
      return <Globe {...props} />;
    case "layers":
      return <Layers {...props} />;
    case "briefcase":
      return <Briefcase {...props} />;
    case "book":
      return <BookOpen {...props} />;
    default:
      return expanded ? (
        <FolderOpen data-folder-state="open" {...props} />
      ) : (
        <Folder data-folder-state="closed" {...props} />
      );
  }
}

export function ProjectIconGlyph({
  iconKind,
  iconValue,
  iconColor,
  expanded = false,
  className,
}: ProjectIconSpec & { expanded?: boolean; className?: string }) {
  if (iconKind === "emoji" && iconValue.trim()) {
    return (
      <span
        aria-hidden="true"
        data-project-icon-kind="emoji"
        className={cn(
          "inline-grid size-[15px] shrink-0 place-items-center text-[13px] leading-none",
          className,
        )}
      >
        {iconValue}
      </span>
    );
  }

  return (
    <VectorGlyph
      iconValue={iconValue}
      expanded={expanded}
      className={cn(
        iconValue === "folder" && iconColor === "folder"
          ? "text-muted-ink"
          : (COLOR_CLASS_MAP[iconColor] ?? "text-muted-ink"),
        className,
      )}
    />
  );
}

export interface ProjectIconPickerProps {
  value: ProjectIconSpec;
  onChange: (next: ProjectIconSpec) => void;
  className?: string;
  compact?: boolean;
}

export function ProjectIconPicker({
  value,
  onChange,
  className,
  compact = false,
}: ProjectIconPickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Choose project icon or emoji"
          data-testid="project-icon-picker-trigger"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "grid shrink-0 cursor-pointer place-items-center rounded-sm text-ink transition-colors hover:bg-hover focus-visible:outline-none",
            compact ? "size-5" : "h-8 w-8 border border-hairline",
            className,
          )}
        >
          <ProjectIconGlyph
            {...value}
            className={compact ? "size-3.5 text-[13px]" : "size-4 text-[15px]"}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        data-testid="project-icon-picker-popover"
        onClick={(e) => e.stopPropagation()}
        className="w-[248px] rounded-xl border-premium-hi bg-popover-solid p-2.5 text-ink shadow-popover"
      >
        <div className="mb-1.5 px-1 text-[11px] font-medium text-muted-ink">
          Emoji
        </div>
        <div className="grid grid-cols-6 gap-1">
          {EMOJI_PRESETS.map((preset) => {
            const active =
              value.iconKind === "emoji" && value.iconValue === preset.glyph;
            return (
              <button
                key={preset.id}
                type="button"
                aria-label={`Emoji ${preset.label}`}
                data-testid={`project-emoji-${preset.id}`}
                onClick={() => {
                  onChange({
                    ...value,
                    iconKind: "emoji",
                    iconValue: preset.glyph,
                  });
                  setOpen(false);
                }}
                className={cn(
                  "grid size-8 cursor-pointer place-items-center rounded-md text-[15px] transition-colors hover:bg-hover",
                  active && "bg-active ring-1 ring-premium-hi",
                )}
              >
                {preset.glyph}
              </button>
            );
          })}
        </div>

        <div className="my-2.5 h-px bg-hairline-soft" />

        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[11px] font-medium text-muted-ink">
            Icons &amp; Color
          </span>
          <div className="flex items-center gap-1.5">
            {PROJECT_COLOR_OPTIONS.map((c) => {
              const activeColor = value.iconColor === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-label={`Color ${c.label}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      iconKind: "icon",
                      iconColor: c.id,
                    })
                  }
                  className={cn(
                    "size-3.5 cursor-pointer rounded-full transition-transform hover:scale-110",
                    COLOR_DOT_MAP[c.id],
                    activeColor &&
                      "ring-2 ring-ink ring-offset-1 ring-offset-popover",
                  )}
                />
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1">
          {PROJECT_ICON_OPTIONS.map((opt) => {
            const active =
              value.iconKind === "icon" && value.iconValue === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                aria-label={`Icon ${opt.label}`}
                data-testid={`project-icon-${opt.id}`}
                onClick={() => {
                  onChange({
                    ...value,
                    iconKind: "icon",
                    iconValue: opt.id,
                  });
                  setOpen(false);
                }}
                className={cn(
                  "grid size-8 cursor-pointer place-items-center rounded-md transition-colors hover:bg-hover",
                  active && "bg-active ring-1 ring-premium-hi",
                )}
              >
                <VectorGlyph
                  iconValue={opt.id}
                  className={COLOR_CLASS_MAP[value.iconColor]}
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
