import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchJSON } from "../lib/api";

type SessionRow = {
  id: string;
  session_id?: string;
  title?: string;
  model?: string;
  source?: string;
  is_active?: boolean;
};

type SessionsResponse = {
  sessions: SessionRow[];
};

type SessionMessagesResponse = {
  session_id: string;
  messages: Array<{
    role?: string;
    content?: string;
    timestamp?: number;
    [key: string]: unknown;
  }>;
};

export function SessionsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [messages, setMessages] = useState<SessionMessagesResponse["messages"]>([]);

  useEffect(() => {
    async function load() {
      try {
        const payload = await fetchJSON<SessionsResponse>("/api/sessions?limit=20");
        setRows(payload.sessions || []);
      } catch {
        setError("Failed to load sessions.");
      } finally {
        setLoading(false);
      }
    }
    void load();
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
    setSelectedSessionId(rawSessionId);
    setDetailLoading(true);
    setDetailError("");
    try {
      const messagePayload = await fetchJSON<SessionMessagesResponse>(
        `/api/sessions/${encodeURIComponent(rawSessionId)}/messages`,
      );
      setMessages(messagePayload.messages || []);
    } catch {
      setMessages([]);
      setDetailError("Failed to load session messages.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section>
      <h2>Sessions</h2>
      {loading ? <p>Loading sessions...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      <div className="detail-layout">
        <ul className="list-grid">
          {rows.map((row) => (
            <li
              key={row.id || row.session_id}
              className={
                selectedSessionId === (row.id || row.session_id || "")
                  ? "clickable-card active"
                  : "clickable-card"
              }
              onClick={() => selectSession(row.id || row.session_id || "")}
            >
              <strong>{row.title || row.id || row.session_id}</strong>
              <p>{row.model || "unknown-model"}</p>
              <p>{row.source || "unknown-source"}</p>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void relaunch(row.id || row.session_id || "");
                }}
                disabled={!(row.id || row.session_id)}
              >
                Relaunch in Chat
              </button>
            </li>
          ))}
        </ul>
        <aside className="detail-panel">
          <h3>Session Messages</h3>
          {!selectedSessionId ? (
            <p className="subtle-copy">Click a session row to inspect messages.</p>
          ) : null}
          {detailLoading ? <p>Loading messages...</p> : null}
          {detailError ? <p className="error-text">{detailError}</p> : null}
          {messages.length > 0 ? (
            <div className="detail-messages">
              <h4>Recent Messages</h4>
              {messages
                .filter((msg) => (msg.role || "").toLowerCase() !== "system")
                .slice(-20)
                .map((msg, index) => (
                  <div key={`${index}-${msg.role || "unknown"}`} className="detail-message">
                    <p><strong>{msg.role || "unknown"}</strong></p>
                    <pre>{typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}</pre>
                  </div>
                ))}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
