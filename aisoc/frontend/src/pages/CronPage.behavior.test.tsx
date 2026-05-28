/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJSON } from "../lib/api";
import { CronPage } from "./CronPage";

vi.mock("../lib/api", () => ({
  fetchJSON: vi.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

function findJobRow(container: HTMLElement, name: string): HTMLLIElement {
  const row = Array.from(container.querySelectorAll<HTMLLIElement>('li[role="button"]')).find((candidate) =>
    candidate.textContent?.includes(name),
  );
  if (!row) throw new Error(`Cron job row not found for: ${name}`);
  return row;
}

function findActionButton(row: HTMLLIElement, label: string): HTMLButtonElement {
  const button = Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`Action button not found: ${label}`);
  return button;
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

async function mountCronPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/cron"]}>
        <CronPage />
      </MemoryRouter>,
    );
  });

  rootRef = root;
  containerRef = container;

  return { container, root };
}

describe("CronPage behavior", () => {
  it("keeps latest selected cron detail when responses resolve out of order", async () => {
    const aDeferred = createDeferred<Record<string, unknown>>();
    const bDeferred = createDeferred<Record<string, unknown>>();

    fetchJSONMock.mockImplementation((url: string) => {
      if (url === "/api/cron/jobs") {
        return Promise.resolve([
          { id: "a", name: "Job A", profile: "p-a", paused: false },
          { id: "b", name: "Job B", profile: "p-b", paused: false },
        ]) as Promise<unknown>;
      }
      if (url === "/api/cron/jobs/a") {
        return aDeferred.promise as Promise<unknown>;
      }
      if (url === "/api/cron/jobs/b") {
        return bDeferred.promise as Promise<unknown>;
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });

    await mountCronPage();

    await waitForAssert(() => {
      expect(containerRef?.querySelectorAll('li[role="button"]').length).toBe(2);
    });

    const rowA = findJobRow(containerRef as HTMLElement, "Job A");
    const rowB = findJobRow(containerRef as HTMLElement, "Job B");

    await act(async () => {
      rowA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      rowB.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      bDeferred.resolve({ detail: "detail-b" });
      await Promise.resolve();
    });

    await waitForAssert(() => {
      const text = (containerRef as HTMLElement).textContent || "";
      expect(text).toContain("Focus: b");
      expect(text).toContain("detail-b");
    });

    await act(async () => {
      aDeferred.resolve({ detail: "stale-detail-a" });
      await Promise.resolve();
    });

    await waitForAssert(() => {
      const text = (containerRef as HTMLElement).textContent || "";
      expect(text).toContain("Focus: b");
      expect(text).toContain("detail-b");
      expect(text).not.toContain("stale-detail-a");
    });
  });

  it("activates cron row selection via keyboard", async () => {
    fetchJSONMock.mockImplementation((url: string) => {
      if (url === "/api/cron/jobs") {
        return Promise.resolve([
          { id: "a", name: "Job A", profile: "p-a", paused: false },
          { id: "b", name: "Job B", profile: "p-b", paused: false },
        ]) as Promise<unknown>;
      }
      if (url === "/api/cron/jobs/a") {
        return Promise.resolve({ detail: "kbd-a" }) as Promise<unknown>;
      }
      if (url === "/api/cron/jobs/b") {
        return Promise.resolve({ detail: "kbd-b" }) as Promise<unknown>;
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });

    await mountCronPage();

    await waitForAssert(() => {
      expect(containerRef?.querySelectorAll('li[role="button"]').length).toBe(2);
    });

    const rowA = findJobRow(containerRef as HTMLElement, "Job A");
    const rowB = findJobRow(containerRef as HTMLElement, "Job B");

    await act(async () => {
      rowA.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    await waitForAssert(() => {
      const text = (containerRef as HTMLElement).textContent || "";
      expect(text).toContain("Focus: a");
      expect(text).toContain("kbd-a");
    });

    await act(async () => {
      rowB.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      await Promise.resolve();
    });

    await waitForAssert(() => {
      const text = (containerRef as HTMLElement).textContent || "";
      expect(text).toContain("Focus: b");
      expect(text).toContain("kbd-b");
    });
  });

  it("does not let stale action follow-up overwrite a newer selection", async () => {
    const actionDeferred = createDeferred<Record<string, unknown>>();
    const aDeferred = createDeferred<Record<string, unknown>>();
    const bDeferred = createDeferred<Record<string, unknown>>();
    let jobsLoadCount = 0;

    fetchJSONMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/cron/jobs") {
        jobsLoadCount += 1;
        return Promise.resolve([
          { id: "job/a", name: "Job A", profile: "p-a", paused: false },
          { id: "b", name: "Job B", profile: "p-b", paused: false },
        ]) as Promise<unknown>;
      }
      if (url === "/api/cron/jobs/job%2Fa") {
        return aDeferred.promise as Promise<unknown>;
      }
      if (url === "/api/cron/jobs/b") {
        return bDeferred.promise as Promise<unknown>;
      }
      if (url === "/api/cron/jobs/job%2Fa/trigger") {
        expect(init?.method).toBe("POST");
        return actionDeferred.promise as Promise<unknown>;
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });

    await mountCronPage();

    await waitForAssert(() => {
      expect(containerRef?.querySelectorAll('li[role="button"]').length).toBe(2);
    });

    const rowA = findJobRow(containerRef as HTMLElement, "Job A");
    const rowB = findJobRow(containerRef as HTMLElement, "Job B");
    const triggerButton = findActionButton(rowA, "Trigger");

    await act(async () => {
      rowA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      triggerButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      rowB.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      bDeferred.resolve({ detail: "detail-b" });
      await Promise.resolve();
    });

    await waitForAssert(() => {
      const text = (containerRef as HTMLElement).textContent || "";
      expect(text).toContain("Focus: b");
      expect(text).toContain("detail-b");
    });

    await act(async () => {
      actionDeferred.resolve({ ok: true });
      await Promise.resolve();
    });

    await waitForAssert(() => {
      expect(jobsLoadCount).toBe(2);
    });

    await act(async () => {
      aDeferred.resolve({ detail: "stale-a" });
      await Promise.resolve();
    });

    await waitForAssert(() => {
      const text = (containerRef as HTMLElement).textContent || "";
      expect(text).toContain("Focus: b");
      expect(text).toContain("detail-b");
      expect(text).not.toContain("stale-a");
      const detailCallsForA = fetchJSONMock.mock.calls.filter(([callUrl]) => callUrl === "/api/cron/jobs/job%2Fa");
      expect(detailCallsForA.length).toBe(1);
    });
  });
});
