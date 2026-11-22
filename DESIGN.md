---
name: RayuCode Desktop
description: A calm mission-control desk for parallel coding agents — signature green on obsidian, alabaster in the light.
colors:
  emerald: "#10B981"
  mint: "#34D399"
  jade: "#059669"
  forest: "#047857"
  obsidian: "#0B0E0D"
  slate-charcoal: "#111614"
  raised-dark: "#161C19"
  inset-dark: "#0D1210"
  alabaster: "#FAFAFA"
  surface-light: "#FFFFFF"
  inset-light: "#F4F5F3"
  ink-dark: "#ECF2EE"
  secondary-dark: "#A8B5AD"
  meta-dark: "#8C9991"
  ink-light: "#17211C"
  secondary-light: "#4C5A52"
  meta-light: "#6E7B73"
  hairline-dark: "rgba(255, 255, 255, 0.08)"
  hairline-light: "rgba(17, 24, 20, 0.10)"
  danger-dark: "#F87171"
  warn-dark: "#FBBF24"
  info-dark: "#7DD3FC"
  danger-light: "#DC2626"
  warn-light: "#B45309"
  info-light: "#0369A1"
typography:
  title:
    fontFamily: "Inter, -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  pane-title:
    fontFamily: "Inter, -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.01em"
  dense:
    fontFamily: "Inter, -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.55
  label:
    fontFamily: "Inter, -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.06em"
  mono:
    fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "tabular-nums"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.emerald}"
    textColor: "#04120C"
    rounded: "{rounded.md}"
    padding: "7px 12px"
  button-primary-hover:
    backgroundColor: "{colors.mint}"
    textColor: "#04120C"
  button-primary-light:
    backgroundColor: "{colors.jade}"
    textColor: "#FFFFFF"
  button-secondary:
    backgroundColor: "{colors.raised-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
    padding: "7px 12px"
  chip-context:
    backgroundColor: "{colors.inset-dark}"
    textColor: "{colors.secondary-dark}"
    rounded: "{rounded.sm}"
    padding: "3px 6px 3px 8px"
  badge-live:
    backgroundColor: "rgba(16, 185, 129, 0.12)"
    textColor: "{colors.mint}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  card-diff:
    backgroundColor: "{colors.slate-charcoal}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
  composer:
    backgroundColor: "{colors.raised-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.lg}"
  send-button:
    backgroundColor: "{colors.emerald}"
    textColor: "#04120C"
    rounded: "{rounded.pill}"
    size: "34px"
---

# Design System: RayuCode Desktop

## Overview

**Creative North Star: "The Mission-Control Desk"**

RayuCode Desktop is one obsidian window where a developer supervises a swarm of coding agents. The interface is calm and dense like a well-kept editor: hairline seams divide panes, monospace carries every measurement, and green appears only where something is alive, selected, primary, or succeeded. Expression lives in precise details, never in decoration floods. The references (Antigravity, Claude, Devin, Qoder, Codex) set the craft bar for workflow ergonomics; the identity is RayuCode's own.

Dark is the default because the scene is a developer at a desk in long sessions, often at night; the light theme is crisp alabaster with rich jade for daylight rooms. Both themes share one token system (`prototype/css/tokens.css`); a view never invents its own palette.

**Key Characteristics:**
- Obsidian `#0B0E0D` / slate-charcoal `#111614` grounds; emerald `#10B981` / mint `#34D399` accents (light: alabaster `#FAFAFA`, jade `#059669` / forest `#047857`).
- Inter for UI, JetBrains Mono for code, data, and every numeral (tabular).
- Hairline 1px borders as the primary depth device; one soft-shadow voice for raised surfaces only.
- The session pulse: a breathing emerald dot ties rail, sidebar row, and stream header to the same live session; a flowing 2px live-thread tops the active stream.
- 150ms transitions on state changes; reduced-motion collapses all animation.

## Colors

One accent family (green) doing real jobs on a neutral obsidian/alabaster ground; state colors sit on top only where they carry meaning.

### Primary
- **Emerald** (`#10B981`): primary buttons, send action, active fills, success states, meters (dark theme).
- **Mint** (`#34D399`): live pulse, accent-as-text on dark, hover of primary fills, diff-add markers.
- **Jade** (`#059669`) / **Forest** (`#047857`): the same roles in the light theme (fill / text-and-hover).
- **Accent ink** (`#04120C` dark, `#FFFFFF` light): text on accent fills, never gray.

### Neutral
- **Obsidian** (`#0B0E0D`): window ground, title bar, rail. **Slate-charcoal** (`#111614`): panes, sidebar, cards. **Raised** (`#161C19`): composer, buttons, user bubbles. **Inset** (`#0D1210`): code wells, terminal, chips.
- **Alabaster** (`#FAFAFA`) / **White** (`#FFFFFF`) / **Inset light** (`#F4F5F3`): the same roles in light.
- **Ink** (`#ECF2EE` dark / `#17211C` light): primary text. **Secondary** (`#A8B5AD` / `#4C5A52`): body-support text. **Meta** (`#8C9991` / `#6E7B73`): tertiary labels, line numbers, code comments — AA on every surface it sits on.
- **Hairline** (`rgba(255,255,255,0.08)` dark / `rgba(17,24,20,0.10)` light): every pane seam and card border; strong variant at 0.14 / 0.18 for interactive borders.

### State
- **Danger** (`#F87171` / `#DC2626`): failures, deletions, reject. **Warn** (`#FBBF24` / `#B45309`): awaiting review, modified flags. **Info** (`#7DD3FC` / `#0369A1`): neutral notices. Each has a ~10% soft tint for badge backgrounds.

### Named Rules
**The Green Means Alive Rule.** Green marks state and action only: live sessions, selection, primary actions, success, diff additions. Never a decorative wash, never a gradient fill.
**The One Token System Rule.** Every view and both themes read from `tokens.css`; `[data-theme="light"]` overrides values, never structure.

## Typography

**UI Font:** Inter (variable, self-hosted woff2; falls back to SF Pro Text / Segoe UI)
**Mono Font:** JetBrains Mono (variable, self-hosted; falls back to SF Mono)

**Character:** A crisp humanist UI voice at dense sizes, paired with a sharp developer mono that carries every file path, duration, token count, and line number. Numerals are tabular everywhere data appears.

### Hierarchy
- **Title** (600, 20px/1.25, -0.02em): settings section headings.
- **Pane title** (600, 16px/1.25, -0.02em): one h1 per view in the pane head.
- **Body** (400, 14px/1.55, -0.01em): agent prose, max 72ch.
- **Dense** (500, 13px): rows, buttons, tree, tool steps.
- **Label** (600, 11px, +0.06em, uppercase): inspector section titles, sidebar group labels.
- **Mono** (400, 12px/1.6): code, diffs, terminal, metadata; 13px in the code viewer.

### Named Rules
**The Mono Measures Rule.** Monospace is for code, data, and measurement only, never as a "technical" costume for prose.

## Layout

Desktop window frame: 44px title bar (traffic lights, brand, breadcrumbs, actions), body grid of 56px icon rail + 264px session sidebar + fluid main (`minmax(0,1fr)`), 28px status bar. The main pane splits into a fluid stream column (max 860px, centered) and a 340px inspector. Spacing rhythm is a 4px base scale (4/8/12/16/20/24/32/40/48); dense rows share the 4px step deliberately, like an editor. Below 1180px the inspector hides; below 900px the sidebar hides, the frame becomes a scrolling document, and the composer sits in flow after the stream.

## Elevation & Depth

Hairline borders and tonal layering carry depth at rest; shadows are one voice, offset plus soft blur, reserved for the composer and raised cards. Focus is a 3px emerald ring (`--focus-glow`), the brief's sanctioned focus glow. Selection is a tint plus a full inset 1px ring, never a one-sided bar.

### Shadow Vocabulary
- **shadow-1** (`0 1px 2px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.25)` dark; `0 1px 2px rgba(23,33,28,0.06), 0 4px 12px rgba(23,33,28,0.06)` light): composer at rest.
- **shadow-2** (`0 2px 6px …, 0 12px 32px …`): reserved for future overlays; no view uses it at rest.

### Named Rules
**The Seam Rule.** Declare elevation once per surface: a hairline border or a shadow, never a border under a wide soft shadow.

## Shapes

Radii: 6px for small controls and chips, 10px for cards, buttons and rows, 14px for the composer and user bubbles, full pill for badges, dots and the circular 34px send button. Cards are flat rectangles with 1px hairlines; no nested cards. Icons are one authored SVG sprite (`assets/icons.svg`), 1.75px stroke, round caps, 16px default.

## Components

### Buttons
- **Shape:** 10px radius; small variant 6px.
- **Primary:** emerald fill, accent-ink text, 600 weight; hover brightens to mint (forest in light).
- **Secondary:** raised background + hairline; hover strengthens the border. **Ghost:** transparent, secondary text. **Danger-ghost:** danger text, danger tint on hover.
- **Focus:** 3px emerald ring on every interactive element.

### Composer (signature)
Raised 14px card with strong hairline; focus-within shifts the border to emerald and adds the ring. Context chips row on top (mono file chips with remove buttons), textarea, then a bar: Plan/Build/Autonomous segmented toggle (pressed = emerald tint + accent text), model pill (mono name + tier), mic, circular emerald send. Send appends the typed message; empty send focuses the input and shows a transient "Nothing to send yet" hint.

### Diff card
Header: mono file path, +N/−N stat in accent/danger. Body: inset well, mono 12px/1.6, line numbers in meta, add rows on emerald tint with mint `+`, delete rows on danger tint. Footer: hint + Reject (danger ghost) / Accept (primary); accepting swaps the footer to "Accepted · staged for commit" with Undo.

### Reasoning block
Collapsible pane card: brain icon, "Reasoned for Ns · N steps", rotating chevron; body is an ordered list of steps in secondary text.

### Tool timeline / task steps
Row per call: 22px icon tile (done = emerald tint, fail = danger tint), name + mono argument, right-aligned mono duration. Runner task steps use 24px state circles with the same vocabulary.

### Session pulse (signature)
8px dot: live = mint with a 2.4s breathing ring, done = emerald, waiting = warn, failed = danger. The same dot appears in the sidebar row, pane head, and status bar for one session. A 2px flowing emerald thread runs under the active pane head.

### Terminal
Inset well inside a pane card; tab strip (agent/shell) with mono tabs; output in mono 12px with prompt in accent, dim metadata, ok/warn/err state colors, blinking block caret.

### Settings controls
Switch: 36×20 pill, emerald when checked. Select: raised, hairline, custom chevron. Routing table: hairline rows, uppercase label headers, mono model and latency columns. Theme cards: miniature palette previews with a full emerald ring when pressed.

## Do's and Don'ts

### Do:
- **Do** keep green ≤ the state-and-action vocabulary; a screen where green decorates has lost the signature.
- **Do** set every numeral in JetBrains Mono with tabular figures.
- **Do** hold body and meta text ≥ 4.5:1 on its actual surface in both themes (meta is `#8C9991` on dark for exactly this reason).
- **Do** use the full inset ring + tint for selection, in rail and sidebar alike.
- **Do** label synthetic demonstration data ("Prototype · synthetic demo data" in the status bar; latency figures marked illustrative).

### Don't:
- **Don't** use one-sided border bars, gradient text, glow halos as decoration, or hard offset shadows.
- **Don't** nest cards or wrap a pane in another card; panes are seams, cards are content.
- **Don't** use emoji or unicode glyphs as icons; extend `assets/icons.svg` in the same 1.75px stroke.
- **Don't** invent prices, benchmarks, or customer claims; the routing table's latencies are explicitly illustrative.
- **Don't** pick a theme by category: dark is the pinned default, light is a first-class equal, both from the same tokens.