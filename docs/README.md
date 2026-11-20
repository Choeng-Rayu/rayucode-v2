# rayu Docs

Reference documentation for the rayucode codebase.

## Layout

- `docs/*.md` — architecture, feature, and behavior docs (current state of the system).
- `docs/plans/` — forward-looking plans, roadmaps, and TODO trackers. May be partially implemented or stale.
- `docs/audits/` — point-in-time audits and reviews. Historical snapshots, not kept up to date.
- `docs/proposals/` — design proposals not yet committed to.
- `docs/dev/` — developer-facing process and testing notes.

## Key entry points

- **Multi-Product Ecosystem Overview**: [`MULTI_PRODUCT_ARCHITECTURE.md`](./MULTI_PRODUCT_ARCHITECTURE.md)
- **Per-Product Developer Guides**:
  - CLI & TUI (Rust + Ratatui): [`PRODUCT_CLI_DEV.md`](./PRODUCT_CLI_DEV.md)
  - Desktop App (Rust + Slint): [`PRODUCT_DESKTOP_DEV.md`](./PRODUCT_DESKTOP_DEV.md) & [`DESKTOP_AUTH_SDK.md`](./DESKTOP_AUTH_SDK.md)
  - VS Code Extension (React Webview + Host): [`PRODUCT_VSCODE_DEV.md`](./PRODUCT_VSCODE_DEV.md)
  - RayuCode Web (Next.js + React): [`PRODUCT_WEB_DEV.md`](./PRODUCT_WEB_DEV.md)
  - Shared Packages (`rayucode-sdk`, `@rayu-dev/rayucode-sdk`, `@rayu-dev/rayucode-ui`): [`SHARED_PACKAGES_DEV.md`](./SHARED_PACKAGES_DEV.md)
- Architecture: `SERVER_ARCHITECTURE.md`, `MODULAR_ARCHITECTURE_RFC.md`, `CRATE_OWNERSHIP_BOUNDARIES.md`, `CODEBASE_MAP.md`
- Swarm: `SWARM_ARCHITECTURE.md`
- Memory: `MEMORY_ARCHITECTURE.md`, `MEMORY_BUDGET.md`, `MEMORY_INCIDENT_RUNBOOK.md`
- Refactoring and quality: `REFACTORING.md`, `plans/CODE_QUALITY_10_10_PLAN.md`
- Providers: `PROVIDER_DOCTOR.md`, `AWS_BEDROCK_PROVIDER.md`
- MCP servers: `MCP_REMOTE.md`
- Platform: `WINDOWS.md`, `TERMINAL_CAPABILITIES.md`

## Conventions

- Docs describing current behavior live at the top level; anything speculative goes in `plans/` or `proposals/`.
- Prefer updating an existing doc over adding a near-duplicate.
- Root of the repo should only hold README, CONTRIBUTING, RELEASING, AGENTS, LICENSE, and similar meta files. Put everything else here.
