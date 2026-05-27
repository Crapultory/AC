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
    <section>
      <header className="detail-panel">
        <h2>Memory</h2>
        <p className="subtle-copy">Edit `SOUL.md`, `USER.md`, and built-in memory files.</p>
      </header>
      <div className="memory-layout" style={{ marginTop: 14 }}>
        <aside className="detail-panel memory-nav">
          <h3>Memory Files</h3>
          <button type="button" onClick={() => setSelected("soul")}>
            Agent Soul
          </button>
          <button type="button" onClick={() => setSelected("user")}>
            User Preferences
          </button>
          {(memoryIndex?.memory_files || []).map((file) => (
            <button key={file.name} type="button" onClick={() => setSelected(`file:${file.name}`)}>
              {file.name}
            </button>
          ))}
        </aside>
        <div className="detail-panel memory-editor">
          <h3>{selectedLabel}</h3>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={20} />
          <div>
            <button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
