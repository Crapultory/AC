import { useEffect, useState } from "react";

import { fetchJSON } from "../lib/api";

type SkillRow = {
  name: string;
  description?: string;
  enabled: boolean;
};

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadSkills() {
    setLoading(true);
    try {
      const payload = await fetchJSON<SkillRow[]>("/api/skills");
      setSkills(payload || []);
    } catch {
      setError("Failed to load skills.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleSkill(name: string, enabled: boolean) {
    await fetchJSON("/api/skills/toggle", {
      method: "PUT",
      body: JSON.stringify({ name, enabled }),
    });
    await loadSkills();
  }

  useEffect(() => {
    void loadSkills();
  }, []);

  return (
    <section>
      <header className="detail-panel">
        <h2>Skills</h2>
        <p className="subtle-copy">Enable or disable skill modules without changing backend behavior.</p>
        {error ? <p className="error-text">{error}</p> : null}
      </header>
      <section className="detail-panel" style={{ marginTop: 14 }}>
        <h3>Installed Skills</h3>
        {loading ? <p className="subtle-copy">Loading skills...</p> : null}
        {!loading && !error && skills.length === 0 ? <p className="subtle-copy">No skills found.</p> : null}
        <ul
          className="list-grid"
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {skills.map((skill) => (
            <li key={skill.name}>
              <strong>{skill.name}</strong>
              <p>{skill.description || "No description available."}</p>
              <button type="button" onClick={() => toggleSkill(skill.name, !skill.enabled)}>
                {skill.enabled ? "Disable" : "Enable"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
