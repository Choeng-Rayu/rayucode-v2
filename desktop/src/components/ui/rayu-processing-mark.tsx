import { cn } from "@/lib/utils"

export interface RayuProcessingMarkProps {
  animated?: boolean
  className?: string
}

const ORBIT_DOTS: ReadonlyArray<{ cx: number; cy: number; delayMs: number }> = [
  { cx: 12.0, cy: 4.2, delayMs: -840 },
  { cx: 17.52, cy: 6.48, delayMs: -720 },
  { cx: 19.8, cy: 12.0, delayMs: -600 },
  { cx: 17.52, cy: 17.52, delayMs: -480 },
  { cx: 12.0, cy: 19.8, delayMs: -360 },
  { cx: 6.48, cy: 17.52, delayMs: -240 },
  { cx: 4.2, cy: 12.0, delayMs: -120 },
  { cx: 6.48, cy: 6.48, delayMs: 0 },
]

export function RayuProcessingMark({
  animated = true,
  className,
}: RayuProcessingMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-slot="rayu-processing-mark"
      data-animated={animated ? "true" : "false"}
      className={cn("size-4 shrink-0 text-brand", className)}
    >
      {ORBIT_DOTS.map((dot, idx) => (
        <circle
          key={idx}
          cx={dot.cx}
          cy={dot.cy}
          r={2.05}
          fill="currentColor"
          className={animated ? "rayu-dot-orbit" : undefined}
          style={
            animated
              ? {
                  animationDelay: `${dot.delayMs}ms`,
                  transformBox: "fill-box",
                  transformOrigin: "center",
                }
              : undefined
          }
        />
      ))}
    </svg>
  )
}
