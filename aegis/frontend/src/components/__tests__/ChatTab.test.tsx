import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatTab from '../ChatTab';

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

describe('ChatTab', () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('aegis_session_token', 'frontend-test-token');
    MockWebSocket.instances = [];
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.WebSocket = OriginalWebSocket;
    clipboardWriteText.mockReset();
  });

  it('connects lazily and renders main state, delegate events, delegate tools, copy actions, and per-turn orchestration chains', async () => {
    render(<ChatTab agents={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /新建/i }));
    expect(MockWebSocket.instances).toHaveLength(0);

    expect(screen.getByText('CENTRAL ARCHIVE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /collapse session sidebar/i }));
    expect(screen.queryByText('CENTRAL ARCHIVE')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /expand session sidebar/i }));
    expect(screen.getByText('CENTRAL ARCHIVE')).toBeInTheDocument();

    const initialComposer = screen.getByPlaceholderText(/ask aegis anything/i);
    expect(initialComposer.tagName).toBe('INPUT');
    fireEvent.click(screen.getByRole('button', { name: /expand composer/i }));
    expect(screen.getByPlaceholderText(/ask aegis anything/i).tagName).toBe('TEXTAREA');

    fireEvent.change(screen.getByPlaceholderText(/ask aegis anything/i), {
      target: { value: 'hello over websocket' },
    });
    fireEvent.click(screen.getByRole('button', { name: /发送/i }));

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    const socket = MockWebSocket.instances[0];

    await waitFor(() => {
      expect(socket.sent.length).toBeGreaterThan(0);
    });
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: 'session.bind' });
    expect(socket.sent.some((item) => JSON.parse(item).type === 'message.send')).toBe(false);

    socket.emit({
      type: 'session.bound',
      session_id: 'sess-1',
      title: 'New Investigation',
      resumed: false,
    });

    await waitFor(() => {
      expect(socket.sent.some((item) => JSON.parse(item).type === 'message.send')).toBe(true);
    });

    const messageSend = socket.sent
      .map((item) => JSON.parse(item))
      .find((item) => item.type === 'message.send');
    expect(messageSend).toMatchObject({
      type: 'message.send',
      session_id: 'sess-1',
      text: 'hello over websocket',
    });

    socket.emit({
      type: 'run.state',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      source: 'main',
      state: 'running',
    });
    await waitFor(() => {
      expect(screen.getByText('MAIN.RUNNING')).toBeInTheDocument();
    });

    socket.emit({
      type: 'message.accepted',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      client_msg_id: messageSend.client_msg_id,
      source: 'main',
    });
    socket.emit({
      type: 'tool.started',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      source: 'main',
      tool_name: 'terminal',
      tool_call_id: 'tool-1',
      args_preview: 'pwd',
    });
    socket.emit({
      type: 'tool.completed',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      source: 'main',
      tool_name: 'terminal',
      tool_call_id: 'tool-1',
      result_preview: '/Users/demo',
    });

    expect(await screen.findByText(/orchestration chain/i)).toBeInTheDocument();
    expect(screen.getByText('terminal')).toBeInTheDocument();

    socket.emit({
      type: 'message.delta',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      message_id: 'assistant-1',
      source: 'main',
      delta: 'hello ',
    });
    socket.emit({
      type: 'message.completed',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      message_id: 'assistant-1',
      source: 'main',
      content: 'hello websocket world',
      completed: true,
    });

    expect(await screen.findByText('hello websocket world')).toBeInTheDocument();

    socket.emit({
      type: 'delegate.entered',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      source: 'delegate',
      srcagent: 'threat-intel',
      child_session_id: 'delegate-sess',
    });
    socket.emit({
      type: 'run.state',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      source: 'delegate',
      srcagent: 'threat-intel',
      state: 'waiting_for_delegate_input',
    });

    expect(await screen.findByText('threat-intel entered foreground')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('DELEGATE.THREAT-INTEL.WAITING_FOR_DELEGATE_INPUT')).toBeInTheDocument();
    });

    socket.emit({
      type: 'tool.started',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      source: 'delegate',
      srcagent: 'threat-intel',
      tool_name: 'terminal',
      tool_call_id: 'delegate-tool-1',
      args_preview: 'ls -la',
    });
    socket.emit({
      type: 'tool.started',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      source: 'delegate',
      srcagent: 'threat-intel',
      tool_name: 'grep',
      tool_call_id: 'delegate-tool-2',
      args_preview: 'grep secret config.txt',
    });
    socket.emit({
      type: 'message.completed',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      message_id: 'delegate-1',
      source: 'delegate',
      srcagent: 'threat-intel',
      content: 'delegate is waiting for your direction',
      completed: true,
    });

    expect(screen.queryByText('Delegate Tool Activity')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /toggle delegate tool messages/i }));
    expect(await screen.findByText('Delegate Tool Activity')).toBeInTheDocument();
    expect(screen.queryByText('ls -la')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /expand delegate tool details/i }));
    expect(await screen.findByText('ls -la')).toBeInTheDocument();
    expect(screen.getByText('grep secret config.txt')).toBeInTheDocument();

    socket.emit({
      type: 'tool.started',
      session_id: 'sess-1',
      turn_id: 'turn-2',
      source: 'delegate',
      srcagent: 'threat-intel',
      tool_name: 'cat',
      tool_call_id: 'delegate-tool-3',
      args_preview: 'cat evidence.txt',
    });

    await waitFor(() => {
      expect(screen.getAllByText('Delegate Tool Activity')).toHaveLength(2);
    });
    const secondDelegateToolCard = screen.getAllByText('Delegate Tool Activity')[1].closest('.relative');
    expect(secondDelegateToolCard).toBeTruthy();
    fireEvent.click(
      within(secondDelegateToolCard as HTMLElement).getByRole('button', { name: /expand delegate tool details/i }),
    );
    expect(await screen.findByText('cat evidence.txt')).toBeInTheDocument();

    socket.emit({
      type: 'delegate.exited',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      source: 'delegate',
      srcagent: 'threat-intel',
      reason: 'return_to_main',
    });
    socket.emit({
      type: 'run.state',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      source: 'main',
      state: 'running',
    });
    socket.emit({
      type: 'message.completed',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      message_id: 'assistant-main-after-delegate',
      source: 'main',
      content: 'main agent resumed after /main',
      completed: true,
    });

    expect(await screen.findByText(/returned control to main/i)).toBeInTheDocument();
    expect(await screen.findByText('main agent resumed after /main')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('MAIN.RUNNING')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /collapse composer/i }));
    expect(screen.getByPlaceholderText(/ask aegis anything/i).tagName).toBe('INPUT');

    const messageCards = screen.getAllByTestId('chat-message');
    const userMessage = messageCards.find((card) => card.getAttribute('data-sender') === 'user');
    const aegisMessage = messageCards.find((card) =>
      within(card).queryByText('hello websocket world'),
    );
    const delegateMessage = messageCards.find((card) =>
      within(card).queryByText('delegate is waiting for your direction'),
    );
    const chainMessage = messageCards.find((card) =>
      within(card).queryByText(/orchestration chain/i),
    );
    expect(userMessage).toBeTruthy();
    expect(aegisMessage).toBeTruthy();
    expect(delegateMessage).toBeTruthy();
    expect(chainMessage).toBeTruthy();
    expect(aegisMessage).toHaveClass('w-full');
    expect(within(aegisMessage as HTMLElement).getByTestId('message-text')).toHaveClass('select-text');
    expect(within(aegisMessage as HTMLElement).queryByText(/orchestration chain/i)).not.toBeInTheDocument();
    expect(within(chainMessage as HTMLElement).getByText(/orchestration chain/i)).toBeInTheDocument();
    expect(within(chainMessage as HTMLElement).getByText('terminal')).toBeInTheDocument();
    expect(within(chainMessage as HTMLElement).queryByText('threat-intel')).not.toBeInTheDocument();
    expect(within(aegisMessage as HTMLElement).getByText('AE')).toBeInTheDocument();
    expect(within(delegateMessage as HTMLElement).getByText('DG')).toBeInTheDocument();

    fireEvent.click(within(userMessage as HTMLElement).getByRole('button', { name: /copy message/i }));
    expect(clipboardWriteText).toHaveBeenLastCalledWith('hello over websocket');

    fireEvent.click(within(aegisMessage as HTMLElement).getByRole('button', { name: /copy message/i }));
    expect(clipboardWriteText).toHaveBeenLastCalledWith('hello websocket world');

    fireEvent.click(within(chainMessage as HTMLElement).getByRole('button', { name: /copy message/i }));
    expect(clipboardWriteText).toHaveBeenLastCalledWith('terminal\nCompleted\n/Users/demo');

    socket.emit({
      type: 'approval.request',
      session_id: 'sess-1',
      approval_id: 'approval-1',
      command: 'rm -rf /tmp/aegis-approval-test',
      description: 'recursive delete',
      choices: ['once', 'session', 'always', 'deny'],
      source: 'main',
    });

    expect(await screen.findByText(/approval required/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /allow once/i }));

    await waitFor(() => {
      expect(
        socket.sent.some((item) => {
          const payload = JSON.parse(item);
          return payload.type === 'approval.respond' && payload.choice === 'once';
        }),
      ).toBe(true);
    });

    const cached = JSON.parse(window.localStorage.getItem('aegis_convs') || '[]');
    expect(cached[0]).toMatchObject({
      sessionId: 'sess-1',
      messages: expect.arrayContaining([
        expect.objectContaining({ text: 'hello over websocket', sender: 'user' }),
        expect.objectContaining({ text: 'hello websocket world', sender: 'aegis' }),
        expect.objectContaining({ text: 'main agent resumed after /main', sender: 'aegis' }),
      ]),
    });
  });
});
