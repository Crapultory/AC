import { useEffect, useMemo, useState } from "react";

import { fetchJSON } from "../lib/api";

type MemoryIndex = {
  soul: { name: string };
  user_preferences: { name: string };
  memory_files: Array<{ name: string }>;
};

type MemoryFilePayload = {
  name: string;
  content: string;
};

type EditorKind = "soul" | "user" | `file:${string}`;

export function MemoryPage() {
  const [memoryIndex, setMemoryIndex] = useState<MemoryIndex | null>(null);
  const [selected, setSelected] = useState<EditorKind>("soul");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      try {
        const payload = await fetchJSON<MemoryIndex>("/api/memory");
        setMemoryIndex(payload);
      } catch {
        setError("Failed to load memory index.");
      }
    }
    void bootstrap();
  }, []);

  const selectedLabel = useMemo(() => {
    if (selected === "soul") return "Agent Soul";
    if (selected === "user") return "User Preferences";
    return selected.replace("file:", "");
  }, [selected]);

  const selectedSourceName = useMemo(() => {
    if (selected === "soul") return memoryIndex?.soul.name ?? "SOUL.md";
    if (selected === "user") return memoryIndex?.user_preferences.name ?? "USER.md";
    return selected.replace("file:", "");
  }, [memoryIndex, selected]);

  const selectedApiPath = useMemo(() => {
    if (selected === "soul") return "/api/memory/soul";
    if (selected === "user") return "/api/memory/user";
    return `/api/memory/files/${selected.replace("file:", "")}`;
  }, [selected]);

  async function loadEditor(kind: EditorKind) {
    setSelected(kind);
    setError("");
    try {
      let payload: MemoryFilePayload;
      if (kind === "soul") {
        payload = await fetchJSON<MemoryFilePayload>("/api/memory/soul");
      } else if (kind === "user") {
        payload = await fetchJSON<MemoryFilePayload>("/api/memory/user");
      } else {
        payload = await fetchJSON<MemoryFilePayload>(
          `/api/memory/files/${kind.replace("file:", "")}`,
        );
      }
      setContent(payload.content || "");
    } catch {
      setError("Failed to load memory content.");
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (selected === "soul") {
        await fetchJSON("/api/memory/soul", {
          method: "PUT",
          body: JSON.stringify({ content }),
        });
      } else if (selected === "user") {
        await fetchJSON("/api/memory/user", {
          method: "PUT",
          body: JSON.stringify({ content }),
        });
      } else {
        await fetchJSON(`/api/memory/files/${selected.replace("file:", "")}`, {
          method: "PUT",
          body: JSON.stringify({ content }),
        });
      }
    } catch {
      setError("Failed to save memory content.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadEditor(selected);
    // selected is driven by click handlers; reloading on change keeps editor synchronized.
  }, [selected]);

  return (
    <section className="memory-workbench-page">
      <header className="page-mission-header memory-mission-header">
        <div>
          <h2>Memory</h2>
          <p className="subtle-copy">
            Edit `SOUL.md`, `USER.md`, and built-in memory files.
          </p>
        </div>
        <div className="page-mission-meta">
          <span className="badge">
            {(memoryIndex?.memory_files || []).length} indexed files
          </span>
        </div>
      </header>
      <div className="memory-layout memory-workbench">
        <div className="detail-panel memory-editor memory-editor-pane">
          <h3>{selectedLabel}</h3>
          <p className="subtle-copy">Primary editor pane. Save writes directly to the selected memory file.</p>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={20} />
          <div className="memory-save-row">
            <button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <aside className="memory-context-rail">
          <section className="detail-panel memory-nav memory-index-panel">
            <h3>Memory Files</h3>
            <button
              className={selected === "soul" ? "active" : ""}
              type="button"
              onClick={() => setSelected("soul")}
            >
              Agent Soul
            </button>
            <button
              className={selected === "user" ? "active" : ""}
              type="button"
              onClick={() => setSelected("user")}
            >
              User Preferences
            </button>
            {(memoryIndex?.memory_files || []).map((file) => {
              const key = `file:${file.name}` as const;
              return (
                <button
                  key={file.name}
                  className={selected === key ? "active" : ""}
                  type="button"
                  onClick={() => setSelected(key)}
                >
                  {file.name}
                </button>
              );
            })}
          </section>
          <section className="detail-panel memory-file-context">
            <h3>File Context</h3>
            <p className="subtle-copy">Current selection: {selectedLabel}</p>
            <p className="subtle-copy">Source: {selectedSourceName}</p>
            <p className="subtle-copy">
              Save target:{" "}
              <code>{selectedApiPath}</code>
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
