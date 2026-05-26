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

export function SessionsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const payload = await fetchJSON<SessionsResponse>("/api/sessions?limit=40");
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

  return (
    <section>
      <h2>Sessions</h2>
      {loading ? <p>Loading sessions...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      <ul className="list-grid">
        {rows.map((row) => (
          <li key={row.id || row.session_id}>
            <strong>{row.title || row.id || row.session_id}</strong>
            <p>{row.model || "unknown-model"}</p>
            <p>{row.source || "unknown-source"}</p>
            <button
              type="button"
              onClick={() => relaunch(row.id || row.session_id || "")}
              disabled={!(row.id || row.session_id)}
            >
              Relaunch in Chat
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
