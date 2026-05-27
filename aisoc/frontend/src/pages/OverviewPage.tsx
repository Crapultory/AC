import { useEffect, useState } from "react";

import {
  getCronjobs,
  getOverviewStats,
  getOverviewStatus,
  getOverviewTokenTrend,
  listOverviewSecurityEvents,
  type Cronjob,
  type OverviewStats,
  type OverviewStatus,
  type SecurityEvent,
  type TokenTrendPoint,
} from "../lib/overview";

type OverviewData = {
  status: OverviewStatus;
  stats: OverviewStats;
  trend: TokenTrendPoint[];
  cronjobs: Cronjob[];
  events: SecurityEvent[];
};

type OverviewPageProps = {
  initialData?: OverviewData;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(unixSeconds: number | null): string {
  if (!unixSeconds) return "-";
  return new Date(unixSeconds * 1000).toLocaleString();
}

async function loadOverviewData(): Promise<OverviewData> {
  const [status, stats, trend, cronjobs, events] = await Promise.all([
    getOverviewStatus(),
    getOverviewStats(),
    getOverviewTokenTrend(7),
    getCronjobs(),
    listOverviewSecurityEvents(15),
  ]);

  return { status, stats, trend, cronjobs, events };
}

export function OverviewPage({ initialData }: OverviewPageProps) {
  const [data, setData] = useState<OverviewData | null>(initialData ?? null);
  const [loading, setLoading] = useState(initialData ? false : true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialData) return;

    let cancelled = false;

    async function run() {
      setLoading(true);
      setError("");
      try {
        const payload = await loadOverviewData();
        if (!cancelled) {
          setData(payload);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load overview data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [initialData]);

  if (loading && !data) {
    return (
      <section>
        <h2>Overview</h2>
        <p className="subtle-copy">Loading overview dashboard...</p>
      </section>
    );
  }

  return (
    <section>
      <header>
        <h2>Overview</h2>
        <p className="subtle-copy">
          Status: {data?.status.status ?? "unknown"} | Model: {data?.status.model ?? "-"} |
          Provider: {data?.status.provider ?? "-"}
        </p>
        <p className="subtle-copy">
          Profile: {data?.status.profile ?? "-"} | Last Activity: {formatDateTime(data?.status.last_activity ?? null)}
        </p>
        {error ? <p className="error-text">{error}</p> : null}
      </header>

      <section>
        <h3>Key Stats</h3>
        <ul className="list-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <li>
            <strong>Total Sessions</strong>
            <p>{formatNumber(data?.stats.total_sessions ?? 0)}</p>
          </li>
          <li>
            <strong>Active Sessions</strong>
            <p>{formatNumber(data?.stats.active_sessions ?? 0)}</p>
          </li>
          <li>
            <strong>Today Tokens</strong>
            <p>{formatNumber(data?.stats.today_tokens ?? 0)}</p>
          </li>
          <li>
            <strong>Cron Jobs Enabled</strong>
            <p>
              {formatNumber(data?.stats.cron_jobs_enabled ?? 0)} / {formatNumber(data?.stats.cron_jobs_total ?? 0)}
            </p>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Token Trend</h3>
        <div className="detail-layout">
          <article className="detail-panel">
            <h4>7-Day Tokens</h4>
            <canvas aria-label="token trend chart placeholder" height={140} />
            <p className="subtle-copy">Points: {formatNumber(data?.trend.length ?? 0)}</p>
          </article>
          <article className="detail-panel">
            <h4>Source Distribution</h4>
            <canvas aria-label="source distribution chart placeholder" height={140} />
            <p className="subtle-copy">
              Sources: {formatNumber(Object.keys(data?.stats.source_distribution ?? {}).length)}
            </p>
          </article>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Cron Jobs</h3>
        <div className="detail-panel">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Schedule</th>
                <th align="left">Enabled</th>
                <th align="left">Last Run</th>
                <th align="left">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {(data?.cronjobs ?? []).map((job) => (
                <tr key={job.id}>
                  <td>{job.name}</td>
                  <td>{job.schedule}</td>
                  <td>{job.enabled ? "Yes" : "No"}</td>
                  <td>{formatDateTime(job.last_run?.started_at ?? null)}</td>
                  <td>{formatNumber(job.last_run?.tokens ?? 0)}</td>
                </tr>
              ))}
              {(data?.cronjobs.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={5}>No cron jobs found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Security Events</h3>
        <ul className="list-grid">
          {(data?.events ?? []).map((event) => (
            <li key={`${event.session_id}-${event.type}-${event.time ?? "none"}`}>
              <strong>
                {event.icon} {event.type_label}
              </strong>
              <p>{event.summary}</p>
              <p>
                Risk: {event.risk_level} | Status: {event.status} | Tokens: {formatNumber(event.tokens)}
              </p>
            </li>
          ))}
          {(data?.events.length ?? 0) === 0 ? (
            <li>
              <p>No security events found.</p>
            </li>
          ) : null}
        </ul>
      </section>
    </section>
  );
}
