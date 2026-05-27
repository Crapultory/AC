import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OverviewPage } from "./OverviewPage";

describe("OverviewPage", () => {
  it("renders loading state initially", () => {
    const html = renderToStaticMarkup(<OverviewPage />);

    expect(html).toContain("Loading overview dashboard...");
  });

  it("renders key overview sections when state data is ready", () => {
    const html = renderToStaticMarkup(
      <OverviewPage
        initialData={{
          status: {
            status: "running",
            model: "gpt-5",
            provider: "openai",
            profile: "default",
            uptime_seconds: 3600,
            last_activity: 1710000000,
          },
          stats: {
            total_sessions: 100,
            active_sessions: 5,
            today_tokens: 12345,
            today_input_tokens: 7000,
            today_output_tokens: 5345,
            cron_jobs_total: 8,
            cron_jobs_enabled: 6,
            memory_used_chars: 10000,
            memory_total_chars: 20000,
            memory_percent: 50,
            source_distribution: { cli: 3, telegram: 2 },
          },
          trend: [
            {
              date: "2026-05-27",
              input_tokens: 100,
              output_tokens: 200,
              total_tokens: 300,
              sessions: 2,
            },
          ],
          cronjobs: [
            {
              id: "job-1",
              name: "Daily summary",
              enabled: true,
              schedule: "0 8 * * *",
              last_run: {
                session_id: "sess-1",
                started_at: 1710000100,
                ended_at: 1710000200,
                tokens: 200,
                status: "success",
              },
              run_count: 21,
            },
          ],
          events: [
            {
              session_id: "sess-2",
              type: "security",
              type_label: "Security Alert",
              icon: "⚠️",
              time: 1710000300,
              duration: 5,
              tokens: 120,
              status: "open",
              risk_level: "high",
              summary: "Suspicious command chain detected",
              entities: ["curl", "bash"],
              verdict: "investigate",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Overview");
    expect(html).toContain("Key Stats");
    expect(html).toContain("Token Trend");
    expect(html).toContain("Cron Jobs");
    expect(html).toContain("Security Events");
  });
});
