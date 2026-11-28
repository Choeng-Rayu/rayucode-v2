---
trigger: always_on
---

# RayuCode Shared Design, Tokens & Engine-Split Rule

1. **Repository Boundary:** `rayucode-v2` owns the shared Rust engine (`crates/`, `src/`), CLI/TUI, `sdk/typescript`, `packages/*`, `vscode/`, and the golden visual specs (`DESIGN.md`, `prototype/`). RayuCode Desktop lives exclusively in `Choeng-Rayu/rayucode-app` — never recreate a duplicate `desktop/` app inside `rayucode-v2`.
2. **Source of Truth:** Always read `DESIGN.md` (and `vscode/VSCODE_DESIGN.md` for VS Code) before touching UI tokens or components. Visually match `prototype/` 1:1.
3. **Strict Styling Ban:** Never introduce raw hex colors (`#...`), arbitrary Tailwind color values (`bg-[#...]`), default shadcn zinc/slate classes, or UI emojis in TSX.
4. **Verification Gate:** Run the relevant workspace verification (`npm run check:ts`, `npm run test:release-scripts`, and/or `npm test --workspace @rayu-dev/rayucode-vscode` + `npm run lint:design --workspace @rayu-dev/rayucode-vscode`) before committing.
