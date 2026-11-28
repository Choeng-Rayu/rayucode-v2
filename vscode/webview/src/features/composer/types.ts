import { z } from "zod";
import {
  CacheTtlSchema,
  EditorSelectionViewSchema,
  EffortLevelSchema,
  ImageAttachmentViewSchema,
  PermissionModeIdSchema,
  ServiceTierSchema,
  type CacheTtl,
  type EditorSelectionView,
  type EffortLevel,
  type ImageAttachmentView,
  type PermissionModeId,
  type ServiceTier,
} from "@shared/vscodeProtocol";

export type {
  CacheTtl,
  EditorSelectionView,
  EffortLevel,
  ImageAttachmentView,
  PermissionModeId,
  ServiceTier,
};

export type ComposerMode = "home" | "workspace" | "chat";

export const ModelOptionSchema = z.object({
  id: z.string().min(1),
  modelSpec: z.string().optional(),
  label: z.string().min(1),
  provider: z.string().min(1),
  apiMethod: z.string().optional(),
  subtitle: z.string().optional(),
  authMethod: z.enum(["oauth", "api_key", "env", "none"]).optional(),
  accountLabel: z.string().optional(),
  recommended: z.boolean().optional(),
  available: z.boolean().optional(),
  unavailableReason: z.string().optional(),
  supportedEfforts: z.array(z.string()).optional(),
  defaultEffort: z.string().nullable().optional(),
  contextWindow: z.number().int().positive().optional(),
});
export type ModelOption = z.infer<typeof ModelOptionSchema>;

export interface EffortStopConfig {
  index: number;
  level: EffortLevel;
  label: string;
  description: string;
  progress: number;
}

export type PermissionIconName =
  | "lock"
  | "shield-outline"
  | "eye"
  | "shield-alert"
  | "swarm";

export interface PermissionModeOption {
  id: PermissionModeId;
  label: string;
  description: string;
  isDefault?: boolean;
  iconName: PermissionIconName;
}

export type SlashCommandKind = "runtime" | "skill";

export interface SlashCommandItem {
  command: string;
  name?: string;
  insertText: string;
  description: string;
  kind: SlashCommandKind;
  category?: string;
  argHint?: string;
  requiresSession?: boolean;
  dispatch?:
    | { kind: "api_request"; req: string }
    | { kind: "runtime_command"; command: string }
    | { kind: "skill"; name: string };
}

export interface QuickActionItem {
  id: string;
  label: string;
  prompt: string;
  kind: "explain" | "test" | "diff" | "swarm";
}

export const ComposerSubmitPayloadSchema = z.object({
  prompt: z.string(),
  images: z.array(ImageAttachmentViewSchema).optional(),
  project: z.string(),
  workingDir: z.string().optional(),
  checkout: z.string(),
  modelId: z.string(),
  modelSpec: z.string().optional(),
  modelLabel: z.string(),
  apiMethod: z.string().optional(),
  effort: EffortLevelSchema.optional(),
  serviceTier: ServiceTierSchema.optional(),
  cacheTtl: CacheTtlSchema.optional(),
  permissionMode: PermissionModeIdSchema,
  editorSelection: EditorSelectionViewSchema.nullable().optional(),
  selectionIncluded: z.boolean().optional(),
});
export type ComposerSubmitPayload = z.infer<typeof ComposerSubmitPayloadSchema>;
