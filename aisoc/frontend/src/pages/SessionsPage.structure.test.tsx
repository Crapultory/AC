import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { SessionsPage } from "./SessionsPage";

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
});
