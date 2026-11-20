/**
 * Shared Tailwind CSS preset for RayuCode Web (Next.js) and VS Code Extension.
 *
 * Maps `rc-*` Tailwind colour, font, and radius utilities directly to the
 * `--rc-*` CSS custom properties so the same utility classes render natively
 * under both Rayu Web dark/light themes and VS Code themes.
 */
export const rayucodeTailwindPreset = {
  theme: {
    extend: {
      colors: {
        rc: {
          bg: "var(--rc-bg)",
          surface: "var(--rc-surface)",
          elevated: "var(--rc-surface-elevated)",
          border: "var(--rc-border)",
          fg: "var(--rc-fg)",
          muted: "var(--rc-muted)",
          accent: "var(--rc-accent)",
          "accent-fg": "var(--rc-accent-fg)",
          danger: "var(--rc-danger)",
          warning: "var(--rc-warning)",
          focus: "var(--rc-focus)",
          code: "var(--rc-code-bg)",
        },
      },
      fontFamily: {
        "rc-sans": ["var(--rc-font-sans)"],
        "rc-mono": ["var(--rc-font-mono)"],
      },
      borderRadius: {
        "rc-sm": "var(--rc-radius-sm)",
        "rc-md": "var(--rc-radius-md)",
        "rc-lg": "var(--rc-radius-lg)",
      },
    },
  },
} as const;

export default rayucodeTailwindPreset;
