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
  status?: OverviewStatus;
  stats?: OverviewStats;
  trend?: TokenTrendPoint[];
  cronjobs?: Cronjob[];
  events?: SecurityEvent[];
};

type OverviewPageProps = {
  initialData?: OverviewData;
};

export type OverviewLoaderDeps = {
  getOverviewStatus: typeof getOverviewStatus;
  getOverviewStats: typeof getOverviewStats;
  getOverviewTokenTrend: typeof getOverviewTokenTrend;
  getCronjobs: typeof getCronjobs;
  listOverviewSecurityEvents: typeof listOverviewSecurityEvents;
};

type OverviewLoadResult = {
  data: OverviewData | null;
  error: string;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatNumberOrUnavailable(value: number | undefined): string {
  if (typeof value !== "number") return "Unavailable";
  return formatNumber(value);
}

export function formatDateTime(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) return "-";
  return new Date(unixSeconds * 1000).toLocaleString();
}

const defaultOverviewLoaderDeps: OverviewLoaderDeps = {
  getOverviewStatus,
  getOverviewStats,
  getOverviewTokenTrend,
  getCronjobs,
  listOverviewSecurityEvents,
};

export async function loadOverviewDataResilient(
  deps: OverviewLoaderDeps = defaultOverviewLoaderDeps,
): Promise<OverviewLoadResult> {
  const requests = [
    { key: "status", label: "status", run: () => deps.getOverviewStatus() },
    { key: "stats", label: "stats", run: () => deps.getOverviewStats() },
    { key: "trend", label: "token trend", run: () => deps.getOverviewTokenTrend(7) },
    { key: "cronjobs", label: "cron jobs", run: () => deps.getCronjobs() },
    {
      key: "events",
      label: "security events",
      run: () => deps.listOverviewSecurityEvents(15),
    },
  ] as const;

  const settled = await Promise.allSettled(requests.map((request) => request.run()));
  const data: OverviewData = {};
  const failedLabels: string[] = [];
  let successCount = 0;

  settled.forEach((result, index) => {
    const request = requests[index];
    if (result.status === "fulfilled") {
      successCount += 1;
      switch (request.key) {
        case "status":
          data.status = result.value as OverviewStatus;
          break;
        case "stats":
          data.stats = result.value as OverviewStats;
          break;
        case "trend":
          data.trend = result.value as TokenTrendPoint[];
          break;
        case "cronjobs":
          data.cronjobs = result.value as Cronjob[];
          break;
        case "events":
          data.events = result.value as SecurityEvent[];
          break;
      }
      return;
    }
    failedLabels.push(request.label);
  });

  if (successCount === 0) {
    const errorSuffix = failedLabels.length > 0 ? ` Unable to load: ${failedLabels.join(", ")}.` : "";
    return {
      data: null,
      error: `Failed to load overview data.${errorSuffix}`,
    };
  }

  if (failedLabels.length > 0) {
    return {
      data,
      error: `Some overview panels failed to load: ${failedLabels.join(", ")}.`,
    };
  }

  return { data, error: "" };
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
      const result = await loadOverviewDataResilient();
      if (!cancelled) {
        setData(result.data);
        setError(result.error);
        setLoading(false);
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

  if (!data) {
    return (
      <section>
        <h2>Overview</h2>
        <p className="subtle-copy">Overview data is currently unavailable.</p>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    );
  }

  return (
    <section>
      <header>
        <h2>Overview</h2>
        <p className="subtle-copy">
          Status: {data.status?.status ?? "Unavailable"} | Model: {data.status?.model ?? "Unavailable"} |
          Provider: {data.status?.provider ?? "Unavailable"}
        </p>
        <p className="subtle-copy">
          Profile: {data.status?.profile ?? "Unavailable"} | Last Activity: {formatDateTime(data.status?.last_activity)}
        </p>
        {error ? <p className="error-text">{error}</p> : null}
      </header>

      <section>
        <h3>Key Stats</h3>
        <ul className="list-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <li>
            <strong>Total Sessions</strong>
            <p>{formatNumberOrUnavailable(data.stats?.total_sessions)}</p>
          </li>
          <li>
            <strong>Active Sessions</strong>
            <p>{formatNumberOrUnavailable(data.stats?.active_sessions)}</p>
          </li>
          <li>
            <strong>Today Tokens</strong>
            <p>{formatNumberOrUnavailable(data.stats?.today_tokens)}</p>
          </li>
          <li>
            <strong>Cron Jobs Enabled</strong>
            <p>
              {typeof data.stats?.cron_jobs_enabled === "number" &&
              typeof data.stats?.cron_jobs_total === "number"
                ? `${formatNumber(data.stats.cron_jobs_enabled)} / ${formatNumber(data.stats.cron_jobs_total)}`
                : "Unavailable"}
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
            <p className="subtle-copy">
              Points: {data.trend ? formatNumber(data.trend.length) : "Unavailable"}
            </p>
          </article>
          <article className="detail-panel">
            <h4>Source Distribution</h4>
            <canvas aria-label="source distribution chart placeholder" height={140} />
            <p className="subtle-copy">
              Sources:{" "}
              {data.stats?.source_distribution
                ? formatNumber(Object.keys(data.stats.source_distribution).length)
                : "Unavailable"}
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
              {(data.cronjobs ?? []).map((job) => (
                <tr key={job.id}>
                  <td>{job.name}</td>
                  <td>{job.schedule}</td>
                  <td>{job.enabled ? "Yes" : "No"}</td>
                  <td>{formatDateTime(job.last_run?.started_at)}</td>
                  <td>{formatNumber(job.last_run?.tokens ?? 0)}</td>
                </tr>
              ))}
              {data.cronjobs === undefined ? (
                <tr>
                  <td colSpan={5}>Cron jobs are unavailable.</td>
                </tr>
              ) : data.cronjobs.length === 0 ? (
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
          {(data.events ?? []).map((event) => (
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
          {data.events === undefined ? (
            <li>
              <p>Security events are unavailable.</p>
            </li>
          ) : data.events.length === 0 ? (
            <li>
              <p>No security events found.</p>
            </li>
          ) : null}
        </ul>
      </section>
    </section>
  );
}
