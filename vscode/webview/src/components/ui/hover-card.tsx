import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

interface HoverCardContextValue {
  scheduleOpen: () => void;
  scheduleClose: () => void;
}

const HoverCardContext = React.createContext<HoverCardContextValue | null>(null);

export interface HoverCardProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  openDelay?: number;
  closeDelay?: number;
  children?: React.ReactNode;
}

function HoverCard({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  openDelay = 220,
  closeDelay = 120,
  children,
}: HoverCardProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOpen = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const clearTimers = React.useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  const ctx = React.useMemo<HoverCardContextValue>(
    () => ({
      scheduleOpen: () => {
        clearTimers();
        openTimer.current = setTimeout(() => setOpen(true), openDelay);
      },
      scheduleClose: () => {
        clearTimers();
        closeTimer.current = setTimeout(() => setOpen(false), closeDelay);
      },
    }),
    [clearTimers, closeDelay, openDelay, setOpen],
  );

  return (
    <HoverCardContext.Provider value={ctx}>
      <PopoverPrimitive.Root open={isOpen} onOpenChange={setOpen}>
        {children}
      </PopoverPrimitive.Root>
    </HoverCardContext.Provider>
  );
}

function HoverCardTrigger({
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const ctx = React.useContext(HoverCardContext);
  return (
    <PopoverPrimitive.Trigger
      data-slot="hover-card-trigger"
      onMouseEnter={(e) => {
        ctx?.scheduleOpen();
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        ctx?.scheduleClose();
        onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        ctx?.scheduleOpen();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        ctx?.scheduleClose();
        onBlur?.(e);
      }}
      {...props}
    />
  );
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 6,
  onMouseEnter,
  onMouseLeave,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const ctx = React.useContext(HoverCardContext);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={(e) => {
          ctx?.scheduleOpen();
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          ctx?.scheduleClose();
          onMouseLeave?.(e);
        }}
        className={cn(
          "rayu-animate-pop z-50 w-64 rounded-lg border border-premium-hi bg-popover-solid p-3 text-xs text-ink shadow-popover outline-hidden",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
