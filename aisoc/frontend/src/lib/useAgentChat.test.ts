/**
 * @vitest-environment jsdom
 */

import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WIDGET_SESSION_KEY } from "./useAgentChat";

// Mock agent-rpc before importing the hook module
const mockCall = vi.fn();
const mockOn = vi.fn(() => () => {});
const mockDisconnect = vi.fn();

vi.mock("./agent-rpc", () => ({
  AgentRpc: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    call: mockCall,
    on: mockOn,
    disconnect: mockDisconnect,
  })),
}));

vi.mock("./auth", () => ({
  getStoredToken: vi.fn(() => "test-token"),
}));

import { useAgentChat } from "./useAgentChat";

function renderChatHook() {
  return renderHook(() => useAgentChat());
}

describe("useAgentChat", () => {
  beforeEach(() => {
    localStorage.clear();
    mockCall.mockReset();
    mockOn.mockReset();
    mockOn.mockReturnValue(() => {});
    mockDisconnect.mockReset();
  });

  it("exports the session storage key constant", () => {
    expect(WIDGET_SESSION_KEY).toBe("aisoc.widget.sessionId");
  });

  it("starts disconnected", () => {
    const { result } = renderChatHook();
    expect(result.current.state.phase).toBe("disconnected");
  });

  describe("connect()", () => {
    it("creates new session when no cached DB session ID", async () => {
      mockCall
        .mockResolvedValueOnce({ session_id: "tui-new", info: {} })  // session.create
        .mockResolvedValueOnce({ title: "New Chat", session_key: "20260530_120000_abc123" }); // session.title

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("session.create", expect.any(Object));
        expect(mockCall).toHaveBeenCalledWith("session.title", expect.objectContaining({ session_id: "tui-new" }));
        expect(result.current.state.sessionId).toBe("tui-new");
      });
    });

    it("resumes using cached DB session ID", async () => {
      localStorage.setItem("aisoc.widget.dbSessionId", "db-session-001");
      mockCall
        .mockResolvedValueOnce({                                    // session.resume
          session_id: "tui-789",
          resumed: "db-session-001",
          messages: [
            { role: "user", text: "hello" },
            { role: "assistant", text: "hi" },
          ],
          info: {},
        })
        .mockResolvedValueOnce({ status: "ok" });                  // prompt.submit

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(result.current.state.phase).toBe("idle");
        expect(result.current.state.sessionId).toBe("tui-789");
      });

      // Verify resume used cached DB ID, not most_recent
      expect(mockCall).toHaveBeenCalledWith("session.resume", expect.objectContaining({
        session_id: "db-session-001",
      }));
      expect(mockCall).not.toHaveBeenCalledWith("session.most_recent", expect.anything());

      // Verify prompt.submit uses TUI sid
      act(() => result.current.send("test"));
      expect(mockCall).toHaveBeenCalledWith("prompt.submit", expect.objectContaining({
        session_id: "tui-789",
      }));
    });

    it("falls back to create on resume error", async () => {
      localStorage.setItem("aisoc.widget.dbSessionId", "expired-999");
      mockCall
        .mockRejectedValueOnce({ code: 4007, message: "session not found" }) // session.resume fails
        .mockResolvedValueOnce({ session_id: "fresh-111", info: {} })         // session.create
        .mockResolvedValueOnce({ title: "", session_key: "new-db-id" });      // session.title

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("session.create", expect.any(Object));
      });
    });

    it("startNewSession skips resume and creates fresh", async () => {
      localStorage.setItem("aisoc.widget.dbSessionId", "db-old");
      mockCall
        .mockResolvedValueOnce({ session_id: "tui-old", resumed: "db-old", messages: [], info: {} });

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(result.current.state.phase).toBe("idle");
      });

      mockCall.mockReset();
      mockCall
        .mockResolvedValueOnce({ session_id: "tui-new", info: {} })
        .mockResolvedValueOnce({ title: "", session_key: "db-new" });

      act(() => result.current.startNewSession());

      await vi.waitFor(() => {
        expect(result.current.state.phase).toBe("idle");
        expect(result.current.state.sessionId).toBe("tui-new");
        expect(mockCall).not.toHaveBeenCalledWith("session.resume", expect.anything());
        expect(mockCall).toHaveBeenCalledWith("session.create", expect.any(Object));
      });
    });

    it("retries once on connection failure", async () => {
      const { AgentRpc } = await import("./agent-rpc");
      let callCount = 0;
      (AgentRpc as any).mockImplementation(() => ({
        connect: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error("Connection failed"));
          return Promise.resolve();
        }),
        call: mockCall
          .mockResolvedValueOnce({ session_id: "retry-ok", info: {} })
          .mockResolvedValueOnce({ title: "", session_key: "db-retry" }),
        on: mockOn,
        disconnect: mockDisconnect,
      }));

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(callCount).toBeGreaterThanOrEqual(2);
      }, { timeout: 4000 });
    });
  });

  describe("send()", () => {
    it("calls prompt.submit with text", async () => {
      mockCall
        .mockResolvedValueOnce({ session_id: "sess-1", info: {} })   // session.create
        .mockResolvedValueOnce({ title: "", session_key: "db-1" })   // session.title
        .mockResolvedValueOnce({ status: "streaming" });              // prompt.submit

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(result.current.state.phase).toBe("idle");
      });

      act(() => result.current.send("hello agent"));
      expect(mockCall).toHaveBeenCalledWith("prompt.submit", expect.objectContaining({
        text: "hello agent",
      }));
    });
  });
});
