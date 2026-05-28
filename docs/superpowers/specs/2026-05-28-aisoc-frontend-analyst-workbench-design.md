# AISOC Frontend Analyst Workbench Design

## Context

AISOC frontend already has:
- authenticated shell and module routing (`/overview`, `/chat`, `/sessions`, `/cron`, `/skills`, `/memory`)
- cyber-themed visual baseline led by Overview page
- connected backend APIs and PTY/WS chain for Chat

Current gap:
- non-overview pages still vary in layout grammar and information hierarchy
- operations workflow is fragmented across pages
- modal/layer interactions need stricter global rules

This spec defines a desktop-first, unified "Analyst Workbench" redesign for all frontend pages, without changing backend API contracts or business capabilities.

## Goals

1. Keep a unified cyber-tech visual language across all pages.
2. Rebuild Chat/Sessions/Cron/Skills/Memory as a coherent analyst workbench.
3. Improve information hierarchy and task flow clarity on desktop (`>=1024px`).
4. Preserve existing API and core behavior; redesign only presentation and interaction structure.

## Non-Goals

1. No new backend endpoints, no API schema changes.
2. No replacement of PTY/WS chat runtime logic.
3. No full mobile-first redesign in this iteration.
4. No feature expansion beyond current module capabilities.

## Design Principles

1. Task-first composition: primary user operation stays in the main pane.
2. Context secondary: metadata, history, and helper actions move to a right context rail.
3. Consistency over novelty: shared UI primitives across pages.
4. Operational readability: high contrast, compact scanning, predictable state feedback.
5. Motion restraint: meaningful transitions only; reduced-motion compliant.

## Information Architecture

Global shell structure:
- Left nav: persistent module navigation and session-level actions.
- Page mission header: page purpose, key counters, status chips, and top-level actions.
- Main workspace grid: `2.2fr main pane + 1fr context pane`.

Layer model (strict z-index scale):
- L1 content: 10
- L2 sticky headers/toolbars: 20
- L3 drawers/popovers: 30
- L4 standard modals: 50
- L5 critical modals/session detail over modal: 60

This eliminates cross-modal masking regressions.

## Visual System

### Typography
- Data/labels/time/status: `JetBrains Mono` family.
- Body copy/forms: `IBM Plex Sans` family.
- Optional fallback set remains system-safe and existing-compatible.

### Color Semantics
- Base surface: deep blue-black panel stack.
- Accent primary: cyan family for actionable/focus states.
- Accent success: green family for healthy/running states.
- Warning/danger: amber/red families for risk/error states.
- Neutral/muted text scales standardized across all pages.

### Component Language
Shared primitives:
- panel container
- panel header (icon + title + hint + actions)
- badge/chip states
- toolbar row
- table styles
- empty/loading/error blocks
- modal overlays and dialog shells

No emoji icons in UI controls. Replace with a consistent SVG icon family.

### Motion
- micro transitions: 150-260ms
- transforms/opacity only for performance
- `prefers-reduced-motion` fully supported

## Page-by-Page Blueprint

### 1) AppShell
- Upgrade nav into clearer grouped module map.
- Add mission header slot in all pages.
- Normalize grid container and spacing tokens.

### 2) Chat
- Main pane: PTY terminal remains dominant area.
- Context pane: event stream, channel/session info, quick controls.
- Keep existing websocket lifecycle and resume flow unchanged.

### 3) Sessions
- Main pane: session list + message stream readability optimized.
- Context pane: selected session metadata, relaunch actions, shortcuts.
- Preserve existing rule: detail displays messages only, excluding system prompt.

### 4) Cron
- Main pane: job table with operational scanning focus.
- Context pane: selected job details and recent execution summary.
- Better loading/empty/error semantics to avoid false-empty perception.

### 5) Skills
- Main pane: skill cards/table with clear enabled/disabled grouping.
- Context pane: selected skill detail, effect explanation, action feedback.

### 6) Memory
- Main pane: focused editor layout with readable line length and hierarchy.
- Context pane: Soul/User/memory files index + save status.
- Preserve current memory APIs and content model.

### 7) Overview
- Keep current replicated overview structure as visual anchor.
- Align tokens and shared primitives with rest of workbench.

## Interaction and State Rules

1. Every async operation has explicit loading, success, and error feedback.
2. Empty states include guidance text and next-step action where applicable.
3. Disabled actions must show distinct visual style and `not-allowed` cursor.
4. Keyboard focus rings are visible for all interactive controls.
5. Modal open from modal follows layer model; parent behavior is explicit per flow.

## Accessibility and UX Constraints

1. Text contrast target: minimum readable contrast in dark surfaces.
2. Minimum hit target: 44x44 for touch-interactive controls where applicable.
3. Keyboard navigability for critical controls (links/buttons/modals).
4. Focus management when opening/closing modals.

## Technical Implementation Plan (High-Level)

Phase A: Design tokens and shared primitives
- extract and normalize color/type/spacing/layer tokens
- define shared panel/toolbar/badge/modal utility classes

Phase B: Shell normalization
- refactor `AppShell` and shared page scaffolding

Phase C: Page refactors
- Chat -> Sessions -> Cron -> Skills -> Memory -> Overview alignment

Phase D: QA and polish
- responsive behavior for 1024/768 breakpoints
- reduced-motion, focus, loading/empty/error audits

## Validation Strategy

1. Build checks:
- `cd aisoc/frontend && npm run build`

2. Targeted tests:
- keep overview/session/interaction tests passing
- add or adjust component-level tests for new structural states when required

3. Manual UX checks:
- Desktop widths: 1024, 1280, 1440+
- Modal layering conflict scenarios
- Sessions -> relaunch -> chat resume flow intact
- Keyword/session-detail layered modal flow intact

## Acceptance Criteria

1. All core pages follow the same workbench structure and style grammar.
2. Primary operations on each page are visually obvious and one-step discoverable.
3. No modal masking or z-index regressions across module flows.
4. Existing backend behavior remains unchanged.
5. Frontend build succeeds; existing critical tests remain green.

## Risks and Mitigations

1. Risk: style refactor causes cross-page regressions.
- Mitigation: scope new primitives and migrate incrementally by page.

2. Risk: over-animated visuals reduce readability.
- Mitigation: strict motion budget and reduced-motion fallback.

3. Risk: shared class updates break established flows.
- Mitigation: phase-based rollout with build/test checks after each module migration.

## Delivery Scope

In-scope:
- visual system unification
- page layout and interaction hierarchy redesign
- component-level UX consistency

Out-of-scope:
- backend API changes
- new business features
- full mobile redesign parity
