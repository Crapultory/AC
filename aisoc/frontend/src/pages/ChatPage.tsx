import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ChatSidebar } from "../components/ChatSidebar";
import { fetchJSON } from "../lib/api";
import { buildEventsUrl, buildGatewayUrl, buildPtyUrl, generateChannelId } from "../lib/chat";

type ChatStatus = {
  embedded_chat: boolean;
  ready: boolean;
};

type LatestDescendant = {
  session_id: string;
};

const TERMINAL_THEME = {
  background: "#0d2626",
  foreground: "#f0e6d2",
  cursor: "#f0e6d2",
  cursorAccent: "#0d2626",
  selectionBackground: "#f0e6d244",
};

export function ChatPage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const resume = searchParams.get("resume");
  const channel = useMemo(() => generateChannelId(), [resume]);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const payload = await fetchJSON<ChatStatus>("/api/chat/status");
        if (!cancelled) setStatus(payload);
      } catch {
        if (!cancelled) setBanner("Failed to query chat runtime status.");
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const resumeId = resume ?? "";
    if (!resumeId) return;
    let cancelled = false;

    async function syncLatest() {
      try {
        const payload = await fetchJSON<LatestDescendant>(
          `/api/sessions/${encodeURIComponent(resumeId)}/latest-descendant`,
        );
        if (cancelled) return;
        if (payload.session_id && payload.session_id !== resumeId) {
          const next = new URLSearchParams(searchParams);
          next.set("resume", payload.session_id);
          setSearchParams(next, { replace: true });
        }
      } catch {
        // Best effort; stale session should not block chat launch.
      }
    }

    void syncLatest();
    return () => {
      cancelled = true;
    };
  }, [resume, searchParams, setSearchParams]);

  useEffect(() => {
    if (!status?.ready) {
      return;
    }
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', 'Cascadia Mono', 'Fira Code', 'Source Code Pro', Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.08,
      scrollback: 5000,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.loadAddon(new WebLinksAddon());
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL can fail on remote/virtualized GPUs; fallback renderer is fine.
    }

    term.open(host);
    fit.fit();
    term.focus();

    const ptyUrl = buildPtyUrl({ channel, resume });
    const ptyWs = new WebSocket(ptyUrl);
    ptyWs.binaryType = "arraybuffer";
    wsRef.current = ptyWs;
    termRef.current = term;

    ptyWs.onopen = () => {
      term.writeln("\x1b[2mConnected to AISOC chat PTY.\x1b[0m");
      const { cols, rows } = term;
      ptyWs.send(`\x1b[RESIZE:${cols};${rows}]`);
    };
    ptyWs.onmessage = (event) => {
      if (typeof event.data === "string") {
        term.write(event.data);
        return;
      }
      term.write(new Uint8Array(event.data));
    };
    ptyWs.onerror = () => {
      term.writeln("\r\n\x1b[31mPTY websocket error.\x1b[0m");
    };
    ptyWs.onclose = (event) => {
      term.writeln("\r\n\x1b[33mPTY connection closed.\x1b[0m");
      if (event.code === 4401) {
        setBanner("Session token expired. Please sign in again.");
      } else if (event.code === 4403) {
        setBanner("Embedded chat is disabled on the server. Start with --tui.");
      }
    };

    const disposeData = term.onData((text) => {
      if (ptyWs.readyState === WebSocket.OPEN) {
        ptyWs.send(text);
      }
    });
    const disposeResize = term.onResize(({ cols, rows }) => {
      if (ptyWs.readyState === WebSocket.OPEN) {
        ptyWs.send(`\x1b[RESIZE:${cols};${rows}]`);
      }
    });
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(host);

    const eventsWs = new WebSocket(buildEventsUrl(channel));
    eventsWs.onclose = (event) => {
      if (event.code === 4401) {
        setBanner("Session token expired. Please sign in again.");
      } else if (event.code === 4403) {
        setBanner("Embedded chat is disabled on the server. Start with --tui.");
      }
    };
    eventsWs.onmessage = (event) => {
      const text = typeof event.data === "string" ? event.data : "";
      if (!text) return;
      setEvents((prev) => {
        const next = [...prev, text];
        return next.slice(-120);
      });
    };

    const gatewayWs = new WebSocket(buildGatewayUrl(channel));
    gatewayWs.onclose = (event) => {
      if (event.code === 4401) {
        setBanner("Session token expired. Please sign in again.");
      } else if (event.code === 4403) {
        setBanner("Embedded chat is disabled on the server. Start with --tui.");
      }
    };

    return () => {
      disposeData.dispose();
      disposeResize.dispose();
      resizeObserver.disconnect();
      gatewayWs.close();
      eventsWs.close();
      ptyWs.close();
      term.dispose();
      wsRef.current = null;
      termRef.current = null;
    };
  }, [channel, resume, status?.ready]);

  return (
    <section className="chat-layout">
      <div className="chat-terminal-pane">
        <h2>Chat</h2>
        {resume ? <p className="subtle-copy">Resume target: {resume}</p> : null}
        {!status?.ready ? (
          <p className="subtle-copy">
            Embedded chat is disabled. Start AISOC with `hermes aisoc --tui`.
          </p>
        ) : null}
        {banner ? <p className="error-text">{banner}</p> : null}
        <div className="terminal-host" ref={hostRef} />
      </div>
      <ChatSidebar events={events} />
    </section>
  );
}
