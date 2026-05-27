import { useEffect, useMemo, useRef, useState } from "react";

import {
  getCronTokenDistribution,
  getCronjobHistoryDrilldown,
  getCronjobs,
  getKeywordSessionsDrilldown,
  getOverviewStats,
  getOverviewStatus,
  getOverviewTokenTrend,
  getSessionDetailDrilldown,
  listOverviewKeywords,
  listOverviewSecurityEvents,
  listOverviewSecurityEventsPage,
  type CronTokenDistribution,
  type CronTokenPeriod,
  type Cronjob,
  type CronjobHistoryItem,
  type KeywordSession,
  type OverviewKeyword,
  type OverviewStats,
  type OverviewStatus,
  type PaginatedSecurityEvents,
  type SecurityEvent,
  type SessionDetail,
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
  interactionDeps?: Partial<OverviewInteractionDeps>;
};

export type OverviewLoaderDeps = {
  getOverviewStatus: typeof getOverviewStatus;
  getOverviewStats: typeof getOverviewStats;
  getOverviewTokenTrend: typeof getOverviewTokenTrend;
  getCronjobs: typeof getCronjobs;
  listOverviewSecurityEvents: typeof listOverviewSecurityEvents;
};

export type OverviewInteractionDeps = {
  getOverviewTokenTrend: typeof getOverviewTokenTrend;
  getCronTokenDistribution: typeof getCronTokenDistribution;
  listOverviewSecurityEventsPage: typeof listOverviewSecurityEventsPage;
  getCronjobHistoryDrilldown: typeof getCronjobHistoryDrilldown;
  getSessionDetailDrilldown: typeof getSessionDetailDrilldown;
  listOverviewKeywords: typeof listOverviewKeywords;
  getKeywordSessionsDrilldown: typeof getKeywordSessionsDrilldown;
};

type OverviewLoadResult = {
  data: OverviewData | null;
  error: string;
};

export type TrendSwitchResult = {
  days: 7 | 30;
  trend: TokenTrendPoint[] | null;
  error: string;
};

export type CronPeriodResult = {
  period: CronTokenPeriod;
  dist: CronTokenDistribution | null;
  error: string;
};

export type DrilldownResult<T> = {
  payload: T | null;
  error: string;
};

export type CronHistoryModalState = {
  open: boolean;
  jobId: string;
  jobName: string;
  loading: boolean;
  error: string;
  items: CronjobHistoryItem[];
};

export type SessionModalState = {
  open: boolean;
  sessionId: string;
  loading: boolean;
  error: string;
  detail: SessionDetail | null;
};

export type KeywordModalState = {
  open: boolean;
  keyword: string;
  loading: boolean;
  error: string;
  items: KeywordSession[];
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

const defaultOverviewInteractionDeps: OverviewInteractionDeps = {
  getOverviewTokenTrend,
  getCronTokenDistribution,
  listOverviewSecurityEventsPage,
  getCronjobHistoryDrilldown,
  getSessionDetailDrilldown,
  listOverviewKeywords,
  getKeywordSessionsDrilldown,
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

export async function loadTrendForRange(
  days: 7 | 30,
  deps: Pick<OverviewInteractionDeps, "getOverviewTokenTrend"> = defaultOverviewInteractionDeps,
): Promise<TrendSwitchResult> {
  try {
    const trend = await deps.getOverviewTokenTrend(days);
    return { days, trend, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load trend range.";
    return { days, trend: null, error: message };
  }
}

export async function loadCronDistributionForPeriod(
  period: CronTokenPeriod,
  deps: Pick<OverviewInteractionDeps, "getCronTokenDistribution"> = defaultOverviewInteractionDeps,
): Promise<CronPeriodResult> {
  try {
    const dist = await deps.getCronTokenDistribution(period);
    return { period, dist, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cron token distribution.";
    return { period, dist: null, error: message };
  }
}

export async function loadSecurityEventsPageForOverview(
  page: number,
  pageSize: number,
  deps: Pick<OverviewInteractionDeps, "listOverviewSecurityEventsPage"> = defaultOverviewInteractionDeps,
): Promise<DrilldownResult<PaginatedSecurityEvents>> {
  try {
    const payload = await deps.listOverviewSecurityEventsPage(page, pageSize);
    return { payload, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load security events page.";
    return { payload: null, error: message };
  }
}

export async function openCronHistoryDrilldown(
  jobId: string,
  deps: Pick<OverviewInteractionDeps, "getCronjobHistoryDrilldown"> = defaultOverviewInteractionDeps,
): Promise<DrilldownResult<CronjobHistoryItem[]>> {
  try {
    const payload = await deps.getCronjobHistoryDrilldown(jobId);
    return { payload, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cron history.";
    return { payload: null, error: message };
  }
}

export async function openSessionDetailDrilldown(
  sessionId: string,
  deps: Pick<OverviewInteractionDeps, "getSessionDetailDrilldown"> = defaultOverviewInteractionDeps,
): Promise<DrilldownResult<SessionDetail>> {
  try {
    const payload = await deps.getSessionDetailDrilldown(sessionId);
    return { payload, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load session detail.";
    return { payload: null, error: message };
  }
}

export async function openKeywordSessionsDrilldown(
  keyword: string,
  deps: Pick<OverviewInteractionDeps, "getKeywordSessionsDrilldown"> = defaultOverviewInteractionDeps,
): Promise<DrilldownResult<KeywordSession[]>> {
  try {
    const payload = await deps.getKeywordSessionsDrilldown(keyword);
    return { payload, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load keyword sessions.";
    return { payload: null, error: message };
  }
}

export function shouldLoadTrendRange(
  currentDays: 7 | 30,
  nextDays: 7 | 30,
  hasCurrentTrend: boolean,
): boolean {
  if (currentDays !== nextDays) return true;
  return !hasCurrentTrend;
}

export function createCronHistoryModalOpenState(job: Cronjob): CronHistoryModalState {
  return {
    open: true,
    jobId: job.id,
    jobName: job.name,
    loading: true,
    error: "",
    items: [],
  };
}

export function createSessionModalOpenState(sessionId: string): SessionModalState {
  return {
    open: true,
    sessionId,
    loading: true,
    error: "",
    detail: null,
  };
}

export function createKeywordModalOpenState(keyword: string): KeywordModalState {
  return {
    open: true,
    keyword,
    loading: true,
    error: "",
    items: [],
  };
}

function createInitialEventsPage(events: SecurityEvent[] | undefined, pageSize: number): PaginatedSecurityEvents | null {
  if (!events) return null;
  return {
    page: 1,
    page_size: pageSize,
    fetched_count: events.length,
    items: events.slice(0, pageSize),
    has_prev: false,
    has_next: events.length > pageSize,
  };
}

export function OverviewPage({ initialData, interactionDeps }: OverviewPageProps) {
  const deps: OverviewInteractionDeps = useMemo(
    () => ({ ...defaultOverviewInteractionDeps, ...interactionDeps }),
    [interactionDeps],
  );
  const [data, setData] = useState<OverviewData | null>(initialData ?? null);
  const [loading, setLoading] = useState(initialData ? false : true);
  const [error, setError] = useState("");

  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const [trendPoints, setTrendPoints] = useState<TokenTrendPoint[] | undefined>(initialData?.trend);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState("");

  const [cronPeriod, setCronPeriod] = useState<CronTokenPeriod>("today");
  const [cronDist, setCronDist] = useState<CronTokenDistribution | null>(null);
  const [cronDistLoading, setCronDistLoading] = useState(false);
  const [cronDistError, setCronDistError] = useState("");

  const eventsPageSize = 5;
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPanel, setEventsPanel] = useState<PaginatedSecurityEvents | null>(
    createInitialEventsPage(initialData?.events, eventsPageSize),
  );
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [eventsUnavailable, setEventsUnavailable] = useState(false);

  const [keywords, setKeywords] = useState<OverviewKeyword[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [keywordsError, setKeywordsError] = useState("");

  const [cronHistoryModal, setCronHistoryModal] = useState<CronHistoryModalState>({
    open: false,
    jobId: "",
    jobName: "",
    loading: false,
    error: "",
    items: [],
  });

  const [sessionModal, setSessionModal] = useState<SessionModalState>({
    open: false,
    sessionId: "",
    loading: false,
    error: "",
    detail: null,
  });

  const [keywordModal, setKeywordModal] = useState<KeywordModalState>({
    open: false,
    keyword: "",
    loading: false,
    error: "",
    items: [],
  });
  const trendRequestId = useRef(0);
  const eventsRequestId = useRef(0);
  const cronHistoryRequestId = useRef(0);
  const sessionRequestId = useRef(0);
  const keywordRequestId = useRef(0);

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
        setEventsUnavailable(Boolean(result.error) && !result.data?.events);
        setLoading(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [initialData]);

  useEffect(() => {
    if (eventsPanel || !data?.events) return;
    setEventsPanel(createInitialEventsPage(data.events, eventsPageSize));
  }, [data?.events, eventsPanel]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setCronDistLoading(true);
      setCronDistError("");
      const result = await loadCronDistributionForPeriod(cronPeriod, deps);
      if (cancelled) return;
      setCronDist(result.dist);
      setCronDistError(result.error);
      setCronDistLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [cronPeriod, deps]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setKeywordsLoading(true);
      setKeywordsError("");
      try {
        const items = await deps.listOverviewKeywords();
        if (cancelled) return;
        setKeywords(items);
      } catch (loadError) {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : "Failed to load keywords.";
        setKeywordsError(message);
      } finally {
        if (!cancelled) setKeywordsLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [deps]);

  async function handleTrendSwitch(days: 7 | 30) {
    if (!shouldLoadTrendRange(trendDays, days, Boolean(trendPoints))) return;
    const requestId = ++trendRequestId.current;
    setTrendDays(days);
    setTrendLoading(true);
    setTrendError("");
    const result = await loadTrendForRange(days, deps);
    if (requestId !== trendRequestId.current) return;
    setTrendPoints(result.trend ?? undefined);
    setTrendError(result.error);
    setTrendLoading(false);
  }

  async function handleCronPeriodSwitch(period: CronTokenPeriod) {
    if (cronPeriod === period) return;
    setCronPeriod(period);
  }

  async function handleEventsPageChange(nextPage: number) {
    if (nextPage < 1) return;
    const requestId = ++eventsRequestId.current;
    setEventsLoading(true);
    setEventsError("");
    const result = await loadSecurityEventsPageForOverview(nextPage, eventsPageSize, deps);
    if (requestId !== eventsRequestId.current) return;
    if (result.payload) {
      setEventsPanel(result.payload);
      setEventsPage(result.payload.page);
      setEventsUnavailable(false);
    } else {
      setEventsError(result.error);
    }
    setEventsLoading(false);
  }

  async function openCronHistory(job: Cronjob) {
    const requestId = ++cronHistoryRequestId.current;
    setCronHistoryModal(createCronHistoryModalOpenState(job));
    const result = await openCronHistoryDrilldown(job.id, deps);
    if (requestId !== cronHistoryRequestId.current) return;
    setCronHistoryModal((prev) => ({
      ...prev,
      loading: false,
      error: result.error,
      items: result.payload ?? [],
    }));
  }

  async function openSessionDetail(sessionId: string) {
    const requestId = ++sessionRequestId.current;
    setSessionModal(createSessionModalOpenState(sessionId));
    const result = await openSessionDetailDrilldown(sessionId, deps);
    if (requestId !== sessionRequestId.current) return;
    setSessionModal((prev) => ({
      ...prev,
      loading: false,
      error: result.error,
      detail: result.payload,
    }));
  }

  async function openKeywordSessions(keyword: string) {
    const requestId = ++keywordRequestId.current;
    setKeywordModal(createKeywordModalOpenState(keyword));
    const result = await openKeywordSessionsDrilldown(keyword, deps);
    if (requestId !== keywordRequestId.current) return;
    setKeywordModal((prev) => ({
      ...prev,
      loading: false,
      error: result.error,
      items: result.payload ?? [],
    }));
  }

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
              {typeof data.stats?.cron_jobs_enabled === "number" && typeof data.stats?.cron_jobs_total === "number"
                ? `${formatNumber(data.stats.cron_jobs_enabled)} / ${formatNumber(data.stats.cron_jobs_total)}`
                : "Unavailable"}
            </p>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Token Trend</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" aria-pressed={trendDays === 7} onClick={() => void handleTrendSwitch(7)}>
            7D
          </button>
          <button type="button" aria-pressed={trendDays === 30} onClick={() => void handleTrendSwitch(30)}>
            30D
          </button>
        </div>
        <div className="detail-layout">
          <article className="detail-panel">
            <h4>{trendDays}-Day Tokens</h4>
            <canvas aria-label="token trend chart placeholder" height={140} />
            <p className="subtle-copy">Trend Range: {trendDays}D</p>
            {trendLoading ? <p className="subtle-copy">Loading trend range...</p> : null}
            {trendError ? <p className="error-text">{trendError}</p> : null}
            <p className="subtle-copy">Points: {trendPoints ? formatNumber(trendPoints.length) : "Unavailable"}</p>
          </article>
          <article className="detail-panel">
            <h4>Source Distribution</h4>
            <canvas aria-label="source distribution chart placeholder" height={140} />
            <p className="subtle-copy">
              Sources: {data.stats?.source_distribution ? formatNumber(Object.keys(data.stats.source_distribution).length) : "Unavailable"}
            </p>
          </article>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Cron Jobs</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" aria-pressed={cronPeriod === "today"} onClick={() => void handleCronPeriodSwitch("today")}>
            today
          </button>
          <button type="button" aria-pressed={cronPeriod === "7d"} onClick={() => void handleCronPeriodSwitch("7d")}>
            7d
          </button>
          <button type="button" aria-pressed={cronPeriod === "30d"} onClick={() => void handleCronPeriodSwitch("30d")}>
            30d
          </button>
        </div>
        <p className="subtle-copy">Cron Token Distribution Period: {cronPeriod}</p>
        {cronDistLoading ? <p className="subtle-copy">Loading cron token distribution...</p> : null}
        {cronDistError ? <p className="error-text">{cronDistError}</p> : null}
        {cronDist ? (
          <p className="subtle-copy">
            Cron Tokens: {formatNumber(cronDist.total_cron_tokens)} / Total: {formatNumber(cronDist.grand_total)} ({cronDist.cron_percent}%)
          </p>
        ) : null}
        <div className="detail-panel">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Schedule</th>
                <th align="left">Enabled</th>
                <th align="left">Last Run</th>
                <th align="left">Tokens</th>
                <th align="left">Actions</th>
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
                  <td>
                    <button type="button" onClick={() => void openCronHistory(job)}>
                      History
                    </button>
                  </td>
                </tr>
              ))}
              {data.cronjobs === undefined ? (
                <tr>
                  <td colSpan={6}>Cron jobs are unavailable.</td>
                </tr>
              ) : data.cronjobs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No cron jobs found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Top Keywords</h3>
        {keywordsLoading ? <p className="subtle-copy">Loading keywords...</p> : null}
        {keywordsError ? <p className="error-text">{keywordsError}</p> : null}
        <ul className="list-grid">
          {keywords.map((keyword) => (
            <li key={`${keyword.lang}-${keyword.word}`}>
              <strong>{keyword.word}</strong>
              <p>Count: {formatNumber(keyword.count)}</p>
              <button type="button" onClick={() => void openKeywordSessions(keyword.word)}>
                Sessions
              </button>
            </li>
          ))}
          {!keywordsLoading && keywords.length === 0 ? (
            <li>
              <p>No keywords found.</p>
            </li>
          ) : null}
        </ul>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Security Events</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => void handleEventsPageChange(eventsPage - 1)}
            disabled={eventsLoading || !(eventsPanel?.has_prev ?? false)}
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => void handleEventsPageChange(eventsPage + 1)}
            disabled={eventsLoading || !(eventsPanel?.has_next ?? false)}
          >
            Next
          </button>
          <span className="subtle-copy">Page {eventsPanel?.page ?? eventsPage}</span>
        </div>
        {eventsLoading ? <p className="subtle-copy">Loading events page...</p> : null}
        {eventsError ? <p className="error-text">{eventsError}</p> : null}
        <ul className="list-grid">
          {(eventsPanel?.items ?? []).map((event) => (
            <li key={`${event.session_id}-${event.type}-${event.time ?? "none"}`}>
              <strong>
                {event.icon} {event.type_label}
              </strong>
              <p>{event.summary}</p>
              <p>
                Risk: {event.risk_level} | Status: {event.status} | Tokens: {formatNumber(event.tokens)}
              </p>
              <button type="button" onClick={() => void openSessionDetail(event.session_id)}>
                Session Detail
              </button>
            </li>
          ))}
          {!eventsLoading && eventsUnavailable ? (
            <li>
              <p>Security events are unavailable.</p>
            </li>
          ) : null}
          {!eventsLoading && !eventsUnavailable && (eventsPanel?.items.length ?? 0) === 0 ? (
            <li>
              <p>No security events found.</p>
            </li>
          ) : null}
        </ul>
      </section>

      {cronHistoryModal.open ? (
        <section role="dialog" aria-label="cron history modal" className="detail-panel" style={{ marginTop: 16 }}>
          <h4>Cron History: {cronHistoryModal.jobName}</h4>
          <button
            type="button"
            onClick={() =>
              setCronHistoryModal({ open: false, jobId: "", jobName: "", loading: false, error: "", items: [] })
            }
          >
            Close
          </button>
          {cronHistoryModal.loading ? <p className="subtle-copy">Loading cron history...</p> : null}
          {cronHistoryModal.error ? <p className="error-text">{cronHistoryModal.error}</p> : null}
          <ul>
            {cronHistoryModal.items.map((item) => (
              <li key={`${item.session_id}-${item.started_at ?? "none"}`}>
                <span>
                  {formatDateTime(item.started_at)} | {item.status} | Tokens: {formatNumber(item.tokens)}
                </span>{" "}
                <button type="button" onClick={() => void openSessionDetail(item.session_id)}>
                  View Session
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sessionModal.open ? (
        <section role="dialog" aria-label="session detail modal" className="detail-panel" style={{ marginTop: 16 }}>
          <h4>Session Detail: {sessionModal.sessionId}</h4>
          <button
            type="button"
            onClick={() => setSessionModal({ open: false, sessionId: "", loading: false, error: "", detail: null })}
          >
            Close
          </button>
          {sessionModal.loading ? <p className="subtle-copy">Loading session detail...</p> : null}
          {sessionModal.error ? <p className="error-text">{sessionModal.error}</p> : null}
          {sessionModal.detail ? (
            <>
              <p className="subtle-copy">
                Source: {sessionModal.detail.source} | Model: {sessionModal.detail.model} | Tokens: {formatNumber(sessionModal.detail.tokens)}
              </p>
              <ul>
                {sessionModal.detail.messages.slice(0, 5).map((message, index) => (
                  <li key={`${message.role}-${message.timestamp ?? index}-${index}`}>
                    <strong>{message.role}</strong>: {message.content.slice(0, 120)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {keywordModal.open ? (
        <section role="dialog" aria-label="keyword sessions modal" className="detail-panel" style={{ marginTop: 16 }}>
          <h4>Keyword Sessions: {keywordModal.keyword}</h4>
          <button
            type="button"
            onClick={() => setKeywordModal({ open: false, keyword: "", loading: false, error: "", items: [] })}
          >
            Close
          </button>
          {keywordModal.loading ? <p className="subtle-copy">Loading keyword sessions...</p> : null}
          {keywordModal.error ? <p className="error-text">{keywordModal.error}</p> : null}
          <ul>
            {keywordModal.items.map((item) => (
              <li key={item.session_id}>
                <strong>{item.title}</strong> | {item.source} | Tokens: {formatNumber(item.tokens)}{" "}
                <button type="button" onClick={() => void openSessionDetail(item.session_id)}>
                  Session Detail
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
