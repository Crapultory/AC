import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchJSON } from "../lib/api";

type SessionRow = {
  id: string;
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

  return (
    <section>
      <h2>Sessions</h2>
      {loading ? <p>Loading sessions...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      <ul className="list-grid">
        {rows.map((row) => (
          <li key={row.id}>
            <strong>{row.title || row.id}</strong>
            <p>{row.model || "unknown-model"}</p>
            <p>{row.source || "unknown-source"}</p>
            <button type="button" onClick={() => navigate(`/chat?resume=${row.id}`)}>
              Relaunch in Chat
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
