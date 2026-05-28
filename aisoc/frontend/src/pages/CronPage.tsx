import { useEffect, useRef, useState } from "react";

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

const CRON_EDITABLE_KEYS = [
  "name",
  "prompt",
  "schedule",
  "schedule_display",
  "enabled",
  "deliver",
  "profile",
  "skills",
  "skill",
  "enabled_toolsets",
  "model",
  "provider",
  "base_url",
  "script",
  "workdir",
  "no_agent",
] as const;

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

function buildEditableCronUpdates(detail: Record<string, unknown> | null): Record<string, unknown> {
  if (!detail) return {};
  const updates: Record<string, unknown> = {};
  for (const key of CRON_EDITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(detail, key)) {
      updates[key] = detail[key];
    }
  }
  return updates;
}

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [detailEditor, setDetailEditor] = useState("{}");
  const [detailDirty, setDetailDirty] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingAction, setPendingAction] = useState<string>("");
  const [rawDetailModalOpen, setRawDetailModalOpen] = useState(false);
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
    setRawDetailModalOpen(false);
    setSaveError("");
    setSaveSuccess("");
    setDetailDirty(false);
    try {
      const payload = await fetchJSON<Record<string, unknown>>(
        `/api/cron/jobs/${encodeURIComponent(rawId)}`,
      );
      if (!isLatestCronDetailRequest(requestId, detailRequestIdRef.current)) return;
      setDetail(payload);
      const editable = buildEditableCronUpdates(payload);
      setDetailEditor(JSON.stringify(editable, null, 2));
    } catch {
      if (!isLatestCronDetailRequest(requestId, detailRequestIdRef.current)) return;
      setDetail(null);
      setDetailError("Failed to load cron job details.");
    } finally {
      if (!isLatestCronDetailRequest(requestId, detailRequestIdRef.current)) return;
      setDetailLoading(false);
    }
  }

  async function saveDetailUpdates() {
    if (!selectedJobId) return;
    setSavePending(true);
    setSaveError("");
    setSaveSuccess("");
    try {
      const parsed = JSON.parse(detailEditor) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setSaveError("Updates must be a JSON object.");
        return;
      }
      await fetchJSON(`/api/cron/jobs/${encodeURIComponent(selectedJobId)}`, {
        method: "PUT",
        body: JSON.stringify({ updates: parsed }),
      });
      setDetailDirty(false);
      setSaveSuccess("Cron job updated.");
      await loadJobs();
      if (selectedJobIdRef.current === selectedJobId) {
        await selectJob(selectedJobId);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        setSaveError(`Invalid JSON: ${error.message}`);
      } else {
        setSaveError("Failed to update cron job.");
      }
    } finally {
      setSavePending(false);
    }
  }

  useEffect(() => {
    void loadJobs();
  }, []);

  useEffect(() => {
    if (!rawDetailModalOpen) return;
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRawDetailModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [rawDetailModalOpen]);

  return (
    <section className="cron-workbench-page">
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
          <div className="cron-jobs-scroll">
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
          </div>
          <div className="cron-action-zone">
            <p className="subtle-copy">Action zone: trigger/pause/resume controls are available on each job row.</p>
          </div>
          {actionError ? <p className="error-text">{actionError}</p> : null}
        </article>
        <aside className="detail-panel cron-detail-pane">
          <h3>Cron Job Detail</h3>
          <p className="subtle-copy">Edit updates JSON and save via PUT /api/cron/jobs/{selectedJobId || "{job_id}"}.</p>
          {!selectedJobId ? (
            <StateBlock kind="empty" title="No Job Selected" message="Click a cron row to inspect details and context." />
          ) : null}
          {detailLoading ? <StateBlock kind="loading" title="Loading Detail" message="Fetching selected job payload." /> : null}
          {detailError ? <StateBlock kind="error" title="Detail Unavailable" message={detailError} /> : null}
          {detail ? (
            <div className="cron-detail-scroll">
              <label className="memory-editor-label" htmlFor="cron-detail-editor">
                Editable Updates JSON
              </label>
              <textarea
                id="cron-detail-editor"
                className="cron-detail-editor"
                value={detailEditor}
                onChange={(event) => {
                  setDetailEditor(event.target.value);
                  setDetailDirty(true);
                  setSaveError("");
                  setSaveSuccess("");
                }}
                rows={18}
              />
              <div className="button-row cron-action-zone">
                <button type="button" onClick={() => void saveDetailUpdates()} disabled={savePending || !detailDirty}>
                  {savePending ? "Saving..." : "Save Updates"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={savePending}
                  onClick={() => {
                    const editable = buildEditableCronUpdates(detail);
                    setDetailEditor(JSON.stringify(editable, null, 2));
                    setDetailDirty(false);
                    setSaveError("");
                    setSaveSuccess("");
                  }}
                >
                  Reset
                </button>
              </div>
              {saveError ? <p className="error-text">{saveError}</p> : null}
              {saveSuccess ? <p>{saveSuccess}</p> : null}
              <div className="cron-context-inline">
                <p className="cron-context-item">
                  <strong>Selected Job</strong>
                  <span>{selectedJobId || "none"}</span>
                </p>
                <p className="cron-context-item">
                  <strong>Profile</strong>
                  <span>{selectedJob?.profile || "default"}</span>
                </p>
                <p className="cron-context-item">
                  <strong>State</strong>
                  <span>{selectedJob ? (selectedJob.paused ? "paused" : "running") : "unknown"}</span>
                </p>
                <button
                  type="button"
                  className="ghost-button cron-raw-open-button"
                  onClick={() => setRawDetailModalOpen(true)}
                >
                  Raw Detail JSON
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
      {detail ? (
        <div
          className={rawDetailModalOpen ? "cron-raw-modal-overlay active" : "cron-raw-modal-overlay"}
          onClick={() => setRawDetailModalOpen(false)}
          aria-hidden={!rawDetailModalOpen}
        >
          <div
            className="cron-raw-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Raw cron detail json"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="cron-raw-modal-header">
              <h4>Raw Detail JSON</h4>
              <button
                type="button"
                className="ghost-button cron-raw-modal-close"
                onClick={() => setRawDetailModalOpen(false)}
                aria-label="Close raw detail modal"
              >
                ×
              </button>
            </div>
            <div className="cron-raw-modal-body">
              <pre>{JSON.stringify(detail, null, 2)}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
