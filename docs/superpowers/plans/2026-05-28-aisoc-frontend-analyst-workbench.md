# AISOC Frontend Analyst Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild AISOC frontend into a unified cyber-tech analyst workbench for Overview/Chat/Sessions/Cron/Skills/Memory while preserving existing backend APIs and runtime behavior.

**Architecture:** Introduce a shared workbench UI layer (layout shell, panel primitives, state blocks, modal layering scale), then migrate each page to the same structure: mission header + primary task pane + right context pane. Keep module logic and API calls intact; refactor only presentation, interaction hierarchy, and feedback states.

**Tech Stack:** React 19, React Router, TypeScript, Vite, Vitest, xterm.js, existing AISOC REST + websocket APIs.

---

## Scope Check

This spec is one frontend subsystem with shared UI tokens/primitives plus page migrations. It is suitable for a single implementation plan with phased tasks.

## File Structure and Responsibilities

### Shared shell and style foundation
- Modify: `aisoc/frontend/src/styles.css`
  - Own global tokens, workbench layout primitives, panel/header/table/modal/state styles, z-index scale.
- Modify: `aisoc/frontend/src/components/AppShell.tsx`
  - Own left nav + shell frame and shared page scaffold hooks.
- Create: `aisoc/frontend/src/components/PageMissionHeader.tsx`
  - Own consistent page mission header (title, status, counts, actions).
- Create: `aisoc/frontend/src/components/StateBlock.tsx`
  - Own standardized loading/empty/error/success blocks.

### Page migrations
- Modify: `aisoc/frontend/src/pages/OverviewPage.tsx`
  - Align with shared primitives/tokens while keeping current replicated overview layout intent.
- Modify: `aisoc/frontend/src/pages/ChatPage.tsx`
  - Move to analyst workbench split without touching PTY/WS logic.
- Modify: `aisoc/frontend/src/pages/SessionsPage.tsx`
  - Recompose list/messages/context rail with current APIs and system-message filtering.
- Modify: `aisoc/frontend/src/pages/CronPage.tsx`
  - Recompose jobs/detail/context and action feedback states.
- Modify: `aisoc/frontend/src/pages/SkillsPage.tsx`
  - Add grouped operational view and context detail rail.
- Modify: `aisoc/frontend/src/pages/MemoryPage.tsx`
  - Recompose editor-centric workspace + memory index context.

### Tests
- Modify: `aisoc/frontend/src/pages/OverviewPage.test.tsx`
  - Update assertions for shared primitives where needed.
- Create: `aisoc/frontend/src/pages/AppShell.layout.test.tsx`
  - Validate shell renders nav + outlet scaffold classes.
- Create: `aisoc/frontend/src/pages/SessionsPage.structure.test.tsx`
  - Validate key sections and message-only detail rendering structure.
- Create: `aisoc/frontend/src/pages/CronPage.structure.test.tsx`
  - Validate jobs pane + detail pane + actions container structure.
- Create: `aisoc/frontend/src/pages/SkillsPage.structure.test.tsx`
  - Validate grouped cards and toggle action zones.
- Create: `aisoc/frontend/src/pages/MemoryPage.structure.test.tsx`
  - Validate editor-first layout and index rail presence.

### Optional docs
- Create: `aisoc/frontend/docs/workbench-ui-guidelines.md`
  - Document design tokens, layering scale, and component usage rules for future consistency.

---

### Task 1: Lock Shared Design System Tokens and Layer Scale

**Files:**
- Modify: `aisoc/frontend/src/styles.css`
- Test: `aisoc/frontend/src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing test expectation for shared class presence (if missing)**

```tsx
expect(html).toContain("overview-cyber-wrap");
```

- [ ] **Step 2: Run test to verify current baseline and identify missing expectations**

Run: `cd aisoc/frontend && npm run test -- src/pages/OverviewPage.test.tsx`
Expected: either fail on missing new class assertion or pass baseline before style refactor.

- [ ] **Step 3: Implement token/layer updates in CSS**

```css
:root {
  --z-content: 10;
  --z-sticky: 20;
  --z-drawer: 30;
  --z-modal: 50;
  --z-modal-critical: 60;
}
```

- [ ] **Step 4: Re-run tests and build**

Run: `cd aisoc/frontend && npm run test -- src/pages/OverviewPage.test.tsx && npm run build`
Expected: tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/styles.css aisoc/frontend/src/pages/OverviewPage.test.tsx
git commit -m "feat(frontend): add shared workbench tokens and layering scale"
```

### Task 2: Build Shared Page Primitives (Mission Header + State Blocks)

**Files:**
- Create: `aisoc/frontend/src/components/PageMissionHeader.tsx`
- Create: `aisoc/frontend/src/components/StateBlock.tsx`
- Modify: `aisoc/frontend/src/styles.css`
- Test: `aisoc/frontend/src/pages/AppShell.layout.test.tsx`

- [ ] **Step 1: Write failing test for mission header primitives render contract**

```tsx
const html = renderToStaticMarkup(<PageMissionHeader title="Sessions" subtitle="Browse" />);
expect(html).toContain("Sessions");
```

- [ ] **Step 2: Run test to verify it fails because component file is missing**

Run: `cd aisoc/frontend && npm run test -- src/pages/AppShell.layout.test.tsx`
Expected: FAIL with module/component not found.

- [ ] **Step 3: Implement minimal reusable primitives**

```tsx
export function PageMissionHeader({ title, subtitle }: Props) {
  return <header className="page-mission-header"><h2>{title}</h2><p>{subtitle}</p></header>;
}
```

- [ ] **Step 4: Run tests and build**

Run: `cd aisoc/frontend && npm run test -- src/pages/AppShell.layout.test.tsx && npm run build`
Expected: PASS and successful build.

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/components/PageMissionHeader.tsx aisoc/frontend/src/components/StateBlock.tsx aisoc/frontend/src/styles.css aisoc/frontend/src/pages/AppShell.layout.test.tsx
git commit -m "feat(frontend): add shared mission header and state block primitives"
```

### Task 3: Refactor AppShell to Workbench Scaffold

**Files:**
- Modify: `aisoc/frontend/src/components/AppShell.tsx`
- Modify: `aisoc/frontend/src/styles.css`
- Test: `aisoc/frontend/src/pages/AppShell.layout.test.tsx`

- [ ] **Step 1: Add failing assertions for new shell sections**

```tsx
expect(html).toContain("app-shell");
expect(html).toContain("side-nav");
expect(html).toContain("main-panel");
```

- [ ] **Step 2: Run targeted test**

Run: `cd aisoc/frontend && npm run test -- src/pages/AppShell.layout.test.tsx`
Expected: FAIL for missing or changed scaffold markers.

- [ ] **Step 3: Implement shell grouping and stable nav hierarchy**

```tsx
<aside className="side-nav side-nav-workbench">...</aside>
<main className="main-panel workbench-main"><Outlet /></main>
```

- [ ] **Step 4: Re-run tests + build**

Run: `cd aisoc/frontend && npm run test -- src/pages/AppShell.layout.test.tsx && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/components/AppShell.tsx aisoc/frontend/src/styles.css aisoc/frontend/src/pages/AppShell.layout.test.tsx
git commit -m "feat(frontend): upgrade app shell to analyst workbench scaffold"
```

### Task 4: Recompose Chat into Main Task Pane + Context Rail

**Files:**
- Modify: `aisoc/frontend/src/pages/ChatPage.tsx`
- Modify: `aisoc/frontend/src/styles.css`
- Test: `aisoc/frontend/src/pages/ChatPage.structure.test.tsx` (create if missing)

- [ ] **Step 1: Write failing structural test for chat workbench zones**

```tsx
expect(html).toContain("chat-terminal-pane");
expect(html).toContain("chat-sidebar");
```

- [ ] **Step 2: Run test and confirm failure/mismatch**

Run: `cd aisoc/frontend && npm run test -- src/pages/ChatPage.structure.test.tsx`
Expected: FAIL before structure normalization.

- [ ] **Step 3: Refactor layout only; preserve websocket/PTY behavior**

```tsx
<PageMissionHeader ... />
<div className="workbench-layout chat-workbench">...</div>
```

- [ ] **Step 4: Validate tests and build**

Run: `cd aisoc/frontend && npm run test -- src/pages/ChatPage.structure.test.tsx && npm run build`
Expected: PASS; runtime build intact.

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/pages/ChatPage.tsx aisoc/frontend/src/styles.css aisoc/frontend/src/pages/ChatPage.structure.test.tsx
git commit -m "refactor(frontend): redesign chat page as analyst workbench"
```

### Task 5: Recompose Sessions for Scan + Deep Dive Workflow

**Files:**
- Modify: `aisoc/frontend/src/pages/SessionsPage.tsx`
- Modify: `aisoc/frontend/src/styles.css`
- Test: `aisoc/frontend/src/pages/SessionsPage.structure.test.tsx`

- [ ] **Step 1: Add failing test for three-zone sessions composition**

```tsx
expect(html).toContain("Recent Sessions");
expect(html).toContain("Session Messages");
```

- [ ] **Step 2: Run test to verify failure before migration**

Run: `cd aisoc/frontend && npm run test -- src/pages/SessionsPage.structure.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement workbench layout + keep message-only detail rule**

```tsx
const visibleMessages = messages.filter((m) => (m.role || "").toLowerCase() !== "system");
```

- [ ] **Step 4: Run tests and build**

Run: `cd aisoc/frontend && npm run test -- src/pages/SessionsPage.structure.test.tsx && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/pages/SessionsPage.tsx aisoc/frontend/src/styles.css aisoc/frontend/src/pages/SessionsPage.structure.test.tsx
git commit -m "refactor(frontend): redesign sessions page with analyst workbench flow"
```

### Task 6: Recompose Cron for Operational Monitoring

**Files:**
- Modify: `aisoc/frontend/src/pages/CronPage.tsx`
- Modify: `aisoc/frontend/src/styles.css`
- Test: `aisoc/frontend/src/pages/CronPage.structure.test.tsx`

- [ ] **Step 1: Write failing test for jobs pane/detail pane/action row**

```tsx
expect(html).toContain("Jobs");
expect(html).toContain("Cron Job Detail");
```

- [ ] **Step 2: Run targeted test**

Run: `cd aisoc/frontend && npm run test -- src/pages/CronPage.structure.test.tsx`
Expected: FAIL before layout migration.

- [ ] **Step 3: Implement layout/state-block refactor with existing actions**

```tsx
<button onClick={() => void action(job.id as string, "trigger")}>Trigger</button>
```

- [ ] **Step 4: Run tests and build**

Run: `cd aisoc/frontend && npm run test -- src/pages/CronPage.structure.test.tsx && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/pages/CronPage.tsx aisoc/frontend/src/styles.css aisoc/frontend/src/pages/CronPage.structure.test.tsx
git commit -m "refactor(frontend): redesign cron page for monitoring workflow"
```

### Task 7: Recompose Skills for Operational Toggle Clarity

**Files:**
- Modify: `aisoc/frontend/src/pages/SkillsPage.tsx`
- Modify: `aisoc/frontend/src/styles.css`
- Test: `aisoc/frontend/src/pages/SkillsPage.structure.test.tsx`

- [ ] **Step 1: Write failing test for grouped skill list + action area**

```tsx
expect(html).toContain("Installed Skills");
```

- [ ] **Step 2: Run test and confirm failure prior to grouping structure**

Run: `cd aisoc/frontend && npm run test -- src/pages/SkillsPage.structure.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement grouped/clearer card layout using existing toggle API**

```tsx
<button type="button" onClick={() => toggleSkill(skill.name, !skill.enabled)}>
```

- [ ] **Step 4: Run tests and build**

Run: `cd aisoc/frontend && npm run test -- src/pages/SkillsPage.structure.test.tsx && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/pages/SkillsPage.tsx aisoc/frontend/src/styles.css aisoc/frontend/src/pages/SkillsPage.structure.test.tsx
git commit -m "refactor(frontend): redesign skills page with clearer operation states"
```

### Task 8: Recompose Memory as Editor-First Workbench

**Files:**
- Modify: `aisoc/frontend/src/pages/MemoryPage.tsx`
- Modify: `aisoc/frontend/src/styles.css`
- Test: `aisoc/frontend/src/pages/MemoryPage.structure.test.tsx`

- [ ] **Step 1: Write failing test for editor-first + index rail sections**

```tsx
expect(html).toContain("Memory Files");
expect(html).toContain("Save");
```

- [ ] **Step 2: Run targeted test**

Run: `cd aisoc/frontend && npm run test -- src/pages/MemoryPage.structure.test.tsx`
Expected: FAIL before redesign.

- [ ] **Step 3: Implement layout/spacing/readability improvements only**

```tsx
<div className="memory-layout workbench-layout">...</div>
```

- [ ] **Step 4: Run tests and build**

Run: `cd aisoc/frontend && npm run test -- src/pages/MemoryPage.structure.test.tsx && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/pages/MemoryPage.tsx aisoc/frontend/src/styles.css aisoc/frontend/src/pages/MemoryPage.structure.test.tsx
git commit -m "refactor(frontend): redesign memory page as editor-first workbench"
```

### Task 9: Align Overview with Shared Primitives (No Feature Drift)

**Files:**
- Modify: `aisoc/frontend/src/pages/OverviewPage.tsx`
- Modify: `aisoc/frontend/src/styles.css`
- Modify: `aisoc/frontend/src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Add failing test for shared primitive class usage if needed**

```tsx
expect(html).toContain("ov-panel");
```

- [ ] **Step 2: Run overview tests**

Run: `cd aisoc/frontend && npm run test -- src/pages/OverviewPage.test.tsx src/lib/overview.test.ts`
Expected: FAIL only if assertions enforce new shared hooks.

- [ ] **Step 3: Align component wrappers/tokens while preserving replicated layout and APIs**

```tsx
<section className="overview-cyber-wrap workbench-overview">...</section>
```

- [ ] **Step 4: Run tests and build**

Run: `cd aisoc/frontend && npm run test -- src/pages/OverviewPage.test.tsx src/lib/overview.test.ts && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/pages/OverviewPage.tsx aisoc/frontend/src/styles.css aisoc/frontend/src/pages/OverviewPage.test.tsx
git commit -m "refactor(frontend): align overview with shared workbench primitives"
```

### Task 10: Final Regression, UX Audit, and Documentation

**Files:**
- Modify: `aisoc/frontend/src/styles.css` (only if final polish needed)
- Create: `aisoc/frontend/docs/workbench-ui-guidelines.md`

- [ ] **Step 1: Run full targeted suite for touched pages**

Run:

```bash
cd aisoc/frontend
npm run test -- src/pages/OverviewPage.test.tsx src/lib/overview.test.ts src/pages/AppShell.layout.test.tsx src/pages/ChatPage.structure.test.tsx src/pages/SessionsPage.structure.test.tsx src/pages/CronPage.structure.test.tsx src/pages/SkillsPage.structure.test.tsx src/pages/MemoryPage.structure.test.tsx
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run: `cd aisoc/frontend && npm run build`
Expected: build succeeds; known chunk-size warning may remain acceptable.

- [ ] **Step 3: Manual UX verification checklist**

Run app and verify:
- modal layering from keyword -> session detail is visible and unobstructed
- sessions relaunch -> chat resume path still works
- cron/skills/memory loading/empty/error states are explicit
- desktop layouts at 1024/1280/1440 remain clear

- [ ] **Step 4: Write UI guidelines for future consistency**

```md
# Workbench UI Guidelines
- shared tokens
- panel grammar
- z-index scale
- async feedback rules
```

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/docs/workbench-ui-guidelines.md aisoc/frontend/src/styles.css
git commit -m "docs(frontend): add workbench ui guidelines and finalize polish"
```

---

## Implementation Notes

- Use `@superpowers/ui-ux-pro-max` recommendations for contrast, icon consistency, and motion budget.
- Keep DRY/YAGNI: avoid creating per-page unique primitives when shared ones suffice.
- Keep all behavior contracts unchanged with backend endpoints.
- Do not revert unrelated user-owned workspace changes.

## Reviewer Loop Record

- Plan reviewer subagent dispatch was requested by skill guidance.
- In this session, explicit user permission for sub-agent delegation was not provided; therefore sub-agent spawning is intentionally skipped.
- Equivalent strict self-review completed against: header requirements, scope consistency, task granularity, test-first flow, file ownership clarity, and acceptance coverage.
