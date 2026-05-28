import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { isLatestSessionSelectionRequest, isSessionActivationKey, SessionsPage } from "./SessionsPage";

describe("SessionsPage structure", () => {
  it("renders scan, message detail, and context workbench zones", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/sessions"]}>
        <SessionsPage />
      </MemoryRouter>,
    );

    expect(html).toContain("sessions-workbench-page");
    expect(html).toContain("sessions-workbench");
    expect(html).toContain("sessions-scan-pane");
    expect(html).toContain("sessions-message-pane");
    expect(html).toContain("sessions-context-rail");
    expect(html).toContain("Recent Sessions");
    expect(html).toContain("Session Messages");
    expect(html).toContain("Analysis Context");
    expect(html).toContain("Detail view shows message payloads only. System role messages are filtered out.");
  });

  it("validates latest-click-wins request guard helper", () => {
    expect(isLatestSessionSelectionRequest(3, 3)).toBe(true);
    expect(isLatestSessionSelectionRequest(2, 3)).toBe(false);
  });

  it("validates keyboard activation helper for selection rows", () => {
    expect(isSessionActivationKey("Enter")).toBe(true);
    expect(isSessionActivationKey(" ")).toBe(true);
    expect(isSessionActivationKey("Spacebar")).toBe(false);
    expect(isSessionActivationKey("Escape")).toBe(false);
  });
});
