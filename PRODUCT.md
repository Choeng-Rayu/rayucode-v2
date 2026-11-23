# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing Rust CLI/TUI codebase (`rayucode-v2`) with a TypeScript/React workspace (SDK, shared UI, VS Code extension). The desktop UI prototype in `prototype/` is pinned by the user's brief: pure HTML5 + modular variable-driven CSS, minimal vanilla JS strictly for the dark/light theme switcher and basic tab/collapsible states.

## Users

Developers who run RayuCode as their AI coding agent. The desktop prototype targets the same developer using a flagship desktop workspace: supervising one or many parallel agent sessions, reviewing diffs, managing codebase context, watching execution, and configuring models. (Inferred from README positioning and the user's desktop brief; not separately interviewed.)

## Product Purpose

RayuCode is a high-performance AI coding agent: "Run dozens of agents in parallel without melting your machine. More agents, less RAM, no lag." The desktop prototype architects the premium desktop workspace experience before production application logic is built. Success for the prototype: it looks and clicks like a shipping desktop app for rayucode.com.

## Positioning

Parallel-agent throughput at low resource cost (Rust core), sold with a hosted plan through rayucode.com. The desktop surface must make agent supervision (reasoning, tool calls, diffs, execution) legible and calm, not chaotic.

## Operating Context

Desktop window usage at developer-desk sizes, long sessions, both dark and light environments; dark theme is the default per the brief. The product family: CLI + VS Code extension (this repo), rayu-backend + rayu-gateway-rust (billing/AI routing), rayu-web (site/dashboard), Rayu Studio (separate). Desktop inspiration references live in `../desktop-inspration/` (Antigravity, Claude, Devin, Qoder, Codex screenshots): they set the craft bar and workflow ergonomics, not the identity.

## Capabilities and Constraints

- Prototype views pinned by the brief: workspace shell (index), agent workspace (chat stream, reasoning blocks, live diff review), codebase context (file tree, context pills, code viewer), execution runner (terminal, task steps, tool logs), settings/models (model routing, autonomy modes, theme).
- Composer must carry: inline file/context chips, model selector pill, mode toggles (Plan / Build / Autonomous), green primary send action.
- All views linked through a persistent navigation rail; realistic developer mock data (TypeScript/Rust snippets, git diffs, terminal output, agent reasoning) labeled as demonstration data.
- 150ms transitions, hairline 1px borders, subtle backdrop blur, tabular numerals.
- Product name and repo facts come from README/AGENTS.md; no invented prices, benchmarks, or customer claims.

## Brand Commitments

Pinned by the user's brief (binding):
- Name: RayuCode (rayucode.com). Green is the unmistakable brand signature: refined, intentional, high-contrast, never oversaturated.
- Dark theme (default): deep obsidian/slate-charcoal surfaces `#0B0E0D` / `#111614`, luminous emerald/mint accents `#10B981` / `#34D399`, hairline borders `rgba(255,255,255,0.08)`, subtle emerald focus glows.
- Light theme: alabaster/warm-stone surfaces `#FAFAFA` / `#FFFFFF`, rich forest/jade accents `#059669` / `#047857`, clean hairline dividers, soft ambient shadows.
- Typography: crisp geometric/humanist UI sans (Inter / Geist) paired with developer monospace (JetBrains Mono / Geist Mono), tight tabular numerals.
- Benchmark craft: Antigravity, Claude, Devin, Qoder. Synthesize their ergonomics into a signature RayuCode language; do not clone.
- Existing logo asset: `assets/brand/rayucode-mark.png`.

## Evidence on Hand

- Real brand mark: `assets/brand/rayucode-mark.png`.
- Reference screenshots: `../desktop-inspration/{atigravity,claude,devin,qoder,codex}.png`.
- Real product facts: README (installation commands, release badges), AGENTS.md (service map, TUI conventions).
- No real desktop screenshots, testimonials, or benchmarks exist; all session/diff/terminal content in the prototype is synthetic demonstration data and must not be presented as real usage.

## Product Principles

- Calm supervision: agent activity is legible at a glance; density serves scanning, expression stays in precise details (Operate surface).
- Green marks state and action (active session, primary action, success), never decoration floods.
- One token system across every view and both themes; a view never invents its own palette.
- The prototype demonstrates the mechanism (parallel agents, reasoning, diffs, execution) with full-fidelity synthetic data, never empty chrome.

## Accessibility & Inclusion

WCAG AA contrast for body text and text on accent in both themes (agent-derived floor, consistent with the family's rayu-web standard). Keyboard-focusable controls with visible focus states; reduced-motion respected.