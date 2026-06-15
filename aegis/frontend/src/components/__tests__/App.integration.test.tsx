import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.onopen?.();
    });
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(payload: unknown) {
    this.onmessage?.({
      data: JSON.stringify(payload),
    } as MessageEvent<string>);
  }
}

function jsonResponse(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Aegis App integration', () => {
  const originalFetch = global.fetch;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    MockWebSocket.instances = [];
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it('authenticates and creates agents and global rules through the backend API', async () => {
    const agents = [
      {
        agent_id: 'seed-agent',
        url: 'http://127.0.0.1:9086/a2a',
        description: 'Seed agent',
        headers: { Authorization: 'Bearer seed' },
        status: 'active',
        extcapabilities: ['seed capability'],
      },
    ];
    const rules = [
      {
        id: 'rule0001',
        name: 'Seed Rule',
        policy: 'Seed policy',
        status: 'active',
      },
    ];
    const requests: Array<{ url: string; method: string; auth: string | null }> = [];

    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      const headers = new Headers(init?.headers || {});
      requests.push({
        url,
        method,
        auth: headers.get('Authorization'),
      });

      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false, token_source: 'env' });
      }
      if (url === '/api/auth/login' && method === 'POST') {
        return jsonResponse({ authenticated: true });
      }
      if (url === '/api/agents' && method === 'GET') {
        return jsonResponse({ agents });
      }
      if (url === '/api/routing/global' && method === 'GET') {
        return jsonResponse({ rules });
      }
      if (url === '/api/agents/new-agent' && method === 'POST') {
        agents.push({
          agent_id: 'new-agent',
          url: 'http://127.0.0.1:9090/a2a',
          description: 'New agent description',
          headers: { Authorization: 'Bearer abc' },
          status: 'idle',
          extcapabilities: ['cap-a', 'cap-b'],
        });
        return jsonResponse(agents[agents.length - 1], 201);
      }
      if (url === '/api/routing/global' && method === 'POST') {
        rules.push({
          id: 'rule0002',
          name: 'New Rule',
          policy: 'Route suspicious email to email-sec',
          status: 'inactive',
        });
        return jsonResponse(rules[rules.length - 1], 201);
      }

      throw new Error(`Unhandled request: ${method} ${url}`);
    }) as typeof global.fetch;

    render(<App />);

    expect(await screen.findByText(/authenticate/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/session token/i), {
      target: { value: 'test-session-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await screen.findByRole('button', { name: /agent orchestration/i });
    expect(window.location.pathname).toBe('/overview');

    fireEvent.click(screen.getByRole('button', { name: /agent orchestration/i }));
    fireEvent.click(await screen.findByRole('button', { name: /注册智能体/i }));

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. threat-intel/i), {
      target: { value: 'new-agent' },
    });
    fireEvent.change(screen.getByPlaceholderText(/http:\/\/127\.0\.0\.1:9086\/a2a/i), {
      target: { value: 'http://127.0.0.1:9090/a2a' },
    });
    fireEvent.change(screen.getByPlaceholderText(/authorization/i), {
      target: { value: 'Authorization' },
    });
    fireEvent.change(screen.getByPlaceholderText(/bearer token/i), {
      target: { value: 'Bearer abc' },
    });
    fireEvent.change(screen.getByPlaceholderText(/审计服务器特权指令偏差/i), {
      target: { value: 'New agent description' },
    });
    fireEvent.change(screen.getByPlaceholderText(/每行一条 capability/i), {
      target: { value: 'cap-a\ncap-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await screen.findByText('new-agent');
    expect(screen.getByText('New agent description')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /routing policy/i }));
    fireEvent.click(await screen.findByRole('button', { name: /新建路由规则/i }));
    fireEvent.change(screen.getByPlaceholderText(/钓鱼邮件重设优先级/i), {
      target: { value: 'New Rule' },
    });
    fireEvent.change(screen.getByPlaceholderText(/统一分流、过滤、兜底处置/i), {
      target: { value: 'Route suspicious email to email-sec' },
    });
    fireEvent.change(screen.getByDisplayValue(/enabled/i), {
      target: { value: 'Disabled' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存规则/i }));

    await screen.findByText('New Rule');
    expect(screen.getAllByText('Route suspicious email to email-sec').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(requests.some((request) => request.url === '/api/agents/new-agent' && request.auth === 'Bearer test-session-token')).toBe(true);
      expect(requests.some((request) => request.url === '/api/routing/global' && request.method === 'POST' && request.auth === 'Bearer test-session-token')).toBe(true);
    });
  });

  it('keeps session sockets alive when switching chat sessions and preserves parallel task streams', async () => {
    window.localStorage.setItem('aegis_session_token', 'frontend-test-token');
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    global.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: true, token_source: 'env' });
      }
      if (url === '/api/agents') {
        return jsonResponse({ agents: [] });
      }
      if (url === '/api/routing/global') {
        return jsonResponse({ rules: [] });
      }
      throw new Error(`Unhandled request: GET ${url}`);
    }) as typeof global.fetch;

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /aegis chat/i }));
    fireEvent.change(await screen.findByPlaceholderText(/ask aegis anything/i), {
      target: { value: 'session-one' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送/i }));

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    const firstSocket = MockWebSocket.instances[0];
    await waitFor(() => {
      expect(firstSocket.sent.length).toBeGreaterThan(0);
    });
    firstSocket.emit({
      type: 'session.bound',
      session_id: 'sess-1',
      title: 'session-one',
      resumed: false,
    });
    await waitFor(() => {
      expect(firstSocket.sent.some((item) => JSON.parse(item).type === 'message.send')).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: /新建/i }));
    fireEvent.change(screen.getByPlaceholderText(/ask aegis anything/i), {
      target: { value: 'session-two' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送/i }));

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2);
    });
    const secondSocket = MockWebSocket.instances[1];
    await waitFor(() => {
      expect(secondSocket.sent.length).toBeGreaterThan(0);
    });

    expect(firstSocket.readyState).toBe(1);

    secondSocket.emit({
      type: 'session.bound',
      session_id: 'sess-2',
      title: 'session-two',
      resumed: false,
    });
    await waitFor(() => {
      expect(secondSocket.sent.some((item) => JSON.parse(item).type === 'message.send')).toBe(true);
    });

    firstSocket.emit({
      type: 'message.completed',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      message_id: 'assistant-1',
      source: 'main',
      content: 'background response from session one',
      completed: true,
    });
    secondSocket.emit({
      type: 'message.completed',
      session_id: 'sess-2',
      turn_id: 'turn-2',
      message_id: 'assistant-2',
      source: 'main',
      content: 'foreground response from session two',
      completed: true,
    });

    expect(await screen.findByText('foreground response from session two')).toBeInTheDocument();
    fireEvent.click(screen.getByText('session-one'));
    expect(await screen.findByText('background response from session one')).toBeInTheDocument();
  });

  it('keeps background chat state updating across app navigation and surfaces attention in the sidebar', async () => {
    window.localStorage.setItem('aegis_session_token', 'frontend-test-token');
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    global.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: true, token_source: 'env' });
      }
      if (url === '/api/agents') {
        return jsonResponse({ agents: [] });
      }
      if (url === '/api/routing/global') {
        return jsonResponse({ rules: [] });
      }
      throw new Error(`Unhandled request: GET ${url}`);
    }) as typeof global.fetch;

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /aegis chat/i }));
    fireEvent.change(await screen.findByPlaceholderText(/ask aegis anything/i), {
      target: { value: 'background-session' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送/i }));

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    const socket = MockWebSocket.instances[0];
    socket.emit({
      type: 'session.bound',
      session_id: 'sess-background',
      title: 'background-session',
      resumed: false,
    });
    await waitFor(() => {
      expect(socket.sent.some((item) => JSON.parse(item).type === 'message.send')).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: /overview/i }));

    socket.emit({
      type: 'approval.request',
      session_id: 'sess-background',
      approval_id: 'approval-1',
      command: 'sudo rm -rf /tmp/demo',
      description: 'dangerous command',
      choices: ['once', 'session', 'always', 'deny'],
      source: 'main',
    });
    socket.emit({
      type: 'message.completed',
      session_id: 'sess-background',
      turn_id: 'turn-1',
      message_id: 'assistant-background',
      source: 'main',
      content: 'background session kept streaming',
      completed: true,
    });

    expect(await screen.findByText('1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /aegis chat/i }));
    expect(await screen.findByText('background session kept streaming')).toBeInTheDocument();
    expect(await screen.findByText(/approval required/i)).toBeInTheDocument();
  });
});
