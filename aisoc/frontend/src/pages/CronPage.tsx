import { useEffect, useState } from "react";

import { fetchJSON } from "../lib/api";

type CronJob = {
  id?: string;
  name?: string;
  profile?: string;
  schedule?:
    | string
    | {
        kind?: string;
        expr?: string;
        display?: string;
      };
  paused?: boolean;
};

function renderSchedule(schedule: CronJob["schedule"]): string {
  if (!schedule) return "no schedule";
  if (typeof schedule === "string") return schedule;
  if (schedule.display) return schedule.display;
  if (schedule.expr) return schedule.expr;
  if (schedule.kind) return schedule.kind;
  return "no schedule";
}

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  async function loadJobs() {
    setLoading(true);
    try {
      const payload = await fetchJSON<CronJob[]>("/api/cron/jobs");
      setJobs(payload || []);
    } catch {
      setError("Failed to load cron jobs.");
    } finally {
      setLoading(false);
    }
  }

  async function action(jobId: string, verb: "pause" | "resume" | "trigger") {
    await fetchJSON(`/api/cron/jobs/${jobId}/${verb}`, { method: "POST" });
    await loadJobs();
  }

  async function selectJob(rawId: string) {
    if (!rawId) return;
    setSelectedJobId(rawId);
    setDetailLoading(true);
    setDetailError("");
    try {
      const payload = await fetchJSON<Record<string, unknown>>(
        `/api/cron/jobs/${encodeURIComponent(rawId)}`,
      );
      setDetail(payload);
    } catch {
      setDetail(null);
      setDetailError("Failed to load cron job details.");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadJobs();
  }, []);

  return (
    <section>
      <header className="detail-panel">
        <h2>Cron</h2>
        <p className="subtle-copy">Inspect and control scheduled jobs.</p>
        {error ? <p className="error-text">{error}</p> : null}
      </header>
      <div className="detail-layout" style={{ marginTop: 14 }}>
        <article className="detail-panel">
          <h3>Jobs</h3>
          {loading ? <p className="subtle-copy">Loading cron jobs...</p> : null}
          {!loading && jobs.length === 0 ? <p className="subtle-copy">No cron jobs found.</p> : null}
          <ul className="list-grid" style={{ display: "grid", gap: 10 }}>
            {jobs.map((job) => (
              <li
                key={job.id || job.name}
                className={
                  selectedJobId === String(job.id || job.name || "")
                    ? "clickable-card active"
                    : "clickable-card"
                }
                onClick={() => selectJob(String(job.id || job.name || ""))}
              >
                <strong>{job.name || job.id}</strong>
                <p>{renderSchedule(job.schedule)}</p>
                <p>Profile: {job.profile || "default"}</p>
                {job.id ? (
                  <div className="button-row">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void action(job.id as string, "trigger");
                      }}
                    >
                      Trigger
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void action(job.id as string, "pause");
                      }}
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void action(job.id as string, "resume");
                      }}
                    >
                      Resume
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </article>
        <aside className="detail-panel">
          <h3>Cron Job Detail</h3>
          {!selectedJobId ? (
            <p className="subtle-copy">Click a cron row to inspect details.</p>
          ) : null}
          {detailLoading ? <p>Loading detail...</p> : null}
          {detailError ? <p className="error-text">{detailError}</p> : null}
          {detail ? (
            <div className="detail-content">
              <pre>{JSON.stringify(detail, null, 2)}</pre>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
