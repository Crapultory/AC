import { useEffect, useRef, useState } from "react";

import { PageMissionHeader } from "../components/PageMissionHeader";
import { StateBlock } from "../components/StateBlock";
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

export function isLatestCronDetailRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

export function isCronActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [actionError, setActionError] = useState("");
  const [pendingAction, setPendingAction] = useState<string>("");
  const detailRequestIdRef = useRef(0);
  const selectedJobIdRef = useRef("");

  const selectedJob = jobs.find((job) => String(job.id || job.name || "") === selectedJobId);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  async function loadJobs() {
    setLoading(true);
    setError("");
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
    const actionKey = `${jobId}:${verb}`;
    setActionError("");
    setPendingAction(actionKey);
    try {
      await fetchJSON(`/api/cron/jobs/${encodeURIComponent(jobId)}/${verb}`, { method: "POST" });
      await loadJobs();
      if (selectedJobIdRef.current !== jobId) return;
      await selectJob(jobId);
    } catch {
      setActionError(`Failed to ${verb} cron job.`);
    } finally {
      setPendingAction("");
    }
  }

  async function selectJob(rawId: string) {
    if (!rawId) return;
    const requestId = ++detailRequestIdRef.current;
    selectedJobIdRef.current = rawId;
    setSelectedJobId(rawId);
    setDetailLoading(true);
    setDetailError("");
    setDetail(null);
    try {
      const payload = await fetchJSON<Record<string, unknown>>(
        `/api/cron/jobs/${encodeURIComponent(rawId)}`,
      );
      if (!isLatestCronDetailRequest(requestId, detailRequestIdRef.current)) return;
      setDetail(payload);
    } catch {
      if (!isLatestCronDetailRequest(requestId, detailRequestIdRef.current)) return;
      setDetail(null);
      setDetailError("Failed to load cron job details.");
    } finally {
      if (!isLatestCronDetailRequest(requestId, detailRequestIdRef.current)) return;
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadJobs();
  }, []);

  return (
    <section className="cron-workbench-page">
      <PageMissionHeader
        title="Cron Operations"
        subtitle="Monitor scheduled jobs, execute interventions, and inspect runtime detail from one analyst workspace."
        status={<span className="status-badge">Jobs: {jobs.length}</span>}
        actions={
          selectedJobId ? (
            <span className="status-badge" title={selectedJobId}>
              Focus: {selectedJobId}
            </span>
          ) : null
        }
      />
      {error ? (
        <StateBlock kind="error" title="Cron Load Failed" message={error} />
      ) : null}
      <div className="cron-workbench">
        <article className="detail-panel cron-jobs-pane">
          <h3>Jobs</h3>
          <p className="subtle-copy">Select a job to inspect detail and dispatch trigger/pause/resume actions.</p>
          {loading ? (
            <StateBlock kind="loading" title="Loading Cron Jobs" message="Fetching scheduler inventory from /api/cron/jobs." />
          ) : null}
          {!loading && jobs.length === 0 ? (
            <StateBlock kind="empty" title="No Cron Jobs Found" message="No jobs are currently registered for this profile." />
          ) : null}
          <ul className="list-grid cron-jobs-list">
            {jobs.map((job) => (
              <li
                key={job.id || job.name}
                className={
                  selectedJobId === String(job.id || job.name || "")
                    ? "clickable-card active"
                    : "clickable-card"
                }
                role="button"
                tabIndex={0}
                onClick={() => selectJob(String(job.id || job.name || ""))}
                onKeyDown={(event) => {
                  if (!isCronActivationKey(event.key)) return;
                  event.preventDefault();
                  void selectJob(String(job.id || job.name || ""));
                }}
              >
                <div className="cron-job-head">
                  <strong>{job.name || job.id}</strong>
                  <span className="status-badge">{job.paused ? "Paused" : "Running"}</span>
                </div>
                <div className="cron-job-meta">
                  <p>Schedule: {renderSchedule(job.schedule)}</p>
                  <p>Profile: {job.profile || "default"}</p>
                </div>
                {job.id ? (
                  <div className="button-row cron-action-zone">
                    <button
                      type="button"
                      disabled={pendingAction === `${job.id}:trigger`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void action(job.id as string, "trigger");
                      }}
                    >
                      {pendingAction === `${job.id}:trigger` ? "Triggering..." : "Trigger"}
                    </button>
                    <button
                      type="button"
                      disabled={pendingAction === `${job.id}:pause`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void action(job.id as string, "pause");
                      }}
                    >
                      {pendingAction === `${job.id}:pause` ? "Pausing..." : "Pause"}
                    </button>
                    <button
                      type="button"
                      disabled={pendingAction === `${job.id}:resume`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void action(job.id as string, "resume");
                      }}
                    >
                      {pendingAction === `${job.id}:resume` ? "Resuming..." : "Resume"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="cron-action-zone">
            <p className="subtle-copy">Action zone: trigger/pause/resume controls are available on each job row.</p>
          </div>
          {actionError ? <p className="error-text">{actionError}</p> : null}
        </article>
        <aside className="detail-panel cron-detail-pane">
          <h3>Cron Job Detail</h3>
          <p className="subtle-copy">Detail payload and context for the selected scheduler entry.</p>
          {!selectedJobId ? (
            <StateBlock kind="empty" title="No Job Selected" message="Click a cron row to inspect details and context." />
          ) : null}
          {detailLoading ? <StateBlock kind="loading" title="Loading Detail" message="Fetching selected job payload." /> : null}
          {detailError ? <StateBlock kind="error" title="Detail Unavailable" message={detailError} /> : null}
          {detail ? (
            <div className="detail-content">
              <pre>{JSON.stringify(detail, null, 2)}</pre>
            </div>
          ) : null}
          <div className="cron-context-grid">
            <p>
              <strong>Selected Job</strong>
            </p>
            <p>{selectedJobId || "none"}</p>
            <p>
              <strong>Profile</strong>
            </p>
            <p>{selectedJob?.profile || "default"}</p>
            <p>
              <strong>State</strong>
            </p>
            <p>{selectedJob ? (selectedJob.paused ? "paused" : "running") : "unknown"}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
