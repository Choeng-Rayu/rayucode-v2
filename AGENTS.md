# Repository Guidelines

## Repository Scope

- The Rust CLI/daemon (`crates/`) is the single coding engine shared across CLI, VS Code (`vscode/`), and RayuCode Desktop (`desktop/`).
- `prototype/` is the frozen HTML/CSS visual golden baseline for RayuCode Desktop, codified in root `DESIGN.md`.

## RayuCode Desktop UI Rules (`desktop/`)

Every coordinator, sub-agent, and swarm worker touching `desktop/` MUST follow these binding rules:

1. **Read Authority Files First:** Before writing any UI code, read `DESIGN.md`, `desktop/src/styles/globals.css`, and the matching `prototype/*.html` reference file.
2. **Single-Source Tailwind v4 Styling ("Change Once, Change Everywhere"):**
   - All theme/accent colors, borders, specular bevels, and surfaces MUST come from semantic tokens in `desktop/src/styles/globals.css` (`bg-chrome`, `bg-canvas`, `bg-pane`, `bg-raised`, `bg-inset`, `bg-active`, `text-ink`, `text-body`, `text-muted`, `text-accent`, `border-hairline`, `border-premium`).
   - Raw hex literals (`#...`), arbitrary Tailwind color classes (`bg-[#...]`), default shadcn zinc/slate classes, and UI emojis in TSX are forbidden and fail `pnpm lint:design`.
3. **Mandatory Pre-Flight shadcn/ui Check:**
   - Run `node desktop/scripts/check-shadcn.mjs check <names...> --json` BEFORE building UI.
   - Reuse installed Radix/shadcn primitives from `desktop/src/components/ui/*` (restyled with `globals.css` tokens) or install missing ones via `node desktop/scripts/check-shadcn.mjs ensure <names...>`.
4. **Feature-Sliced Encapsulation & React 19 Patterns:**
   - Business domains live strictly in `desktop/src/features/<name>/` (`__tests__/`, `api/`, `components/`, `constants/`, `hooks/`, `schemas/`, `types/`, `index.ts`).
   - Never deep-import another feature's internals — import ONLY from `@/features/<name>` barrel exports (enforced by ESLint `no-restricted-imports`).
   - Heavy libraries (`@xterm/xterm`, `shiki`) must stay inside their owning feature and be lazy-loaded via `React.lazy` + `<Suspense>` with zero-CLS skeletons and `<SectionErrorBoundary>`.
   - Use React 19 `ref`-as-prop (no `React.forwardRef`), TanStack Query v5 `queryOptions()` factories + hover prefetching, `Zod` validation, and `createStreamBatcher()` (`16–33ms` rAF batching) for live Rust daemon events.
5. **Standard Agent Commands (`cd desktop`):**
   - Pre-flight UI check: `node scripts/check-shadcn.mjs check <names...> --json`
   - Typecheck gate: `pnpm typecheck` (0 errors)
   - Lint gate: `pnpm lint` (ESLint 9 architectural + React Hooks rules, 0 errors)
   - Design token gate: `pnpm lint:design` (0 raw hex, 0 `bg-[#...]`, 0 emojis)
   - Unit test gate: `pnpm test` (Vitest)
   - Build gate: `pnpm build` (Vite renderer + Electron main/preload)
   - Full mandatory gate: `pnpm verify` (`typecheck && lint && lint:design && test && build`)
6. **Autonomous Swarm Protocol & Closed-Loop Screen Verification:**
   - Delegate with explicit Task & Goal, Owned Files, Target `prototype/` reference, and Verification Route(s).
   - Execute autonomously end-to-end without pausing for minor questions when the answer is in `DESIGN.md`, `docs/superpowers/specs/2026-11-23-rayucode-desktop-design.md`, or `prototype/`.
   - **Mandatory Screen Verification:** Before finishing, render owned views at `1440×934` in Dark (Rayu Green), Dark (Ocean Blue), and Light modes into `.swarm-logs/verify/<task-id>-*.png`, visually compare against `prototype/`, fix any discrepancy, and include screenshot paths + `pnpm verify` output in the completion report.
   - Commit ONLY owned files with conventional commits (`feat(desktop): ...`) on your scoped branch (`swarm/<task-id>`) and open a PR to `main` once CI passes.

## TUI style

- UI chrome must not wrap: startup headers, account rows, status labels, and
  other compact UI rows should fit their available terminal-cell width or
  truncate with an ellipsis. Count Unicode display cells, not characters.
  Preserve one logical row per visual row, including at narrow widths.
  Chat prose and other intentionally multiline content may wrap normally.
- Reuse the info widget's limit-bar renderer for usage indicators instead of
  introducing a different bar glyph, color, or used/remaining convention.

## Development Workflow

- **Commit and push as you go** - Make small, scoped commits and push them to
  the current branch's remote as meaningful work is completed, rather than
  waiting until the end of the task. Preserve unrelated changes and never
  force-push unless the user explicitly authorizes it.
- **Use the user's Git identity** - Create commits with the configured
  `user.name` and `user.email`. Do not override them with `Rayu`, `RayuCode`, `Rayu agent`,
  or a fabricated agent email. Preserve existing contributor attribution when
  integrating work. If no identity is configured, ask rather than inventing one.
- **Welcome pull requests from everyone** - Review contributions on their merits,
  regardless of whether the author is a maintainer, an existing contributor, a
  first-time contributor, or an agent. Good PRs can be merged directly after review
  and validation. Do not require a maintainer-authored rewrite merely because of
  who submitted the change. See `CONTRIBUTING.md` for the contribution policy.
- **Prefer master/main** - Work directly on the repository's primary branch
  (`master` or `main`) by default. Do not create a branch or worktree merely to
  start a task. Only do so when the user explicitly requests it or isolation is
  genuinely necessary, and explain the concrete reason first.
- **Keep work scoped** - Preserve unrelated work. If already on a branch with
  ongoing changes, finish and integrate safely rather than switching blindly.
  When the user asks you to review or integrate a PR or branch, you may inspect,
  test, and integrate that contribution regardless of author status. Do not pull
  in unrelated branches or merge a PR without user authorization.

## Provider model discovery

- Model arrays are offline fallbacks, not release allowlists. Providers with a
  catalog must discover new model IDs without a RayuCode release and expose them
  through switching lists and structured model routes.
- Implement both cached prefetch and explicit refresh. Explicit refresh must
  bypass fresh caches. Preserve the last good catalog on network, authentication,
  or malformed-response failures, and scope persistent caches to their endpoint.
- Wire new providers into the shared refresh fanout and model-update publication,
  including long-lived sessions, not only startup or login.
- Regression tests must discover an arbitrary future model absent from all
  fallback arrays, using the provider's actual response schema. Check picker
  routes, forced refresh with a fresh cache, and last-good behavior on failure.
- If a backend has no discovery API, document that limitation instead of
  presenting a hardcoded list or a no-op refresh as live discovery.

## Install Notes
- `~/.local/bin/rayu` is the launcher symlink used from `PATH`.
- `~/.rayu/builds/current/rayu` is the active local/source-build channel; self-dev builds and `scripts/install_release.sh` point the launcher here.
- `~/.rayu/builds/stable/rayu` is the stable release channel; `scripts/install.sh` installs this and points the launcher here.
- `~/.rayu/builds/versions/<version>/rayu` stores immutable binaries.
- `~/.rayu/builds/canary/rayu` still exists for canary/testing flows, but it is not the primary self-dev install path.
- On Windows, the equivalents are `%LOCALAPPDATA%\\rayu\\bin\\rayu.exe` for the launcher, `%LOCALAPPDATA%\\rayu\\builds\\stable\\rayu.exe` for stable, and `%LOCALAPPDATA%\\rayu\\builds\\versions\\<version>\\rayu.exe` for immutable installs; `scripts/install.ps1` currently installs the stable channel.
- Ensure `~/.local/bin` is **before** `~/.cargo/bin` in `PATH`.

## Verifying a change at runtime

`cargo build` alone proves nothing about behavior. `rayu run` and interactive
sessions are served by the long-lived daemon at
`~/.rayu/builds/shared-server/rayu`, which is a symlink into
`~/.rayu/builds/versions/<version>/`. Until that symlink is repointed and the
daemon restarted (`rayu self-dev --build`), a freshly built binary is inert and
every runtime check silently measures the old code.

To test a change without disturbing the shared daemon or the caller's session,
run your build against its own socket:

```bash
cargo build --profile selfdev
./target/selfdev/rayu run --no-update --socket /run/user/1000/rayu-mytest.sock '<prompt>'
```

Two things that waste time otherwise:

- `crate::logging::info` writes to a log file, not stderr, so instrumenting a
  code path with it produces no visible output under `--trace`. Use `eprintln!`
  for throwaway diagnostics and delete it before committing.
- Confirm which binary you are actually inspecting. `strings` on
  `builds/shared-server/rayu` reads a 70-byte symlink, not a program; resolve it
  with `readlink -f` first.
