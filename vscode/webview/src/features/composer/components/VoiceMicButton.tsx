import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { callRpc, cn, useAppStore } from "@/lib";

import { voiceFeaturesQueryOptions } from "../hooks/useComposerData";

export interface VoiceMicButtonProps {
  supported?: boolean;
  enabled?: boolean;
  onToggleCapture?: (recording: boolean) => void;
  onTranscript?: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

export function VoiceMicButton({
  supported: controlledSupported,
  enabled: controlledEnabled,
  onToggleCapture,
  disabled = false,
  className,
}: VoiceMicButtonProps) {
  const queryClient = useQueryClient();
  const capabilities = useAppStore((s) => s.capabilities);
  const voiceQuery = useQuery(voiceFeaturesQueryOptions());

  const voiceStatus = voiceQuery.data?.voice;
  const isSupported =
    controlledSupported !== undefined
      ? controlledSupported
      : Boolean(
          voiceStatus?.supported ||
            capabilities.includes("voice") ||
            capabilities.includes("rayucode-voice") ||
            capabilities.length === 0,
        );

  const [isRecording, setIsRecording] = React.useState(
    Boolean(controlledEnabled ?? voiceStatus?.enabled),
  );

  React.useEffect(() => {
    if (controlledEnabled !== undefined) {
      setIsRecording(controlledEnabled);
    } else if (voiceStatus?.enabled !== undefined) {
      setIsRecording(voiceStatus.enabled);
    }
  }, [controlledEnabled, voiceStatus?.enabled]);

  const updateVoiceMutation = useMutation({
    mutationFn: (nextEnabled: boolean) =>
      callRpc("settings.voice.update", { enabled: nextEnabled }),
    onSuccess: (updated) => {
      setIsRecording(updated.enabled);
      void queryClient.invalidateQueries({
        queryKey: ["composer", "voice-features"],
      });
    },
  });

  const handleClick = () => {
    if (disabled || !isSupported) return;
    const next = !isRecording;
    setIsRecording(next);
    onToggleCapture?.(next);
    void updateVoiceMutation.mutateAsync(next).catch(() => {
      setIsRecording(!next);
    });
  };

  const hotkeyLabel = voiceStatus?.hotkeyHint ?? "Alt+V";
  const tooltipText = !isSupported
    ? "Voice dictation unavailable in current runtime"
    : isRecording
      ? `Stop voice capture (${hotkeyLabel})`
      : `Voice dictation (${hotkeyLabel})`;

  return (
    <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="voice-mic-btn"
            data-supported={isSupported ? "true" : "false"}
            data-recording={isRecording ? "true" : "false"}
            aria-label={tooltipText}
            aria-pressed={isRecording}
            disabled={disabled}
            onClick={handleClick}
            className={cn(
              "grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border transition-colors outline-none select-none focus:outline-none",
              !isSupported
                ? "cursor-not-allowed border-transparent text-faint opacity-60"
                : isRecording
                  ? "border-brand bg-brand-soft text-brand-text shadow-bevel-surface"
                  : "border-transparent text-muted-ink hover:border-hairline hover:bg-hover hover:text-ink",
              disabled && "pointer-events-none opacity-50",
              className,
            )}
          >
            {!isSupported ? (
              <MicOff className="size-3.5" aria-hidden="true" />
            ) : (
              <Mic
                className={cn("size-3.5", isRecording && "animate-pulse")}
                aria-hidden="true"
              />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipText}</TooltipContent>
      </Tooltip>
  );
}
