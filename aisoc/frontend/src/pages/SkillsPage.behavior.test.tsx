/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJSON } from "../lib/api";
import { SkillsPage } from "./SkillsPage";

vi.mock("../lib/api", () => ({
  fetchJSON: vi.fn(),
}));

async function waitForAssert(assertion: () => void, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) throw error;
      await act(async () => {
        await Promise.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

let rootRef: Root | null = null;
let containerRef: HTMLElement | null = null;
const fetchJSONMock = vi.mocked(fetchJSON);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (rootRef && containerRef) {
    await act(async () => {
      rootRef?.unmount();
    });
    containerRef.remove();
  }
  rootRef = null;
  containerRef = null;
});

async function mountSkillsPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/skills"]}>
        <SkillsPage />
      </MemoryRouter>,
    );
  });

  rootRef = root;
  containerRef = container;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

describe("SkillsPage behavior", () => {
  it("does not show success when toggle succeeds but refresh fails", async () => {
    let skillsLoadCount = 0;

    fetchJSONMock.mockImplementation((url: string) => {
      if (url === "/api/skills") {
        skillsLoadCount += 1;
        if (skillsLoadCount === 1) {
          return Promise.resolve([
            { name: "threat-hunt", description: "Threat Hunt", enabled: false },
          ]) as Promise<unknown>;
        }
        return Promise.reject(new Error("refresh failed")) as Promise<unknown>;
      }

      if (url === "/api/skills/toggle") {
        return Promise.resolve({ ok: true }) as Promise<unknown>;
      }

      throw new Error(`Unexpected URL in test: ${url}`);
    });

    await mountSkillsPage();

    await waitForAssert(() => {
      const text = (containerRef as HTMLElement).textContent || "";
      expect(text).toContain("Disabled Skills");
      expect(text).toContain("threat-hunt");
    });

    const enableButton = findButton(containerRef as HTMLElement, "Enable");

    await act(async () => {
      enableButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForAssert(() => {
      const text = (containerRef as HTMLElement).textContent || "";
      expect(text).toContain("Operation Failed");
      expect(text).toContain("Updated threat-hunt, but failed to refresh skills from /api/skills.");
      expect(text).not.toContain("Operation Completed");
      expect(text).not.toContain("threat-hunt enabled successfully.");
    });
  });
});
