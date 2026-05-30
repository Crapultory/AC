# Floating Agent Chat Widget Design

Date: 2026-05-30

## Overview

A global floating chat widget for the AISOC frontend that provides full agent interaction via the `/api/chat/ws` JSON-RPC interface. The widget is completely isolated from the existing ChatPage — separate session storage, cache keys, and WebSocket connection.

## Architecture

Three-layer separation following Approach C:

```
Transport (agent-rpc.ts)  →  Hook (useAgentChat.ts)  →  UI (FloatingChat.tsx)
   low-level JSON-RPC WS      session lifecycle           icon + drawer + messages
```

Files:

```
aisoc/frontend/src/
  components/
    FloatingChat.tsx
    FloatingChat.css
  lib/
    agent-rpc.ts
    useAgentChat.ts
```

Mount point: `FloatingChat` renders in `App.tsx` inside `AppShell`, outside `<Outlet />`, visible on every page.

## Section 1: Transport Layer (`agent-rpc.ts`)

Low-level JSON-RPC WebSocket client. No awareness of sessions, messages, or UI.

```typescript
class AgentRpc {
  private ws: WebSocket | null;
  private nextId: number;
  private pending: Map<string, { resolve, reject }>;
  private eventHandlers: Map<string, Set<(params: any) => void>>;

  connect(url: string): Promise<void>;
  disconnect(): void;
  call(method: string, params?: object): Promise<any>;
  on(event: string, handler): () => void;
  off(event: string, handler): void;
}
```

- `call()` sends `{jsonrpc:"2.0", id, method, params}` and returns a promise resolving to `result` or rejecting with `error`.
- Inbound events (`method: "event"`) route to subscribed handlers via `on()`.
- Waits for `gateway.ready` event to confirm connection.
- No auto-reconnect — the hook owns that decision.
- URL built from same pattern as `buildGatewayUrl()` in `lib/chat.ts`.

Export: single `AgentRpc` class.

## Section 2: Session Hook (`useAgentChat.ts`)

Manages session lifecycle, message buffer, reconnection, and idle timer.

### State

```typescript
type ChatState = {
  phase: "disconnected" | "connecting" | "idle" | "streaming";
  sessionId: string | null;
  messages: ChatMessage[];
  activeApproval: ApprovalRequest | null;
  activeClarify: ClarifyRequest | null;
  error: string | null;
};

type ChatMessage =
  | { role: "user"; id: string; text: string }
  | { role: "agent"; id: string; text: string; done: boolean }
  | { role: "tool"; id: string; name: string; status: "running" | "done"; summary?: string }
  | { role: "thinking"; id: string; text: string };
```

### Hook interface

```typescript
function useAgentChat(): {
  state: ChatState;
  send(text: string): void;
  respondApproval(accept: boolean): void;
  respondClarify(choice: string): void;
  startNewSession(): void;
  connect(): void;
  disconnect(): void;
  interrupt(): void;
};
```

### Session resume strategy

On `connect()`:

1. Create `AgentRpc`, open WebSocket.
2. Wait for `gateway.ready`.
3. Check localStorage (`aisoc.widget.sessionId`) for saved session.
   - If exists: call `session.resume(session_id)`. Populate messages from `response.messages`. On error (session gone): fall through to create.
   - If not exists: call `session.create`.
4. Save `session_id` to localStorage.
5. Subscribe to all events: `tool.start`, `tool.complete`, `thinking.delta`, `reasoning.delta`, `approval.request`, `clarify.request`, `status.update`, `error`, plus any response-text streaming events discovered in implementation (see note below).
6. Start idle timer.

### Message assembly

**Implementation note:** The gateway's `_agent_cbs` explicitly emits `thinking.delta`, `reasoning.delta`, `tool.start`, `tool.complete`, and `status.update` events. The agent response text streaming path (`message.start`/`message.delta`/`message.done`) needs verification by inspecting `_run_prompt_submit` during implementation. If these events do not exist, the implementation must either:
  (a) Read the final response from the `prompt.submit` response payload or `session.history` after the turn completes, or
  (b) Add response-streaming callbacks to the gateway backend.

For now, the message assembly assumes the ideal case:

- `message.start` (if available) → push agent message with `done: false`
- `message.delta` or equivalent → append text to last agent message
- `thinking.delta` / `reasoning.delta` → append text to last thinking message
- `tool.start` → push tool message with `status: "running"`
- `tool.complete` → update matching tool to `status: "done"` + summary
- `message.done` (if available) → set agent message `done: true`

If streaming events are unavailable, fall back to polling `session.history` after the turn and displaying the complete response.

### Idle timer

- Resets on every inbound event or user action.
- Timeout: `VITE_AISOC_WIDGET_IDLE_MINUTES` env var (default 10), clamped to minimum 1 minute. Accessed via `import.meta.env.VITE_AISOC_WIDGET_IDLE_MINUTES`.
- On timeout: if `phase === "idle"`, call `disconnect()`. If streaming, reset timer.
- Next `connect()` does full resume cycle.

### Isolation

Separate localStorage key: `aisoc.widget.sessionId`. Never touches ChatPage's keys (`aisoc.chat.resumeSessionId`).

### Error handling

- Auth errors (4401) → set `state.error`, UI shows re-login prompt.
- Connection failure → retry once after 2s, then surface error.
- Session not found → auto-create new session with toast.

## Section 3: UI Component (`FloatingChat.tsx` + `FloatingChat.css`)

### Component tree

```
<FloatingChat>
  {drawerOpen ? <ChatDrawer> ... </ChatDrawer> : null}
  <FloatingIcon onClick={toggle} />
  {showConfirm ? <ConfirmDialog /> : null}
</FloatingChat>
```

All sub-components rendered inline — no separate files.

### FloatingIcon

- Fixed `bottom: 24px; right: 24px`, z-index above content, below modals.
- Dual orbit CSS animation: two concentric pseudo-elements with glowing dots rotating at different speeds (inner 2.5s, outer 4s reverse).
- Pulse glow via `radial-gradient` with `scale` animation.
- Red blink dot overlay when agent streaming in background (drawer closed).
- `prefers-reduced-motion`: disables orbit, no animation.

### ChatDrawer

- Slides from right: `translateX(100%)` → `translateX(0)`, `transition: transform 0.3s ease`.
- Width 420px, full height, fixed position (`top: 0; bottom: 0; right: 0`).
- Glass background: `rgba(10, 22, 40, 0.96)` with `backdrop-filter: blur(12px)`.
- Border-left: `1px solid rgba(86, 247, 222, 0.15)`.

### DrawerHeader

- Left: "Agent Chat" + truncated session ID.
- Center: "New" ghost button → `startNewSession()`.
- Right: Close button (`×`).

### MessageList

- `flex: 1; overflow-y: auto; padding: 12px`.
- Auto-scroll to bottom on new messages.
- Scrollback limit: 200 messages in memory.

### Message rendering

| Type | Layout | Content |
|------|--------|---------|
| User | Right-aligned, cyan-tinted bubble (`12px 12px 2px 12px`) | Plain text |
| Agent | Left-aligned, dark bubble, "H" avatar, (`12px 12px 12px 2px`) | Markdown via `react-markdown` |
| Tool | Left-aligned bordered card, icon + name + status badge | `🔧 name` + `Running...` / `Done 2.3s` |
| Thinking | Left-aligned, italic, muted | `💭` prefix + streamed text |
| Approval | Inline card with Accept/Reject buttons | Calls `respondApproval()` |
| Clarify | Inline card with choice buttons | Calls `respondClarify()` |

### ChatInput

- `textarea`, auto-grows, `max-height: 120px`.
- Enter to send, Shift+Enter for newline.
- Disabled during streaming with placeholder "Agent is responding...".
- Send button with cyan accent, disabled when empty or streaming.

### ConfirmDialog

- Triggered when closing drawer during `phase === "streaming"`.
- "Agent is still working. Close anyway?"
- "Keep Running" (dismisses dialog, drawer closes, WS stays) / "Interrupt & Close" (`interrupt()` + `disconnect()` + close drawer).

### CSS

- Plain CSS in `FloatingChat.css`, using existing CSS variables (`--aisoc-accent`, `--aisoc-text`, `--aisoc-muted`, `--aisoc-danger`).
- `prefers-reduced-motion` media query: disables animations.

### Mounting

Rendered in `App.tsx` inside `AppShell`, outside `<Outlet />`. Present on every page. No WS connection until first click.

## Section 4: Error Handling & Edge Cases

### WebSocket errors

| Scenario | Behavior |
|----------|----------|
| Connect fails | Retry once after 2s. Banner: "Connection failed". Disable input. |
| Auth expired (4401/4403) | Banner: "Session expired. Please sign in again." Disable interaction. Click → login. |
| WS drops mid-stream | Auto-reconnect + `session.resume`. Agent continued server-side. |
| Session not found on resume | Create new session. Toast: "Previous session expired. Started new chat." |

### Agent errors

| Scenario | Behavior |
|----------|----------|
| `prompt.submit` error | Red-tinted agent message: "Error: {message}". Reset to idle. |
| Gateway `error` event | Same — red bubble in message list. |
| Agent init timeout | System message: "Agent initialization timed out. Please try again." |
| Tool failure | Tool card shows `Failed` with error summary. Non-blocking. |

### Input edge cases

- Empty input: send button disabled.
- Streaming: input disabled, placeholder text.
- Long input (>10000 chars): character count shown, send allowed.

### Session management

- "New" during active turn: confirm dialog → interrupt → disconnect → connect (no saved session) → fresh session.
- Multiple tabs: each has own WS + session. If another tab takes over a session, show "Session taken over by another tab".
- Page refresh: `connect()` on mount → resume via localStorage → messages reload.
- First visit: no WS connection, no resource usage until icon clicked.
- Idle timer fires during streaming: do not disconnect, reset timer.
- Idle timer env var ≤ 0: clamp to 1 minute.
- Idle timer env var name: `VITE_AISOC_WIDGET_IDLE_MINUTES` (Vite convention).
