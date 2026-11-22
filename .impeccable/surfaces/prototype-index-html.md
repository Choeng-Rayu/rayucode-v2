---
version: 1
slug: "prototype-index-html"
primary_target: "prototype/index.html"
related_targets: ["prototype/pages/agent-workspace.html","prototype/pages/codebase-context.html","prototype/pages/execution-runner.html","prototype/pages/settings-models.html"]
---

# Surface brief: RayuCode desktop prototype

Scope: `rayucode-v2/prototype/` (index.html + pages/agent-workspace.html, pages/codebase-context.html, pages/execution-runner.html, pages/settings-models.html). Visitor mode: Operate. Desktop-window HTML/CSS prototype of the RayuCode desktop workspace; audience is a developer supervising parallel agent sessions. Code-led build (Operate surface; no image generation in this harness).

Audience job: watch many agents work, read reasoning and diffs, manage context, watch execution, route models. Proof: full-fidelity synthetic developer data (Rust/TS code, git diffs, terminal logs), labeled synthetic in the UI footer/status. Constraints: pinned brief in PRODUCT.md Brand Commitments (obsidian/emerald dark default, alabaster/jade light, Inter/Geist + JetBrains Mono, hairlines, 150ms, vanilla JS only for theme + tabs/collapsibles). References (craft bar only): ../desktop-inspration/*.png.

Unresolved: whether the purple/blue legacy fox mark gets a green redraw (brief pins green as signature; prototype uses an authored green geometric mark, legacy PNG kept in assets untouched).

## Direction contract

THESIS: A calm mission-control desk for a swarm of coding agents: one obsidian shell where every session's pulse is a green thread, refusing the category default of a single empty chat column with a centered greeting.

OWN-WORLD: Obsidian `#0B0E0D`/`#111614` grounds, emerald `#10B981`/`#34D399` state-and-action accent, hairline `rgba(255,255,255,.08)` seams, Inter UI + JetBrains Mono data, tabular numerals, 10-14px radii, one elevation voice. Light: `#FAFAFA`/`#FFFFFF` with jade `#059669`/`#047857`. Green appears only where something is alive, selected, primary, or succeeded.

STORY: The developer opens the shell, sees three live agent sessions with state at a glance, clicks into the agent workspace, expands a reasoning block, reviews a diff hunk, approves it; navigation rail carries them to context, runner, and settings without losing the session. Every nav item works; theme flips both ways.

FIRST VIEWPORT: 1440x900 desktop window. 56px icon navigation rail far left (green active pip); 264px session sidebar (project header, New session, three session rows with live-state dots and mono metadata); main pane = active agent stream (user prompt, collapsed reasoning block, tool-call timeline card, inline diff card with +/- lines and Accept/Reject actions) with the anchored composer at the bottom: context chips, textarea, Plan/Build/Autonomous segmented toggle, model pill, circular green send button at bottom right.

FORM: pinned whole by the user brief; seed: none (pinned). Pin quote: "Deep obsidian/slate-charcoal surfaces (#0B0E0D / #111614) paired with luminous emerald/mint accents (#10B981 / #34D399) ... Antigravity-inspired command/chat composer ... collapsible reasoning/thought blocks, clean tool-execution timelines ... high-readability inline diff cards". Signature move: the session pulse — a breathing emerald dot that ties rail, sidebar row, and stream header to the same live session, plus the flowing live-thread atop the active stream. (Adaptation: the planned 2px side stripe on selected rows became a full inset ring + tint; the craft floor bans one-sided bars.)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
