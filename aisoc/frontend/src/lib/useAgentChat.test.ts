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
    it("creates new session when no saved sessionId", async () => {
      mockCall.mockResolvedValue({ session_id: "new-123", info: {} });

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("session.create", expect.any(Object));
      });
    });

    it("resumes existing session when sessionId saved", async () => {
      localStorage.setItem(WIDGET_SESSION_KEY, "saved-456");
      mockCall.mockResolvedValue({
        session_id: "resumed-789",
        resumed: "saved-456",
        messages: [
          { role: "user", text: "hello" },
          { role: "assistant", text: "hi" },
        ],
        info: {},
      });

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("session.resume", expect.objectContaining({
          session_id: "saved-456",
        }));
      });
    });

    it("falls back to create on resume error", async () => {
      localStorage.setItem(WIDGET_SESSION_KEY, "expired-999");
      mockCall
        .mockRejectedValueOnce({ code: 4007, message: "session not found" })
        .mockResolvedValueOnce({ session_id: "fresh-111", info: {} });

      const { result } = renderChatHook();
      act(() => result.current.connect());

      await vi.waitFor(() => {
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
        call: mockCall.mockResolvedValue({ session_id: "retry-ok", info: {} }),
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
        .mockResolvedValueOnce({ session_id: "sess-1", info: {} })
        .mockResolvedValueOnce({ status: "streaming" });

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
