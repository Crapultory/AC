import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { ChatPage } from "./ChatPage";

describe("ChatPage structure", () => {
  it("renders analyst workbench zones and key markers", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/chat?resume=session-42"]}>
        <ChatPage />
      </MemoryRouter>,
    );

    expect(html).toContain("page-mission-header");
    expect(html).toContain("chat-workbench");
    expect(html).toContain("chat-terminal-pane");
    expect(html).toContain("chat-sidebar");
    expect(html).toContain("Resume target: session-42");
  });
});
