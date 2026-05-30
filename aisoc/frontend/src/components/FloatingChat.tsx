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
