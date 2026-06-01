import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchJSON } from "../lib/api";

type SessionRow = {
  id: string;
  session_id?: string;
  title?: string;
  model?: string;
  source?: string;
  is_active?: boolean;
  started_at?: number;
  last_active?: number;
  ended_at?: number | null;
};

type SessionsResponse = {
  sessions: SessionRow[];
  total?: number;
  limit?: number;
  offset?: number;
};

type SessionMessagesResponse = {
  session_id: string;
  messages: Array<{
    id?: string | number;
    role?: string;
    content?: unknown;
    timestamp?: number;
    [key: string]: unknown;
  }>;
};

export function isLatestSessionSelectionRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

export function isSessionActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

function formatSessionDate(row: SessionRow): string {
  const candidate = row.last_active ?? row.started_at ?? undefined;
  if (!candidate) return "--";
  const date = new Date(candidate * 1000);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeMessageText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeToolCallArguments(argumentsValue: unknown): string {
  if (typeof argumentsValue !== "string") return safeJsonStringify(argumentsValue);
  const trimmed = argumentsValue.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function indentBlock(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function formatToolCallsPayload(toolCalls: unknown): string {
  if (!toolCalls) return "";
  if (!Array.isArray(toolCalls)) return safeJsonStringify(toolCalls);
  const blocks = toolCalls.map((item, index) => {
    const entry = item as Record<string, unknown>;
    const fn = (entry.function as Record<string, unknown> | undefined) || undefined;
    const header = `#${index + 1} ${String(fn?.name || "unknown_function")}`;
    const lines = [header];
    if (entry.id) lines.push(`id: ${String(entry.id)}`);
    if (entry.type) lines.push(`type: ${String(entry.type)}`);
    if (fn && Object.prototype.hasOwnProperty.call(fn, "arguments")) {
      const args = normalizeToolCallArguments(fn.arguments);
      lines.push("arguments:");
      lines.push(indentBlock(args || "(empty)"));
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

function formatMessagePayload(message: SessionMessagesResponse["messages"][number]): string {
  const sections: string[] = [];
  const rawContent = message.content;

  if (typeof rawContent === "string" && rawContent.trim().length > 0) {
    sections.push(normalizeMessageText(rawContent));
  } else if (Array.isArray(rawContent)) {
    const parts: string[] = [];
    for (const block of rawContent) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          parts.push(normalizeMessageText(b.text));
        } else if (b.type === "tool_use" || b.type === "tool_result") {
          const label = b.type === "tool_use" ? (b.name || "tool") : "result";
          let detail = "";
          if (b.input && typeof b.input === "object") detail = safeJsonStringify(b.input);
          else if (typeof b.content === "string" && b.content.trim()) detail = normalizeMessageText(b.content);
          else if (b.content && typeof b.content === "object") detail = safeJsonStringify(b.content);
          parts.push(`[${label}]${detail ? " " + detail : ""}`);
        } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
          parts.push(normalizeMessageText(b.thinking));
        }
      }
    }
    if (parts.length > 0) sections.push(parts.join("\n"));
    else if (rawContent.length > 0) sections.push(normalizeMessageText(safeJsonStringify(rawContent)));
  } else if (rawContent !== undefined && rawContent !== null && rawContent !== "") {
    sections.push(normalizeMessageText(safeJsonStringify(rawContent)));
  }

  const toolCallsRendered = formatToolCallsPayload(message.tool_calls);
  if (toolCallsRendered) {
    sections.push(`tool_calls\n${toolCallsRendered}`);
  }

  const functionCall = message.function_call;
  if (functionCall !== undefined) {
    sections.push(`function_call\n${safeJsonStringify(functionCall)}`);
  }

  if (sections.length > 0) return sections.join("\n\n");
  return "(no textual content)";
}

export function SessionsPage() {
  const navigate = useNavigate();
  const pageLimit = 20;
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [messages, setMessages] = useState<SessionMessagesResponse["messages"]>([]);
  const [expandedToolMessages, setExpandedToolMessages] = useState<Record<string, boolean>>({});
  const detailRequestIdRef = useRef(0);
  const visibleMessages = messages.filter((msg) => (msg.role || "").toLowerCase() !== "system");
  const renderedMessages = visibleMessages
    .map((msg) => ({ msg, rendered: formatMessagePayload(msg) }));

  async function loadPage(nextOffset: number, firstLoad = false) {
    if (firstLoad) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const query = nextOffset > 0 ? `?limit=${pageLimit}&offset=${nextOffset}` : `?limit=${pageLimit}`;
      const payload = await fetchJSON<SessionsResponse>(`/api/sessions${query}`);
      const nextRows = payload.sessions || [];
      const reportedTotal = typeof payload.total === "number" ? payload.total : nextRows.length + nextOffset;
      setRows(nextRows);
      setTotal(reportedTotal);
      setOffset(nextOffset);

      if (selectedSessionId && !nextRows.some((row) => (row.id || row.session_id || "") === selectedSessionId)) {
        setSelectedSessionId("");
        setMessages([]);
      }
    } catch {
      setError("Failed to load sessions.");
    } finally {
      if (firstLoad) setLoading(false);
      else setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadPage(0, true);
  }, []);

  async function relaunch(rawSessionId: string) {
    try {
      const payload = await fetchJSON<{ session_id: string }>(
        `/api/sessions/${encodeURIComponent(rawSessionId)}/latest-descendant`,
      );
      navigate(`/chat?resume=${encodeURIComponent(payload.session_id || rawSessionId)}`);
    } catch {
      navigate(`/chat?resume=${encodeURIComponent(rawSessionId)}`);
    }
  }

  async function selectSession(rawSessionId: string) {
    if (!rawSessionId) return;
    const requestId = ++detailRequestIdRef.current;
    setSelectedSessionId(rawSessionId);
    setExpandedToolMessages({});
    setDetailLoading(true);
    setDetailError("");
    try {
      const messagePayload = await fetchJSON<SessionMessagesResponse>(
        `/api/sessions/${encodeURIComponent(rawSessionId)}/messages`,
      );
      if (!isLatestSessionSelectionRequest(requestId, detailRequestIdRef.current)) return;
      setMessages(messagePayload.messages || []);
    } catch {
      if (!isLatestSessionSelectionRequest(requestId, detailRequestIdRef.current)) return;
      setMessages([]);
      setDetailError("Failed to load session messages.");
    } finally {
      if (!isLatestSessionSelectionRequest(requestId, detailRequestIdRef.current)) return;
      setDetailLoading(false);
    }
  }

  async function deleteSession(rawSessionId: string) {
    if (!rawSessionId) return;
    if (!window.confirm("Delete this session from history? This operation cannot be undone.")) return;
    setDeletingSessionId(rawSessionId);
    setError("");
    try {
      await fetchJSON(`/api/sessions/${encodeURIComponent(rawSessionId)}`, { method: "DELETE" });
      const shouldStepBack = rows.length <= 1 && offset >= pageLimit;
      const nextOffset = shouldStepBack ? offset - pageLimit : offset;
      await loadPage(nextOffset, false);
      if (selectedSessionId === rawSessionId) {
        setSelectedSessionId("");
        setMessages([]);
      }
    } catch {
      setError("Failed to delete session.");
    } finally {
      setDeletingSessionId("");
    }
  }

  const page = Math.floor(offset / pageLimit) + 1;
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageLimit));
  const canPrev = offset > 0 && !refreshing;
  const canNext = offset + pageLimit < total && !refreshing;

  return (
    <section className="sessions-workbench-page">
      {error ? <p className="error-text">{error}</p> : null}
      <div className="sessions-workbench">
        <article className="detail-panel sessions-history-pane">
          <div className="sessions-history-head">
            <h3>Session History</h3>
            <span className="status-badge">
              {refreshing ? "Refreshing..." : `${total} total`}
            </span>
          </div>
          <p className="subtle-copy">Title, model, and date are shown per session. Click an item to inspect messages.</p>
          {loading ? <p>Loading sessions...</p> : null}
          {!loading && rows.length === 0 ? <p className="subtle-copy">No sessions found.</p> : null}
          <div className="sessions-history-scroll">
            <ul className="list-grid sessions-history-list">
              {rows.map((row) => (
                <li
                  key={row.id || row.session_id}
                  className={
                    selectedSessionId === (row.id || row.session_id || "")
                      ? "clickable-card active"
                      : "clickable-card"
                  }
                  role="button"
                  tabIndex={0}
                  onClick={() => selectSession(row.id || row.session_id || "")}
                  onKeyDown={(event) => {
                    if (!isSessionActivationKey(event.key)) return;
                    event.preventDefault();
                    void selectSession(row.id || row.session_id || "");
                  }}
                >
                  <div className="sessions-history-item-top">
                    <strong>{row.title || row.id || row.session_id}</strong>
                    <div className="sessions-history-actions">
                      <button
                        type="button"
                        className="ghost-button session-icon-button"
                        title="Relaunch in chat"
                        aria-label="Relaunch in chat"
                        onClick={(event) => {
                          event.stopPropagation();
                          void relaunch(row.id || row.session_id || "");
                        }}
                        disabled={!(row.id || row.session_id)}
                      >
                        ↻
                      </button>
                      <button
                        type="button"
                        className="ghost-button session-icon-button session-delete-button"
                        title="Delete session"
                        aria-label="Delete session"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteSession(row.id || row.session_id || "");
                        }}
                        disabled={deletingSessionId === (row.id || row.session_id || "")}
                      >
                        {deletingSessionId === (row.id || row.session_id || "") ? "…" : "×"}
                      </button>
                    </div>
                  </div>
                  <div className="sessions-history-item-meta">
                    <span>{row.model || "unknown-model"}</span>
                    <span>{row.source || "unknown-source"}</span>
                    <span>{formatSessionDate(row)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="sessions-pagination">
            <button type="button" className="ghost-button" disabled={!canPrev} onClick={() => void loadPage(offset - pageLimit, false)}>
              Previous
            </button>
            <span className="status-badge">
              Page {page} / {totalPages}
            </span>
            <button type="button" className="ghost-button" disabled={!canNext} onClick={() => void loadPage(offset + pageLimit, false)}>
              Next
            </button>
          </div>
        </article>
        <article className="detail-panel sessions-message-pane sessions-message-pane-wide">
          <div className="sessions-message-head">
            <h3>Session Messages</h3>
            {selectedSessionId ? <span className="status-badge sessions-message-badge">{selectedSessionId}</span> : null}
          </div>
          {!selectedSessionId ? (
            <p className="subtle-copy">Click a session row to inspect messages.</p>
          ) : null}
          {detailLoading ? <p>Loading messages...</p> : null}
          {detailError ? <p className="error-text">{detailError}</p> : null}
          {!detailLoading && !detailError && selectedSessionId && renderedMessages.length === 0 ? (
            <p className="subtle-copy">No non-system messages available for this session.</p>
          ) : null}
          {renderedMessages.length > 0 ? (
            <div className="detail-messages sessions-message-stream">
              {renderedMessages.map(({ msg, rendered }, index) => (
                <div
                  key={`${msg.id || "msg"}-${msg.timestamp || "t"}-${index}`}
                  className="detail-message"
                >
                  <p>
                    <strong>{msg.role || "unknown"}</strong>
                  </p>
                  {(() => {
                    const role = String(msg.role || "").toLowerCase();
                    const messageKey = `${selectedSessionId}:${msg.id || index}:${msg.timestamp || ""}`;
                    const isToolMessage = role === "tool";
                    const shouldCollapse = isToolMessage && rendered.length > 120;
                    const isExpanded = Boolean(expandedToolMessages[messageKey]);
                    const preview = `${rendered.slice(0, 120)}...`;
                    return (
                      <>
                        <pre>{shouldCollapse && !isExpanded ? preview : rendered}</pre>
                        {shouldCollapse ? (
                          <button
                            type="button"
                            className="ghost-button tool-message-toggle"
                            onClick={() =>
                              setExpandedToolMessages((current) => ({
                                ...current,
                                [messageKey]: !current[messageKey],
                              }))
                            }
                            aria-label={isExpanded ? "Collapse tool message" : "Expand tool message"}
                          >
                            {isExpanded ? "Collapse" : "Expand"}
                          </button>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
