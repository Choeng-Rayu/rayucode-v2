import * as React from "react";

import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md border border-hairline-soft bg-active",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
