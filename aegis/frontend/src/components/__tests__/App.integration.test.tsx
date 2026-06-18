import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import type { AuthenticatedUser } from '../../types';

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

const adminUser: AuthenticatedUser = {
  uid: 'admin-uid',
  username: 'admin',
  email: 'admin@aegis.local',
  status: 'enabled',
  create_time: '2026-06-17T00:00:00Z',
  last_login: '2026-06-17T01:00:00Z',
  is_admin: true,
};

const analystUser: AuthenticatedUser = {
  uid: 'analyst-uid',
  username: 'analyst',
  email: 'analyst@example.com',
  status: 'enabled',
  create_time: '2026-06-17T00:00:00Z',
  last_login: '2026-06-17T01:00:00Z',
  is_admin: false,
};

function seedStoredAuth(user: AuthenticatedUser = adminUser) {
  window.localStorage.setItem('aegis_session_token', 'frontend-test-token');
  window.localStorage.setItem('aegis_current_user', JSON.stringify(user));
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

  it('leaves login inputs empty by default and surfaces raw API errors via alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';

      if (url === '/api/auth/login' && method === 'POST') {
        return new Response('{"detail":"用户名或密码错误"}', {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: false });
      }

      throw new Error(`Unhandled request: ${method} ${url}`);
    }) as typeof global.fetch;

    render(<App />);

    const usernameInput = await screen.findByLabelText(/^username$/i);
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;

    expect(usernameInput).toHaveValue('');
    expect(passwordInput).toHaveValue('');

    fireEvent.change(usernameInput, {
      target: { value: 'admin' },
    });
    fireEvent.change(passwordInput, {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('{"detail":"用户名或密码错误"}');
    });
  });

  it('supports register, login, agent/rule CRUD, and admin user management', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
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
    const users = [adminUser];
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
        return jsonResponse({ authenticated: false });
      }
      if (url === '/api/overview/agents' && method === 'GET') {
        return jsonResponse({ agents });
      }
      if (url === '/api/auth/register' && method === 'POST') {
        return jsonResponse({ registered: true, status: 'disabled' }, 201);
      }
      if (url === '/api/auth/login' && method === 'POST') {
        return jsonResponse({
          authenticated: true,
          access_token: 'jwt-admin-token',
          token_type: 'bearer',
          expires_in: 28800,
          user: adminUser,
        });
      }
      if (url === '/api/agents' && method === 'GET') {
        return jsonResponse({ agents });
      }
      if (url === '/api/routing/global' && method === 'GET') {
        return jsonResponse({ rules });
      }
      if (url === '/api/users' && method === 'GET') {
        return jsonResponse({ users });
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
      if (url === '/api/users' && method === 'POST') {
        users.push({
          uid: 'alice-uid',
          username: 'alice',
          email: 'alice@example.com',
          status: 'enabled',
          create_time: '2026-06-17T02:00:00Z',
          last_login: null,
          is_admin: false,
        });
        return jsonResponse(users[users.length - 1], 201);
      }
      if (url === '/api/users/alice-uid/status' && method === 'PUT') {
        users[1] = { ...users[1], status: 'disabled' };
        return jsonResponse(users[1]);
      }
      if (url === '/api/users/alice-uid/password' && method === 'PUT') {
        return jsonResponse({ updated: true, uid: 'alice-uid' });
      }
      if (url === '/api/users/alice-uid' && method === 'DELETE') {
        users.splice(1, 1);
        return jsonResponse({ deleted: true, uid: 'alice-uid' });
      }

      throw new Error(`Unhandled request: ${method} ${url}`);
    }) as typeof global.fetch;

    render(<App />);

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByRole('heading', { name: /register/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/register username/i), {
      target: { value: 'pending-user' },
    });
    fireEvent.change(screen.getByLabelText(/register password/i), {
      target: { value: 'Password123!' },
    });
    fireEvent.change(screen.getByLabelText(/register email/i), {
      target: { value: 'pending@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^register$/i }));
    expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^username$/i), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'admin123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await screen.findByRole('button', { name: /agent orchestration/i });
    expect(window.location.pathname).toBe('/overview');
    expect(screen.getByText('Administrator')).toBeInTheDocument();

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

    fireEvent.click(screen.getByRole('button', { name: /user management/i }));
    fireEvent.click(await screen.findByRole('button', { name: /新增用户/i }));
    fireEvent.change(screen.getByLabelText(/create username/i), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText(/create password/i), {
      target: { value: 'Password123!' },
    });
    fireEvent.change(screen.getByLabelText(/create email/i), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));
    await screen.findByText('alice@example.com');

    fireEvent.click(screen.getByRole('button', { name: /disable alice/i }));
    await screen.findByText('disabled');
    expect(confirmSpy).toHaveBeenCalledWith('Disable alice? (确定要disabled该用户吗？)');

    fireEvent.click(screen.getByRole('button', { name: /reset password alice/i }));
    fireEvent.change(screen.getByLabelText(/reset password alice/i), {
      target: { value: 'NewPassword123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    fireEvent.click(screen.getByRole('button', { name: /delete alice/i }));
    await waitFor(() => {
      expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    });
    expect(confirmSpy).toHaveBeenCalledWith('Delete alice? (确定删除该用户吗？此操作不可逆)');

    await waitFor(() => {
      expect(requests.some((request) => request.url === '/api/agents/new-agent' && request.auth === 'Bearer jwt-admin-token')).toBe(true);
      expect(requests.some((request) => request.url === '/api/routing/global' && request.method === 'POST' && request.auth === 'Bearer jwt-admin-token')).toBe(true);
      expect(requests.some((request) => request.url === '/api/users' && request.method === 'POST' && request.auth === 'Bearer jwt-admin-token')).toBe(true);
    });
  });

  it('supports self password change from the user menu', async () => {
    seedStoredAuth();

    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: true, user: adminUser, expires_in: 28800 });
      }
      if (url === '/api/overview/agents') {
        return jsonResponse({ agents: [] });
      }
      if (url === '/api/agents') {
        return jsonResponse({ agents: [] });
      }
      if (url === '/api/routing/global') {
        return jsonResponse({ rules: [] });
      }
      if (url === '/api/users') {
        return jsonResponse({ users: [adminUser] });
      }
      if (url === '/api/auth/password' && method === 'PUT') {
        return jsonResponse({ updated: true });
      }
      throw new Error(`Unhandled request: ${method} ${url}`);
    }) as typeof global.fetch;

    render(<App />);

    await screen.findByRole('button', { name: /user menu/i });
    fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'admin123456' },
    });
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'AdminPassword123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(screen.queryByText(/change password/i)).not.toBeInTheDocument();
    });
  });

  it('hides admin-only control pages from regular users and redirects direct access attempts', async () => {
    seedStoredAuth(analystUser);
    window.history.replaceState({}, '', '/orchestration');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    global.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: true, user: analystUser, expires_in: 28800 });
      }
      if (url === '/api/overview/agents') {
        return jsonResponse({
          agents: [
            {
              agent_id: 'analyst-visible-agent',
              url: 'http://127.0.0.1:9086/a2a',
              description: 'Visible to overview',
              status: 'active',
              extcapabilities: ['query-domain'],
            },
          ],
        });
      }
      throw new Error(`Unhandled request: GET ${url}`);
    }) as typeof global.fetch;

    render(<App />);

    await screen.findByRole('button', { name: /overview/i });
    expect(window.location.pathname).toBe('/overview');
    expect(alertSpy).toHaveBeenCalledWith('Admin access required.');
    expect(screen.getAllByText('Visible to overview').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /agent orchestration/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /routing policy/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /user management/i })).not.toBeInTheDocument();
  });

  it('keeps session sockets alive when switching chat sessions and preserves parallel task streams', async () => {
    seedStoredAuth(analystUser);
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    global.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: true, user: analystUser, expires_in: 28800 });
      }
      if (url === '/api/overview/agents') {
        return jsonResponse({ agents: [] });
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
      expect(MockWebSocket.instances[0].url).toContain('frontend-test-token');
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
    seedStoredAuth(analystUser);
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);

    global.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: true, user: analystUser, expires_in: 28800 });
      }
      if (url === '/api/overview/agents') {
        return jsonResponse({ agents: [] });
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

  it('keeps app shell and tab content selectable by default', async () => {
    seedStoredAuth(adminUser);

    global.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/auth/session') {
        return jsonResponse({ authenticated: true, user: adminUser, expires_in: 28800 });
      }
      if (url === '/api/overview/agents') {
        return jsonResponse({ agents: [] });
      }
      if (url === '/api/agents') {
        return jsonResponse({ agents: [] });
      }
      if (url === '/api/routing/global') {
        return jsonResponse({ rules: [] });
      }
      if (url === '/api/users') {
        return jsonResponse({ users: [adminUser] });
      }
      throw new Error(`Unhandled request: GET ${url}`);
    }) as typeof global.fetch;

    render(<App />);

    await screen.findByRole('button', { name: /aegis chat/i });

    const mainViewport = document.getElementById('main-content-viewport');
    const appShell = mainViewport?.parentElement?.parentElement as HTMLElement | null;
    const sidebar = document.getElementById('sidebar-container');

    expect(appShell).toBeTruthy();
    expect(sidebar).toBeTruthy();
    expect(mainViewport?.firstElementChild).toBeTruthy();
    expect(appShell).not.toHaveClass('select-none');
    expect(sidebar).not.toHaveClass('select-none');
    expect(mainViewport?.firstElementChild).not.toHaveClass('select-none');

    fireEvent.click(screen.getByRole('button', { name: /agent orchestration/i }));
    expect(mainViewport?.firstElementChild).not.toHaveClass('select-none');

    fireEvent.click(screen.getByRole('button', { name: /routing policy/i }));
    expect(mainViewport?.firstElementChild).not.toHaveClass('select-none');

    fireEvent.click(screen.getByRole('button', { name: /aegis chat/i }));
    expect(mainViewport?.firstElementChild).not.toHaveClass('select-none');
  });
});
