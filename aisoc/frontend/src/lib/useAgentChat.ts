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
