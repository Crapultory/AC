import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { SkillsPage } from "./SkillsPage";

describe("SkillsPage structure", () => {
  it("renders grouped operations layout and action zone markers", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/skills"]}>
        <SkillsPage />
      </MemoryRouter>,
    );

    expect(html).toContain("skills-workbench-page");
    expect(html).toContain("skills-workbench");
    expect(html).toContain("skills-enabled-pane");
    expect(html).toContain("skills-context-rail");
    expect(html).toContain("skill-action-zone");
    expect(html).toContain("Installed Skills");
    expect(html).toContain("Enabled Skills");
    expect(html).toContain("Disabled Skills");
    expect(html).toContain("Operation Context");
    expect(html).toContain("Action zone: use Enable/Disable controls on each card to call /api/skills/toggle.");
  });
});
