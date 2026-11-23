import { RayuProcessingMark } from "@/components/ui/rayu-processing-mark";
import { cn } from "@/lib/utils";

export { RayuProcessingMark, type RayuProcessingMarkProps } from "@/components/ui/rayu-processing-mark";

export type NavGlyphName =
  | "home"
  | "threads"
  | "swarm"
  | "clock"
  | "automations"
  | "plug"
  | "plugins"
  | "branch"
  | "changes"
  | "telegram"
  | "remote"
  | "settings"
  | "processes";

export interface NavGlyphProps {
  icon: NavGlyphName;
  className?: string;
}

export function NavGlyph({ icon, className }: NavGlyphProps) {
  const cls = cn("size-[17px] shrink-0", className);
  switch (icon) {
    case "home":
    case "threads":
      return (
        <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H14.5v-5.5h-5v5.5H5.5A1.5 1.5 0 0 1 4 19v-8.5Z"
            fill="currentColor"
          />
        </svg>
      );
    case "swarm":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="5.5" r="2.5" />
          <circle cx="5.5" cy="17.5" r="2.5" />
          <circle cx="18.5" cy="17.5" r="2.5" />
          <path d="M10.5 7.7 6.8 15.2M13.5 7.7l3.7 7.5M8 17.5h8" />
        </svg>
      );
    case "clock":
    case "automations":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      );
    case "plug":
    case "plugins":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M10.5 8.5v3M13.5 8.5v3M9 11.5h6v1.2a3 3 0 0 1-6 0v-1.2Z" />
          <path d="M12 15.7v2.3" />
        </svg>
      );
    case "branch":
    case "changes":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="8" r="2.5" />
          <path d="M6 8.5v7M18 10.5c0 4-4.5 4.5-9 4.5" />
        </svg>
      );
    case "telegram":
    case "remote":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m21 4-3.2 15.5-5.8-4.5-3 2.8v-4.6L21 4Z" />
          <path d="M9 13.2 18.2 6.8" />
        </svg>
      );
    case "processes":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m10 5 6 7-6 7-6-7 6-7Z" />
          <path d="m14.5 5 6 7-6 7" />
        </svg>
      );
    case "settings":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      );
  }
}

export interface UsageRingSvgProps {
  className?: string;
}

export function UsageRingSvg({ className }: UsageRingSvgProps) {
  return (
    <svg
      className={cn("size-5 shrink-0", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-slot="usage-ring-svg"
    >
      <path d="M7.18 6.25A7.5 7.5 0 0 1 16.82 6.25" strokeWidth="1.9" />
      <path d="M19.24 10.06A7.5 7.5 0 1 1 4.76 10.06" strokeWidth="1.9" />
      <rect
        x="9.6"
        y="9.6"
        width="4.8"
        height="4.8"
        rx="0.6"
        transform="rotate(45 12 12)"
        fill="currentColor"
        opacity="0.48"
        stroke="none"
      />
    </svg>
  );
}

export type RunStatusTone = "running" | "success" | "warn" | "danger" | "idle";

export interface RunStatusPulseProps {
  status: RunStatusTone;
  className?: string;
  label?: string;
}

export function RunStatusPulse({
  status,
  className,
  label,
}: RunStatusPulseProps) {
  const dotColor =
    status === "running" || status === "success"
      ? "bg-brand-bright"
      : status === "warn"
        ? "bg-warn"
        : status === "danger"
          ? "bg-danger"
          : "bg-faint";

  return (
    <span
      data-slot="run-status-pulse"
      data-status={status}
      aria-label={label}
      className={cn("relative inline-flex size-2 shrink-0 items-center justify-center", className)}
    >
      {status === "running" && (
        <span
          aria-hidden="true"
          className="absolute inline-flex size-full animate-ping rounded-full bg-brand-bright opacity-60"
        />
      )}
      <span
        aria-hidden="true"
        className={cn("relative inline-flex size-1.5 rounded-full", dotColor)}
      />
    </span>
  );
}

export type InspectorGlyphName = "list" | "terminal" | "diff" | "globe" | "folder";

export function InspectorTabIcon({
  icon,
  className,
}: {
  icon: InspectorGlyphName;
  className?: string;
}) {
  const cls = cn("size-[15px] shrink-0", className);
  switch (icon) {
    case "list":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="4.5" cy="6.5" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="17.5" r="1.15" fill="currentColor" stroke="none" />
          <path d="M8.5 6.5h11.5M8.5 12h11.5M8.5 17.5h11.5" />
        </svg>
      );
    case "terminal":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 6.5 6 5.5-6 5.5M12.5 17.5h7" />
        </svg>
      );
    case "diff":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="16" height="16" rx="3.5" />
          <path d="M12 7.5v5M9.5 10h5M9.5 15.8h5" />
        </svg>
      );
    case "globe":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5s1.3-6.2 3.8-8.5Z" />
        </svg>
      );
    case "folder":
      return (
        <svg
          className={cls}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 7.5a2 2 0 0 1 2-2h4.2l1.8 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9.5Z" />
        </svg>
      );
  }
}

export const RAYU_SYMBOLS = {
  RayuProcessingMark,
  NavGlyph,
  UsageRingSvg,
  RunStatusPulse,
  InspectorTabIcon,
};
