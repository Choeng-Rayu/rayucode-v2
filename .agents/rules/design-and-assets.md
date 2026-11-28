---
trigger: always_on
---

# RayuCode Shared Design, Tokens & Engine-Split Rule

1. **Repository Boundary:** `rayucode-v2` owns the shared Rust engine (`crates/`, `src/`), CLI/TUI, `sdk/typescript`, `packages/*`, and the golden visual specs (`DESIGN.md`, `prototype/`). Both RayuCode Desktop and RayuCode for VS Code (`vscode/`) live exclusively in `Choeng-Rayu/rayucode-app` — never recreate duplicate `desktop/` or `vscode/` apps inside `rayucode-v2`.
2. **Source of Truth:** Always read `DESIGN.md` before touching shared UI tokens or components. Visually match `prototype/` 1:1.
3. **Strict Styling Ban:** Never introduce raw hex colors (`#...`), arbitrary Tailwind color values (`bg-[#...]`), default shadcn zinc/slate classes, or UI emojis in TSX.
4. **Verification Gate:** Run the relevant workspace verification (`npm run check:ts` and `npm run test:release-scripts`) before committing.
