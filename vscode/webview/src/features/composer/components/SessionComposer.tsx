import * as React from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUp,
  AtSign,
  Check,
  Clock,
  CornerDownLeft,
  Image as ImageIcon,
  Lightbulb,
  ListPlus,
  Loader2,
  Plug,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type {
  CacheTtl,
  EditorSelectionView,
  EffortLevel,
  ImageAttachmentView,
  PermissionModeId,
  ServiceTier,
  SessionSummaryView,
} from "@shared/vscodeProtocol";
import {
  formatEffortLabel as formatSessionCoreEffortLabel,
  parseSlashInvocation,
} from "@rayu-dev/rayucode-session-core/client";

import {
  Badge,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { callRpc, cn, useAppStore, type MidTurnSendMode } from "@/lib";

import {
  DEFAULT_CHECKOUT,
  DEFAULT_PERMISSION_MODE_ID,
  DEFAULT_PROJECT,
  formatHarnessModelSpec,
  mergeComposerInjection,
  normalizeEffortLevel,
} from "../constants";
import {
  useComposerModelCatalog,
  useSlashCommandsCatalog,
  useWorkspaceFilesSearch,
  workspaceFoldersQueryOptions,
} from "../hooks/useComposerData";
import type {
  ComposerMode,
  ComposerSubmitPayload,
  ModelOption,
  SlashCommandItem,
} from "../types";
import { ActiveSelectionPill } from "./ActiveSelectionPill";
import { MentionMenu } from "./MentionMenu";
import { ModelEffortPopover } from "./ModelEffortPopover";
import { PermissionPopover } from "./PermissionPopover";
import { SlashCommandMenu } from "./SlashCommandMenu";

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHED_IMAGES = 10;

function inferImageMediaType(
  file: File,
): ImageAttachmentView["mediaType"] | null {
  const rawType = file.type.toLowerCase().trim();
  if (rawType === "image/jpg") return "image/jpeg";
  if (SUPPORTED_IMAGE_MEDIA_TYPES.has(rawType)) {
    return rawType as ImageAttachmentView["mediaType"];
  }
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".gif")) return "image/gif";
  return null;
}

function readImageFile(file: File): Promise<ImageAttachmentView | null> {
  const mediaType = inferImageMediaType(file);
  if (!mediaType || file.size > MAX_IMAGE_FILE_BYTES) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image/")) {
        resolve(null);
        return;
      }
      resolve({
        name: file.name || `image-${Date.now()}.png`,
        mediaType,
        data: dataUrl,
        sizeBytes: file.size,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export interface ActiveSlashTrigger {
  slashIndex: number;
  endIndex: number;
  query: string;
}

function clampCursor(value: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, value.length));
}

function resolveTextareaCursor(
  target: HTMLTextAreaElement,
  valueLength: number,
): number {
  const sel = target.selectionStart;
  if (
    typeof sel === "number" &&
    (document.activeElement === target || sel > 0 || valueLength === 0)
  ) {
    return sel;
  }
  return valueLength;
}

export function getActiveSlashTrigger(
  value: string,
  cursor: number = value.length,
): ActiveSlashTrigger | null {
  const safeCursor = clampCursor(value, cursor);
  const beforeCursor = value.slice(0, safeCursor);
  const match = /(?:^|\s)(\/([^\s/]*))$/.exec(beforeCursor);
  if (!match) return null;
  return {
    slashIndex: safeCursor - match[1]!.length,
    endIndex: safeCursor,
    query: match[2] ?? "",
  };
}

export function applySlashSelection(
  value: string,
  trigger: ActiveSlashTrigger,
  insertText: string,
): { nextValue: string; nextCursor: number } {
  const token = insertText.trim();
  const before = value.slice(0, trigger.slashIndex);
  const after = value.slice(trigger.endIndex);
  const needsTrailingSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = needsTrailingSpace ? `${token} ` : token;
  return {
    nextValue: `${before}${inserted}${after}`,
    nextCursor: before.length + inserted.length,
  };
}

function stripSlashRange(
  value: string,
  start: number,
  end: number,
): { nextValue: string; nextCursor: number } {
  const before = value.slice(0, start);
  let after = value.slice(end);
  if (before.length > 0 && /\s$/.test(before) && /^\s/.test(after)) {
    after = after.replace(/^\s+/, "");
  }
  return {
    nextValue: `${before}${after}`,
    nextCursor: before.length,
  };
}

export interface SessionComposerProps {
  ref?: React.Ref<HTMLTextAreaElement>;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  mode?: ComposerMode;
  sessionId?: string | null;
  project?: string;
  checkout?: string;
  onProjectChange?: (project: string, workingDir?: string) => void;
  onCheckoutChange?: (checkout: string) => void;
  modelId?: string;
  modelLabel?: string;
  effort?: EffortLevel | string;
  serviceTier?: ServiceTier;
  cacheTtl?: CacheTtl;
  permissionMode?: PermissionModeId;
  onModelChange?: (model: ModelOption) => void;
  onEffortChange?: (effort: EffortLevel) => void;
  onServiceTierChange?: (tier: ServiceTier) => void;
  onCacheTtlChange?: (ttl: CacheTtl) => void;
  onPermissionModeChange?: (mode: PermissionModeId) => void;
  editorSelection?: EditorSelectionView | null;
  onSubmit?: (payload: ComposerSubmitPayload) => void | Promise<void>;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
  isSubmitting?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  enablePermissionShortcut?: boolean;
  className?: string;
}

export function SessionComposer({
  ref,
  inputRef,
  mode = "home",
  sessionId: controlledSessionId,
  project: controlledProject,
  checkout: controlledCheckout,
  onProjectChange,
  onCheckoutChange,
  modelId: controlledModelId,
  modelLabel: controlledModelLabel,
  effort: controlledEffort,
  serviceTier: controlledServiceTier,
  cacheTtl: controlledCacheTtl,
  permissionMode: controlledPermissionMode,
  onModelChange,
  onEffortChange,
  onServiceTierChange,
  onCacheTtlChange,
  onPermissionModeChange,
  editorSelection: controlledEditorSelection,
  onSubmit,
  onStop,
  placeholder,
  disabled = false,
  isSubmitting: controlledIsSubmitting,
  value: controlledValue,
  onValueChange,
  enablePermissionShortcut = true,
  className,
}: SessionComposerProps) {
  const queryClient = useQueryClient();

  const storeSessionId = useAppStore((s) => s.activeSessionId);
  const storeProjectPath = useAppStore((s) => s.activeProjectPath);
  const activeDraft = useAppStore((s) => s.activeDraft);
  const updateActiveDraft = useAppStore((s) => s.updateActiveDraft);
  const setActiveProjectPath = useAppStore((s) => s.setActiveProjectPath);
  const storeWorkspaces = useAppStore((s) => s.workspaces);
  const storeEditorSelection = useAppStore((s) => s.editorSelection);
  const setEditorSelection = useAppStore((s) => s.setEditorSelection);
  const storeIsStreamActive = useAppStore((s) => s.isStreamActive);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setBackgroundDrawerOpen = useAppStore((s) => s.setBackgroundDrawerOpen);
  const composerFocusNonce = useAppStore((s) => s.composerFocusNonce);
  const midTurnSendMode = useAppStore((s) => s.midTurnSendMode);
  const setMidTurnSendMode = useAppStore((s) => s.setMidTurnSendMode);
  const addMidTurnMessage = useAppStore((s) => s.addMidTurnMessage);
  const setQueuePausedForSession = useAppStore(
    (s) => s.setQueuePausedForSession,
  );
  const pendingComposerInjection = useAppStore(
    (s) => s.pendingComposerInjection,
  );
  const consumeComposerInjection = useAppStore(
    (s) => s.consumeComposerInjection,
  );

  const effectiveSessionId =
    controlledSessionId !== undefined ? controlledSessionId : storeSessionId;
  const draftKey = effectiveSessionId ?? "__home__";
  const storedDraft = useAppStore((s) => s.composerDrafts[draftKey] ?? "");
  const setComposerDraft = useAppStore((s) => s.setComposerDraft);
  const sessionOverrideKey = effectiveSessionId ?? "__draft__";
  const sessionPrefs = useAppStore(
    (s) => s.sessionPrefsBySession[sessionOverrideKey],
  );
  const setSessionPrefs = useAppStore((s) => s.setSessionPrefs);
  const clearSessionPrefField = useAppStore((s) => s.clearSessionPrefField);
  const seedSessionPrefsFromSummary = useAppStore(
    (s) => s.seedSessionPrefsFromSummary,
  );
  const isSubmitting =
    controlledIsSubmitting !== undefined
      ? controlledIsSubmitting
      : storeIsStreamActive;

  const catalog = useComposerModelCatalog(effectiveSessionId);
  const foldersQuery = useQuery(workspaceFoldersQueryOptions());

  const workspaces = React.useMemo(() => {
    if (storeWorkspaces.length > 0) return storeWorkspaces;
    return foldersQuery.data?.folders ?? [];
  }, [foldersQuery.data?.folders, storeWorkspaces]);

  const activeWorkspace = React.useMemo(() => {
    const targetPath =
      (!effectiveSessionId ? activeDraft?.workingDir : null) ?? storeProjectPath;
    if (targetPath) {
      const found = workspaces.find((w) => w.path === targetPath);
      if (found) return found;
    }
    return workspaces[0] ?? null;
  }, [activeDraft?.workingDir, effectiveSessionId, storeProjectPath, workspaces]);

  const [images, setImages] = React.useState<ImageAttachmentView[]>([]);
  const [selectionIncluded, setSelectionIncluded] = React.useState(true);
  const [plusMenuOpen, setPlusMenuOpen] = React.useState(false);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [slashIndex, setSlashIndex] = React.useState(0);
  const [cursorPos, setCursorPos] = React.useState<number | null>(null);
  const [pendingCaret, setPendingCaret] = React.useState<{
    pos: number;
    seq: number;
  } | null>(null);
  const [popupDismissedForText, setPopupDismissedForText] = React.useState<
    string | null
  >(null);
  const [deferredNotice, setDeferredNotice] = React.useState<string | null>(
    null,
  );
  const [commandBanner, setCommandBanner] = React.useState<{
    tone: "pending" | "success" | "busy" | "error";
    message: string;
  } | null>(null);

  React.useEffect(() => {
    if (!isSubmitting) {
      setDeferredNotice(null);
    }
  }, [isSubmitting]);

  React.useEffect(() => {
    if (commandBanner?.tone !== "success") return;
    const timer = window.setTimeout(() => {
      setCommandBanner(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [commandBanner]);

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const lastFocusNonceRef = React.useRef(composerFocusNonce);
  const pendingCursorToEndRef = React.useRef(false);
  const lastConsumedInjectionIdRef = React.useRef<string | null>(null);

  // Hydrate remembered per-session prefs from cached sessions list when switching sessions
  React.useEffect(() => {
    if (!effectiveSessionId) return;
    const listData = queryClient.getQueryData<{
      sessions?: SessionSummaryView[];
    }>(["sessions", "list", { includeArchived: false }]);
    const summary = listData?.sessions?.find(
      (s) => s.sessionId === effectiveSessionId,
    );
    if (summary) {
      seedSessionPrefsFromSummary(summary);
    }
  }, [effectiveSessionId, queryClient, seedSessionPrefsFromSummary]);

  // If a saved model for this session became unavailable (e.g. signed out of its provider),
  // fall back cleanly to the live catalog default without wiping valid selections.
  React.useEffect(() => {
    if (catalog.models.length === 0) return;
    const savedModelId = sessionPrefs?.modelId;
    if (!savedModelId) return;
    const matches = catalog.models.filter(
      (m) => m.modelSpec === savedModelId || m.id === savedModelId,
    );
    const currentMatch =
      matches.find((m) => m.available !== false) ?? matches[0];
    const hasAvailableModel = catalog.models.some(
      (m) => m.available !== false,
    );
    if (
      currentMatch &&
      currentMatch.available === false &&
      hasAvailableModel
    ) {
      clearSessionPrefField(sessionOverrideKey, "modelId");
      clearSessionPrefField(sessionOverrideKey, "modelLabel");
      clearSessionPrefField(sessionOverrideKey, "apiMethod");
    }
  }, [
    catalog.models,
    clearSessionPrefField,
    sessionOverrideKey,
    sessionPrefs?.modelId,
  ]);

  React.useEffect(() => {
    if (composerFocusNonce > lastFocusNonceRef.current) {
      lastFocusNonceRef.current = composerFocusNonce;
      textareaRef.current?.focus();
    }
  }, [composerFocusNonce]);

  const setTextareaNode = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      for (const targetRef of [ref, inputRef]) {
        if (!targetRef) continue;
        if (typeof targetRef === "function") {
          targetRef(node);
        } else {
          (
            targetRef as React.MutableRefObject<HTMLTextAreaElement | null>
          ).current = node;
        }
      }
    },
    [inputRef, ref],
  );

  const textValue =
    controlledValue !== undefined ? controlledValue : storedDraft;
  const activeProject =
    controlledProject !== undefined
      ? controlledProject
      : (activeWorkspace?.name ?? DEFAULT_PROJECT);
  const activeCheckout =
    controlledCheckout !== undefined
      ? controlledCheckout
      : (activeWorkspace?.branch ?? DEFAULT_CHECKOUT);
  const activeModelId =
    controlledModelId !== undefined
      ? controlledModelId
      : (sessionPrefs?.modelId ?? catalog.defaultModelId);
  const matchedActiveModel = React.useMemo(() => {
    if (!activeModelId) return undefined;
    return (
      catalog.models.find(
        (m) =>
          (m.modelSpec === activeModelId || m.id === activeModelId) &&
          m.available !== false,
      ) ??
      catalog.models.find(
        (m) => m.modelSpec === activeModelId || m.id === activeModelId,
      )
    );
  }, [activeModelId, catalog.models]);
  const activeModelLabel =
    controlledModelLabel !== undefined
      ? controlledModelLabel
      : (matchedActiveModel?.label ??
        sessionPrefs?.modelLabel ??
        catalog.defaultModelLabel);
  const activeEffort = normalizeEffortLevel(
    controlledEffort !== undefined
      ? controlledEffort
      : (sessionPrefs?.effort ?? catalog.defaultEffort),
  );
  const activeServiceTier =
    controlledServiceTier !== undefined
      ? controlledServiceTier
      : (sessionPrefs?.serviceTier ?? catalog.serviceTier);
  const activeCacheTtl =
    controlledCacheTtl !== undefined
      ? controlledCacheTtl
      : (sessionPrefs?.cacheTtl ?? catalog.cacheTtl);
  const storeDefaultPermissionMode = useAppStore(
    (s) => s.defaultPermissionMode,
  );
  const activePermissionMode =
    controlledPermissionMode !== undefined
      ? controlledPermissionMode
      : (sessionPrefs?.permissionMode ??
        storeDefaultPermissionMode ??
        DEFAULT_PERMISSION_MODE_ID);
  const activeSelection =
    controlledEditorSelection !== undefined
      ? controlledEditorSelection
      : storeEditorSelection;

  // Auto-grow textarea height smoothly up to 180px & place cursor at end after injection
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(180, Math.max(44, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
    if (pendingCursorToEndRef.current) {
      pendingCursorToEndRef.current = false;
      const end = el.value.length;
      try {
        el.setSelectionRange(end, end);
      } catch {
        // Ignore if selection API is unavailable
      }
    }
  }, [textValue]);

  React.useLayoutEffect(() => {
    if (!pendingCaret) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const pos = clampCursor(el.value, pendingCaret.pos);
    if (typeof el.setSelectionRange === "function") {
      el.setSelectionRange(pos, pos);
    }
    setCursorPos(pos);
  }, [pendingCaret]);

  const setTextValue = React.useCallback(
    (next: string) => {
      setPopupDismissedForText(null);
      setCommandBanner((prev) => (prev?.tone === "success" ? null : prev));
      if (onValueChange) {
        onValueChange(next);
      } else {
        setComposerDraft(draftKey, next);
      }
    },
    [draftKey, onValueChange, setComposerDraft],
  );

  const effectiveCursor =
    cursorPos === null ? textValue.length : clampCursor(textValue, cursorPos);

  // Detect `@query` file mention trigger
  const mentionTrigger = React.useMemo(() => {
    if (popupDismissedForText === textValue) return null;
    const beforeCursor = textValue.slice(0, effectiveCursor);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
    if (!match) return null;
    return {
      query: match[1] ?? "",
      tokenStart: beforeCursor.lastIndexOf("@"),
      tokenEnd: effectiveCursor,
    };
  }, [effectiveCursor, popupDismissedForText, textValue]);

  // Detect `/query` slash command or skill trigger at start or mid-sentence before caret
  const slashTrigger = React.useMemo(() => {
    if (popupDismissedForText === textValue || mentionTrigger) return null;
    return getActiveSlashTrigger(textValue, effectiveCursor);
  }, [effectiveCursor, mentionTrigger, popupDismissedForText, textValue]);

  const filesSearchQuery = useWorkspaceFilesSearch(
    mentionTrigger?.query ?? "",
    Boolean(mentionTrigger),
    effectiveSessionId,
  );
  const slashCatalog = useSlashCommandsCatalog(
    slashTrigger?.query ?? "",
    Boolean(slashTrigger),
    effectiveSessionId,
  );

  const mentionFiles = React.useMemo(() => {
    const raw = filesSearchQuery.data?.files ?? [
      "vscode/webview/src/styles/globals.css",
      "vscode/webview/src/lib/rpc-client.ts",
      "vscode/webview/src/lib/app-store.ts",
      "vscode/webview/src/features/shell/components/AppShell.tsx",
      "crates/rayu-harness/src/lib.rs",
    ];
    const q = (mentionTrigger?.query ?? "").trim().toLowerCase();
    if (!q) return raw.slice(0, 12);
    return raw.filter((f) => f.toLowerCase().includes(q)).slice(0, 12);
  }, [filesSearchQuery.data?.files, mentionTrigger?.query]);

  React.useEffect(() => {
    setMentionIndex(0);
  }, [mentionTrigger?.query]);

  React.useEffect(() => {
    setSlashIndex(0);
  }, [slashTrigger?.query]);

  const handleSelectMentionFile = React.useCallback(
    (filePath: string) => {
      if (!mentionTrigger) return;
      const prefix = textValue.slice(0, mentionTrigger.tokenStart);
      const suffix = textValue.slice(mentionTrigger.tokenEnd);
      const inserted = `@${filePath} `;
      const next = `${prefix}${inserted}${suffix}`;
      const nextCaret = prefix.length + inserted.length;
      setTextValue(next);
      setPendingCaret((prev) => ({ pos: nextCaret, seq: (prev?.seq ?? 0) + 1 }));
    },
    [mentionTrigger, setTextValue, textValue],
  );

  const executeSlashCommand = React.useCallback(
    async (rawInput: string): Promise<boolean> => {
      const parsed = parseSlashInvocation(
        rawInput,
        slashCatalog.commandDescriptors,
        slashCatalog.skillDescriptors,
      );
      if (parsed.kind === "plain_prompt" || parsed.kind === "skill_prompt") {
        return false;
      }

      const matchedDescriptor = slashCatalog.commandDescriptors.find(
        (cmd) => cmd.name.toLowerCase() === parsed.slashName.toLowerCase(),
      );
      if (matchedDescriptor?.requires_session && !effectiveSessionId) {
        setCommandBanner({
          tone: "error",
          message: `/${parsed.slashName} requires an active chat session.`,
        });
        return true;
      }

      if (parsed.kind === "api_request") {
        setCommandBanner({
          tone: "pending",
          message: `Running /${parsed.slashName}...`,
        });
        try {
          switch (parsed.req) {
            case "compact": {
              if (!effectiveSessionId) {
                setCommandBanner({
                  tone: "error",
                  message: "/compact requires an active chat session.",
                });
                return true;
              }
              const res = await callRpc("workspace.compact", {
                sessionId: effectiveSessionId,
              });
              if (!res.ok) {
                setCommandBanner({
                  tone: "error",
                  message: res.message || "Failed to compact context.",
                });
                return true;
              }
              setTextValue("");
              setCursorPos(0);
              setCommandBanner({
                tone: "success",
                message: res.message || "Context compacted",
              });
              return true;
            }
            case "set_model": {
              const targetModel =
                typeof parsed.params.model === "string"
                  ? parsed.params.model.trim()
                  : "";
              if (!targetModel) {
                setCommandBanner({
                  tone: "error",
                  message: "Specify a model ID (e.g. /model claude-opus-5-5).",
                });
                return true;
              }
              if (effectiveSessionId) {
                const res = await callRpc("sessions.setModel", {
                  sessionId: effectiveSessionId,
                  model: targetModel,
                });
                if (res.deferred || (!res.ok && res.code === "busy")) {
                  setSessionPrefs(sessionOverrideKey, {
                    modelId: targetModel,
                    modelLabel: targetModel,
                  });
                  setDeferredNotice("Applies on next turn");
                  setCommandBanner({
                    tone: "busy",
                    message: res.message || "Applies on next turn",
                  });
                  setTextValue("");
                  setCursorPos(0);
                  return true;
                }
                if (!res.ok) {
                  setCommandBanner({
                    tone: "error",
                    message: res.message || `Failed to switch model to ${targetModel}.`,
                  });
                  return true;
                }
              }
              setSessionPrefs(sessionOverrideKey, {
                modelId: targetModel,
                modelLabel: targetModel,
              });
              if (!effectiveSessionId) {
                updateActiveDraft({ model: targetModel });
              }
              setTextValue("");
              setCursorPos(0);
              setCommandBanner({
                tone: "success",
                message: `Model switched to ${targetModel}`,
              });
              return true;
            }
            case "set_reasoning_effort": {
              const targetEffort =
                typeof parsed.params.effort === "string"
                  ? parsed.params.effort.trim().toLowerCase()
                  : "";
              if (!targetEffort) {
                setCommandBanner({
                  tone: "error",
                  message: "Specify a reasoning effort (e.g. /effort high).",
                });
                return true;
              }
              const normalizedEffort = normalizeEffortLevel(targetEffort);
              if (effectiveSessionId) {
                const res = await callRpc("sessions.setEffort", {
                  sessionId: effectiveSessionId,
                  effort: targetEffort,
                });
                if (res.deferred || (!res.ok && res.code === "busy")) {
                  setSessionPrefs(sessionOverrideKey, { effort: normalizedEffort });
                  setDeferredNotice("Applies on next turn");
                  setCommandBanner({
                    tone: "busy",
                    message: res.message || "Applies on next turn",
                  });
                  setTextValue("");
                  setCursorPos(0);
                  return true;
                }
                if (!res.ok) {
                  setCommandBanner({
                    tone: "error",
                    message: res.message || `Failed to set reasoning effort to ${targetEffort}.`,
                  });
                  return true;
                }
              }
              setSessionPrefs(sessionOverrideKey, { effort: normalizedEffort });
              if (!effectiveSessionId) {
                updateActiveDraft({ reasoningEffort: normalizedEffort });
              }
              setTextValue("");
              setCursorPos(0);
              setCommandBanner({
                tone: "success",
                message: `Reasoning effort set to ${formatSessionCoreEffortLabel(targetEffort, "header")}`,
              });
              return true;
            }
            case "set_permission_mode": {
              const modeRaw =
                typeof parsed.params.mode === "string"
                  ? parsed.params.mode.trim()
                  : "plan";
              const uiMode: PermissionModeId =
                modeRaw === "accept_edits" || modeRaw === "acceptEdits"
                  ? "acceptEdits"
                  : modeRaw === "full_manage" || modeRaw === "fullManage"
                    ? "fullManage"
                    : modeRaw === "orchestrator"
                      ? "orchestrator"
                      : modeRaw === "plan"
                        ? "plan"
                        : "default";
              setSessionPrefs(sessionOverrideKey, { permissionMode: uiMode });
              if (!effectiveSessionId) {
                updateActiveDraft({ permissionMode: uiMode });
              }
              onPermissionModeChange?.(uiMode);
              if (effectiveSessionId) {
                await callRpc("sessions.setPermissionMode", {
                  sessionId: effectiveSessionId,
                  mode: uiMode,
                });
              }
              setCommandBanner({
                tone: "success",
                message: `Permission mode set to ${uiMode}`,
              });
              setTextValue("");
              setCursorPos(0);
              return true;
            }
            default: {
              const res = await callRpc("sessions.runtimeCommand", {
                sessionId: effectiveSessionId ?? undefined,
                command: parsed.slashName,
                args: parsed.rawArgs ? [parsed.rawArgs] : [],
              });
              if (!res.ok) {
                setCommandBanner({
                  tone: res.code === "busy" ? "busy" : "error",
                  message:
                    res.message ||
                    `Command /${parsed.slashName} could not be completed.`,
                });
                return true;
              }
              setCommandBanner({
                tone: "success",
                message: res.message || `Ran /${parsed.slashName}`,
              });
              setTextValue("");
              setCursorPos(0);
              return true;
            }
          }
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error);
          setCommandBanner({
            tone: "error",
            message: msg,
          });
          // Preserve user input on validation/execution error so they can fix typos immediately
          return true;
        }
      }

      // runtime_command
      if (parsed.command === "bg") {
        setBackgroundDrawerOpen(true);
        setTextValue("");
        setCursorPos(0);
        return true;
      }
      if (parsed.command === "clear") {
        setActiveSession(null);
        setTextValue("");
        setCursorPos(0);
        return true;
      }
      if (parsed.command === "plan") {
        setSessionPrefs(sessionOverrideKey, { permissionMode: "plan" });
        if (!effectiveSessionId) {
          updateActiveDraft({ permissionMode: "plan" });
        } else {
          void callRpc("sessions.setPermissionMode", {
            sessionId: effectiveSessionId,
            mode: "plan",
          }).catch(() => {});
        }
        onPermissionModeChange?.("plan");
        setTextValue("");
        setCursorPos(0);
        return true;
      }
      if (parsed.command === "mcp" || parsed.command === "skills") {
        setActiveRoute("plugins");
        setTextValue("");
        setCursorPos(0);
        return true;
      }

      setCommandBanner({
        tone: "pending",
        message: `Running /${parsed.slashName}...`,
      });
      try {
        const res = await callRpc("sessions.runtimeCommand", {
          sessionId: effectiveSessionId ?? undefined,
          command: parsed.command,
          args: parsed.args,
        });
        if (!res.ok) {
          setCommandBanner({
            tone: res.code === "busy" ? "busy" : "error",
            message:
              res.code === "busy"
                ? `/${parsed.slashName} is queued until the active turn finishes.`
                : res.message || `Command /${parsed.slashName} failed.`,
          });
          return true;
        }
        setTextValue("");
        setCursorPos(0);
        setCommandBanner({
          tone: "success",
          message: res.message || `Ran /${parsed.slashName}`,
        });
        return true;
      } catch (error) {
        setCommandBanner({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
    },
    [
      effectiveSessionId,
      onPermissionModeChange,
      sessionOverrideKey,
      setActiveRoute,
      setActiveSession,
      setBackgroundDrawerOpen,
      setSessionPrefs,
      setTextValue,
      slashCatalog.commandDescriptors,
      slashCatalog.skillDescriptors,
      updateActiveDraft,
    ],
  );

  const handleSelectSlashCommand = React.useCallback(
    (item: SlashCommandItem, options?: { completeOnly?: boolean }) => {
      const insertSlashToken = () => {
        if (slashTrigger) {
          const applied = applySlashSelection(
            textValue,
            slashTrigger,
            item.insertText,
          );
          setTextValue(applied.nextValue);
          setPendingCaret((prev) => ({
            pos: applied.nextCursor,
            seq: (prev?.seq ?? 0) + 1,
          }));
          return;
        }
        const fallbackText = item.insertText.endsWith(" ")
          ? item.insertText
          : `${item.insertText} `;
        setTextValue(fallbackText);
        setPendingCaret((prev) => ({
          pos: fallbackText.length,
          seq: (prev?.seq ?? 0) + 1,
        }));
      };

      // Mid-sentence completion (e.g. "Please /rev") or Tab completion always splices the token
      if (
        options?.completeOnly ||
        (slashTrigger && slashTrigger.slashIndex > 0) ||
        item.kind === "skill" ||
        Boolean(item.argHint)
      ) {
        insertSlashToken();
        return;
      }

      // Session-gated check before dispatch
      if (item.requiresSession && !effectiveSessionId) {
        setCommandBanner({
          tone: "error",
          message: `${item.command} requires an active chat session.`,
        });
        return;
      }

      // At start of composer with no arg_hint: dispatch immediately via parseSlashInvocation
      void executeSlashCommand(item.command);
    },
    [effectiveSessionId, executeSlashCommand, setTextValue, slashTrigger, textValue],
  );

  const handleModelSelect = React.useCallback(
    (model: ModelOption) => {
      const spec =
        model.modelSpec ||
        formatHarnessModelSpec(model.id, model.provider, model.apiMethod) ||
        model.id;
      setSessionPrefs(sessionOverrideKey, {
        modelId: spec,
        modelLabel: model.label,
        apiMethod: model.apiMethod,
      });
      if (!effectiveSessionId) {
        updateActiveDraft({ model: spec });
      }
      onModelChange?.(model);
    },
    [
      effectiveSessionId,
      onModelChange,
      sessionOverrideKey,
      setSessionPrefs,
      updateActiveDraft,
    ],
  );

  const handleEffortSelect = React.useCallback(
    (nextEffort: EffortLevel) => {
      setSessionPrefs(sessionOverrideKey, { effort: nextEffort });
      if (!effectiveSessionId) {
        updateActiveDraft({ reasoningEffort: nextEffort });
      }
      onEffortChange?.(nextEffort);
    },
    [
      effectiveSessionId,
      onEffortChange,
      sessionOverrideKey,
      setSessionPrefs,
      updateActiveDraft,
    ],
  );

  const handleServiceTierSelect = React.useCallback(
    (nextTier: ServiceTier) => {
      setSessionPrefs(sessionOverrideKey, { serviceTier: nextTier });
      onServiceTierChange?.(nextTier);
    },
    [onServiceTierChange, sessionOverrideKey, setSessionPrefs],
  );

  const handleCacheTtlSelect = React.useCallback(
    (nextTtl: CacheTtl) => {
      setSessionPrefs(sessionOverrideKey, { cacheTtl: nextTtl });
      onCacheTtlChange?.(nextTtl);
    },
    [onCacheTtlChange, sessionOverrideKey, setSessionPrefs],
  );

  const handlePermissionSelect = React.useCallback(
    (nextMode: PermissionModeId) => {
      setSessionPrefs(sessionOverrideKey, { permissionMode: nextMode });
      if (!effectiveSessionId) {
        updateActiveDraft({ permissionMode: nextMode });
      }
      onPermissionModeChange?.(nextMode);
    },
    [
      effectiveSessionId,
      onPermissionModeChange,
      sessionOverrideKey,
      setSessionPrefs,
      updateActiveDraft,
    ],
  );

  const handlePaste = async (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const fileList = Array.from(event.clipboardData?.files ?? []);
    const imageFiles = fileList.filter((f) => inferImageMediaType(f) !== null);
    if (imageFiles.length === 0) return;
    event.preventDefault();
    const loaded = (
      await Promise.all(imageFiles.map((f) => readImageFile(f)))
    ).filter((img): img is ImageAttachmentView => img !== null);
    if (loaded.length > 0) {
      setImages((prev) => [...prev, ...loaded].slice(0, MAX_ATTACHED_IMAGES));
    }
  };

  const submitWithText = React.useCallback(
    (
      rawText: string,
      useAlternateMidTurnMode = false,
      overrides?: {
        editorSelection?: EditorSelectionView | null;
        selectionIncluded?: boolean;
      },
    ) => {
      const trimmed = rawText.trim();
      if (disabled) return;
      if (!trimmed && images.length === 0) return;

      const resolvedSelection =
        overrides?.editorSelection !== undefined
          ? overrides.editorSelection
          : activeSelection;
      const resolvedSelectionIncluded =
        overrides?.selectionIncluded !== undefined
          ? overrides.selectionIncluded
          : selectionIncluded;

      const matchedModels = catalog.models.filter(
        (m) => m.modelSpec === activeModelId || m.id === activeModelId,
      );
      const activeModelOption =
        matchedModels.find((m) => m.available !== false) ?? matchedModels[0];
      const resolvedModelSpec =
        activeModelOption?.modelSpec ||
        (activeModelOption
          ? formatHarnessModelSpec(
              activeModelOption.id,
              activeModelOption.provider,
              activeModelOption.apiMethod,
            )
          : formatHarnessModelSpec(activeModelId)) ||
        activeModelId;

      if (isSubmitting) {
        if (!effectiveSessionId) return;
        const effectiveMidTurnMode: MidTurnSendMode = useAlternateMidTurnMode
          ? midTurnSendMode === "steer"
            ? "queue"
            : "steer"
          : midTurnSendMode;
        const attachedImages = images.length > 0 ? images : undefined;

        if (effectiveMidTurnMode === "steer") {
          const steerText = trimmed || "[Image attachment]";
          const clientId = `si_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          addMidTurnMessage({
            id: clientId,
            sessionId: effectiveSessionId,
            mode: "steer",
            text: steerText,
            createdAtMs: Date.now(),
            images: attachedImages,
          });
          void callRpc("sessions.softInterrupt", {
            sessionId: effectiveSessionId,
            text: steerText,
            urgent: false,
            clientId,
            ...(attachedImages ? { images: attachedImages } : {}),
          }).catch(() => {
            useAppStore
              .getState()
              .removeMidTurnMessage(effectiveSessionId, clientId);
            setTextValue(rawText);
          });
          setTextValue("");
          setImages([]);
          return;
        }

        const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        addMidTurnMessage({
          id,
          sessionId: effectiveSessionId,
          mode: "queue",
          workingDir: storeProjectPath ?? activeWorkspace?.path ?? undefined,
          text: trimmed,
          createdAtMs: Date.now(),
          images: attachedImages,
          editorSelection:
            resolvedSelection && resolvedSelectionIncluded
              ? resolvedSelection
              : null,
          modelSpec: resolvedModelSpec,
          apiMethod: activeModelOption?.apiMethod,
          effort: activeModelOption?.supportedEfforts?.length === 0 ? undefined : activeEffort,
          permissionMode: activePermissionMode,
          serviceTier: activeServiceTier,
          cacheTtl: activeCacheTtl,
        });
        setQueuePausedForSession(effectiveSessionId, false);
        setTextValue("");
        setImages([]);
        return;
      }

      // Route leading slash/skill commands through packages/session-core parseSlashInvocation
      if (images.length === 0) {
        const parsed = parseSlashInvocation(
          rawText,
          slashCatalog.commandDescriptors,
          slashCatalog.skillDescriptors,
        );
        if (parsed.kind === "api_request" || parsed.kind === "runtime_command") {
          void executeSlashCommand(rawText);
          return;
        }
      }
      const payload: ComposerSubmitPayload = {
        prompt: trimmed,
        images: images.length > 0 ? images : undefined,
        project: activeProject,
        workingDir: storeProjectPath ?? activeWorkspace?.path ?? undefined,
        checkout: activeCheckout,
        modelId: resolvedModelSpec,
        modelSpec: resolvedModelSpec,
        modelLabel: activeModelLabel,
        apiMethod: activeModelOption?.apiMethod,
        effort: activeModelOption?.supportedEfforts?.length === 0 ? undefined : activeEffort,
        serviceTier: activeServiceTier,
        cacheTtl: activeCacheTtl,
        permissionMode: activePermissionMode,
        editorSelection:
          resolvedSelection && resolvedSelectionIncluded
            ? resolvedSelection
            : null,
        selectionIncluded: Boolean(
          resolvedSelection && resolvedSelectionIncluded,
        ),
      };

      setTextValue("");
      setImages([]);
      void Promise.resolve(onSubmit?.(payload)).catch((error) => {
        const state = useAppStore.getState();
        const draftKey = effectiveSessionId ?? "__home__";
        if (!state.composerDrafts[draftKey]) {
          state.setComposerDraft(draftKey, rawText);
          setTextValue(rawText);
        }
        setImages((current) => current.length ? current : payload.images ?? []);
        toast.error(error instanceof Error ? error.message : "Rayu could not submit the prompt.");
      });
    },
    [
      activeCacheTtl,
      activeCheckout,
      activeEffort,
      activeModelId,
      activeModelLabel,
      activePermissionMode,
      activeProject,
      activeSelection,
      activeServiceTier,
      activeWorkspace?.path,
      addMidTurnMessage,
      catalog.models,
      disabled,
      effectiveSessionId,
      executeSlashCommand,
      images,
      isSubmitting,
      midTurnSendMode,
      onSubmit,
      selectionIncluded,
      setQueuePausedForSession,
      setTextValue,
      slashCatalog.commandDescriptors,
      slashCatalog.skillDescriptors,
      storeProjectPath,
    ],
  );

  const triggerSubmit = React.useCallback(
    (useAlternateMidTurnMode = false) => {
      submitWithText(textValue, useAlternateMidTurnMode);
    },
    [submitWithText, textValue],
  );

  // Atomically consume pending host composer injections across both controlled (HomePage) and uncontrolled (Workspace) composers.
  React.useEffect(() => {
    if (!pendingComposerInjection) return;
    if (lastConsumedInjectionIdRef.current === pendingComposerInjection.id) {
      return;
    }
    if (
      useAppStore.getState().pendingComposerInjection?.id !==
      pendingComposerInjection.id
    ) {
      return;
    }
    lastConsumedInjectionIdRef.current = pendingComposerInjection.id;

    const injection = pendingComposerInjection;
    const nextText = mergeComposerInjection(textValue, injection);
    setTextValue(nextText);

    if (injection.selection) {
      setSelectionIncluded(true);
    }

    consumeComposerInjection(injection.id);

    const el = textareaRef.current;
    if (el) {
      el.focus();
      pendingCursorToEndRef.current = true;
      const end = nextText.length;
      try {
        el.setSelectionRange(end, end);
      } catch {
        // Ignore if selection API is unavailable
      }
    }

    if (
      injection.autoSubmit === true &&
      !isSubmitting &&
      !disabled &&
      nextText.trim().length > 0
    ) {
      submitWithText(nextText, false, {
        editorSelection:
          injection.selection !== undefined
            ? injection.selection
            : activeSelection,
        selectionIncluded: injection.selection ? true : selectionIncluded,
      });
    }
  }, [
    activeSelection,
    consumeComposerInjection,
    disabled,
    isSubmitting,
    pendingComposerInjection,
    selectionIncluded,
    setTextValue,
    submitWithText,
    textValue,
  ]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionTrigger && mentionFiles.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionFiles.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (prev) => (prev - 1 + mentionFiles.length) % mentionFiles.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const target = mentionFiles[mentionIndex] ?? mentionFiles[0];
        if (target) handleSelectMentionFile(target);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setPopupDismissedForText(textValue);
        return;
      }
    }

    if (slashTrigger && slashCatalog.commands.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((prev) => (prev + 1) % slashCatalog.commands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex(
          (prev) =>
            (prev - 1 + slashCatalog.commands.length) %
            slashCatalog.commands.length,
        );
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const target =
          slashCatalog.commands[slashIndex] ?? slashCatalog.commands[0];
        if (target) handleSelectSlashCommand(target, { completeOnly: true });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const target =
          slashCatalog.commands[slashIndex] ?? slashCatalog.commands[0];
        if (target) handleSelectSlashCommand(target, { completeOnly: false });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setPopupDismissedForText(textValue);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      triggerSubmit(event.altKey);
    }
  };

  const handleImageFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const fileList = Array.from(event.target.files ?? []);
    event.target.value = "";
    const imageFiles = fileList.filter((f) => inferImageMediaType(f) !== null);
    if (imageFiles.length === 0) return;
    const loaded = (
      await Promise.all(imageFiles.map((f) => readImageFile(f)))
    ).filter((img): img is ImageAttachmentView => img !== null);
    if (loaded.length > 0) {
      setImages((prev) => [...prev, ...loaded].slice(0, MAX_ATTACHED_IMAGES));
    }
  };

  const insertComposerPrefix = React.useCallback(
    (prefix: "@" | "/") => {
      setPlusMenuOpen(false);
      const needsSpace = textValue.length > 0 && !/\s$/.test(textValue);
      const next = `${textValue}${needsSpace ? " " : ""}${prefix}`;
      setTextValue(next);
      setPendingCaret((prev) => ({
        pos: next.length,
        seq: (prev?.seq ?? 0) + 1,
      }));
    },
    [setTextValue, textValue],
  );

  const effectivePlaceholder = React.useMemo(() => {
    if (placeholder) return placeholder;
    if (isSubmitting) {
      return midTurnSendMode === "steer"
        ? "Steer without interrupting... (Enter to steer, Alt+Enter to queue)"
        : "Queue follow-up for after response... (Enter to queue, Alt+Enter to steer)";
    }
    if (activePermissionMode === "plan") {
      return "Describe your task to generate a plan... (@ files, / commands)";
    }
    return "Message RayuCode... (@ files, / commands)";
  }, [activePermissionMode, isSubmitting, midTurnSendMode, placeholder]);

  const hasPromptContent = textValue.trim().length > 0 || images.length > 0;

  return (
    <div
      data-testid="session-composer"
      data-mode={mode}
      className={cn(
        "@container/composer relative mx-auto w-full max-w-[732px] px-2.5 pb-2.5 @min-[640px]/app:px-4 @min-[640px]/app:pb-4",
        className,
      )}
    >
        {/* Floating @file Mention Menu */}
        {mentionTrigger ? (
          <div className="mb-2">
            <MentionMenu
              open={Boolean(mentionTrigger)}
              query={mentionTrigger.query}
              sessionId={effectiveSessionId}
              files={mentionFiles}
              activeIndex={mentionIndex}
              onActiveIndexChange={setMentionIndex}
              onSelectFile={handleSelectMentionFile}
              onClose={() => setPopupDismissedForText(textValue)}
            />
          </div>
        ) : null}

        {/* Floating / Slash Command Menu */}
        {slashTrigger ? (
          <div className="mb-2">
            <SlashCommandMenu
              open={Boolean(slashTrigger)}
              query={slashTrigger.query}
              commands={slashCatalog.commands}
              activeSessionId={effectiveSessionId}
              activeIndex={slashIndex}
              onActiveIndexChange={setSlashIndex}
              onSelectCommand={(item) => handleSelectSlashCommand(item)}
              onClose={() => setPopupDismissedForText(textValue)}
            />
          </div>
        ) : null}

        {/* Outer Machined Tray (.composer-shell: bg-shell border-hairline rounded-2xl shadow-composer) */}
        <div
          data-testid="composer-outer-tray"
          className="rounded-2xl border border-hairline bg-shell p-1.5 shadow-composer"
        >
          {/* Inline Command Feedback & Error Banner */}
          {commandBanner ? (
            <div
              role={commandBanner.tone === "error" ? "alert" : "status"}
              data-testid="composer-command-banner"
              data-tone={commandBanner.tone}
              className={cn(
                "mb-1.5 flex items-center justify-between gap-2 rounded-[10px] border px-3 py-1.5 text-xs",
                commandBanner.tone === "pending" &&
                  "border-hairline bg-pane text-body",
                commandBanner.tone === "success" &&
                  "border-brand/30 bg-brand-soft text-ink",
                commandBanner.tone === "busy" &&
                  "border-warn/30 bg-warn-soft text-warn",
                commandBanner.tone === "error" &&
                  "border-danger/30 bg-danger-soft text-danger",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {commandBanner.tone === "pending" ? (
                  <Loader2
                    className="size-3.5 shrink-0 animate-spin text-brand-text"
                    aria-hidden="true"
                  />
                ) : commandBanner.tone === "success" ? (
                  <Check
                    className="size-3.5 shrink-0 text-brand-text"
                    aria-hidden="true"
                  />
                ) : commandBanner.tone === "busy" ? (
                  <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertCircle
                    className="size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{commandBanner.message}</span>
              </span>
              {commandBanner.tone === "error" ||
              commandBanner.tone === "busy" ? (
                <button
                  type="button"
                  aria-label="Dismiss command error"
                  data-testid="composer-command-banner-dismiss"
                  onClick={() => setCommandBanner(null)}
                  className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-current opacity-80 transition-opacity hover:opacity-100"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Inner Surface (.composer-inner: bg-raised border-hairline rounded-[14px], ZERO focus glow ring) */}
          <div
            data-testid="composer-inner-surface"
            className="flex flex-col rounded-[14px] border border-hairline bg-raised transition-colors focus-within:border-premium-hi"
          >
            {/* Mid-Turn Steer / Queue Mode Bar (shown while AI is actively responding) */}
            {isSubmitting ? (
              <div
                data-testid="composer-midturn-bar"
                className="flex min-w-0 items-center justify-between gap-2 border-b border-hairline-soft px-3 py-1.5"
              >
                <span className="min-w-0 truncate text-[11px] text-muted-ink @max-[360px]/composer:hidden">
                  {midTurnSendMode === "steer"
                    ? "Auto-sends at next safe step"
                    : "Waits until response finishes"}
                </span>
                <div
                  role="group"
                  aria-label="Mid-turn send mode"
                  data-testid="midturn-mode-toggle"
                  className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-hairline bg-inset p-0.5"
                >
                  <button
                    type="button"
                    data-testid="midturn-mode-steer"
                    aria-pressed={midTurnSendMode === "steer"}
                    onClick={() => setMidTurnSendMode("steer")}
                    className={cn(
                      "cursor-pointer rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-all focus:outline-none",
                      midTurnSendMode === "steer"
                        ? "bg-active text-ink shadow-bevel-surface"
                        : "text-muted-ink hover:text-ink",
                    )}
                  >
                    Steer
                  </button>
                  <button
                    type="button"
                    data-testid="midturn-mode-queue"
                    aria-pressed={midTurnSendMode === "queue"}
                    onClick={() => setMidTurnSendMode("queue")}
                    className={cn(
                      "cursor-pointer rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-all focus:outline-none",
                      midTurnSendMode === "queue"
                        ? "bg-active text-ink shadow-bevel-surface"
                        : "text-muted-ink hover:text-ink",
                    )}
                  >
                    Queue
                  </button>
                </div>
              </div>
            ) : null}

            {/* Active VS Code Editor Selection Pill (above textarea) */}
            {activeSelection ? (
              <div className="px-3 pt-2.5 pb-0.5">
                <ActiveSelectionPill
                  selection={activeSelection}
                  included={selectionIncluded}
                  onToggleInclude={setSelectionIncluded}
                  onDismiss={() => setEditorSelection(null)}
                />
              </div>
            ) : null}

            {/* Pasted Screenshot Thumbnails Strip (only when images pasted) */}
            {images.length > 0 ? (
              <div
                data-testid="composer-image-strip"
                className="flex flex-wrap items-center gap-2 px-3 pt-2.5"
              >
                {images.map((img, idx) => (
                  <div
                    key={`${img.name ?? "img"}_${idx}`}
                    className="group relative h-10 w-10 overflow-hidden rounded-lg border border-hairline bg-inset"
                  >
                    <img
                      src={img.data}
                      alt={img.name ?? "Attached image"}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${img.name ?? "image"}`}
                      onClick={() =>
                        setImages((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="absolute top-0.5 right-0.5 grid size-4 cursor-pointer place-items-center rounded-full bg-chrome/85 text-ink opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="size-2.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Auto-growing Textarea (React 19 ref-as-prop, zero browser focus glow ring) */}
            <textarea
              ref={setTextareaNode}
              rows={1}
              value={textValue}
              disabled={disabled}
              placeholder={effectivePlaceholder}
              data-testid="composer-textarea"
              aria-label="Message RayuCode"
              onChange={(e) => {
                const nextVal = e.target.value;
                const nextCursor = resolveTextareaCursor(
                  e.target,
                  nextVal.length,
                );
                setCursorPos(nextCursor);
                setTextValue(nextVal);
              }}
              onClick={(e) =>
                setCursorPos(
                  resolveTextareaCursor(e.currentTarget, textValue.length),
                )
              }
              onKeyUp={(e) =>
                setCursorPos(
                  resolveTextareaCursor(e.currentTarget, textValue.length),
                )
              }
              onSelect={(e) =>
                setCursorPos(
                  resolveTextareaCursor(e.currentTarget, textValue.length),
                )
              }
              onKeyDown={handleKeyDown}
              onPaste={(e) => void handlePaste(e)}
              className="rayu-prose max-h-[180px] min-h-[44px] w-full resize-none border-0 bg-transparent px-3.5 pt-2.5 pb-1.5 text-[13.5px] leading-[1.55] text-ink placeholder:text-muted-ink focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none disabled:opacity-50"
            />

            {/* Hidden image file picker for [+] menu */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => void handleImageFileSelect(e)}
            />

            {/* Bottom Control Bar — matches Desktop Composer 1:1: [+] + ModelEffortPopover | spacer | PermissionPopover + Send/Stop Orb */}
            <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2">
              <Popover open={plusMenuOpen} onOpenChange={setPlusMenuOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label="Add files and more"
                        data-testid="composer-plus-trigger"
                        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border border-transparent text-muted-ink transition-colors outline-none hover:border-hairline hover:bg-hover hover:text-ink focus:outline-none data-[state=open]:border-hairline data-[state=open]:bg-active data-[state=open]:text-ink disabled:pointer-events-none disabled:opacity-50"
                      >
                        <Plus className="size-[15px]" aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Add files, skills &amp; more
                  </TooltipContent>
                </Tooltip>
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={10}
                  className="w-[248px] rounded-[14px] border border-premium-hi bg-popover-solid p-1.5 shadow-popover"
                >
                  <div className="px-2.5 pt-1 pb-1 text-[11px] font-medium text-muted-ink">
                    Add
                  </div>
                  <button
                    type="button"
                    data-testid="composer-add-image"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                  >
                    <ImageIcon
                      className="size-4 shrink-0 text-muted-ink"
                      aria-hidden="true"
                    />
                    <span className="font-medium">Attach image</span>
                  </button>
                  <button
                    type="button"
                    data-testid="composer-add-file-mention"
                    onClick={() => insertComposerPrefix("@")}
                    className="flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <AtSign
                        className="size-4 shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                      <span className="font-medium">Mention file</span>
                    </span>
                    <kbd className="rounded bg-active px-1.5 py-0.5 font-mono text-[10px] text-muted-ink">
                      @
                    </kbd>
                  </button>
                  <button
                    type="button"
                    data-testid="composer-add-slash"
                    onClick={() => insertComposerPrefix("/")}
                    className="flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <Sparkles
                        className="size-4 shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                      <span className="font-medium">Skills &amp; commands</span>
                    </span>
                    <kbd className="rounded bg-active px-1.5 py-0.5 font-mono text-[10px] text-muted-ink">
                      /
                    </kbd>
                  </button>
                  <button
                    type="button"
                    data-testid="composer-toggle-plan"
                    onClick={() => {
                      const prevMode = activePermissionMode;
                      const nextMode: PermissionModeId =
                        activePermissionMode === "plan"
                          ? storeDefaultPermissionMode === "plan"
                            ? "default"
                            : storeDefaultPermissionMode
                          : "plan";
                      handlePermissionSelect(nextMode);
                      if (effectiveSessionId) {
                        void callRpc("sessions.setPermissionMode", {
                          sessionId: effectiveSessionId,
                          mode: nextMode,
                        })
                          .then((res) => {
                            if (res && res.ok === false) {
                              handlePermissionSelect(prevMode);
                            }
                          })
                          .catch(() => {
                            handlePermissionSelect(prevMode);
                          });
                      }
                      setPlusMenuOpen(false);
                      textareaRef.current?.focus();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                  >
                    <Lightbulb
                      className={cn(
                        "size-4 shrink-0",
                        activePermissionMode === "plan"
                          ? "text-brand-text"
                          : "text-muted-ink",
                      )}
                      aria-hidden="true"
                    />
                    <span className="font-medium">Plan mode</span>
                    {activePermissionMode === "plan" ? (
                      <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand-text">
                        On
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusMenuOpen(false);
                      setActiveRoute("plugins");
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                  >
                    <Plug
                      className="size-4 shrink-0 text-muted-ink"
                      aria-hidden="true"
                    />
                    <span className="font-medium">Plugins &amp; MCP</span>
                  </button>
                </PopoverContent>
              </Popover>

              <ModelEffortPopover
                modelId={activeModelId}
                modelLabel={activeModelLabel}
                effort={activeEffort}
                serviceTier={activeServiceTier}
                cacheTtl={activeCacheTtl}
                sessionId={effectiveSessionId}
                models={catalog.models}
                defaultModelId={catalog.defaultModelId}
                deferredNotice={deferredNotice}
                onDeferredChange={setDeferredNotice}
                onSelectModel={handleModelSelect}
                onSelectEffort={handleEffortSelect}
                onSelectServiceTier={handleServiceTierSelect}
                onSelectCacheTtl={handleCacheTtlSelect}
                onRefreshModels={catalog.refreshModels}
                isRefreshing={catalog.isRefreshing}
                isStreaming={isSubmitting}
                disabled={disabled}
              />

              {deferredNotice ? (
                <Badge
                  variant="warn"
                  data-testid="composer-deferred-badge"
                  className="shrink-0 gap-1 border-warn/30 bg-warn-soft text-warn"
                >
                  <Clock className="size-3" aria-hidden="true" />
                  <span>{deferredNotice}</span>
                </Badge>
              ) : null}

              <span className="flex-1" />

              <PermissionPopover
                value={activePermissionMode}
                onChange={handlePermissionSelect}
                sessionId={effectiveSessionId}
                modes={slashCatalog.permissionModes}
                enableShortcut={enablePermissionShortcut}
                disabled={disabled}
              />

              {isSubmitting ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        data-testid="composer-stop-btn"
                        aria-label="Abort active turn"
                        onClick={() => onStop?.()}
                        className="ml-0.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-premium bg-active text-ink shadow-bevel-surface transition-colors hover:border-danger hover:bg-danger-soft hover:text-danger focus:outline-none"
                      >
                        <Square
                          className="size-3.5 fill-current"
                          aria-hidden="true"
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Stop / Abort</TooltipContent>
                  </Tooltip>

                  {midTurnSendMode === "steer" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-testid="composer-steer-btn"
                          aria-label="Steer active turn without interrupting"
                          disabled={disabled || !hasPromptContent}
                          onClick={() => triggerSubmit(false)}
                          className={cn(
                            "grid size-8 shrink-0 place-items-center rounded-full transition-all focus:outline-none",
                            hasPromptContent && !disabled
                              ? "rayu-primary-bevel cursor-pointer bg-brand text-brand-ink hover:scale-[1.04] hover:bg-brand-bright active:scale-[0.98]"
                              : "cursor-not-allowed border border-hairline bg-control text-faint opacity-60",
                          )}
                        >
                          <CornerDownLeft
                            className="size-[15px]"
                            strokeWidth={2.2}
                            aria-hidden="true"
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Steer without interrupting (Enter · Alt+Enter to queue)
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-testid="composer-queue-btn"
                          aria-label="Queue message for after response"
                          disabled={disabled || !hasPromptContent}
                          onClick={() => triggerSubmit(false)}
                          className={cn(
                            "grid size-8 shrink-0 place-items-center rounded-full transition-all focus:outline-none",
                            hasPromptContent && !disabled
                              ? "cursor-pointer border border-premium bg-active text-ink shadow-bevel-surface hover:border-brand hover:bg-brand-soft hover:text-brand-text active:scale-95"
                              : "cursor-not-allowed border border-hairline bg-control text-faint opacity-60",
                          )}
                        >
                          <ListPlus
                            className="size-4"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Queue for after response (Enter · Alt+Enter to steer)
                      </TooltipContent>
                    </Tooltip>
                  )}
                </>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-testid="composer-submit-btn"
                      aria-label="Send message"
                      disabled={disabled || !hasPromptContent}
                      onClick={() => triggerSubmit(false)}
                      className={cn(
                        "ml-0.5 grid size-8 shrink-0 place-items-center rounded-full transition-all outline-none focus:outline-none",
                        hasPromptContent && !disabled
                          ? "rayu-primary-bevel cursor-pointer bg-brand text-brand-ink hover:scale-[1.04] hover:bg-brand-bright active:scale-[0.98]"
                          : "cursor-not-allowed border border-hairline bg-control text-faint opacity-60",
                      )}
                    >
                      <ArrowUp
                        className="size-[15px]"
                        strokeWidth={2.2}
                        aria-hidden="true"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Send (Enter)</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>
  );
}

export { SessionComposer as FloatingComposer };
