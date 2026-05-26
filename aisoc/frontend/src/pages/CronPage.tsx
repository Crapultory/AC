import { useEffect, useState } from "react";

import { fetchJSON } from "../lib/api";

type CronJob = {
  id?: string;
  name?: string;
  profile?: string;
  schedule?: string;
  paused?: boolean;
};

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [error, setError] = useState("");

  async function loadJobs() {
    try {
      const payload = await fetchJSON<CronJob[]>("/api/cron/jobs");
      setJobs(payload || []);
    } catch {
      setError("Failed to load cron jobs.");
    }
  }

  async function action(jobId: string, verb: "pause" | "resume" | "trigger") {
    await fetchJSON(`/api/cron/jobs/${jobId}/${verb}`, { method: "POST" });
    await loadJobs();
  }

  useEffect(() => {
    void loadJobs();
  }, []);

  return (
    <section>
      <h2>Cron</h2>
      {error ? <p className="error-text">{error}</p> : null}
      <ul className="list-grid">
        {jobs.map((job) => (
          <li key={job.id || job.name}>
            <strong>{job.name || job.id}</strong>
            <p>{job.schedule || "no schedule"}</p>
            <p>Profile: {job.profile || "default"}</p>
            {job.id ? (
              <div className="button-row">
                <button type="button" onClick={() => action(job.id as string, "trigger")}>
                  Trigger
                </button>
                <button type="button" onClick={() => action(job.id as string, "pause")}>
                  Pause
                </button>
                <button type="button" onClick={() => action(job.id as string, "resume")}>
                  Resume
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
