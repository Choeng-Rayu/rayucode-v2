import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CornerDownLeft,
  GitBranch,
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
} from "@shared/vscodeProtocol";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import {
  ProjectIconGlyph,
  toProjectIconSpec,
} from "@/features/shell";
import { callRpc, cn, useAppStore } from "@/lib";

import {
  DEFAULT_CHECKOUT,
  DEFAULT_PERMISSION_MODE_ID,
  DEFAULT_PROJECT,
  normalizeEffortLevel,
} from "../constants";
import {
  contextSnapshotQueryOptions,
  useComposerModelCatalog,
  useSlashCommandsCatalog,
  useWorkspaceFilesSearch,
  workspaceBranchesQueryOptions,
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
import { VoiceMicButton } from "./VoiceMicButton";

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
  const setActiveProjectPath = useAppStore((s) => s.setActiveProjectPath);
  const storeWorkspaces = useAppStore((s) => s.workspaces);
  const storeEditorSelection = useAppStore((s) => s.editorSelection);
  const setEditorSelection = useAppStore((s) => s.setEditorSelection);
  const storeIsStreamActive = useAppStore((s) => s.isStreamActive);
  const openRightTab = useAppStore((s) => s.openRightTab);
  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setBackgroundDrawerOpen = useAppStore((s) => s.setBackgroundDrawerOpen);
  const composerFocusNonce = useAppStore((s) => s.composerFocusNonce);

  const effectiveSessionId =
    controlledSessionId !== undefined ? controlledSessionId : storeSessionId;
  const isSubmitting =
    controlledIsSubmitting !== undefined
      ? controlledIsSubmitting
      : storeIsStreamActive;

  const catalog = useComposerModelCatalog(effectiveSessionId);
  const foldersQuery = useQuery(workspaceFoldersQueryOptions());
  const branchesQuery = useQuery(
    workspaceBranchesQueryOptions(storeProjectPath),
  );
  const contextQuery = useQuery(
    contextSnapshotQueryOptions(effectiveSessionId),
  );

  const workspaces = React.useMemo(() => {
    if (storeWorkspaces.length > 0) return storeWorkspaces;
    return foldersQuery.data?.folders ?? [];
  }, [foldersQuery.data?.folders, storeWorkspaces]);

  const activeWorkspace = React.useMemo(() => {
    if (storeProjectPath) {
      const found = workspaces.find((w) => w.path === storeProjectPath);
      if (found) return found;
    }
    return workspaces[0] ?? null;
  }, [storeProjectPath, workspaces]);

  const [internalValue, setInternalValue] = React.useState("");
  const [internalProject, setInternalProject] = React.useState(
    activeWorkspace?.name ?? DEFAULT_PROJECT,
  );
  const [internalCheckout, setInternalCheckout] = React.useState(
    activeWorkspace?.branch ?? DEFAULT_CHECKOUT,
  );
  const [internalModelId, setInternalModelId] = React.useState(
    catalog.defaultModelId,
  );
  const [internalModelLabel, setInternalModelLabel] = React.useState(
    catalog.defaultModelLabel,
  );
  const [internalEffort, setInternalEffort] = React.useState<EffortLevel>(
    catalog.defaultEffort,
  );
  const [internalServiceTier, setInternalServiceTier] =
    React.useState<ServiceTier>(catalog.serviceTier);
  const [internalCacheTtl, setInternalCacheTtl] = React.useState<CacheTtl>(
    catalog.cacheTtl,
  );
  const [internalPermissionMode, setInternalPermissionMode] =
    React.useState<PermissionModeId>(DEFAULT_PERMISSION_MODE_ID);

  const [images, setImages] = React.useState<ImageAttachmentView[]>([]);
  const [selectionIncluded, setSelectionIncluded] = React.useState(true);
  const [workspacePickerOpen, setWorkspacePickerOpen] = React.useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = React.useState(false);
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

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const lastFocusNonceRef = React.useRef(composerFocusNonce);

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
    controlledValue !== undefined ? controlledValue : internalValue;
  const activeProject =
    controlledProject !== undefined
      ? controlledProject
      : activeWorkspace?.name ?? internalProject;
  const activeCheckout =
    controlledCheckout !== undefined
      ? controlledCheckout
      : branchesQuery.data?.current ??
        activeWorkspace?.branch ??
        internalCheckout;
  const activeModelId =
    controlledModelId !== undefined ? controlledModelId : internalModelId;
  const activeModelLabel =
    controlledModelLabel !== undefined
      ? controlledModelLabel
      : internalModelLabel;
  const activeEffort = normalizeEffortLevel(
    controlledEffort !== undefined ? controlledEffort : internalEffort,
  );
  const activeServiceTier =
    controlledServiceTier !== undefined
      ? controlledServiceTier
      : internalServiceTier;
  const activeCacheTtl =
    controlledCacheTtl !== undefined ? controlledCacheTtl : internalCacheTtl;
  const activePermissionMode =
    controlledPermissionMode !== undefined
      ? controlledPermissionMode
      : internalPermissionMode;
  const activeSelection =
    controlledEditorSelection !== undefined
      ? controlledEditorSelection
      : storeEditorSelection;

  // Auto-grow textarea height smoothly up to 180px
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(180, Math.max(44, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
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
      if (onValueChange) {
        onValueChange(next);
      } else {
        setInternalValue(next);
      }
    },
    [onValueChange],
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

  const handleSelectSlashCommand = React.useCallback(
    (item: SlashCommandItem) => {
      const clearOrStripToken = () => {
        if (slashTrigger) {
          const stripped = stripSlashRange(
            textValue,
            slashTrigger.slashIndex,
            slashTrigger.endIndex,
          );
          if (stripped.nextValue.trim().length > 0) {
            setTextValue(stripped.nextValue);
            setPendingCaret((prev) => ({
              pos: stripped.nextCursor,
              seq: (prev?.seq ?? 0) + 1,
            }));
            return;
          }
        }
        setTextValue("");
        setCursorPos(0);
      };

      if (item.command === "/compact" && effectiveSessionId) {
        void callRpc("workspace.compact", {
          sessionId: effectiveSessionId,
        }).catch(() => {});
        clearOrStripToken();
        return;
      }
      if (item.command === "/plan") {
        setInternalPermissionMode("plan");
        onPermissionModeChange?.("plan");
        clearOrStripToken();
        return;
      }
      if (item.command === "/bg") {
        setBackgroundDrawerOpen(true);
        clearOrStripToken();
        return;
      }
      if (item.command === "/clear") {
        setActiveSession(null);
        clearOrStripToken();
        return;
      }
      if (item.command === "/mcp" || item.command === "/skills") {
        setActiveRoute("plugins");
        clearOrStripToken();
        return;
      }

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
    },
    [
      effectiveSessionId,
      onPermissionModeChange,
      setActiveRoute,
      setActiveSession,
      setBackgroundDrawerOpen,
      setTextValue,
      slashTrigger,
      textValue,
    ],
  );

  const handleModelSelect = React.useCallback(
    (model: ModelOption) => {
      setInternalModelId(model.id);
      setInternalModelLabel(model.label);
      onModelChange?.(model);
    },
    [onModelChange],
  );

  const handleEffortSelect = React.useCallback(
    (nextEffort: EffortLevel) => {
      setInternalEffort(nextEffort);
      onEffortChange?.(nextEffort);
    },
    [onEffortChange],
  );

  const handleServiceTierSelect = React.useCallback(
    (nextTier: ServiceTier) => {
      setInternalServiceTier(nextTier);
      onServiceTierChange?.(nextTier);
    },
    [onServiceTierChange],
  );

  const handleCacheTtlSelect = React.useCallback(
    (nextTtl: CacheTtl) => {
      setInternalCacheTtl(nextTtl);
      onCacheTtlChange?.(nextTtl);
    },
    [onCacheTtlChange],
  );

  const handlePermissionSelect = React.useCallback(
    (nextMode: PermissionModeId) => {
      setInternalPermissionMode(nextMode);
      onPermissionModeChange?.(nextMode);
    },
    [onPermissionModeChange],
  );

  const handleWorkspaceSelect = (name: string, path: string) => {
    setInternalProject(name);
    setActiveProjectPath(path);
    onProjectChange?.(name, path);
    setWorkspacePickerOpen(false);
  };

  const handleBranchSelect = (branch: string) => {
    setInternalCheckout(branch);
    onCheckoutChange?.(branch);
    setBranchPickerOpen(false);
    if (activeWorkspace?.path) {
      void callRpc("workspace.checkoutBranch", {
        workspacePath: activeWorkspace.path,
        branch,
      }).then(() => {
        void queryClient.invalidateQueries({
          queryKey: ["composer", "workspace-branches"],
        });
      });
    }
  };

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

  const triggerSubmit = React.useCallback(
    (urgentSteer = false) => {
      const trimmed = textValue.trim();
      if (disabled) return;
      if (!trimmed && images.length === 0) return;

      if (isSubmitting && trimmed && effectiveSessionId) {
        void callRpc("sessions.softInterrupt", {
          sessionId: effectiveSessionId,
          text: trimmed,
          urgent: urgentSteer,
        }).catch(() => {});
        setTextValue("");
        return;
      }

      if (isSubmitting) return;

      const payload: ComposerSubmitPayload = {
        prompt: trimmed,
        images: images.length > 0 ? images : undefined,
        project: activeProject,
        workingDir: activeWorkspace?.path ?? storeProjectPath ?? undefined,
        checkout: activeCheckout,
        modelId: activeModelId,
        modelLabel: activeModelLabel,
        effort: activeEffort,
        serviceTier: activeServiceTier,
        cacheTtl: activeCacheTtl,
        permissionMode: activePermissionMode,
        editorSelection:
          activeSelection && selectionIncluded ? activeSelection : null,
        selectionIncluded: Boolean(activeSelection && selectionIncluded),
      };

      setTextValue("");
      setImages([]);
      void onSubmit?.(payload);
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
      disabled,
      effectiveSessionId,
      images,
      isSubmitting,
      onSubmit,
      selectionIncluded,
      setTextValue,
      storeProjectPath,
      textValue,
    ],
  );

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
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const target =
          slashCatalog.commands[slashIndex] ?? slashCatalog.commands[0];
        if (target) handleSelectSlashCommand(target);
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

  const effectivePlaceholder = React.useMemo(() => {
    if (placeholder) return placeholder;
    if (activePermissionMode === "plan") {
      return "Describe your task to generate a plan... (@ files, / commands)";
    }
    return "Message RayuCode... (@ files, / commands)";
  }, [activePermissionMode, placeholder]);

  const contextUsedPercent = Math.round(
    contextQuery.data?.usedPercent ?? 17,
  );
  const hasPromptContent = textValue.trim().length > 0 || images.length > 0;
  const branchList = branchesQuery.data?.branches ?? [
    activeCheckout,
    "main",
    "feat/kv-cache",
  ];

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
              activeIndex={slashIndex}
              onActiveIndexChange={setSlashIndex}
              onSelectCommand={handleSelectSlashCommand}
              onClose={() => setPopupDismissedForText(textValue)}
            />
          </div>
        ) : null}

        {/* Outer Machined Tray (.composer-shell: bg-shell border-hairline rounded-2xl shadow-composer) */}
        <div
          data-testid="composer-outer-tray"
          className="rounded-2xl border border-hairline bg-shell p-1.5 shadow-composer"
        >
          {/* Home Top Tray: Workspace Picker & Git Branch Checkout (only in mode === "home") */}
          {mode === "home" ? (
            <div
              data-testid="composer-home-top-tray"
              className="flex items-center justify-between gap-2 px-2 pt-0.5 pb-1.5 text-xs text-muted-ink"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <Popover
                  open={workspacePickerOpen}
                  onOpenChange={setWorkspacePickerOpen}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="composer-workspace-picker"
                      className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-2 py-1 text-xs font-medium text-ink transition-colors hover:border-hairline hover:bg-hover focus:outline-none"
                    >
                      <ProjectIconGlyph
                        {...toProjectIconSpec(activeWorkspace?.icon)}
                        className="size-3.5 shrink-0"
                      />
                      <span className="truncate">{activeProject}</span>
                      <ChevronDown
                        className="size-3 shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    className="w-[240px] rounded-xl border border-premium-hi bg-popover-solid p-1.5 shadow-popover"
                  >
                    <div className="px-2 py-1 text-[11px] font-medium text-muted-ink">
                      Workspace folders
                    </div>
                    {workspaces.map((ws) => {
                      const isCurrent = ws.name === activeProject;
                      return (
                        <button
                          key={ws.path}
                          type="button"
                          onClick={() => handleWorkspaceSelect(ws.name, ws.path)}
                          className={cn(
                            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-hover",
                            isCurrent && "bg-active text-ink",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <ProjectIconGlyph
                              {...toProjectIconSpec(ws.icon)}
                              className="size-3.5 shrink-0"
                            />
                            <span className="truncate font-medium text-ink">
                              {ws.name}
                            </span>
                          </span>
                          {isCurrent ? (
                            <Check
                              className="size-3.5 shrink-0 text-ink"
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>

                <Popover
                  open={branchPickerOpen}
                  onOpenChange={setBranchPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      data-testid="composer-branch-picker"
                      className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-lg border border-transparent px-2 py-1 font-mono text-[11px] text-muted-ink transition-colors hover:border-hairline hover:bg-hover hover:text-ink focus:outline-none"
                    >
                      <GitBranch
                        className="size-3 shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                      <span className="truncate">{activeCheckout}</span>
                      <ChevronDown
                        className="size-3 shrink-0 text-muted-ink"
                        aria-hidden="true"
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    className="w-[210px] rounded-xl border border-premium-hi bg-popover-solid p-1.5 shadow-popover"
                  >
                    <div className="px-2 py-1 text-[11px] font-medium text-muted-ink">
                      Switch git branch
                    </div>
                    {branchList.map((branch) => {
                      const isCurrent = branch === activeCheckout;
                      return (
                        <button
                          key={branch}
                          type="button"
                          onClick={() => handleBranchSelect(branch)}
                          className={cn(
                            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-xs transition-colors hover:bg-hover",
                            isCurrent && "bg-active text-ink",
                          )}
                        >
                          <span className="truncate">{branch}</span>
                          {isCurrent ? (
                            <Check
                              className="size-3.5 shrink-0 text-ink"
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          ) : null}

          {/* Inner Surface (.composer-inner: bg-raised border-hairline rounded-[14px], ZERO focus glow ring) */}
          <div
            data-testid="composer-inner-surface"
            className="flex flex-col rounded-[14px] border border-hairline bg-raised transition-colors focus-within:border-premium-hi"
          >
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

            {/* Bottom Control Bar: Left (ModelEffortPopover + PermissionPopover), Right (VoiceMic + Context Gauge + Send/Stop) */}
            <div className="flex items-center justify-between gap-1.5 px-2.5 pt-1 pb-2">
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <ModelEffortPopover
                  modelId={activeModelId}
                  modelLabel={activeModelLabel}
                  effort={activeEffort}
                  serviceTier={activeServiceTier}
                  cacheTtl={activeCacheTtl}
                  sessionId={effectiveSessionId}
                  models={catalog.models}
                  onSelectModel={handleModelSelect}
                  onSelectEffort={handleEffortSelect}
                  onSelectServiceTier={handleServiceTierSelect}
                  onSelectCacheTtl={handleCacheTtlSelect}
                  onRefreshModels={catalog.refreshModels}
                  isRefreshing={catalog.isRefreshing}
                  disabled={disabled}
                />

                <PermissionPopover
                  value={activePermissionMode}
                  onChange={handlePermissionSelect}
                  sessionId={effectiveSessionId}
                  enableShortcut={enablePermissionShortcut}
                  disabled={disabled}
                />
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <VoiceMicButton
                  disabled={disabled}
                  onTranscript={(transcript) =>
                    setTextValue(
                      textValue
                        ? `${textValue.trimEnd()} ${transcript}`
                        : transcript,
                    )
                  }
                />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-testid="composer-context-gauge"
                      onClick={() => openRightTab("overview")}
                      aria-label={`Context usage ${contextUsedPercent}%`}
                      className="cursor-pointer rounded-full border border-transparent px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-ink tabular-nums transition-colors hover:border-hairline hover:bg-hover hover:text-ink focus:outline-none @max-[340px]/composer:hidden"
                    >
                      {contextUsedPercent}%
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Context window: {contextUsedPercent}% used (click to inspect)
                  </TooltipContent>
                </Tooltip>

                {isSubmitting && !hasPromptContent ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        data-testid="composer-stop-btn"
                        aria-label="Abort active turn"
                        onClick={() => onStop?.()}
                        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-premium bg-active text-ink shadow-bevel-surface transition-colors hover:border-danger hover:bg-danger-soft hover:text-danger focus:outline-none"
                      >
                        <Square
                          className="size-3.5 fill-current"
                          aria-hidden="true"
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Stop / Abort</TooltipContent>
                  </Tooltip>
                ) : isSubmitting && hasPromptContent ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        data-testid="composer-steer-btn"
                        aria-label="Steer active turn"
                        onClick={() => triggerSubmit(false)}
                        className="rayu-primary-bevel grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-brand-ink transition-transform hover:bg-brand-bright active:scale-95 focus:outline-none"
                      >
                        <CornerDownLeft
                          className="size-4"
                          strokeWidth={2.2}
                          aria-hidden="true"
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Queue / Steer active turn (Alt+Enter for urgent)
                    </TooltipContent>
                  </Tooltip>
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
                          "grid size-8 shrink-0 place-items-center rounded-full transition-all focus:outline-none",
                          hasPromptContent && !disabled
                            ? "rayu-primary-bevel cursor-pointer bg-brand text-brand-ink hover:bg-brand-bright active:scale-95"
                            : "cursor-not-allowed border border-hairline bg-control text-faint opacity-60",
                        )}
                      >
                        <ArrowUp
                          className="size-4"
                          strokeWidth={2.25}
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
      </div>
  );
}

export { SessionComposer as FloatingComposer };
