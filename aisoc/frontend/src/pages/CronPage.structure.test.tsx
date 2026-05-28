import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { CronPage, isCronActivationKey, isLatestCronDetailRequest } from "./CronPage";

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

describe("CronPage helpers", () => {
  it("validates latest-request guard helper", () => {
    expect(isLatestCronDetailRequest(2, 2)).toBe(true);
    expect(isLatestCronDetailRequest(1, 2)).toBe(false);
  });

  it("validates keyboard activation helper", () => {
    expect(isCronActivationKey("Enter")).toBe(true);
    expect(isCronActivationKey(" ")).toBe(true);
    expect(isCronActivationKey("Escape")).toBe(false);
  });
});
