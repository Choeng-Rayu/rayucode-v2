import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "rayu-surface-bevel bg-raised text-ink hover:border-premium-hi hover:bg-active active:translate-y-[0.5px]",
        primary:
          "rayu-primary-bevel bg-brand font-semibold text-brand-ink hover:bg-brand-bright active:translate-y-[0.5px]",
        destructive:
          "border border-danger/30 bg-danger-soft text-danger shadow-bevel-surface hover:border-danger/50 hover:bg-danger/20",
        outline:
          "border border-hairline bg-pane text-body shadow-bevel-surface hover:border-premium hover:bg-hover hover:text-ink",
        secondary:
          "border border-control-border bg-control text-ink shadow-bevel-surface hover:border-premium hover:bg-active",
        ghost:
          "border border-transparent bg-transparent text-body hover:border-hairline hover:bg-hover hover:text-ink",
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5 py-1.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-sm px-2.5 text-xs",
        lg: "h-9 rounded-md px-5 text-sm",
        icon: "size-8 rounded-sm",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-sm",
        "icon-lg": "size-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
