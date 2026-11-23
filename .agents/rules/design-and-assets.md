---
trigger: always_on
---

# RayuCode Desktop Design, Tokens & Autonomous Swarm Verification Rule

1. **Source of Truth:** Always read `DESIGN.md` and `desktop/src/styles/globals.css` before touching any UI file. Visually match `prototype/` 1:1.
2. **Pre-Flight Check:** Run `node desktop/scripts/check-shadcn.mjs check <names...> --json` before coding. Reuse `desktop/src/components/ui/*` primitives restyled with `globals.css` semantic tokens.
3. **Strict Styling Ban:** Never introduce raw hex colors (`#...`), arbitrary Tailwind color values (`bg-[#...]`), default shadcn zinc/slate classes, UI emojis, composer file chips, composer focus glow rings, or folder trees in v1.
4. **Feature Isolation:** Only import another feature through its `@/features/<name>` public barrel. Wrap every route/panel in `<SectionErrorBoundary>` and `<Suspense>` with a layout-matched skeleton.
5. **Mandatory Definition of Done:**
   - Run `cd desktop && pnpm verify` (`typecheck`, `lint`, `lint:design`, `test`, `build`) — must pass with 0 errors.
   - Render owned route(s) at `1440×934` (Dark Rayu Green, Dark Ocean Blue, Light) into `.swarm-logs/verify/<task-id>-*.png` and compare against `prototype/`.
   - Commit ONLY owned files (`feat(desktop): ...`) and report changed files, `pnpm verify` status, and verification screenshot paths.
