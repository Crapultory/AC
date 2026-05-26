import { getStoredToken } from "./auth";

export function generateChannelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `aisoc-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function wsBaseUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

export function buildPtyUrl(
  *,
  channel: string,
  resume: string | null,
): string {
  const qs = new URLSearchParams({
    token: getStoredToken(),
    channel,
  });
  if (resume) qs.set("resume", resume);
  return `${wsBaseUrl()}/api/chat/pty?${qs.toString()}`;
}

export function buildEventsUrl(channel: string): string {
  const qs = new URLSearchParams({
    token: getStoredToken(),
    channel,
  });
  return `${wsBaseUrl()}/api/chat/events?${qs.toString()}`;
}

export function buildGatewayUrl(channel: string): string {
  const qs = new URLSearchParams({
    token: getStoredToken(),
    channel,
  });
  return `${wsBaseUrl()}/api/chat/ws?${qs.toString()}`;
}

