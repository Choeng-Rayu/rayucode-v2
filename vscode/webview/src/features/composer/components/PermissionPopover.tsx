import * as React from "react";
import {
  Check,
  ChevronDown,
  Eye,
  Info,
  Lock,
  Shield,
  ShieldAlert,
} from "lucide-react";
import type { PermissionModeId } from "@shared/vscodeProtocol";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { callRpc, cn, isVsCodeWebview, useAppStore } from "@/lib";

import {
  FALLBACK_PERMISSION_MODES,
  getPermissionMode,
  nextPermissionModeId,
} from "../constants";
import type { PermissionModeOption } from "../types";

export interface PermissionPopoverProps {
  value: PermissionModeId;
  onChange: (mode: PermissionModeId) => void;
  sessionId?: string | null;
  modes?: readonly PermissionModeOption[];
  enableShortcut?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  className?: string;
}

function PermissionModeIcon({
  iconName,
  className,
}: {
  iconName: PermissionModeOption["iconName"];
  className?: string;
}) {
  switch (iconName) {
    case "lock":
      return <Lock className={className} aria-hidden="true" />;
    case "shield-outline":
      return <Shield className={className} aria-hidden="true" />;
    case "eye":
      return <Eye className={className} aria-hidden="true" />;
    case "shield-alert":
      return <ShieldAlert className={className} aria-hidden="true" />;
    case "swarm":
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
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
  }
}

export function PermissionPopover({
  value,
  onChange,
  sessionId: controlledSessionId,
  modes = FALLBACK_PERMISSION_MODES,
  enableShortcut = true,
  defaultOpen = false,
  disabled = false,
  className,
}: PermissionPopoverProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [triggerTipOpen, setTriggerTipOpen] = React.useState(false);

  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const capabilities = useAppStore((s) => s.capabilities);
  const effectiveSessionId =
    controlledSessionId !== undefined ? controlledSessionId : storeSessionId;

  const resolvedModes = modes.length > 0 ? modes : FALLBACK_PERMISSION_MODES;
  const activeMode = getPermissionMode(value, resolvedModes);

  const isLegacyReadOnlyBridge =
    capabilities.length > 0 &&
    !capabilities.includes("sessions") &&
    !capabilities.includes("permissions");

  const dispatchModeChange = React.useCallback(
    (nextId: PermissionModeId) => {
      onChange(nextId);
      const targetSessionId =
        effectiveSessionId ?? (!isVsCodeWebview() ? "ses_vscode_shell" : null);
      if (!targetSessionId) return;
      void callRpc("sessions.setPermissionMode", {
        sessionId: targetSessionId,
        mode: nextId,
      }).catch(() => {});
    },
    [effectiveSessionId, onChange],
  );

  React.useEffect(() => {
    if (!enableShortcut || disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Tab" &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        const nextId = nextPermissionModeId(value, resolvedModes);
        dispatchModeChange(nextId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, dispatchModeChange, enableShortcut, resolvedModes, value]);

  const handleSelect = (option: PermissionModeOption) => {
    dispatchModeChange(option.id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
        <Tooltip
          open={!open && triggerTipOpen}
          onOpenChange={setTriggerTipOpen}
        >
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                data-testid="permission-mode-trigger"
                data-permission-mode={activeMode.id}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={cn(
                  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2 py-[5px] text-xs font-medium whitespace-nowrap text-body transition-all outline-none select-none hover:border-premium hover:bg-active hover:text-ink hover:shadow-bevel-surface focus:outline-none focus-visible:outline-none data-[state=open]:border-premium data-[state=open]:bg-active data-[state=open]:text-ink data-[state=open]:shadow-bevel-surface disabled:pointer-events-none disabled:opacity-50 @min-[420px]/composer:px-2.5",
                  className,
                )}
              >
                <PermissionModeIcon
                  iconName={activeMode.iconName}
                  className={cn(
                    "size-3.5 shrink-0 text-body",
                    open && "text-ink",
                  )}
                />
                <span
                  data-testid="permission-mode-label"
                  className="whitespace-nowrap @max-[390px]/composer:hidden"
                >
                  {activeMode.label}
                </span>
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 text-muted-ink transition-transform duration-150 @max-[340px]/composer:hidden",
                    open && "rotate-180 text-body",
                  )}
                  aria-hidden="true"
                />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="inline-flex items-center gap-1.5">
              <span>{activeMode.label}</span>
              <kbd className="inline-flex items-center rounded-full border border-hairline bg-active px-1.5 py-0.5 text-[10.5px] font-medium text-body">
                Shift+Tab
              </kbd>
            </span>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={8}
          className="rayu-card-bevel w-[min(356px,calc(100vw-24px))] rounded-2xl border border-premium-hi bg-popover-solid px-0 pt-2 pb-2.5 shadow-rayu-2"
        >
          <div className="flex items-center justify-between px-[18px] pt-2 pb-2.5 text-[13px] font-medium tracking-[-0.01em] text-muted-ink">
            <span>Local Permissions</span>
            <kbd className="rounded border border-hairline bg-inset px-1.5 py-0.5 font-mono text-[10px] text-muted-ink">
              Shift+Tab
            </kbd>
          </div>

          {isLegacyReadOnlyBridge ? (
            <div
              data-testid="permission-legacy-notice"
              className="mx-3 mb-2 rounded-lg border border-hairline-soft bg-inset px-2.5 py-1.5 text-[11px] text-muted-ink"
            >
              Connected to legacy bridge without runtime permission switching.
            </div>
          ) : null}

          <div
            role="listbox"
            aria-label="Local Permissions"
            className="flex flex-col"
          >
            {resolvedModes.map((option) => {
              const isSelected = option.id === activeMode.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-perm-id={option.id}
                  onClick={() => handleSelect(option)}
                  className={cn(
                    "mx-2 my-px flex w-[calc(100%-16px)] cursor-pointer items-center gap-3.5 rounded-[11px] border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-hairline hover:bg-hover",
                    isSelected && "border-hairline bg-active/60",
                  )}
                >
                  <PermissionModeIcon
                    iconName={option.iconName}
                    className={cn(
                      "size-[18px] shrink-0 text-muted-ink",
                      isSelected && "text-ink",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm leading-tight font-medium text-ink">
                      <span>{option.label}</span>
                      {option.isDefault ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-active px-2 py-0.5 text-[11px] leading-tight font-medium text-body">
                          <span>Default</span>
                          <Info
                            className="size-3 text-muted-ink"
                            aria-hidden="true"
                          />
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-snug text-muted-ink">
                      {option.description}
                    </span>
                  </span>
                  <Check
                    className={cn(
                      "ml-1.5 size-4 shrink-0 text-ink transition-opacity duration-150",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
  );
}
