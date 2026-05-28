import { useEffect, useState } from "react";

import { PageMissionHeader } from "../components/PageMissionHeader";
import { StateBlock } from "../components/StateBlock";
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
  const [pendingSkill, setPendingSkill] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  async function loadSkills(): Promise<boolean> {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchJSON<SkillRow[]>("/api/skills");
      setSkills(payload || []);
      return true;
    } catch {
      setError("Failed to load skills.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function toggleSkill(name: string, enabled: boolean) {
    setPendingSkill(name);
    setActionError("");
    setActionSuccess("");
    try {
      await fetchJSON("/api/skills/toggle", {
        method: "PUT",
        body: JSON.stringify({ name, enabled }),
      });
      const refreshSucceeded = await loadSkills();
      if (!refreshSucceeded) {
        setActionError(`Updated ${name}, but failed to refresh skills from /api/skills.`);
        return;
      }
      setActionSuccess(`${name} ${enabled ? "enabled" : "disabled"} successfully.`);
    } catch {
      setActionError(`Failed to ${enabled ? "enable" : "disable"} ${name}.`);
    } finally {
      setPendingSkill("");
    }
  }

  useEffect(() => {
    void loadSkills();
  }, []);

  const enabledSkills = skills.filter((skill) => skill.enabled);
  const disabledSkills = skills.filter((skill) => !skill.enabled);

  return (
    <section className="skills-workbench-page">
      <PageMissionHeader
        title="Skills Operations"
        subtitle="Enable or disable analyst capabilities while preserving existing backend toggle behavior."
        status={<span className="status-badge">Installed: {skills.length}</span>}
        actions={
          <span className="status-badge">
            Enabled: {enabledSkills.length} / Disabled: {disabledSkills.length}
          </span>
        }
      />
      {error ? <StateBlock kind="error" title="Skill Inventory Unavailable" message={error} /> : null}
      <div className="skills-workbench">
        <article className="detail-panel skills-enabled-pane">
          <h3>Installed Skills</h3>
          <p className="subtle-copy">Group by status, then run enable/disable operations per skill card.</p>
          {loading ? (
            <StateBlock
              kind="loading"
              title="Loading Skills"
              message="Fetching inventory from /api/skills."
            />
          ) : null}
          {!loading && !error && skills.length === 0 ? (
            <StateBlock
              kind="empty"
              title="No Skills Found"
              message="No skill entries were returned for this profile."
            />
          ) : null}
          <div className="skills-group-stack">
            <section className="skills-group">
              <h4>Enabled Skills</h4>
              <p className="subtle-copy">Active modules currently available to the analyst runtime.</p>
              {loading ? <p className="subtle-copy">Waiting for inventory to load before rendering enabled cards.</p> : null}
              {!loading && !error && enabledSkills.length === 0 ? (
                <StateBlock kind="empty" title="No Enabled Skills" message="Use the disabled list to activate skills." />
              ) : null}
              {!loading && !error && enabledSkills.length > 0 ? (
                <ul className="list-grid skills-list">
                  {enabledSkills.map((skill) => (
                    <li key={skill.name} className="skills-card">
                      <div className="skills-card-head">
                        <strong>{skill.name}</strong>
                        <span className="status-badge">Enabled</span>
                      </div>
                      <p>{skill.description || "No description available."}</p>
                      <div className="button-row skill-action-zone">
                        <button
                          type="button"
                          disabled={pendingSkill === skill.name}
                          onClick={() => void toggleSkill(skill.name, false)}
                        >
                          {pendingSkill === skill.name ? "Disabling..." : "Disable"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
            <section className="skills-group">
              <h4>Disabled Skills</h4>
              <p className="subtle-copy">Standby modules that can be activated without backend changes.</p>
              {loading ? <p className="subtle-copy">Waiting for inventory to load before rendering disabled cards.</p> : null}
              {!loading && !error && disabledSkills.length === 0 ? (
                <StateBlock kind="empty" title="No Disabled Skills" message="All discovered skills are currently enabled." />
              ) : null}
              {!loading && !error && disabledSkills.length > 0 ? (
                <ul className="list-grid skills-list">
                  {disabledSkills.map((skill) => (
                    <li key={skill.name} className="skills-card">
                      <div className="skills-card-head">
                        <strong>{skill.name}</strong>
                        <span className="status-badge">Disabled</span>
                      </div>
                      <p>{skill.description || "No description available."}</p>
                      <div className="button-row skill-action-zone">
                        <button
                          type="button"
                          disabled={pendingSkill === skill.name}
                          onClick={() => void toggleSkill(skill.name, true)}
                        >
                          {pendingSkill === skill.name ? "Enabling..." : "Enable"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        </article>
        <aside className="detail-panel skills-context-rail">
          <h3>Operation Context</h3>
          <p className="subtle-copy">Action zone markers and feedback for skill toggle operations.</p>
          <div className="skill-action-zone">
            <p className="subtle-copy">
              Action zone: use Enable/Disable controls on each card to call /api/skills/toggle.
            </p>
          </div>
          {pendingSkill ? (
            <StateBlock
              kind="loading"
              title="Applying Toggle"
              message={`Updating ${pendingSkill} via /api/skills/toggle.`}
            />
          ) : null}
          {actionSuccess ? (
            <StateBlock kind="success" title="Operation Completed" message={actionSuccess} />
          ) : null}
          {actionError ? <StateBlock kind="error" title="Operation Failed" message={actionError} /> : null}
        </aside>
      </div>
    </section>
  );
}
