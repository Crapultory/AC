import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { CronPage } from "./CronPage";

describe("CronPage structure", () => {
  it("renders analyst workbench zones and action markers", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/cron"]}>
        <CronPage />
      </MemoryRouter>,
    );

    expect(html).toContain("page-mission-header");
    expect(html).toContain("cron-workbench-page");
    expect(html).toContain("cron-workbench");
    expect(html).toContain("cron-jobs-pane");
    expect(html).toContain("cron-detail-pane");
    expect(html).toContain("cron-action-zone");
    expect(html).toContain("Jobs");
    expect(html).toContain("Cron Job Detail");
  });
});
