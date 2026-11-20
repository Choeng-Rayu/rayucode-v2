import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

function iconAttrs(size = 16, rest: SVGProps<SVGSVGElement>) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export function RayuMarkIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <path d="M5 19V5h8a4 4 0 0 1 0 8H5" />
      <path d="m12 13 6 6" />
    </svg>
  );
}

export function SendIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4Z" />
    </svg>
  );
}

export function StopIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SparklesIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <path d="M12 3 14.5 9.5 21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
    </svg>
  );
}

export function ToolIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-5.6 5.6a2 2 0 1 0 2.8 2.8l5.6-5.6a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.8-2.8Z" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function AlertIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <path d="M12 3 2.5 19.5h19Z" />
      <path d="M12 9v4" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

export function ShieldIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <path d="M12 3 4 6.5v5c0 5 3.4 8.7 8 9.5 4.6-.8 8-4.5 8-9.5v-5Z" />
    </svg>
  );
}

export function DiffIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <path d="M12 5v6" />
      <path d="M9 8h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function SettingsIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function PlusIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function BotIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4" />
      <circle cx="9.5" cy="14" r="1" fill="currentColor" />
      <circle cx="14.5" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

export function CoinsIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...iconAttrs(size, rest)}>
      <circle cx="9.5" cy="12" r="6" />
      <path d="M15.5 7.5a6 6 0 0 1 0 9" />
    </svg>
  );
}
