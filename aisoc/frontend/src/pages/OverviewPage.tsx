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

const CRON_COLORS = ["#00D4FF", "#00FF88", "#FF4D1C", "#A855F7", "#F59E0B", "#EC4899", "#06B6D4", "#84CC16"];
const SOURCE_COLORS = ["#00D4FF", "#A855F7", "#00FF88", "#FF4D1C", "#FFD600"];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatNumberOrUnavailable(value: number | undefined): string {
  if (typeof value !== "number") return "--";
  return formatNumber(value);
}

function formatCompactTokens(value: number | undefined | null): string {
  const n = value ?? 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "--";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m}m`;
}

function formatMiniDateTime(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) return "--";
  return new Date(unixSeconds * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) return "-";
  return new Date(unixSeconds * 1000).toLocaleString();
}

function getStatusIsOnline(status: string | undefined): boolean {
  return (status ?? "").toUpperCase() === "ONLINE" || (status ?? "").toUpperCase() === "RUNNING";
}

function getEventRiskColor(level: string | undefined): string {
  const normalized = (level ?? "").toLowerCase();
  if (normalized === "critical") return "#ff2d55";
  if (normalized === "high") return "#ff6b35";
  if (normalized === "medium") return "#ffb800";
  if (normalized === "low") return "#00d4ff";
  return "#6b7b8a";
}

function getEventStatusClass(status: string | undefined): "ok" | "err" | "warn" {
  if (status === "completed") return "ok";
  if (status === "failed") return "err";
  return "warn";
}

function getEventStatusIcon(status: string | undefined): string {
  if (status === "completed") return "✓";
  if (status === "failed") return "✗";
  return "◐";
}

function resolveEventIcon(icon: string | undefined): string {
  const iconMap: Record<string, string> = {
    shield: "🛡",
    sword: "⚔",
    terminal: "💻",
    mail: "✉",
    report: "📋",
    search: "🔍",
    investigate: "🔬",
  };
  if (!icon) return "📌";
  return iconMap[icon] ?? icon;
}

function drawTrendChart(canvas: HTMLCanvasElement, points: TokenTrendPoint[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.parentElement?.clientWidth ?? 640;
  const height = 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (!points.length) return;

  const max = Math.max(...points.map((point) => point.total_tokens), 1);
  const pad = { top: 20, right: 16, bottom: 38, left: 56 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const gap = chartW / points.length;
  const barW = Math.min(28, gap * 0.58);

  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (chartH / 4) * i;
    const val = max * (1 - i / 4);
    ctx.fillStyle = "#3A5566";
    ctx.fillText(formatCompactTokens(val), pad.left - 8, y + 3);
    ctx.strokeStyle = "rgba(0, 212, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  points.forEach((point, index) => {
    const x = pad.left + index * gap + (gap - barW) / 2;
    const inputH = (point.input_tokens / max) * chartH;
    const outputH = (point.output_tokens / max) * chartH;

    if (inputH > 0) {
      const g = ctx.createLinearGradient(0, pad.top + chartH - inputH, 0, pad.top + chartH);
      g.addColorStop(0, "rgba(0, 212, 255, 0.9)");
      g.addColorStop(1, "rgba(0, 120, 180, 0.35)");
      ctx.fillStyle = g;
      ctx.fillRect(x, pad.top + chartH - inputH - outputH, barW * 0.56, inputH);
    }

    if (outputH > 0) {
      const g2 = ctx.createLinearGradient(0, pad.top + chartH - outputH, 0, pad.top + chartH);
      g2.addColorStop(0, "rgba(168, 85, 247, 0.9)");
      g2.addColorStop(1, "rgba(100, 40, 180, 0.35)");
      ctx.fillStyle = g2;
      ctx.fillRect(x + barW * 0.56 + 2, pad.top + chartH - outputH, barW * 0.4, outputH);
    }

    ctx.fillStyle = "#3A5566";
    ctx.textAlign = "center";
    ctx.fillText(point.date.slice(5), x + barW / 2, height - 12);
  });

  ctx.beginPath();
  ctx.strokeStyle = "rgba(0, 255, 136, 0.5)";
  ctx.lineWidth = 1.4;
  points.forEach((point, index) => {
    const x = pad.left + index * gap + gap / 2;
    const y = pad.top + chartH - (point.total_tokens / max) * chartH;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  points.forEach((point, index) => {
    const x = pad.left + index * gap + gap / 2;
    const y = pad.top + chartH - (point.total_tokens / max) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = "#00FF88";
    ctx.fill();
  });
}

function drawSourceChart(canvas: HTMLCanvasElement, distribution: Record<string, number> | undefined): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = 180;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  if (!distribution) return;

  const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  if (total <= 0) return;

  const cx = size / 2;
  const cy = size / 2;
  const outer = 72;
  const inner = 46;
  let start = -Math.PI / 2;

  entries.forEach((entry, index) => {
    const angle = (entry[1] / total) * Math.PI * 2;
    const color = SOURCE_COLORS[index % SOURCE_COLORS.length];
    ctx.beginPath();
    ctx.arc(cx, cy, outer, start, start + angle);
    ctx.arc(cx, cy, inner, start + angle, start, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
    start += angle;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, inner - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#050A0F";
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "#E0F7FF";
  ctx.font = 'bold 18px "JetBrains Mono", monospace';
  ctx.fillText(`${total}`, cx, cy + 2);
  ctx.fillStyle = "#3A5566";
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.fillText("SESSIONS", cx, cy + 16);
}

function drawCronTokenChart(canvas: HTMLCanvasElement, dist: CronTokenDistribution | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = 280;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  if (!dist) return;

  const cx = size / 2;
  const cy = size / 2;
  const outer = 115;
  const inner = 70;
  const jobs = dist.jobs ?? [];
  const total = Math.max(dist.total_cron_tokens, 1);
  let angle = -Math.PI / 2;

  jobs.forEach((job, index) => {
    const sweep = (job.io_tokens / total) * Math.PI * 2 - 0.03;
    if (sweep <= 0) return;
    const color = CRON_COLORS[index % CRON_COLORS.length];
    ctx.beginPath();
    ctx.arc(cx, cy, outer, angle, angle + sweep);
    ctx.arc(cx, cy, inner, angle + sweep, angle, true);
    ctx.closePath();
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, `${color}44`);
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.fill();
    angle += sweep + 0.03;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, inner - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#0A1018";
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#00D4FF";
  ctx.font = '600 18px "JetBrains Mono", monospace';
  ctx.fillText(formatCompactTokens(dist.total_cron_tokens), cx, cy - 10);
  ctx.fillStyle = "#5a7a9a";
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillText("CRON TOTAL", cx, cy + 10);
  ctx.fillStyle = "#3a5a7a";
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.fillText(`${dist.cron_percent}% of all tokens`, cx, cy + 25);
}

export async function loadOverviewDataResilient(
  deps: OverviewLoaderDeps = defaultOverviewLoaderDeps,
): Promise<OverviewLoadResult> {
  const requests = [
    { key: "status", label: "status", run: () => deps.getOverviewStatus() },
    { key: "stats", label: "stats", run: () => deps.getOverviewStats() },
    { key: "trend", label: "token trend", run: () => deps.getOverviewTokenTrend(7) },
    { key: "cronjobs", label: "cron jobs", run: () => deps.getCronjobs() },
    { key: "events", label: "security events", run: () => deps.listOverviewSecurityEvents(15) },
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
    const suffix = failedLabels.length > 0 ? ` Unable to load: ${failedLabels.join(", ")}.` : "";
    return { data: null, error: `Failed to load overview data.${suffix}` };
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

export function shouldLoadTrendRange(currentDays: 7 | 30, nextDays: 7 | 30, hasCurrentTrend: boolean): boolean {
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

function getStatusText(status: OverviewStatus | undefined): string {
  if (!status) return "INIT";
  return (status.status || "INIT").toUpperCase();
}

export function OverviewPage({ initialData, interactionDeps }: OverviewPageProps) {
  const deps: OverviewInteractionDeps = useMemo(
    () => ({ ...defaultOverviewInteractionDeps, ...interactionDeps }),
    [interactionDeps],
  );

  const [data, setData] = useState<OverviewData | null>(initialData ?? null);
  const [loading, setLoading] = useState(initialData ? false : true);
  const [error, setError] = useState("");

  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
    }),
  );

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

  const trendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cronCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const sourceEntries = useMemo(() => {
    const distribution = data?.stats?.source_distribution;
    if (!distribution) return [] as Array<[string, number]>;
    return Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  }, [data?.stats?.source_distribution]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(
        new Date().toLocaleTimeString("zh-CN", {
          hour12: false,
        }),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshOverview() {
      const result = await loadOverviewDataResilient();
      if (cancelled) return;
      setData(result.data);
      setError(result.error);
      setEventsUnavailable(Boolean(result.error) && !result.data?.events);
      if (result.data?.trend?.length) setTrendPoints(result.data.trend);
      if (result.data?.events) setEventsPanel(createInitialEventsPage(result.data.events, eventsPageSize));
      setLoading(false);
    }

    if (!initialData) {
      setLoading(true);
      setError("");
      void refreshOverview();
    }

    const poll = window.setInterval(() => {
      void refreshOverview();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [initialData]);

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

  useEffect(() => {
    if (trendCanvasRef.current && trendPoints) drawTrendChart(trendCanvasRef.current, trendPoints);
  }, [trendPoints]);

  useEffect(() => {
    if (sourceCanvasRef.current) drawSourceChart(sourceCanvasRef.current, data?.stats?.source_distribution);
  }, [data?.stats?.source_distribution]);

  useEffect(() => {
    if (cronCanvasRef.current) drawCronTokenChart(cronCanvasRef.current, cronDist);
  }, [cronDist]);

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

  function handleCronPeriodSwitch(period: CronTokenPeriod) {
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
    setCronHistoryModal((prev) => ({ ...prev, loading: false, error: result.error, items: result.payload ?? [] }));
  }

  async function openSessionDetail(sessionId: string) {
    const requestId = ++sessionRequestId.current;
    setSessionModal(createSessionModalOpenState(sessionId));
    const result = await openSessionDetailDrilldown(sessionId, deps);
    if (requestId !== sessionRequestId.current) return;
    setSessionModal((prev) => ({ ...prev, loading: false, error: result.error, detail: result.payload }));
  }

  async function openKeywordSessions(keyword: string) {
    const requestId = ++keywordRequestId.current;
    setKeywordModal(createKeywordModalOpenState(keyword));
    const result = await openKeywordSessionsDrilldown(keyword, deps);
    if (requestId !== keywordRequestId.current) return;
    setKeywordModal((prev) => ({ ...prev, loading: false, error: result.error, items: result.payload ?? [] }));
  }

  const memoryPercent = data?.stats?.memory_percent ?? 0;
  const uptimeSeconds = data?.status?.uptime_seconds ?? 0;
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const uptimeText = `UPTIME: ${Math.floor(hours / 24)}D ${hours % 24}H ${minutes}M`;

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
    <section className="overview-cyber-wrap workbench-overview">
      <div className="ov-bg-grid" aria-hidden="true" />
      <div className="ov-scanline" aria-hidden="true" />

      <div className="ov-container">
        <header className="ov-header">
          <div className="ov-header-left">
            <div className="ov-logo-glyph">⬡</div>
            <div className="ov-logo-block">
              <span className="ov-logo-text">AISOC</span>
              <span className="ov-logo-sub">SECURITY OPERATIONS CENTER</span>
            </div>
          </div>
          <div className="ov-header-center">
            <div className="ov-clock">{clock}</div>
            <div className="ov-uptime">{uptimeText}</div>
            <div className="ov-refresh-indicator">
              <span className="ov-live-dot" />
              LIVE · 30s
            </div>
          </div>
          <div className="ov-header-right">
            <div className={`ov-status-badge ${getStatusIsOnline(data.status?.status) ? "" : "idle"}`.trim()}>
              <span className="ov-status-dot" />
              <span className="ov-status-text">{getStatusText(data.status)}</span>
            </div>
            <div className="ov-model-tag">
              {(data.status?.model ?? "--") + " · " + (data.status?.provider ?? "--")}
            </div>
          </div>
        </header>

        {error ? <p className="error-text" style={{ marginBottom: 10 }}>{error}</p> : null}

        <section className="ov-stats-row">
          <article className="ov-stat-card card">
            <div className="ov-stat-icon-wrap">
              <span>⚡</span>
            </div>
            <div className="ov-stat-body">
              <div className="ov-stat-value">{formatNumberOrUnavailable(data.stats?.active_sessions)}</div>
              <div className="ov-stat-label">
                活跃会话 <span className="ov-stat-sub">/ {formatNumberOrUnavailable(data.stats?.total_sessions)} total</span>
              </div>
            </div>
          </article>
          <article className="ov-stat-card card">
            <div className="ov-stat-icon-wrap accent-green">
              <span>⏱</span>
            </div>
            <div className="ov-stat-body">
              <div className="ov-stat-value">{formatNumberOrUnavailable(data.stats?.cron_jobs_total)}</div>
              <div className="ov-stat-label">
                计划任务 <span className="ov-stat-sub">/ {formatNumberOrUnavailable(data.stats?.cron_jobs_enabled)} 启用</span>
              </div>
            </div>
          </article>
          <article className="ov-stat-card card">
            <div className="ov-stat-icon-wrap accent-purple">
              <span>◉</span>
            </div>
            <div className="ov-stat-body">
              <div className="ov-stat-value">{memoryPercent}%</div>
              <div className="ov-stat-label">Memory 容量</div>
              <div className="ov-memory-bar">
                <div className="ov-memory-fill" style={{ width: `${Math.max(0, Math.min(100, memoryPercent))}%` }} />
              </div>
            </div>
          </article>
          <article className="ov-stat-card card glow">
            <div className="ov-stat-icon-wrap accent-orange">
              <span>🔥</span>
            </div>
            <div className="ov-stat-body">
              <div className="ov-stat-value">{formatCompactTokens(data.stats?.today_tokens)}</div>
              <div className="ov-stat-label">今日 Token</div>
              <div className="ov-token-detail">
                IN: {formatCompactTokens(data.stats?.today_input_tokens)} / OUT: {formatCompactTokens(data.stats?.today_output_tokens)}
              </div>
            </div>
          </article>
        </section>

        <section className="ov-charts-row">
          <article className="ov-panel panel">
            <div className="ov-panel-header">
              <h3>
                <span className="ov-panel-icon">◈</span>TOKEN 使用趋势
              </h3>
              <div className="ov-panel-tabs">
                <button className={`ov-tab ${trendDays === 7 ? "active" : ""}`} type="button" onClick={() => void handleTrendSwitch(7)}>
                  7D
                </button>
                <button className={`ov-tab ${trendDays === 30 ? "active" : ""}`} type="button" onClick={() => void handleTrendSwitch(30)}>
                  30D
                </button>
              </div>
            </div>
            <div className="ov-panel-body ov-chart-body">
              <canvas ref={trendCanvasRef} aria-label="trend chart" />
              {trendLoading ? <p className="subtle-copy">Loading trend range...</p> : null}
              {trendError ? <p className="error-text">{trendError}</p> : null}
            </div>
          </article>
          <article className="ov-panel panel">
            <div className="ov-panel-header">
              <h3>
                <span className="ov-panel-icon">◈</span>会话来源
              </h3>
            </div>
            <div className="ov-panel-body ov-source-layout">
              <canvas ref={sourceCanvasRef} aria-label="source chart" />
              <div className="ov-source-legend">
                {sourceEntries.map(([source, count], index) => {
                  const pct = data.stats?.source_distribution
                    ? ((count / Object.values(data.stats.source_distribution).reduce((s, x) => s + x, 0)) * 100).toFixed(1)
                    : "0.0";
                  const label = source === "api_server" ? "API" : source === "cron" ? "CRON" : source.toUpperCase();
                  const color = SOURCE_COLORS[index % SOURCE_COLORS.length];
                  return (
                    <div key={source} className="ov-legend-item">
                      <span className="ov-legend-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                      <span className="ov-legend-label">{label}</span>
                      <span className="ov-legend-value">{pct}%</span>
                      <span className="ov-legend-count">({count})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </article>
        </section>

        <section className="ov-panel panel ov-panel-keywords">
          <div className="ov-panel-header">
            <h3>
              <span className="ov-panel-icon">◈</span>会话关键词
            </h3>
            <span className="ov-panel-hint">CLICK TO DRILL DOWN</span>
          </div>
          <div className="ov-panel-body">
            {keywordsLoading ? <p className="subtle-copy">Loading keywords...</p> : null}
            {keywordsError ? <p className="error-text">{keywordsError}</p> : null}
            <div className="ov-keywords-cloud">
              {keywords.map((keyword) => {
                const maxCount = Math.max(...keywords.map((item) => item.count), 1);
                const hot = keyword.count > maxCount * 0.4;
                return (
                  <button
                    key={`${keyword.lang}-${keyword.word}`}
                    type="button"
                    className={`ov-kw-tag ${keyword.lang === "zh" ? "zh" : ""} ${hot ? "hot" : ""}`.trim()}
                    onClick={() => void openKeywordSessions(keyword.word)}
                  >
                    {keyword.word}
                    <span className="ov-kw-count">{keyword.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="ov-panel panel ov-panel-cron-tokens">
          <div className="ov-panel-header">
            <h3>
              <span className="ov-panel-icon">◈</span>计划任务 Token 消耗占比
            </h3>
            <div className="ov-panel-tabs">
              <button className={`ov-tab ${cronPeriod === "today" ? "active" : ""}`} type="button" onClick={() => handleCronPeriodSwitch("today")}>
                今日
              </button>
              <button className={`ov-tab ${cronPeriod === "7d" ? "active" : ""}`} type="button" onClick={() => handleCronPeriodSwitch("7d")}>
                7天
              </button>
              <button className={`ov-tab ${cronPeriod === "30d" ? "active" : ""}`} type="button" onClick={() => handleCronPeriodSwitch("30d")}>
                30天
              </button>
            </div>
          </div>
          <div className="ov-panel-body">
            {cronDistLoading ? <p className="subtle-copy">Loading cron token distribution...</p> : null}
            {cronDistError ? <p className="error-text">{cronDistError}</p> : null}
            <div className="ov-cron-token-layout">
              <div className="ov-cron-token-chart-wrap">
                <canvas ref={cronCanvasRef} aria-label="cron token chart" />
              </div>
              <div className="ov-cron-token-list">
                {(cronDist?.jobs ?? []).map((job, index) => {
                  const color = CRON_COLORS[index % CRON_COLORS.length];
                  return (
                    <div key={job.job_id} className="ov-cron-token-item">
                      <div className="ov-cron-token-dot" style={{ background: color, boxShadow: `0 0 6px ${color}88` }} />
                      <div className="ov-cron-token-name">{job.name}</div>
                      <div className="ov-cron-token-value">{formatCompactTokens(job.io_tokens)}</div>
                      <div className="ov-cron-token-pct">{job.percent_of_cron}%</div>
                      <div className="ov-cron-token-bar-wrap">
                        <div className="ov-cron-token-bar-fill" style={{ width: `${job.percent_of_cron}%`, background: `linear-gradient(90deg, ${color}22, ${color})` }} />
                      </div>
                    </div>
                  );
                })}
                {cronDist && cronDist.non_cron_tokens > 0 ? (
                  <div className="ov-cron-token-item muted">
                    <div className="ov-cron-token-dot" style={{ background: "#3a5a7a" }} />
                    <div className="ov-cron-token-name">非 Cron 会话 (API/CLI/Slack)</div>
                    <div className="ov-cron-token-value">{formatCompactTokens(cronDist.non_cron_tokens)}</div>
                    <div className="ov-cron-token-pct">{Math.round((cronDist.non_cron_tokens / Math.max(cronDist.grand_total, 1)) * 100)}%</div>
                  </div>
                ) : null}
                {cronDist ? (
                  <div className="ov-cron-token-summary">
                    <span>
                      总计 Cron: <strong>{formatCompactTokens(cronDist.total_cron_tokens)}</strong>
                    </span>
                    <span>
                      占全部: <strong>{cronDist.cron_percent}%</strong>
                    </span>
                    <span>
                      Runs: <strong>{cronDist.jobs.reduce((sum, job) => sum + job.runs, 0)}</strong>
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="ov-bottom-row">
          <article className="ov-panel panel">
            <div className="ov-panel-header">
              <h3>
                <span className="ov-panel-icon">◈</span>计划任务
              </h3>
              <span className="ov-panel-hint">{(data.cronjobs?.length ?? 0) + " TASKS"}</span>
            </div>
            <div className="ov-table-wrap">
              <table className="ov-data-table table">
                <thead>
                  <tr>
                    <th>STATUS</th>
                    <th>TASK</th>
                    <th>SCHEDULE</th>
                    <th>LAST RUN</th>
                    <th>TOKENS</th>
                    <th>RUNS</th>
                    <th>OP</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.cronjobs ?? []).map((job) => (
                    <tr key={job.id}>
                      <td>
                        <span className={`ov-badge ${job.enabled ? "green" : "gray"}`}>{job.enabled ? "ACTIVE" : "OFF"}</span>
                      </td>
                      <td className="ov-col-strong">{job.name}</td>
                      <td>{job.schedule}</td>
                      <td>{formatMiniDateTime(job.last_run?.started_at)}</td>
                      <td>{formatCompactTokens(job.last_run?.tokens ?? 0)}</td>
                      <td>{job.run_count}</td>
                      <td>
                        <button type="button" className="ov-btn-sm" onClick={() => void openCronHistory(job)}>
                          HIST
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="ov-panel panel">
            <div className="ov-panel-header">
              <h3>
                <span className="ov-panel-icon">◈</span>安全事件
              </h3>
              <span className="ov-panel-hint">RECENT INVESTIGATIONS</span>
            </div>
            <div className="ov-panel-body">
              <div className="ov-events-list" id="events-list">
                {(eventsPanel?.items ?? []).map((event) => {
                  const riskColor = getEventRiskColor(event.risk_level);
                  const statusClass = getEventStatusClass(event.status);
                  const statusIcon = getEventStatusIcon(event.status);
                  const verdictClass = (event.verdict ?? "").toLowerCase();
                  return (
                    <button
                      type="button"
                      key={`${event.session_id}-${event.type}-${event.time ?? "none"}`}
                      className="ov-ev-row"
                      onClick={() => void openSessionDetail(event.session_id)}
                    >
                      <div className="ov-ev-indicator" style={{ background: riskColor }} />
                      <div className="ov-ev-icon">{resolveEventIcon(event.icon)}</div>
                      <div className="ov-ev-main">
                        <div className="ov-ev-title-row">
                          <span className="ov-ev-type">{event.type_label}</span>
                          <span className="ov-ev-risk" style={{ color: riskColor }}>{event.risk_level}</span>
                          {event.verdict ? <span className={`ov-ev-verdict ov-ev-verdict-${verdictClass}`}>{event.verdict}</span> : null}
                        </div>
                        <div className="ov-ev-summary">{event.summary}</div>
                        <div className="ov-ev-entities">
                          {event.entities.slice(0, 4).map((entity) => (
                            <span key={entity} className="ov-ev-entity">
                              {entity}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="ov-ev-meta">
                        <div className="ov-ev-time">{formatMiniDateTime(event.time)}</div>
                        <div className="ov-ev-stats">
                          <span className={`ov-ev-status ov-ev-status-${statusClass}`}>{statusIcon}</span>
                          <span>{formatDuration(event.duration)}</span>
                          <span>{formatCompactTokens(event.tokens)}</span>
                        </div>
                      </div>
                      <div className="ov-ev-arrow">▸</div>
                    </button>
                  );
                })}

                {eventsLoading ? <p className="subtle-copy">Loading events page...</p> : null}
                {eventsError ? <p className="error-text">{eventsError}</p> : null}
                {!eventsLoading && eventsUnavailable ? <p className="subtle-copy">Security events are unavailable.</p> : null}
                {!eventsLoading && !eventsUnavailable && (eventsPanel?.items.length ?? 0) === 0 ? (
                  <p className="subtle-copy">No security events found.</p>
                ) : null}

                <div className="ov-ev-pagination">
                  <button
                    type="button"
                    className="ov-ev-page-btn"
                    onClick={() => void handleEventsPageChange(eventsPage - 1)}
                    disabled={eventsLoading || !(eventsPanel?.has_prev ?? false)}
                  >
                    ◂ PREV
                  </button>
                  <span className="ov-ev-page-info">
                    {(eventsPanel?.page ?? eventsPage) + " / " + Math.max(eventsPage, eventsPanel?.has_next ? eventsPage + 1 : eventsPage)}
                  </span>
                  <button
                    type="button"
                    className="ov-ev-page-btn"
                    onClick={() => void handleEventsPageChange(eventsPage + 1)}
                    disabled={eventsLoading || !(eventsPanel?.has_next ?? false)}
                  >
                    NEXT ▸
                  </button>
                </div>
              </div>
            </div>
          </article>
        </section>
      </div>

      <div className={`ov-modal-overlay ov-modal-overlay-cron ${cronHistoryModal.open ? "active" : ""}`} onClick={() => setCronHistoryModal({ open: false, jobId: "", jobName: "", loading: false, error: "", items: [] })}>
        <div className="ov-modal" onClick={(event) => event.stopPropagation()}>
          <div className="ov-modal-header">
            <h3>{cronHistoryModal.jobName || "执行历史"}</h3>
            <button type="button" className="ov-modal-close" onClick={() => setCronHistoryModal({ open: false, jobId: "", jobName: "", loading: false, error: "", items: [] })}>
              ✕
            </button>
          </div>
          <div className="ov-modal-body">
            {cronHistoryModal.loading ? <p className="subtle-copy">LOADING...</p> : null}
            {cronHistoryModal.error ? <p className="error-text">{cronHistoryModal.error}</p> : null}
            {cronHistoryModal.items.map((item) => (
              <button type="button" className="ov-history-item" key={`${item.session_id}-${item.started_at ?? "none"}`} onClick={() => void openSessionDetail(item.session_id)}>
                <div>
                  <div className="ov-history-time">{formatMiniDateTime(item.started_at)}</div>
                </div>
                <div className="ov-history-meta">
                  <span>{formatDuration(item.duration_seconds)}</span>
                  <span>{formatCompactTokens(item.tokens)} tkn</span>
                  <span>{item.messages} msg</span>
                  <span className={`ov-badge ${item.status === "completed" ? "green" : "red"}`}>{item.status}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`ov-modal-overlay ov-modal-overlay-session ${sessionModal.open ? "active" : ""}`} onClick={() => setSessionModal({ open: false, sessionId: "", loading: false, error: "", detail: null })}>
        <div className="ov-modal ov-modal-lg" onClick={(event) => event.stopPropagation()}>
          <div className="ov-modal-header">
            <h3>SESSION DETAIL</h3>
            <button type="button" className="ov-modal-close" onClick={() => setSessionModal({ open: false, sessionId: "", loading: false, error: "", detail: null })}>
              ✕
            </button>
          </div>
          <div className="ov-modal-body">
            {sessionModal.loading ? <p className="subtle-copy">LOADING...</p> : null}
            {sessionModal.error ? <p className="error-text">{sessionModal.error}</p> : null}
            {(sessionModal.detail?.messages ?? []).map((message, index) => (
              <div key={`${message.role}-${message.timestamp ?? index}-${index}`} className={`ov-msg-item ov-msg-${message.role}`}>
                <div className="ov-msg-role">{(message.tool_name ? `${message.role} (${message.tool_name})` : message.role).toUpperCase()}</div>
                <div className="ov-msg-content">{message.content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`ov-modal-overlay ov-modal-overlay-keyword ${keywordModal.open ? "active" : ""}`} onClick={() => setKeywordModal({ open: false, keyword: "", loading: false, error: "", items: [] })}>
        <div className="ov-modal" onClick={(event) => event.stopPropagation()}>
          <div className="ov-modal-header">
            <h3>{`"${keywordModal.keyword}" — RELATED`}</h3>
            <button type="button" className="ov-modal-close" onClick={() => setKeywordModal({ open: false, keyword: "", loading: false, error: "", items: [] })}>
              ✕
            </button>
          </div>
          <div className="ov-modal-body">
            {keywordModal.loading ? <p className="subtle-copy">LOADING...</p> : null}
            {keywordModal.error ? <p className="error-text">{keywordModal.error}</p> : null}
            {keywordModal.items.map((item) => (
              <button
                type="button"
                className="ov-history-item"
                key={item.session_id}
                onClick={() => {
                  setKeywordModal({ open: false, keyword: "", loading: false, error: "", items: [] });
                  void openSessionDetail(item.session_id);
                }}
              >
                <div>
                  <div className="ov-history-title">{item.title}</div>
                  <div className="ov-history-time">{`${formatMiniDateTime(item.started_at)} · ${item.source}`}</div>
                </div>
                <div className="ov-history-meta">
                  <span>{item.messages} msg</span>
                  <span>{formatCompactTokens(item.tokens)} tkn</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
