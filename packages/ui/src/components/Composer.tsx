import { useMemo, useState, type KeyboardEvent } from "react";
import { SendIcon, StopIcon } from "./Icons.js";

export interface SlashCommandItem {
  command: string;
  description: string;
}

export const DEFAULT_SLASH_COMMANDS: readonly SlashCommandItem[] = [
  { command: "/model", description: "Switch active model or provider" },
  { command: "/clear", description: "Clear conversation transcript" },
  { command: "/compact", description: "Compact session context" },
  { command: "/new", description: "Start a new session" },
  { command: "/settings", description: "Open RayuCode settings" },
];

export interface ComposerProps {
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  slashCommands?: readonly SlashCommandItem[];
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onSlashCommand?: (command: string) => void;
}

export function Composer({
  isStreaming,
  disabled,
  placeholder = "Ask RayuCode anything... (Enter to send, Shift+Enter for newline)",
  slashCommands = DEFAULT_SLASH_COMMANDS,
  onSubmit,
  onCancel,
  onSlashCommand,
}: ComposerProps) {
  const [value, setValue] = useState("");

  const matchingCommands = useMemo(() => {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("/") || trimmed.includes(" ")) return [];
    const needle = trimmed.toLowerCase();
    return slashCommands.filter((item) => item.command.toLowerCase().startsWith(needle));
  }, [value, slashCommands]);

  const submitCurrent = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    if (trimmed.startsWith("/") && onSlashCommand) {
      const exact = slashCommands.find((c) => c.command === trimmed);
      if (exact) {
        onSlashCommand(exact.command);
        setValue("");
        return;
      }
    }
    onSubmit(trimmed);
    setValue("");
  };

  const handleKeyDown = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      submitCurrent();
    }
  };

  return (
    <div className="rc-composer">
      {matchingCommands.length > 0 ? (
        <div
          role="menu"
          aria-label="Slash commands"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
          }}
        >
          {matchingCommands.map((item) => (
            <button
              key={item.command}
              type="button"
              role="menuitem"
              className="rc-btn"
              onClick={() => {
                if (onSlashCommand) {
                  onSlashCommand(item.command);
                  setValue("");
                } else {
                  setValue(`${item.command} `);
                }
              }}
            >
              <code>{item.command}</code>
              <span style={{ color: "var(--rc-muted)", fontSize: "var(--rc-font-size-xs)" }}>
                {item.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        className="rc-composer-input"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Chat prompt"
        onChange={(ev) => setValue(ev.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <span style={{ fontSize: "var(--rc-font-size-xs)", color: "var(--rc-muted)" }}>
          Type <code>/</code> for commands
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          {isStreaming ? (
            <button type="button" className="rc-btn rc-btn-danger" onClick={onCancel}>
              <StopIcon size={14} />
              Stop
            </button>
          ) : null}
          <button
            type="button"
            className="rc-btn rc-btn-primary"
            disabled={disabled || !value.trim()}
            onClick={submitCurrent}
          >
            <SendIcon size={14} />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
