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

  async function loadSkills() {
    try {
      const payload = await fetchJSON<SkillRow[]>("/api/skills");
      setSkills(payload || []);
    } catch {
      setError("Failed to load skills.");
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
      <h2>Skills</h2>
      {error ? <p className="error-text">{error}</p> : null}
      <ul className="list-grid">
        {skills.map((skill) => (
          <li key={skill.name}>
            <strong>{skill.name}</strong>
            <p>{skill.description || "No description available."}</p>
            <button
              type="button"
              onClick={() => toggleSkill(skill.name, !skill.enabled)}
            >
              {skill.enabled ? "Disable" : "Enable"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
