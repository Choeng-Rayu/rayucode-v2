import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        default: "border-hairline bg-control text-ink",
        brand: "border-brand/30 bg-brand-soft text-brand-text",
        secondary: "border-hairline-soft bg-active text-body",
        outline: "border-hairline bg-transparent text-muted-ink",
        danger: "border-danger/30 bg-danger-soft text-danger",
        warn: "border-warn/30 bg-warn-soft text-warn",
        info: "border-info/30 bg-info-soft text-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
