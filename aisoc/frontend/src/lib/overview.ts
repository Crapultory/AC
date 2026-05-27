import { fetchJSON } from "./api";

export type OverviewStatus = {
  status: string;
  model: string;
  provider: string;
  profile: string;
  uptime_seconds: number;
  last_activity: number;
};

export type OverviewStats = {
  total_sessions: number;
  active_sessions: number;
  today_tokens: number;
  today_input_tokens: number;
  today_output_tokens: number;
  cron_jobs_total: number;
  cron_jobs_enabled: number;
  memory_used_chars: number;
  memory_total_chars: number;
  memory_percent: number;
  source_distribution: Record<string, number>;
};

export type TokenTrendPoint = {
  date: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  sessions: number;
};

export type SecurityEvent = {
  session_id: string;
  type: string;
  type_label: string;
  icon: string;
  time: number | null;
  duration: number | null;
  tokens: number;
  status: string;
  risk_level: string;
  summary: string;
  entities: string[];
  verdict: string;
};

export type OverviewKeyword = {
  word: string;
  count: number;
  lang: "en" | "zh";
};

export type KeywordSession = {
  session_id: string;
  title: string;
  source: string;
  started_at: number | null;
  messages: number;
  tokens: number;
};

export type CronTokenPeriod = "today" | "7d" | "30d";

export type CronTokenDistributionJob = {
  job_id: string;
  name: string;
  runs: number;
  input_tokens: number;
  output_tokens: number;
  io_tokens: number;
  cache_read: number;
  cache_write: number;
  percent_of_cron: number;
  percent_of_total: number;
};

export type CronTokenDistribution = {
  period: CronTokenPeriod;
  total_cron_tokens: number;
  non_cron_tokens: number;
  grand_total: number;
  cron_percent: number;
  jobs: CronTokenDistributionJob[];
};

export type CronjobLastRun = {
  session_id: string;
  started_at: number | null;
  ended_at: number | null;
  tokens: number;
  status: string;
};

export type Cronjob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  last_run: CronjobLastRun | null;
  run_count: number;
};

export type CronjobHistoryItem = {
  session_id: string;
  started_at: number | null;
  ended_at: number | null;
  duration_seconds: number | null;
  messages: number;
  tokens: number;
  status: string;
};

export type SessionDetailMessage = {
  role: string;
  content: string;
  tool_name?: string | null;
  timestamp?: number | null;
};

export type SessionDetail = {
  session_id: string;
  source: string;
  model: string;
  started_at: number | null;
  ended_at: number | null;
  message_count: number;
  tokens: number;
  messages: SessionDetailMessage[];
};

export function getOverviewStatus(): Promise<OverviewStatus> {
  return fetchJSON<OverviewStatus>("/api/overview/status");
}

export function getOverviewStats(): Promise<OverviewStats> {
  return fetchJSON<OverviewStats>("/api/overview/stats");
}

export function getOverviewTokenTrend(days: 7 | 30): Promise<TokenTrendPoint[]> {
  return fetchJSON<TokenTrendPoint[]>(`/api/overview/token-trend?days=${days}`);
}

export function listOverviewSecurityEvents(limit: number = 15): Promise<SecurityEvent[]> {
  return fetchJSON<SecurityEvent[]>(`/api/overview/security-events?limit=${limit}`);
}

export function listOverviewKeywords(): Promise<OverviewKeyword[]> {
  return fetchJSON<OverviewKeyword[]>("/api/overview/keywords");
}

export function getKeywordSessions(keyword: string): Promise<KeywordSession[]> {
  const encodedKeyword = encodeURIComponent(keyword);
  return fetchJSON<KeywordSession[]>(`/api/overview/keywords/${encodedKeyword}/sessions`);
}

export function getCronTokenDistribution(
  period: CronTokenPeriod = "today",
): Promise<CronTokenDistribution> {
  return fetchJSON<CronTokenDistribution>(`/api/overview/cron-token-dist?period=${period}`);
}

export function getCronjobs(): Promise<Cronjob[]> {
  return fetchJSON<Cronjob[]>("/api/overview/cronjobs");
}

export function getCronjobHistory(jobId: string): Promise<CronjobHistoryItem[]> {
  const encodedJobId = encodeURIComponent(jobId);
  return fetchJSON<CronjobHistoryItem[]>(`/api/overview/cronjobs/${encodedJobId}/history`);
}

export function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  const encodedSessionId = encodeURIComponent(sessionId);
  return fetchJSON<SessionDetail>(`/api/overview/sessions/${encodedSessionId}/detail`);
}
