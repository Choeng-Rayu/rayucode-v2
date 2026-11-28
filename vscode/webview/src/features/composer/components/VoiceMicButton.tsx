import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { callRpc, cn, useAppStore } from "@/lib";
import { operationAvailable, requireOperation } from "@/lib/operation-result";

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
  const hostAllowsVoice = operationAvailable("settings.voice.update");
  // Voice is only offered when the engine/host explicitly reports support; an
  // unknown capability list is NOT treated as supported.
  const isSupported =
    controlledSupported !== undefined
      ? controlledSupported && hostAllowsVoice
      : Boolean(
          hostAllowsVoice &&
            (voiceStatus?.supported ||
              capabilities.includes("voice") ||
              capabilities.includes("rayucode-voice")),
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
      requireOperation(
        callRpc("settings.voice.update", { enabled: nextEnabled }).then(
          (voice) => ({
            ...voice,
            // The voice RPC returns the status view, not `{ ok }`; a missing
            // `enabled` flag means the host did not acknowledge the change.
            ok: typeof voice?.enabled === "boolean",
            message: "The host did not acknowledge the voice dictation change.",
          }),
        ),
      ),
    onSuccess: (updated) => {
      setIsRecording(updated.enabled);
      void queryClient.invalidateQueries({
        queryKey: ["composer", "voice-features"],
      });
    },
  });

  const handleClick = () => {
    if (disabled) return;
    if (!isSupported) {
      toast.error(
        "Voice dictation is unavailable in this VS Code host or engine.",
      );
      return;
    }
    const next = !isRecording;
    setIsRecording(next);
    void updateVoiceMutation
      .mutateAsync(next)
      .then(() => onToggleCapture?.(next))
      .catch(() => {
        // requireOperation already raised the visible toast.error.
        setIsRecording(!next);
      });
  };

  const hotkeyLabel = voiceStatus?.hotkeyHint ?? "Alt+V";
  const tooltipText = !isSupported
    ? "Voice dictation is unavailable in this VS Code host or engine"
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
            aria-disabled={!isSupported || disabled}
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
