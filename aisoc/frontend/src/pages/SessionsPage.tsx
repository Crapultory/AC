import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { PageMissionHeader } from "../components/PageMissionHeader";
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
  const visibleMessages = messages.filter((msg) => (msg.role || "").toLowerCase() !== "system");
  const selectedSession = rows.find((row) => (row.id || row.session_id || "") === selectedSessionId);

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
    <section className="sessions-workbench-page">
      <PageMissionHeader
        title="Sessions"
        subtitle="Scan recent runs, deep-dive message trails, and keep investigation context aligned."
        status={<span className="status-badge">Loaded: {rows.length}</span>}
        actions={
          selectedSessionId ? (
            <span className="status-badge" title={selectedSessionId}>
              Selected: {selectedSessionId}
            </span>
          ) : null
        }
      />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="sessions-workbench">
        <article className="detail-panel sessions-scan-pane">
          <h3>Recent Sessions</h3>
          <p className="subtle-copy">Click a row to inspect message-only detail and relaunch from the same lineage.</p>
          {loading ? <p>Loading sessions...</p> : null}
          {!loading && rows.length === 0 ? <p className="subtle-copy">No sessions found.</p> : null}
          <ul className="list-grid sessions-scan-list">
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
        </article>
        <article className="detail-panel sessions-message-pane">
          <h3>Session Messages</h3>
          <p className="subtle-copy">
            Detail view shows message payloads only. System role messages are filtered out.
          </p>
          {!selectedSessionId ? (
            <p className="subtle-copy">Click a session row to inspect messages.</p>
          ) : null}
          {detailLoading ? <p>Loading messages...</p> : null}
          {detailError ? <p className="error-text">{detailError}</p> : null}
          {!detailLoading && !detailError && selectedSessionId && visibleMessages.length === 0 ? (
            <p className="subtle-copy">No non-system messages available for this session.</p>
          ) : null}
          {visibleMessages.length > 0 ? (
            <div className="detail-messages sessions-message-stream">
              <h4>Recent Messages</h4>
              {visibleMessages.slice(-20).map((msg, index) => (
                <div key={`${index}-${msg.role || "unknown"}`} className="detail-message">
                  <p>
                    <strong>{msg.role || "unknown"}</strong>
                  </p>
                  <pre>{typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}</pre>
                </div>
              ))}
            </div>
          ) : null}
        </article>
        <aside className="detail-panel sessions-context-rail">
          <h3>Analysis Context</h3>
          <p className="subtle-copy">Use this rail to keep session identity and scan-to-detail workflow grounded.</p>
          {!selectedSession ? (
            <p className="subtle-copy">No session selected.</p>
          ) : (
            <div className="sessions-context-grid">
              <p>
                <strong>Session ID</strong>
              </p>
              <p>{selectedSessionId}</p>
              <p>
                <strong>Model</strong>
              </p>
              <p>{selectedSession.model || "unknown-model"}</p>
              <p>
                <strong>Source</strong>
              </p>
              <p>{selectedSession.source || "unknown-source"}</p>
              <p>
                <strong>Visible Messages</strong>
              </p>
              <p>{visibleMessages.length}</p>
            </div>
          )}
          <div className="sessions-context-actions">
            <p className="subtle-copy">
              Relaunch is best-effort to latest descendant and falls back to the selected session.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
