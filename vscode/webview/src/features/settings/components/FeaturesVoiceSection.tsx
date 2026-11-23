import type {
  FeatureFlagsView,
  UpdateChannel,
  VoiceStatusView,
} from "@shared/vscodeProtocol";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface FeaturesVoiceSectionProps {
  features: FeatureFlagsView;
  voice: VoiceStatusView;
  onSetFeatureFlag: (
    key: keyof FeatureFlagsView,
    value: boolean | string,
  ) => Promise<unknown>;
  onUpdateVoice: (patch: {
    enabled?: boolean;
    deviceId?: string;
    noiseSuppression?: boolean;
    autoSendOnSilence?: boolean;
  }) => Promise<unknown>;
}

const TEN_BOOLEAN_FEATURE_FLAGS: ReadonlyArray<{
  key: Exclude<
    keyof FeatureFlagsView,
    "update_channel" | "codemode" | "integration_tools"
  >;
  label: string;
  description: string;
}> = [
  {
    key: "memory",
    label: "Semantic & Jev Memory Graph (features.memory)",
    description:
      "Persist and recall architectural facts and user preferences across sessions",
  },
  {
    key: "swarm",
    label: "Swarm Multi-Agent Orchestration (features.swarm)",
    description:
      "Enable parallel coordinator/worker swarm mission control and shared board",
  },
  {
    key: "mermaid",
    label: "Inline Mermaid Diagram Rendering (features.mermaid)",
    description:
      "Render architecture flowcharts and sequence diagrams inline in transcripts",
  },
  {
    key: "auto_poke",
    label: "Autonomous Follow-Up Poke (features.auto_poke)",
    description:
      "Automatically nudge stalled background tasks or incomplete multi-step turns",
  },
  {
    key: "todo_gate_digest",
    label: "Todo Gate Digest Summary (features.todo_gate_digest)",
    description:
      "Emit structured todo completion digests at turn checkpoints",
  },
  {
    key: "todo_gate_diagnostics",
    label: "Todo Gate Diagnostics Verification (features.todo_gate_diagnostics)",
    description:
      "Verify workspace diagnostics before marking todo items complete",
  },
  {
    key: "message_timestamps",
    label: "Transcript Message Timestamps (features.message_timestamps)",
    description: "Display relative and wall-clock timestamps on chat turns",
  },
  {
    key: "persist_memory_injections",
    label: "Persist Memory Injections (features.persist_memory_injections)",
    description:
      "Retain injected memory blocks across context compactions for warm KV cache",
  },
  {
    key: "kv_cache_miss_notices",
    label: "KV-Cache Miss Telemetry Notices (features.kv_cache_miss_notices)",
    description:
      "Surface quiet inspector notices when a turn experiences a prompt cache miss",
  },
  {
    key: "check_updates",
    label: "Automatic Binary Update Checks (features.check_updates)",
    description:
      "Periodically check for new RayuCode daemon releases on the selected channel",
  },
];

export function FeaturesVoiceSection({
  features,
  voice,
  onSetFeatureFlag,
  onUpdateVoice,
}: FeaturesVoiceSectionProps) {
  return (
    <section
      data-testid="settings-section-features"
      aria-labelledby="settings-h-features"
      className="flex flex-col gap-6"
    >
      <div>
        <h1
          id="settings-h-features"
          className="m-0 text-xl font-semibold tracking-[-0.02em] text-ink"
        >
          Features &amp; Voice
        </h1>
        <p className="mt-1 text-xs text-muted-ink">
          Toggle all 11 Rust runtime [features] flags, Codemode QuickJS sandbox,
          workspace integration tools, and streaming voice dictation.
        </p>
      </div>

      {/* All 11 Rust Runtime [features] Settings */}
      <div>
        <h2 className="mb-3 text-xs font-semibold text-ink">
          Rust Runtime [features] Configuration (11 settings)
        </h2>
        <div
          data-testid="runtime-features-list"
          className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane"
        >
          {TEN_BOOLEAN_FEATURE_FLAGS.map((item) => (
            <div
              key={item.key}
              data-testid={`feature-row-${item.key}`}
              className="flex items-center justify-between gap-4 px-4 py-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">{item.label}</div>
                <div className="mt-0.5 text-muted-ink">{item.description}</div>
              </div>
              <Switch
                checked={Boolean(features[item.key])}
                onCheckedChange={(checked) =>
                  void onSetFeatureFlag(item.key, checked)
                }
                aria-label={item.label}
                data-testid={`feature-switch-${item.key}`}
              />
            </div>
          ))}

          {/* 11th [features] setting: update_channel */}
          <div
            data-testid="feature-row-update_channel"
            className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-xs"
          >
            <div>
              <div className="font-medium text-ink">
                Update Channel (features.update_channel)
              </div>
              <div className="mt-0.5 text-muted-ink">
                Release channel for managed RayuCode CLI and shared daemon
                binaries
              </div>
            </div>
            <Select
              value={features.update_channel}
              onValueChange={(v) =>
                void onSetFeatureFlag("update_channel", v as UpdateChannel)
              }
            >
              <SelectTrigger
                aria-label="Update channel"
                data-testid="feature-select-update_channel"
                className="w-[150px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="stable">stable</SelectItem>
                <SelectItem value="preview">preview</SelectItem>
                <SelectItem value="main">main</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Opt-In Engine Tool Gates: codemode + integration_tools */}
      <div>
        <h2 className="mb-3 text-xs font-semibold text-ink">
          Opt-In Engine Tool Gates
        </h2>
        <div className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane">
          <div
            data-testid="feature-row-codemode"
            className="flex items-center justify-between gap-4 px-4 py-3 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink">
                Codemode QuickJS Sandbox ([tools] codemode)
              </div>
              <div className="mt-0.5 text-muted-ink">
                Allow agents to compose multi-tool scripts inside an isolated
                QuickJS runtime
              </div>
            </div>
            <Switch
              checked={features.codemode}
              onCheckedChange={(checked) =>
                void onSetFeatureFlag("codemode", checked)
              }
              aria-label="Codemode QuickJS Sandbox"
              data-testid="feature-switch-codemode"
            />
          </div>

          <div
            data-testid="feature-row-integration_tools"
            className="flex items-center justify-between gap-4 px-4 py-3 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink">
                Integration Tools Catalog ([sponsors] enabled)
              </div>
              <div className="mt-0.5 text-muted-ink">
                Expose endorsed workspace integration tools and connector
                templates
              </div>
            </div>
            <Switch
              checked={features.integration_tools}
              onCheckedChange={(checked) =>
                void onSetFeatureFlag("integration_tools", checked)
              }
              aria-label="Integration Tools Catalog"
              data-testid="feature-switch-integration_tools"
            />
          </div>
        </div>
      </div>

      {/* Streaming Voice Dictation & Audio */}
      <div>
        <h2 className="mb-3 text-xs font-semibold text-ink">
          Streaming Voice Dictation (rayucode-voice)
        </h2>
        <div className="rayu-card-bevel divide-y divide-hairline overflow-hidden rounded-xl border border-premium bg-pane">
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
            <div>
              <div className="font-medium text-ink">
                Enable voice dictation ({voice.hotkeyHint ?? "Alt+V"})
              </div>
              <div className="mt-0.5 text-muted-ink">
                {voice.supported
                  ? "Native audio capture pipeline ready"
                  : "Audio capture unavailable in current host environment"}
              </div>
            </div>
            <Switch
              checked={voice.enabled}
              onCheckedChange={(checked) =>
                void onUpdateVoice({ enabled: checked })
              }
              aria-label="Enable voice dictation"
              data-testid="voice-enabled-switch"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-xs">
            <div>
              <div className="font-medium text-ink">Input microphone</div>
              <div className="mt-0.5 text-muted-ink">
                Audio input device for push-to-talk composer dictation
              </div>
            </div>
            <Select
              value={voice.deviceId ?? voice.devices[0]?.id ?? "default"}
              onValueChange={(deviceId) => void onUpdateVoice({ deviceId })}
            >
              <SelectTrigger
                aria-label="Input microphone"
                data-testid="voice-device-select"
                className="w-full sm:w-[230px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {voice.devices.map((dev) => (
                  <SelectItem key={dev.id} value={dev.id}>
                    {dev.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
            <div>
              <div className="font-medium text-ink">Noise suppression</div>
              <div className="mt-0.5 text-muted-ink">
                Filter keyboard clicks and ambient fan noise during dictation
              </div>
            </div>
            <Switch
              checked={voice.noiseSuppression}
              onCheckedChange={(checked) =>
                void onUpdateVoice({ noiseSuppression: checked })
              }
              aria-label="Noise suppression"
              data-testid="voice-noise-suppression-switch"
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
            <div>
              <div className="font-medium text-ink">Auto-send on silence</div>
              <div className="mt-0.5 text-muted-ink">
                Automatically submit dictated prompt after 1.5 seconds of
                silence
              </div>
            </div>
            <Switch
              checked={voice.autoSendOnSilence}
              onCheckedChange={(checked) =>
                void onUpdateVoice({ autoSendOnSilence: checked })
              }
              aria-label="Auto-send on silence"
              data-testid="voice-autosend-switch"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
