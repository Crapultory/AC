import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { fetchJSON } from "../lib/api";

type ChatStatus = {
  embedded_chat: boolean;
  ready: boolean;
};

export function ChatPage() {
  const [searchParams] = useSearchParams();
  const resume = searchParams.get("resume");
  const [status, setStatus] = useState<ChatStatus | null>(null);

  useEffect(() => {
    async function load() {
      const payload = await fetchJSON<ChatStatus>("/api/chat/status");
      setStatus(payload);
    }
    void load();
  }, []);

  return (
    <section>
      <h2>Chat</h2>
      {resume ? <p>Resuming session: {resume}</p> : null}
      {status?.ready ? (
        <p>Embedded chat runtime is enabled. PTY bridge wiring is pending.</p>
      ) : (
        <p>Embedded chat is currently disabled. Start with `hermes aisoc --tui`.</p>
      )}
    </section>
  );
}
