# Floating Agent Chat Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global floating chat widget that provides full agent interaction via the `/api/chat/ws` JSON-RPC interface, isolated from the existing ChatPage.

**Architecture:** Three-layer separation: transport (agent-rpc.ts) handles raw JSON-RPC WebSocket, hook (useAgentChat.ts) manages session lifecycle and message state, UI (FloatingChat.tsx + .css) renders the floating icon and drawer. All mounted globally in AppShell.

**Tech Stack:** React 19, TypeScript, Vitest, plain CSS with existing CSS variables, native WebSocket, react-markdown (existing dep).

**Spec correction:** The spec references `message.done` but the actual gateway event is `message.complete`. The streaming sequence is `message.start` → `message.delta` → `message.complete`.

---

## File Structure

| File | Responsibility | Status |
|------|---------------|--------|
| `aisoc/frontend/src/lib/agent-rpc.ts` | Low-level JSON-RPC WebSocket client | Create |
| `aisoc/frontend/src/lib/agent-rpc.test.ts` | Unit tests for AgentRpc | Create |
| `aisoc/frontend/src/lib/useAgentChat.ts` | Session lifecycle hook | Create |
| `aisoc/frontend/src/lib/useAgentChat.test.ts` | Unit tests for the hook | Create |
| `aisoc/frontend/src/components/FloatingChat.tsx` | UI: icon + drawer + messages + input | Create |
| `aisoc/frontend/src/components/FloatingChat.css` | Styles: animations, drawer, bubbles | Create |
| `aisoc/frontend/src/components/FloatingChat.test.tsx` | Structure + behavior tests | Create |
| `aisoc/frontend/src/components/AppShell.tsx` | Mount point for FloatingChat | Modify |

---

### Task 1: Transport Layer — AgentRpc

**Files:**
- Create: `aisoc/frontend/src/lib/agent-rpc.ts`
- Create: `aisoc/frontend/src/lib/agent-rpc.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// aisoc/frontend/src/lib/agent-rpc.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRpc } from "./agent-rpc";

// Minimal mock WebSocket
function createMockWs() {
  const ws = {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 0,
    onopen: null as (() => void) | null,
    onmessage: null as ((ev: { data: string }) => void) | null,
    onerror: null as (() => void) | null,
    onclose: null as ((ev: { code: number }) => void) | null,
  };
  return ws;
}

describe("AgentRpc", () => {
  let rpc: AgentRpc;
  let mockWs: ReturnType<typeof createMockWs>;

  beforeEach(() => {
    rpc = new AgentRpc();
    mockWs = createMockWs();
    // Inject mock ws factory
    (rpc as any)._createWs = () => {
      const w = createMockWs();
      mockWs = w;
      return w as any;
    };
  });

  it("connects and resolves after gateway.ready", async () => {
    const promise = rpc.connect("ws://localhost/api/chat/ws?token=x");
    // Simulate WS open then gateway.ready
    mockWs.onopen!();
    mockWs.onmessage!({
      data: JSON.stringify({
        jsonrpc: "2.0",
        method: "event",
        params: { type: "gateway.ready", payload: {} },
      }),
    });
    await expect(promise).resolves.toBeUndefined();
  });

  it("call() sends JSON-RPC and resolves with result", async () => {
    mockWs.onopen!();
    mockWs.onmessage!({
      data: JSON.stringify({
        jsonrpc: "2.0",
        method: "event",
        params: { type: "gateway.ready", payload: {} },
      }),
    });

    const callPromise = rpc.call("session.create", { cols: 80 });
    // Verify sent
    expect(mockWs.send).toHaveBeenCalled();
    const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sent.method).toBe("session.create");
    expect(sent.id).toBeTruthy();

    // Simulate response
    mockWs.onmessage!({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: sent.id,
        result: { session_id: "abc123" },
      }),
    });
    const result = await callPromise;
    expect(result.session_id).toBe("abc123");
  });

  it("routes events to subscribers via on()", async () => {
    const handler = vi.fn();
    rpc.on("tool.start", handler);

    mockWs.onopen!();
    mockWs.onmessage!({
      data: JSON.stringify({
        jsonrpc: "2.0",
        method: "event",
        params: { type: "gateway.ready", payload: {} },
      }),
    });

    mockWs.onmessage!({
      data: JSON.stringify({
        jsonrpc: "2.0",
        method: "event",
        params: {
          type: "tool.start",
          session_id: "abc",
          payload: { name: "git_diff" },
        },
      }),
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { name: "git_diff" } }),
    );
  });

  it("unsubscribe via returned function", async () => {
    const handler = vi.fn();
    const unsub = rpc.on("tool.start", handler);
    unsub();

    mockWs.onopen!();
    mockWs.onmessage!({
      data: JSON.stringify({
        jsonrpc: "2.0",
        method: "event",
        params: { type: "gateway.ready", payload: {} },
      }),
    });

    mockWs.onmessage!({
      data: JSON.stringify({
        jsonrpc: "2.0",
        method: "event",
        params: { type: "tool.start", payload: { name: "x" } },
      }),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("disconnect closes WebSocket", async () => {
    mockWs.onopen!();
    mockWs.onmessage!({
      data: JSON.stringify({
        jsonrpc: "2.0",
        method: "event",
        params: { type: "gateway.ready", payload: {} },
      }),
    });
    rpc.disconnect();
    expect(mockWs.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aisoc/frontend && npx vitest run src/lib/agent-rpc.test.ts`
Expected: FAIL — module `./agent-rpc` not found

- [ ] **Step 3: Write AgentRpc implementation**

```typescript
// aisoc/frontend/src/lib/agent-rpc.ts
type PendingEntry = { resolve: (value: any) => void; reject: (reason: any) => void };

export class AgentRpc {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<string, PendingEntry>();
  private eventHandlers = new Map<string, Set<(params: any) => void>>();

  /** @internal test hook — override to inject mock WebSocket */
  _createWs(url: string): WebSocket {
    return new WebSocket(url);
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this._createWs(url);
      this.ws = ws;

      ws.onopen = () => {};
      ws.onmessage = (ev) => {
        let obj: any;
        try {
          obj = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }

        // gateway.ready resolves the connect promise
        if (obj.method === "event" && obj.params?.type === "gateway.ready") {
          resolve();
          return;
        }

        // JSON-RPC response
        if (obj.id != null) {
          const entry = this.pending.get(String(obj.id));
          if (entry) {
            this.pending.delete(String(obj.id));
            if (obj.error) {
              entry.reject(obj.error);
            } else {
              entry.resolve(obj.result);
            }
          }
        }

        // Event dispatch
        if (obj.method === "event" && obj.params?.type) {
          const handlers = this.eventHandlers.get(obj.params.type);
          if (handlers) {
            for (const h of handlers) {
              h(obj.params);
            }
          }
        }
      };

      ws.onerror = () => reject(new Error("WebSocket connection failed"));
      ws.onclose = () => {
        // Reject all pending calls
        for (const [, entry] of this.pending) {
          entry.reject(new Error("WebSocket closed"));
        }
        this.pending.clear();
      };
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const [, entry] of this.pending) {
      entry.reject(new Error("WebSocket closed"));
    }
    this.pending.clear();
  }

  call(method: string, params: object = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const id = String(this.nextId++);
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  on(event: string, handler: (params: any) => void): () => void {
    let set = this.eventHandlers.get(event);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.eventHandlers.delete(event);
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aisoc/frontend && npx vitest run src/lib/agent-rpc.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/lib/agent-rpc.ts aisoc/frontend/src/lib/agent-rpc.test.ts
git commit -m "feat(widget): add AgentRpc transport layer with JSON-RPC WebSocket client"
```

---

### Task 2: Session Hook — useAgentChat

**Files:**
- Create: `aisoc/frontend/src/lib/useAgentChat.ts`
- Create: `aisoc/frontend/src/lib/useAgentChat.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// aisoc/frontend/src/lib/useAgentChat.test.ts
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WIDGET_SESSION_KEY } from "./useAgentChat";

// Mock agent-rpc before importing the hook module
const mockCall = vi.fn();
const mockOn = vi.fn(() => () => {});
const mockDisconnect = vi.fn();

vi.mock("./agent-rpc", () => ({
  AgentRpc: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    call: mockCall,
    on: mockOn,
    disconnect: mockDisconnect,
  })),
}));

vi.mock("./auth", () => ({
  getStoredToken: vi.fn(() => "test-token"),
}));

import { useAgentChat } from "./useAgentChat";

function renderChatHook() {
  return renderHook(() => useAgentChat());
}

describe("useAgentChat", () => {
  beforeEach(() => {
    localStorage.clear();
    mockCall.mockReset();
    mockOn.mockReset();
    mockOn.mockReturnValue(() => {});
    mockDisconnect.mockReset();
  });

  it("exports the session storage key constant", () => {
    expect(WIDGET_SESSION_KEY).toBe("aisoc.widget.sessionId");
  });

  it("starts disconnected", () => {
    const { result } = renderChatHook();
    expect(result.current.state.phase).toBe("disconnected");
  });

  describe("connect()", () => {
    it("creates new session when no saved sessionId", async () => {
      mockCall.mockResolvedValue({ session_id: "new-123", info: {} });

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("session.create", expect.any(Object));
      });
    });

    it("resumes existing session when sessionId saved", async () => {
      localStorage.setItem(WIDGET_SESSION_KEY, "saved-456");
      mockCall.mockResolvedValue({
        session_id: "resumed-789",
        resumed: "saved-456",
        messages: [
          { role: "user", text: "hello" },
          { role: "assistant", text: "hi" },
        ],
        info: {},
      });

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("session.resume", expect.objectContaining({
          session_id: "saved-456",
        }));
      });
    });

    it("falls back to create on resume error", async () => {
      localStorage.setItem(WIDGET_SESSION_KEY, "expired-999");
      mockCall
        .mockRejectedValueOnce({ code: 4007, message: "session not found" })
        .mockResolvedValueOnce({ session_id: "fresh-111", info: {} });

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("session.create", expect.any(Object));
      });
    });

    it("retries once on connection failure", async () => {
      const { AgentRpc } = await import("./agent-rpc");
      let callCount = 0;
      (AgentRpc as any).mockImplementation(() => ({
        connect: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error("Connection failed"));
          return Promise.resolve();
        }),
        call: mockCall.mockResolvedValue({ session_id: "retry-ok", info: {} }),
        on: mockOn,
        disconnect: mockDisconnect,
      }));

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(callCount).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe("send()", () => {
    it("calls prompt.submit with text", async () => {
      mockCall
        .mockResolvedValueOnce({ session_id: "sess-1", info: {} })
        .mockResolvedValueOnce({ status: "streaming" });

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(result.current.state.phase).toBe("idle");
      });

      act(() => result.current.send("hello agent"));
      expect(mockCall).toHaveBeenCalledWith("prompt.submit", expect.objectContaining({
        text: "hello agent",
      }));
    });
  });
});
```

**Note:** This test requires `@testing-library/react`. Install it before running: `cd aisoc/frontend && npm install --save-dev @testing-library/react`

- [ ] **Step 2: Install test dependency**

Run: `cd aisoc/frontend && npm install --save-dev @testing-library/react`

- [ ] **Step 3: Run test to verify it fails**

Run: `cd aisoc/frontend && npx vitest run src/lib/useAgentChat.test.ts`
Expected: FAIL — module `./useAgentChat` not found

- [ ] **Step 4: Write useAgentChat implementation**

```typescript
// aisoc/frontend/src/lib/useAgentChat.ts
import { useCallback, useRef, useState } from "react";
import { AgentRpc } from "./agent-rpc";
import { getStoredToken } from "./auth";

export const WIDGET_SESSION_KEY = "aisoc.widget.sessionId";
const SCROLLBACK_LIMIT = 200;

export type ChatMessage =
  | { role: "user"; id: string; text: string }
  | { role: "agent"; id: string; text: string; done: boolean }
  | { role: "tool"; id: string; name: string; status: "running" | "done"; duration_s?: number; summary?: string }
  | { role: "thinking"; id: string; text: string };

export type ApprovalRequest = {
  request_id: string;
  tool_name?: string;
  command?: string;
};

export type ClarifyRequest = {
  request_id: string;
  question: string;
  choices: string[];
};

export type ChatPhase = "disconnected" | "connecting" | "idle" | "streaming";

export type ChatState = {
  phase: ChatPhase;
  sessionId: string | null;
  messages: ChatMessage[];
  activeApproval: ApprovalRequest | null;
  activeClarify: ClarifyRequest | null;
  error: string | null;
};

function wsBaseUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

function generateChannelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `widget-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function buildWsUrl(): string {
  const qs = new URLSearchParams({
    token: getStoredToken(),
    channel: generateChannelId(),
  });
  return `${wsBaseUrl()}/api/chat/ws?${qs.toString()}`;
}

let _msgSeq = 0;
function nextMsgId(): string {
  return `m-${++_msgSeq}`;
}

function getIdleTimeoutMs(): number {
  const raw = import.meta.env.VITE_AISOC_WIDGET_IDLE_MINUTES;
  const mins = Math.max(1, Math.round(Number(raw) || 10));
  return mins * 60_000;
}

function trimMessages(msgs: ChatMessage[]): ChatMessage[] {
  if (msgs.length <= SCROLLBACK_LIMIT) return msgs;
  return msgs.slice(msgs.length - SCROLLBACK_LIMIT);
}

/** Helper to format tool duration for display */
export function formatToolDuration(seconds: number | undefined): string {
  if (seconds == null) return "";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs ? `${mins}m ${secs}s` : `${mins}m`;
}

export function useAgentChat(): {
  state: ChatState;
  send: (text: string) => void;
  respondApproval: (accept: boolean) => void;
  respondClarify: (choice: string) => void;
  startNewSession: () => void;
  connect: () => void;
  disconnect: () => void;
  interrupt: () => void;
} {
  const [state, setState] = useState<ChatState>({
    phase: "disconnected",
    sessionId: null,
    messages: [],
    activeApproval: null,
    activeClarify: null,
    error: null,
  });

  const rpcRef = useRef<AgentRpc | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubsRef = useRef<(() => void)[]>([]);
  // Refs to avoid stale closures — always read from refs in callbacks
  const sessionIdRef = useRef<string | null>(null);
  const activeApprovalRef = useRef<ApprovalRequest | null>(null);
  const activeClarifyRef = useRef<ClarifyRequest | null>(null);

  // Keep refs in sync with state
  sessionIdRef.current = state.sessionId;
  activeApprovalRef.current = state.activeApproval;
  activeClarifyRef.current = state.activeClarify;

  // disconnectImpl is a stable ref-based function (not a useCallback with deps)
  const disconnectRef = useRef<() => void>(() => {});
  disconnectRef.current = () => {
    for (const u of unsubsRef.current) u();
    unsubsRef.current = [];
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    rpcRef.current?.disconnect();
    rpcRef.current = null;
    sessionIdRef.current = null;
    setState((s) => ({ ...s, phase: "disconnected" }));
  };

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // Read phase from state via setState updater
      setState((s) => {
        if (s.phase === "idle") {
          // Schedule disconnect outside updater to avoid side effects in setState
          setTimeout(() => disconnectRef.current(), 0);
        }
        return s;
      });
    }, getIdleTimeoutMs());
  }, []);

  const subscribe = useCallback((rpc: AgentRpc) => {
    const unsub = (event: string, handler: (p: any) => void) => {
      const u = rpc.on(event, handler);
      unsubsRef.current.push(u);
      return u;
    };

    unsub("message.start", () => {
      resetIdleTimer();
      const msg: ChatMessage = { role: "agent", id: nextMsgId(), text: "", done: false };
      setState((s) => ({ ...s, phase: "streaming", messages: trimMessages([...s.messages, msg]) }));
    });

    unsub("message.delta", (params) => {
      resetIdleTimer();
      setState((s) => {
        const msgs = [...s.messages];
        const last = msgs.length - 1;
        if (last >= 0 && msgs[last].role === "agent") {
          msgs[last] = { ...msgs[last], text: msgs[last].text + (params.payload?.text || "") };
        }
        return { ...s, messages: msgs };
      });
    });

    unsub("message.complete", () => {
      resetIdleTimer();
      setState((s) => {
        const msgs = [...s.messages];
        const last = msgs.length - 1;
        if (last >= 0 && msgs[last].role === "agent") {
          msgs[last] = { ...msgs[last], done: true };
        }
        return { ...s, phase: "idle", messages: msgs };
      });
    });

    unsub("thinking.delta", (params) => {
      resetIdleTimer();
      setState((s) => {
        const msgs = [...s.messages];
        const last = msgs.length - 1;
        if (last >= 0 && msgs[last].role === "thinking") {
          msgs[last] = { ...msgs[last], text: msgs[last].text + (params.payload?.text || "") };
        } else {
          msgs.push({ role: "thinking", id: nextMsgId(), text: params.payload?.text || "" });
        }
        return { ...s, messages: trimMessages(msgs) };
      });
    });

    unsub("reasoning.delta", (params) => {
      resetIdleTimer();
      setState((s) => {
        const msgs = [...s.messages];
        const last = msgs.length - 1;
        if (last >= 0 && msgs[last].role === "thinking") {
          msgs[last] = { ...msgs[last], text: msgs[last].text + (params.payload?.text || "") };
        } else {
          msgs.push({ role: "thinking", id: nextMsgId(), text: params.payload?.text || "" });
        }
        return { ...s, messages: trimMessages(msgs) };
      });
    });

    unsub("tool.start", (params) => {
      resetIdleTimer();
      const msg: ChatMessage = {
        role: "tool",
        id: params.payload?.tool_id || nextMsgId(),
        name: params.payload?.name || "tool",
        status: "running",
      };
      setState((s) => ({ ...s, messages: trimMessages([...s.messages, msg]) }));
    });

    unsub("tool.complete", (params) => {
      resetIdleTimer();
      const toolId = params.payload?.tool_id;
      const duration_s = params.payload?.duration_s;
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.role === "tool" && m.id === toolId
            ? { ...m, status: "done", summary: params.payload?.summary, duration_s }
            : m,
        ),
      }));
    });

    unsub("approval.request", (params) => {
      resetIdleTimer();
      setState((s) => ({ ...s, activeApproval: params.payload as ApprovalRequest }));
    });

    unsub("clarify.request", (params) => {
      resetIdleTimer();
      setState((s) => ({ ...s, activeClarify: params.payload as ClarifyRequest }));
    });

    unsub("error", (params) => {
      resetIdleTimer();
      const errMsg = params.payload?.message || "Unknown error";
      setState((s) => ({
        ...s,
        phase: "idle",
        messages: trimMessages([...s.messages, { role: "agent", id: nextMsgId(), text: `Error: ${errMsg}`, done: true }]),
      }));
    });
  }, [resetIdleTimer]);

  const connect = useCallback(() => {
    setState((s) => ({ ...s, phase: "connecting", error: null }));
    const rpc = new AgentRpc();
    rpcRef.current = rpc;
    const url = buildWsUrl();

    const attemptConnect = (retriesLeft: number) => {
      rpc.connect(url).then(async () => {
        subscribe(rpc);

        const savedId = localStorage.getItem(WIDGET_SESSION_KEY);
        if (savedId) {
          try {
            const res = await rpc.call("session.resume", { session_id: savedId, cols: 80 });
            const resumedId = res.resumed || savedId;
            localStorage.setItem(WIDGET_SESSION_KEY, resumedId);
            sessionIdRef.current = resumedId;
            const msgs: ChatMessage[] = (res.messages || []).map((m: any) => ({
              role: m.role === "assistant" ? "agent" : m.role,
              id: nextMsgId(),
              text: m.text || "",
              done: true,
            }));
            setState({ phase: "idle", sessionId: resumedId, messages: trimMessages(msgs), activeApproval: null, activeClarify: null, error: null });
            resetIdleTimer();
            return;
          } catch {
            // Session gone — fall through to create
          }
        }

        const res = await rpc.call("session.create", { cols: 80 });
        localStorage.setItem(WIDGET_SESSION_KEY, res.session_id);
        sessionIdRef.current = res.session_id;
        setState({ phase: "idle", sessionId: res.session_id, messages: [], activeApproval: null, activeClarify: null, error: null });
        resetIdleTimer();
      }).catch((err) => {
        if (retriesLeft > 0) {
          setTimeout(() => attemptConnect(retriesLeft - 1), 2000);
        } else {
          setState((s) => ({ ...s, phase: "disconnected", error: err.message || "Connection failed" }));
        }
      });
    };

    attemptConnect(1); // 1 retry
  }, [subscribe, resetIdleTimer]);

  const disconnect = useCallback(() => disconnectRef.current(), []);

  const send = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { role: "user", id: nextMsgId(), text };
    setState((s) => ({ ...s, messages: trimMessages([...s.messages, userMsg]), phase: "streaming" }));
    resetIdleTimer();
    // Use ref to get latest sessionId, avoiding stale closure
    const sid = sessionIdRef.current;
    rpcRef.current?.call("prompt.submit", { session_id: sid, text }).catch((err) => {
      setState((s) => ({
        ...s,
        phase: "idle",
        messages: trimMessages([...s.messages, { role: "agent", id: nextMsgId(), text: `Error: ${err.message || "send failed"}`, done: true }]),
      }));
    });
  }, [resetIdleTimer]);

  const respondApproval = useCallback((accept: boolean) => {
    const approval = activeApprovalRef.current;
    if (!approval) return;
    rpcRef.current?.call("approval.respond", {
      request_id: approval.request_id,
      response: accept ? "allow" : "deny",
    });
    setState((s) => ({ ...s, activeApproval: null }));
  }, []);

  const respondClarify = useCallback((choice: string) => {
    const clarify = activeClarifyRef.current;
    if (!clarify) return;
    rpcRef.current?.call("clarify.respond", {
      request_id: clarify.request_id,
      response: choice,
    });
    setState((s) => ({ ...s, activeClarify: null }));
  }, []);

  const interrupt = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    rpcRef.current?.call("session.interrupt", { session_id: sid });
  }, []);

  const startNewSession = useCallback(() => {
    disconnectRef.current();
    localStorage.removeItem(WIDGET_SESSION_KEY);
    sessionIdRef.current = null;
    setState({ phase: "disconnected", sessionId: null, messages: [], activeApproval: null, activeClarify: null, error: null });
    setTimeout(() => connect(), 100);
  }, [connect]);

  return { state, send, respondApproval, respondClarify, startNewSession, connect, disconnect, interrupt };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd aisoc/frontend && npx vitest run src/lib/useAgentChat.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add aisoc/frontend/src/lib/useAgentChat.ts aisoc/frontend/src/lib/useAgentChat.test.ts
git commit -m "feat(widget): add useAgentChat hook with session lifecycle and message assembly"
```

---

### Task 3: UI Styles — FloatingChat.css

**Files:**
- Create: `aisoc/frontend/src/components/FloatingChat.css`

- [ ] **Step 1: Write the CSS file**

```css
/* aisoc/frontend/src/components/FloatingChat.css */

/* ── Floating icon ──────────────────────────────────────────── */
.widget-icon {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  cursor: pointer;
  z-index: calc(var(--aisoc-z-modal, 50) - 1);
  background: linear-gradient(135deg, #56f7de, #3a9d8f);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 20px;
  color: var(--aisoc-bg, #050a12);
  user-select: none;
  transition: transform 0.2s ease;
}
.widget-icon:hover {
  transform: scale(1.08);
}

/* Inner orbit ring */
.widget-icon::before {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1.5px solid rgba(86, 247, 222, 0.3);
}

/* Outer orbit ring */
.widget-icon::after {
  content: "";
  position: absolute;
  inset: -14px;
  border-radius: 50%;
  border: 1.5px solid rgba(86, 247, 222, 0.15);
}

/* Orbit dot containers */
.widget-orbit-inner,
.widget-orbit-outer {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
}
.widget-orbit-inner {
  animation: widget-orbit 2.5s linear infinite;
}
.widget-orbit-outer {
  position: absolute;
  inset: -8px;
  animation: widget-orbit 4s linear infinite reverse;
}

.widget-orbit-dot {
  position: absolute;
  top: -3px;
  left: 50%;
  transform: translateX(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #56f7de;
  box-shadow: 0 0 10px #56f7de;
}
.widget-orbit-outer .widget-orbit-dot {
  width: 5px;
  height: 5px;
  background: #82ffd2;
  box-shadow: 0 0 8px #82ffd2;
}

/* Pulse glow */
.widget-pulse {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(86, 247, 222, 0.15) 0%, transparent 70%);
  animation: widget-pulse 2s ease-in-out infinite;
  pointer-events: none;
}

/* Active streaming indicator (red dot) */
.widget-active-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--aisoc-danger, #ff6b92);
  border: 2px solid var(--aisoc-bg, #050a12);
  animation: widget-blink 1s ease-in-out infinite;
}

@keyframes widget-orbit {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes widget-pulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.08); }
}
@keyframes widget-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ── Drawer ─────────────────────────────────────────────────── */
.widget-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  background: rgba(10, 22, 40, 0.96);
  backdrop-filter: blur(12px);
  border-left: 1px solid rgba(86, 247, 222, 0.15);
  display: flex;
  flex-direction: column;
  z-index: var(--aisoc-z-modal, 50);
  transform: translateX(100%);
  transition: transform 0.3s ease;
}
.widget-drawer-open {
  transform: translateX(0);
}

.widget-drawer-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(86, 247, 222, 0.1);
  gap: 8px;
}
.widget-drawer-title {
  color: var(--aisoc-accent, #56f7de);
  font-size: 13px;
  font-weight: 600;
  flex: 1;
}
.widget-drawer-session {
  font-size: 10px;
  color: var(--aisoc-muted, #8aa8c3);
  margin-left: 6px;
}
.widget-btn-new {
  background: rgba(86, 247, 222, 0.1);
  color: var(--aisoc-accent, #56f7de);
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}
.widget-btn-new:hover {
  background: rgba(86, 247, 222, 0.2);
}
.widget-btn-close {
  background: none;
  border: none;
  color: var(--aisoc-muted, #8aa8c3);
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.widget-btn-close:hover {
  color: var(--aisoc-text, #e1f4ff);
}

/* ── Message list ───────────────────────────────────────────── */
.widget-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.widget-msg {
  margin-bottom: 8px;
  max-width: 90%;
  animation: widget-fade-in 0.2s ease;
}
.widget-msg-user {
  margin-left: auto;
  background: rgba(86, 247, 222, 0.12);
  border-radius: 12px 12px 2px 12px;
  padding: 8px 12px;
}
.widget-msg-agent {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px 12px 12px 2px;
  padding: 8px 12px;
}
.widget-msg-thinking {
  font-style: italic;
  color: var(--aisoc-muted, #8aa8c3);
  font-size: 12px;
  padding: 4px 8px;
}
.widget-msg-tool {
  background: rgba(86, 247, 222, 0.04);
  border: 1px solid rgba(86, 247, 222, 0.12);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 11px;
}
.widget-msg-text {
  color: var(--aisoc-text, #e1f4ff);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.widget-msg-text code {
  background: rgba(86, 247, 222, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}
.widget-msg-text pre {
  background: rgba(0, 0, 0, 0.3);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 4px 0;
}
.widget-tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.widget-tool-name {
  color: var(--aisoc-accent, #56f7de);
  font-size: 10px;
}
.widget-tool-status {
  font-size: 9px;
  color: var(--aisoc-muted, #8aa8c3);
}
.widget-tool-status-done {
  color: #82ffd2;
}
.widget-tool-summary {
  font-size: 10px;
  color: var(--aisoc-muted, #8aa8c3);
  margin-top: 2px;
}
.widget-agent-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.widget-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #56f7de, #3a9d8f);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--aisoc-bg, #050a12);
  flex-shrink: 0;
  margin-top: 2px;
}

/* Approval / Clarify cards */
.widget-approval-card,
.widget-clarify-card {
  background: rgba(255, 107, 146, 0.06);
  border: 1px solid rgba(255, 107, 146, 0.2);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
}
.widget-clarify-card {
  background: rgba(86, 247, 222, 0.06);
  border-color: rgba(86, 247, 222, 0.2);
}
.widget-approval-text,
.widget-clarify-text {
  font-size: 11px;
  color: var(--aisoc-text, #e1f4ff);
  margin-bottom: 8px;
}
.widget-approval-actions,
.widget-clarify-actions {
  display: flex;
  gap: 6px;
}
.widget-btn-accept {
  background: rgba(86, 247, 222, 0.15);
  color: var(--aisoc-accent, #56f7de);
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}
.widget-btn-reject {
  background: rgba(255, 107, 146, 0.15);
  color: var(--aisoc-danger, #ff6b92);
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}
.widget-btn-choice {
  background: rgba(86, 247, 222, 0.1);
  color: var(--aisoc-accent, #56f7de);
  border: 1px solid rgba(86, 247, 222, 0.2);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}

/* Error banner */
.widget-error-banner {
  padding: 8px 12px;
  background: rgba(255, 107, 146, 0.1);
  color: var(--aisoc-danger, #ff6b92);
  font-size: 11px;
  text-align: center;
}
.widget-error-auth {
  cursor: pointer;
  text-decoration: underline;
}
.widget-error-auth:hover {
  background: rgba(255, 107, 146, 0.18);
}

/* Char count for long input */
.widget-char-count {
  font-size: 9px;
  color: var(--aisoc-muted, #8aa8c3);
  text-align: right;
  margin-top: 2px;
}

/* ── Input area ─────────────────────────────────────────────── */
.widget-input-area {
  padding: 12px;
  border-top: 1px solid rgba(86, 247, 222, 0.1);
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.widget-textarea {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(86, 247, 222, 0.15);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--aisoc-text, #e1f4ff);
  font-size: 12px;
  font-family: inherit;
  resize: none;
  min-height: 36px;
  max-height: 120px;
  outline: none;
  line-height: 1.4;
}
.widget-textarea:focus {
  border-color: rgba(86, 247, 222, 0.35);
}
.widget-textarea:disabled {
  opacity: 0.5;
}
.widget-textarea::placeholder {
  color: var(--aisoc-muted, #8aa8c3);
}
.widget-btn-send {
  background: linear-gradient(135deg, #56f7de, #3a9d8f);
  color: var(--aisoc-bg, #050a12);
  border: none;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.widget-btn-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Confirm dialog ─────────────────────────────────────────── */
.widget-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 18, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: calc(var(--aisoc-z-modal, 50) + 1);
}
.widget-confirm-card {
  background: rgba(13, 31, 53, 0.95);
  border: 1px solid rgba(255, 107, 146, 0.3);
  border-radius: 10px;
  padding: 20px;
  text-align: center;
  max-width: 300px;
}
.widget-confirm-title {
  color: var(--aisoc-danger, #ff6b92);
  font-size: 13px;
  margin-bottom: 6px;
}
.widget-confirm-text {
  color: var(--aisoc-muted, #8aa8c3);
  font-size: 11px;
  margin-bottom: 14px;
}
.widget-confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

@keyframes widget-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Reduced motion ─────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .widget-orbit-inner,
  .widget-orbit-outer,
  .widget-pulse,
  .widget-active-dot {
    animation: none;
  }
  .widget-drawer {
    transition: none;
  }
  .widget-msg {
    animation: none;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add aisoc/frontend/src/components/FloatingChat.css
git commit -m "feat(widget): add FloatingChat CSS with orbit animation and drawer styles"
```

---

### Task 4: UI Component — FloatingChat.tsx

**Files:**
- Create: `aisoc/frontend/src/components/FloatingChat.tsx`
- Create: `aisoc/frontend/src/components/FloatingChat.test.tsx`

- [ ] **Step 1: Write the structure test**

```typescript
// aisoc/frontend/src/components/FloatingChat.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

// Mock the hook to avoid WebSocket side effects during SSR tests
vi.mock("../lib/useAgentChat", () => ({
  useAgentChat: () => ({
    state: {
      phase: "disconnected",
      sessionId: null,
      messages: [],
      activeApproval: null,
      activeClarify: null,
      error: null,
    },
    send: vi.fn(),
    respondApproval: vi.fn(),
    respondClarify: vi.fn(),
    startNewSession: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    interrupt: vi.fn(),
  }),
  formatToolDuration: (s: number) => `${s.toFixed(1)}s`,
}));

import { FloatingChat } from "./FloatingChat";

describe("FloatingChat structure", () => {
  it("renders the floating icon with orbit elements", () => {
    const html = renderToStaticMarkup(<FloatingChat />);
    expect(html).toContain("widget-icon");
    expect(html).toContain("widget-orbit-inner");
    expect(html).toContain("widget-orbit-outer");
  });

  it("renders drawer (hidden via CSS translateX)", () => {
    const html = renderToStaticMarkup(<FloatingChat />);
    expect(html).toContain("widget-drawer");
    expect(html).toContain("widget-textarea");
  });

  it("renders send button", () => {
    const html = renderToStaticMarkup(<FloatingChat />);
    expect(html).toContain("widget-btn-send");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aisoc/frontend && npx vitest run src/components/FloatingChat.test.tsx`
Expected: FAIL — module `./FloatingChat` not found

- [ ] **Step 3: Write FloatingChat component**

```typescript
// aisoc/frontend/src/components/FloatingChat.tsx
import ReactMarkdown from "react-markdown";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentChat, formatToolDuration, type ChatMessage } from "../lib/useAgentChat";
import "./FloatingChat.css";

const LONG_INPUT_THRESHOLD = 10000;

export function FloatingChat() {
  const chat = useAgentChat();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"close" | "new">("close");
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = chat.state.phase === "streaming";

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.state.messages.length]);

  const requestConfirmOrAction = useCallback((action: "close" | "new", onConfirmed: () => void) => {
    if (isStreaming) {
      setConfirmAction(action);
      setShowConfirm(true);
      return;
    }
    onConfirmed();
  }, [isStreaming]);

  const handleIconClick = useCallback(() => {
    if (drawerOpen) {
      requestConfirmOrAction("close", () => setDrawerOpen(false));
      return;
    }
    setDrawerOpen(true);
    if (chat.state.phase === "disconnected") {
      chat.connect();
    }
  }, [drawerOpen, chat, requestConfirmOrAction]);

  const handleClose = useCallback(() => {
    requestConfirmOrAction("close", () => setDrawerOpen(false));
  }, [requestConfirmOrAction]);

  const handleNew = useCallback(() => {
    requestConfirmOrAction("new", () => chat.startNewSession());
  }, [chat, requestConfirmOrAction]);

  const handleKeepRunning = useCallback(() => {
    setShowConfirm(false);
    if (confirmAction === "new") return; // "New" cancelled, stay in current session
    setDrawerOpen(false);
  }, [confirmAction]);

  const handleInterruptConfirm = useCallback(() => {
    chat.interrupt();
    chat.disconnect();
    setShowConfirm(false);
    if (confirmAction === "new") {
      chat.startNewSession();
    } else {
      setDrawerOpen(false);
    }
  }, [chat, confirmAction]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    chat.send(input.trim());
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "36px";
  }, [input, isStreaming, chat]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "36px";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const isAuthError = chat.state.error?.includes("expired") || chat.state.error?.includes("4401") || chat.state.error?.includes("403");

  return (
    <>
      {/* Drawer */}
      <div className={`widget-drawer ${drawerOpen ? "widget-drawer-open" : ""}`}>
        <div className="widget-drawer-header">
          <span className="widget-drawer-title">
            Agent Chat
            {chat.state.sessionId ? (
              <span className="widget-drawer-session">
                {chat.state.sessionId.slice(0, 8)}
              </span>
            ) : null}
          </span>
          <button className="widget-btn-new" onClick={handleNew} type="button">
            New
          </button>
          <button className="widget-btn-close" onClick={handleClose} type="button">
            &times;
          </button>
        </div>

        {chat.state.error ? (
          <div
            className={`widget-error-banner ${isAuthError ? "widget-error-auth" : ""}`}
            onClick={isAuthError ? () => { window.location.href = "/login"; } : undefined}
          >
            {isAuthError ? "Session expired. Please sign in again." : chat.state.error}
          </div>
        ) : null}

        <div className="widget-messages">
          {chat.state.messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          {chat.state.activeApproval && (
            <ApprovalCard
              text={chat.state.activeApproval.command || "Approve this action?"}
              onAccept={() => chat.respondApproval(true)}
              onReject={() => chat.respondApproval(false)}
            />
          )}
          {chat.state.activeClarify && (
            <ClarifyCard
              question={chat.state.activeClarify.question}
              choices={chat.state.activeClarify.choices}
              onChoice={chat.respondClarify}
            />
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="widget-input-area">
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <textarea
              ref={textareaRef}
              className="widget-textarea"
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={isStreaming ? "Agent is responding..." : "Type a message..."}
              rows={1}
            />
            {input.length > LONG_INPUT_THRESHOLD ? (
              <div className="widget-char-count">{input.length.toLocaleString()} chars</div>
            ) : null}
          </div>
          <button
            className="widget-btn-send"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            type="button"
          >
            Send
          </button>
        </div>
      </div>

      {/* Floating icon */}
      <div className="widget-icon" onClick={handleIconClick} role="button" tabIndex={0}>
        <div className="widget-pulse" />
        <div className="widget-orbit-inner">
          <div className="widget-orbit-dot" />
        </div>
        <div className="widget-orbit-outer">
          <div className="widget-orbit-dot" />
        </div>
        {!drawerOpen && isStreaming ? <div className="widget-active-dot" /> : null}
        H
      </div>

      {/* Confirm dialog */}
      {showConfirm ? (
        <div className="widget-confirm-overlay">
          <div className="widget-confirm-card">
            <div className="widget-confirm-title">Agent is still working</div>
            <div className="widget-confirm-text">
              {confirmAction === "new" ? "Start a new session?" : "Close anyway?"}
            </div>
            <div className="widget-confirm-actions">
              <button className="widget-btn-accept" onClick={handleKeepRunning} type="button">
                {confirmAction === "new" ? "Cancel" : "Keep Running"}
              </button>
              <button className="widget-btn-reject" onClick={handleInterruptConfirm} type="button">
                {confirmAction === "new" ? "Interrupt & New" : "Interrupt & Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  switch (msg.role) {
    case "user":
      return (
        <div className="widget-msg widget-msg-user">
          <div className="widget-msg-text">{msg.text}</div>
        </div>
      );
    case "agent":
      return (
        <div className="widget-msg">
          <div className="widget-agent-row">
            <div className="widget-avatar">H</div>
            <div className="widget-msg widget-msg-agent">
              <div className="widget-msg-text">
                <ReactMarkdown>{msg.text || (msg.done ? "" : "...")}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      );
    case "thinking":
      return (
        <div className="widget-msg widget-msg-thinking">
          {"\u{1F4AD}"} {msg.text || "Thinking..."}
        </div>
      );
    case "tool": {
      const duration = msg.status === "done" && msg.duration_s != null
        ? ` ${formatToolDuration(msg.duration_s)}` : "";
      return (
        <div className="widget-msg widget-msg-tool">
          <div className="widget-tool-header">
            <span className="widget-tool-name">{"\u{1F527}"} {msg.name}</span>
            <span className={`widget-tool-status ${msg.status === "done" ? "widget-tool-status-done" : ""}`}>
              {msg.status === "running" ? "Running..." : `Done${duration}`}
            </span>
          </div>
          {msg.summary ? <div className="widget-tool-summary">{msg.summary}</div> : null}
        </div>
      );
    }
  }
}

function ApprovalCard({ text, onAccept, onReject }: { text: string; onAccept: () => void; onReject: () => void }) {
  return (
    <div className="widget-approval-card">
      <div className="widget-approval-text">{text}</div>
      <div className="widget-approval-actions">
        <button className="widget-btn-accept" onClick={onAccept} type="button">Allow</button>
        <button className="widget-btn-reject" onClick={onReject} type="button">Deny</button>
      </div>
    </div>
  );
}

function ClarifyCard({ question, choices, onChoice }: { question: string; choices: string[]; onChoice: (c: string) => void }) {
  return (
    <div className="widget-clarify-card">
      <div className="widget-clarify-text">{question}</div>
      <div className="widget-clarify-actions">
        {choices.map((c) => (
          <button key={c} className="widget-btn-choice" onClick={() => onChoice(c)} type="button">
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd aisoc/frontend && npx vitest run src/components/FloatingChat.test.tsx`
Expected: PASS

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `cd aisoc/frontend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add aisoc/frontend/src/components/FloatingChat.tsx aisoc/frontend/src/components/FloatingChat.test.tsx
git commit -m "feat(widget): add FloatingChat UI component with drawer and message rendering"
```

---

### Task 5: Mount in AppShell

**Files:**
- Modify: `aisoc/frontend/src/components/AppShell.tsx`

- [ ] **Step 1: Add import and render FloatingChat**

In `AppShell.tsx`, add the import at the top:

```typescript
import { FloatingChat } from "./FloatingChat";
```

Then add `<FloatingChat />` right after the `<Outlet />` line (inside the `<main>` element), so it renders on all authenticated pages:

```tsx
<main className="main-panel workbench-main">
  {showWorkbenchTopbar ? (
    <header className="workbench-topbar">...</header>
  ) : null}
  <Outlet />
  <FloatingChat />
</main>
```

- [ ] **Step 2: Verify no build errors**

Run: `cd aisoc/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `cd aisoc/frontend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add aisoc/frontend/src/components/AppShell.tsx
git commit -m "feat(widget): mount FloatingChat globally in AppShell"
```

---

### Task 6: Build Verification

- [ ] **Step 1: Run production build**

Run: `cd aisoc/frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run full test suite**

Run: `cd aisoc/frontend && npm test`
Expected: All tests PASS

- [ ] **Step 3: Final commit (if any build fixes needed)**

```bash
git add -A
git commit -m "fix(widget): address build issues"
```
