import type { PermissionDecision } from "@rayu-dev/rayucode-sdk/browser";
import type { PendingPermission } from "../state/sessionReducer.js";
import { ShieldIcon } from "./Icons.js";

export interface PermissionCardProps {
  permission: PendingPermission;
  onRespond: (requestId: string, decision: PermissionDecision) => void;
}

export function PermissionCard({ permission, onRespond }: PermissionCardProps) {
  return (
    <section
      className="rc-permission-card"
      role="alertdialog"
      aria-label={`Permission required for ${permission.toolName}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
        <ShieldIcon size={15} />
        <span>Approve tool: {permission.toolName}</span>
      </div>
      <p style={{ marginBlock: "6px", color: "var(--rc-muted)" }}>{permission.description}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button
          type="button"
          className="rc-btn rc-btn-primary"
          onClick={() => onRespond(permission.requestId, "allow")}
        >
          Allow once
        </button>
        <button
          type="button"
          className="rc-btn"
          onClick={() => onRespond(permission.requestId, "allow_always")}
        >
          Allow always
        </button>
        <button
          type="button"
          className="rc-btn rc-btn-danger"
          onClick={() => onRespond(permission.requestId, "deny")}
        >
          Deny
        </button>
      </div>
    </section>
  );
}
