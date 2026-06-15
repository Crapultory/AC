import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Agent, ChainStep, Conversation, DelegateToolCall, Message } from '../types';
import {
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Layers,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { getStoredToken } from '../lib/auth';

interface ChatTabProps {
  agents: Agent[];
}

type ChatSocketEvent = {
  type: string;
  session_id?: string;
  title?: string;
  resumed?: boolean;
  turn_id?: string;
  source?: 'main' | 'delegate';
  srcagent?: string;
  message_id?: string;
  delta?: string;
  content?: string;
  completed?: boolean;
  client_msg_id?: string;
  tool_name?: string;
  tool_call_id?: string;
  args_preview?: string;
  result_preview?: string;
  child_session_id?: string;
  reason?: string;
  state?: string;
  approval_id?: string;
  clarify_id?: string;
  command?: string;
  description?: string;
  question?: string;
  choices?: string[];
  code?: string;
  message?: string;
};

type PendingBoundAction =
  | { type: 'message.send'; text: string; clientMsgId: string }
  | { type: 'approval.respond'; choice: 'once' | 'session' | 'always' | 'deny' }
  | { type: 'clarify.respond'; answer: string }
  | { type: 'session.resume' };

const STORAGE_KEY = 'aegis_convs';

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createMessageId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatClock(now: Date = new Date()): string {
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function loadCachedConversations(): Conversation[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCachedConversations(conversations: Conversation[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

function buildSocketUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/chat/ws?token=${encodeURIComponent(token)}`;
}

function getOpenReadyState(): number {
  return typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number' ? WebSocket.OPEN : 1;
}

function isConversationBusy(conversation: Conversation | undefined): boolean {
  if (!conversation) {
    return false;
  }
  if (conversation.lastKnownRunState === 'waiting_for_approval') {
    return true;
  }
  if (conversation.lastKnownRunState === 'waiting_for_clarify') {
    return !conversation.pendingClarify?.awaitingText;
  }
  return false;
}

function upsertChainStep(steps: ChainStep[], nextStep: ChainStep & { id: string }): ChainStep[] {
  const index = steps.findIndex((step) => step.id === nextStep.id);
  if (index < 0) {
    return [...steps, nextStep];
  }
  const updated = [...steps];
  updated[index] = { ...updated[index], ...nextStep };
  return updated;
}

function findMessageIndex(
  messages: Message[],
  {
    messageId,
    turnId,
    source,
    srcagent,
  }: {
    messageId: string;
    turnId?: string;
    source?: 'main' | 'delegate';
    srcagent?: string;
  },
): number {
  const exactIndex = messages.findIndex((message) => message.id === messageId);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if ((candidate.kind || 'chat') !== 'chat') {
      continue;
    }
    if (candidate.turnId !== turnId) {
      continue;
    }
    if (candidate.source !== source) {
      continue;
    }
    if ((candidate.srcagent || '') !== (srcagent || '')) {
      continue;
    }
    if (candidate.pending) {
      return index;
    }
  }
  return -1;
}

function upsertDelegateToolCall(calls: DelegateToolCall[], nextCall: DelegateToolCall): DelegateToolCall[] {
  const index = calls.findIndex((call) => call.id === nextCall.id);
  if (index < 0) {
    return [...calls, nextCall];
  }
  const updated = [...calls];
  updated[index] = { ...updated[index], ...nextCall };
  return updated;
}

function buildDelegateToolSummaryId(turnId?: string, srcagent?: string): string {
  return `delegate-tools:${turnId || 'unknown'}:${srcagent || 'delegate'}`;
}

function buildDelegateEventText(payload: ChatSocketEvent): string {
  const agentLabel = payload.srcagent || 'Delegate Agent';
  if (payload.type === 'delegate.entered') {
    return `${agentLabel} entered foreground`;
  }
  const reason = payload.reason ? ` · ${payload.reason}` : '';
  return `${agentLabel} returned control to main${reason}`;
}

function upsertDelegateToolMessage(conversation: Conversation, payload: ChatSocketEvent): Message[] {
  const messageId = buildDelegateToolSummaryId(payload.turn_id, payload.srcagent);
  const toolCallId = payload.tool_call_id || createMessageId('delegate-tool');
  const nextCall: DelegateToolCall = {
    id: toolCallId,
    toolName: payload.tool_name || 'delegate_tool',
    argsPreview: payload.args_preview || '',
    resultPreview: payload.result_preview,
    status: payload.type === 'tool.completed' ? 'completed' : 'running',
  };
  const existingIndex = conversation.messages.findIndex((message) => message.id === messageId);
  if (existingIndex >= 0) {
    const updatedMessages = [...conversation.messages];
    const existingMessage = updatedMessages[existingIndex];
    updatedMessages[existingIndex] = {
      ...existingMessage,
      timestamp: formatClock(),
      text: `${payload.srcagent || 'Delegate Agent'} tool activity`,
      delegateTools: upsertDelegateToolCall(existingMessage.delegateTools || [], nextCall),
    };
    return updatedMessages;
  }
  return [
    ...conversation.messages,
    {
      id: messageId,
      sender: 'aegis',
      kind: 'delegate-tools',
      text: `${payload.srcagent || 'Delegate Agent'} tool activity`,
      timestamp: formatClock(),
      source: 'delegate',
      srcagent: payload.srcagent,
      turnId: payload.turn_id,
      delegateTools: [nextCall],
    },
  ];
}

function buildMainToolSummaryId(turnId?: string): string {
  return `main-tools:${turnId || 'unknown'}`;
}

function upsertMainToolMessage(conversation: Conversation, payload: ChatSocketEvent): Message[] {
  const messageId = buildMainToolSummaryId(payload.turn_id);
  const nextStep: ChainStep & { id: string } = {
    id: payload.tool_call_id || `tool:${payload.tool_name || 'tool'}`,
    agentName: payload.tool_name || 'Tool',
    type: 'vip_tool',
    status: payload.type === 'tool.completed' ? 'Completed' : 'Processing',
    message:
      payload.type === 'tool.completed'
        ? payload.result_preview || `${payload.tool_name || 'Tool'} completed`
        : payload.args_preview || payload.tool_name || 'Tool started',
    timestamp: formatClock(),
  };
  const existingIndex = conversation.messages.findIndex((message) => message.id === messageId);
  if (existingIndex >= 0) {
    const updatedMessages = [...conversation.messages];
    const existingMessage = updatedMessages[existingIndex];
    updatedMessages[existingIndex] = {
      ...existingMessage,
      timestamp: formatClock(),
      chainSteps: upsertChainStep(existingMessage.chainSteps || [], nextStep),
    };
    return updatedMessages;
  }
  return [
    ...conversation.messages,
    {
      id: messageId,
      sender: 'aegis',
      kind: 'main-tools',
      text: 'Main orchestration activity',
      timestamp: formatClock(),
      source: 'main',
      turnId: payload.turn_id,
      chainSteps: [nextStep],
    },
  ];
}

function buildStateLabel(conversation?: Conversation): string {
  if (!conversation?.lastKnownRunState) {
    return 'MAIN.IDLE';
  }
  const source = conversation.foregroundSource || 'main';
  const srcagent = conversation.foregroundAgentName;
  return [source, srcagent, conversation.lastKnownRunState]
    .filter((part) => !!part)
    .join('.')
    .toUpperCase();
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const element = document.createElement('textarea');
  element.value = text;
  element.setAttribute('readonly', 'true');
  element.style.position = 'absolute';
  element.style.left = '-9999px';
  document.body.appendChild(element);
  element.select();
  document.execCommand('copy');
  document.body.removeChild(element);
}

function getMessageCopyText(message: Message): string {
  if (message.kind === 'delegate-tools' && message.delegateTools?.length) {
    return message.delegateTools
      .map((toolCall) => {
        const resultLine = toolCall.resultPreview ? `\nResult: ${toolCall.resultPreview}` : '';
        return `${toolCall.toolName}\nArgs: ${toolCall.argsPreview || '(none)'}${resultLine}`;
      })
      .join('\n\n');
  }
  if (message.kind === 'main-tools' && message.chainSteps?.length) {
    return message.chainSteps
      .map((step) => `${step.agentName}\n${step.status}\n${step.message}`)
      .join('\n\n');
  }
  return message.text;
}

export default function ChatTab({ agents }: ChatTabProps) {
  void agents;
  const [conversations, setConversations] = useState<Conversation[]>(() => loadCachedConversations());
  const [activeConvId, setActiveConvId] = useState<string>(() => loadCachedConversations()[0]?.id || '');
  const [inputVal, setInputVal] = useState('');
  const [transportError, setTransportError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [showDelegateTools, setShowDelegateTools] = useState(false);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const socketConversationIdRef = useRef<string>('');
  const socketSessionIdRef = useRef<string>('');
  const pendingBoundActionsRef = useRef<Record<string, PendingBoundAction[]>>({});
  const conversationsRef = useRef<Conversation[]>(conversations);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConvId),
    [activeConvId, conversations],
  );

  useEffect(() => {
    saveCachedConversations(conversations);
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeConvId && conversations.length > 0) {
      setActiveConvId(conversations[0].id);
    }
  }, [activeConvId, conversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations, activeConvId]);

  useEffect(() => {
    if (
      socketRef.current &&
      socketConversationIdRef.current &&
      activeConvId &&
      socketConversationIdRef.current !== activeConvId
    ) {
      socketRef.current.close();
    }
  }, [activeConvId]);

  function closeSocket() {
    if (socketRef.current) {
      socketRef.current.close();
    }
    socketRef.current = null;
    socketConversationIdRef.current = '';
    socketSessionIdRef.current = '';
  }

  function queueBoundAction(localConversationId: string, action: PendingBoundAction) {
    const queued = pendingBoundActionsRef.current[localConversationId] || [];
    pendingBoundActionsRef.current[localConversationId] = [...queued, action];
  }

  function sendBoundAction(sessionId: string, action: PendingBoundAction) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== getOpenReadyState()) {
      setTransportError('Chat transport is not connected.');
      return;
    }
    if (action.type === 'message.send') {
      socket.send(
        JSON.stringify({
          type: 'message.send',
          session_id: sessionId,
          text: action.text,
          client_msg_id: action.clientMsgId,
        }),
      );
      return;
    }
    if (action.type === 'approval.respond') {
      socket.send(
        JSON.stringify({
          type: 'approval.respond',
          session_id: sessionId,
          choice: action.choice,
        }),
      );
      return;
    }
    if (action.type === 'clarify.respond') {
      socket.send(
        JSON.stringify({
          type: 'clarify.respond',
          session_id: sessionId,
          answer: action.answer,
        }),
      );
      return;
    }
    socket.send(
      JSON.stringify({
        type: 'session.resume',
        session_id: sessionId,
      }),
    );
  }

  function flushBoundActions(localConversationId: string, sessionId: string) {
    const queued = pendingBoundActionsRef.current[localConversationId] || [];
    delete pendingBoundActionsRef.current[localConversationId];
    queued.forEach((action) => sendBoundAction(sessionId, action));
  }

  function handleSocketEvent(localConversationId: string, payload: ChatSocketEvent) {
    const payloadSessionId = payload.session_id;

    if (payload.type === 'error') {
      setTransportError(payload.message || 'Chat transport error.');
      return;
    }

    if (payload.type === 'session.bound' && payload.session_id) {
      socketSessionIdRef.current = payload.session_id;
    }

    setConversations((current) => {
      const next = current.map((conversation) => {
        const matched =
          conversation.id === localConversationId ||
          (!!payloadSessionId && conversation.sessionId === payloadSessionId);
        if (!matched) {
          return conversation;
        }

        const nextConversation: Conversation = {
          ...conversation,
          lastUpdatedAt: new Date().toISOString(),
          timestamp: formatClock(),
        };

        if (payload.type === 'session.bound') {
          nextConversation.sessionId = payload.session_id || nextConversation.sessionId;
          nextConversation.title = payload.title || nextConversation.title;
          return nextConversation;
        }

        if (payload.type === 'message.accepted') {
          if ((payload.source || 'main') === 'main') {
            nextConversation.liveChainTurnId = payload.turn_id || nextConversation.liveChainTurnId;
            nextConversation.liveChainSteps = [];
          }
          return nextConversation;
        }

        if (payload.type === 'message.delta' || payload.type === 'message.completed') {
          const source = payload.source || 'main';
          const messageId =
            payload.message_id || `${source}:${payload.turn_id || 'unknown'}:${payload.srcagent || 'main'}`;
          const existingIndex = findMessageIndex(nextConversation.messages, {
            messageId,
            turnId: payload.turn_id,
            source,
            srcagent: payload.srcagent,
          });
          const existingMessage = existingIndex >= 0 ? nextConversation.messages[existingIndex] : null;
          const nextText =
            payload.type === 'message.delta'
              ? `${existingMessage?.text || ''}${payload.delta || ''}`
              : payload.content || '';
          const nextMessage: Message = {
            id: messageId,
            sender: 'aegis',
            kind: 'chat',
            text: nextText,
            timestamp: formatClock(),
            source,
            srcagent: payload.srcagent,
            turnId: payload.turn_id,
            pending: payload.type === 'message.delta',
          };

          if (existingIndex >= 0) {
            const updatedMessages = [...nextConversation.messages];
            updatedMessages[existingIndex] = {
              ...updatedMessages[existingIndex],
              ...nextMessage,
            };
            nextConversation.messages = updatedMessages;
          } else {
            nextConversation.messages = [...nextConversation.messages, nextMessage];
          }
          return nextConversation;
        }

        if (payload.type === 'run.state') {
          nextConversation.lastKnownRunState = payload.state || nextConversation.lastKnownRunState;
          nextConversation.foregroundSource = payload.source || nextConversation.foregroundSource;
          nextConversation.foregroundAgentName = payload.srcagent || '';
          return nextConversation;
        }

        if (payload.type === 'delegate.entered' || payload.type === 'delegate.exited') {
          nextConversation.messages = [
            ...nextConversation.messages,
            {
              id: createMessageId('delegate-event'),
              sender: 'aegis',
              kind: 'delegate-event',
              text: buildDelegateEventText(payload),
              timestamp: formatClock(),
              source: 'delegate',
              srcagent: payload.srcagent,
              turnId: payload.turn_id,
            },
          ];
          return nextConversation;
        }

        if (payload.type === 'tool.started' || payload.type === 'tool.completed') {
          if ((payload.source || 'main') === 'delegate') {
            nextConversation.messages = upsertDelegateToolMessage(nextConversation, payload);
            return nextConversation;
          }
          nextConversation.messages = upsertMainToolMessage(nextConversation, payload);
          return nextConversation;
        }

        if (payload.type === 'approval.request') {
          nextConversation.pendingApproval = {
            approvalId: payload.approval_id || '',
            command: payload.command || '',
            description: payload.description || '',
            choices: payload.choices || ['once', 'session', 'always', 'deny'],
          };
          nextConversation.lastKnownRunState = 'waiting_for_approval';
          return nextConversation;
        }

        if (payload.type === 'approval.resolved') {
          nextConversation.pendingApproval = null;
          return nextConversation;
        }

        if (payload.type === 'clarify.request') {
          const nextChoices = payload.choices || [];
          nextConversation.pendingClarify = {
            clarifyId: payload.clarify_id || '',
            question: payload.question || '',
            choices: nextChoices,
            awaitingText: nextChoices.length === 0,
          };
          nextConversation.lastKnownRunState = 'waiting_for_clarify';
          return nextConversation;
        }

        if (payload.type === 'clarify.resolved') {
          nextConversation.pendingClarify = null;
          return nextConversation;
        }

        return nextConversation;
      });
      conversationsRef.current = next;
      return next;
    });
  }

  function connectSocketForConversation(
    targetConversation: Conversation,
    action?: PendingBoundAction,
  ): boolean {
    const token = getStoredToken();
    if (!token) {
      setTransportError('Missing session token for chat transport.');
      return false;
    }

    if (action) {
      queueBoundAction(targetConversation.id, action);
    }

    const currentSocket = socketRef.current;
    if (
      currentSocket &&
      currentSocket.readyState === getOpenReadyState() &&
      socketConversationIdRef.current === targetConversation.id
    ) {
      const sessionId = targetConversation.sessionId || socketSessionIdRef.current;
      if (sessionId) {
        flushBoundActions(targetConversation.id, sessionId);
      }
      return true;
    }

    if (currentSocket && socketConversationIdRef.current !== targetConversation.id) {
      closeSocket();
    }

    if (socketRef.current) {
      return true;
    }

    const socket = new WebSocket(buildSocketUrl(token));
    socketConversationIdRef.current = targetConversation.id;
    socketSessionIdRef.current = targetConversation.sessionId || '';
    socketRef.current = socket;

    socket.onopen = () => {
      setTransportError('');
      socket.send(
        JSON.stringify({
          type: 'session.bind',
          session_id: targetConversation.sessionId,
          title: targetConversation.title,
        }),
      );
    };

    socket.onmessage = (event) => {
      let payload: ChatSocketEvent;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      handleSocketEvent(targetConversation.id, payload);
      if (payload.type === 'session.bound' && payload.session_id) {
        socketSessionIdRef.current = payload.session_id;
        flushBoundActions(targetConversation.id, payload.session_id);
      }
    };

    socket.onerror = () => {
      setTransportError('Chat transport degraded. Reconnect or open a new conversation.');
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
        socketConversationIdRef.current = '';
        socketSessionIdRef.current = '';
      }
    };

    return true;
  }

  function ensureConversation(): Conversation {
    const existing = activeConversation;
    if (existing) {
      return existing;
    }
    const created: Conversation = {
      id: createLocalId(),
      title: 'New Investigation',
      messages: [],
      timestamp: 'Just now',
      lastUpdatedAt: new Date().toISOString(),
      lastKnownRunState: 'idle',
      foregroundSource: 'main',
      foregroundAgentName: '',
      liveChainTurnId: undefined,
      liveChainSteps: [],
      pendingApproval: null,
      pendingClarify: null,
    };
    setConversations((current) => [created, ...current]);
    setActiveConvId(created.id);
    return created;
  }

  function handleCreateNewConversation() {
    const created: Conversation = {
      id: createLocalId(),
      title: 'New Investigation',
      messages: [],
      timestamp: 'Just now',
      lastUpdatedAt: new Date().toISOString(),
      lastKnownRunState: 'idle',
      foregroundSource: 'main',
      foregroundAgentName: '',
      liveChainTurnId: undefined,
      liveChainSteps: [],
      pendingApproval: null,
      pendingClarify: null,
    };
    setConversations((current) => [created, ...current]);
    setActiveConvId(created.id);
    setInputVal('');
    setTransportError('');
  }

  function handleClearHistory() {
    if (!window.confirm('确定要清除所有对话和本地缓存吗？')) {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
    pendingBoundActionsRef.current = {};
    setConversations([]);
    setActiveConvId('');
    setInputVal('');
    setTransportError('');
    closeSocket();
  }

  function handleDeleteConversation(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    const updated = conversations.filter((conversation) => conversation.id !== id);
    delete pendingBoundActionsRef.current[id];
    if (socketConversationIdRef.current === id) {
      closeSocket();
    }
    if (activeConvId === id) {
      setActiveConvId(updated[0]?.id || '');
    }
    setConversations(updated);
  }

  function handleSubmit() {
    const text = inputVal.trim();
    if (!text) {
      return;
    }
    const conversation = conversationsRef.current.find((item) => item.id === activeConvId) || ensureConversation();
    const isClarifyReply = Boolean(conversation.pendingClarify?.awaitingText && conversation.sessionId);
    const title =
      !isClarifyReply && conversation.messages.length === 0
        ? (text.length > 24 ? `${text.slice(0, 24)}...` : text)
        : conversation.title;
    const clientMsgId = createMessageId('client');
    const userMessage: Message = {
      id: createMessageId('user'),
      sender: 'user',
      kind: 'chat',
      text,
      timestamp: formatClock(),
      clientMsgId,
    };
    const targetConversation = {
      ...conversation,
      title,
    };
    setConversations((current) =>
      current.map((item) =>
        item.id === conversation.id
          ? {
              ...item,
              title,
              timestamp: formatClock(),
              lastUpdatedAt: new Date().toISOString(),
              liveChainTurnId: undefined,
              liveChainSteps: [],
              messages: [...item.messages, userMessage],
            }
          : item,
      ),
    );
    setInputVal('');

    connectSocketForConversation(targetConversation, {
      ...(isClarifyReply
        ? {
            type: 'clarify.respond' as const,
            answer: text,
          }
        : {
            type: 'message.send' as const,
            text,
            clientMsgId,
          }),
    });
  }

  function handleApproval(choice: 'once' | 'session' | 'always' | 'deny') {
    if (!activeConversation?.sessionId) {
      return;
    }
    connectSocketForConversation(activeConversation, {
      type: 'approval.respond',
      choice,
    });
  }

  function handleClarifyChoice(answer: string) {
    if (!activeConversation?.sessionId) {
      return;
    }
    connectSocketForConversation(activeConversation, {
      type: 'clarify.respond',
      answer,
    });
  }

  function handleClarifyOther() {
    if (!activeConversation) {
      return;
    }
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              pendingClarify: conversation.pendingClarify
                ? {
                    ...conversation.pendingClarify,
                    awaitingText: true,
                  }
                : conversation.pendingClarify,
            }
          : conversation,
      ),
    );
  }

  function handleResume() {
    if (!activeConversation?.sessionId) {
      return;
    }
    connectSocketForConversation(activeConversation, {
      type: 'session.resume',
    });
  }

  async function handleCopyMessage(message: Message) {
    try {
      await writeClipboardText(getMessageCopyText(message));
      setCopiedMessageId(message.id);
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId('');
        copyFeedbackTimeoutRef.current = null;
      }, 1600);
    } catch {
      setTransportError('Unable to copy this message right now.');
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (!composerExpanded && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
      return;
    }
    if (composerExpanded && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSubmit();
    }
  }

  function toggleMessageExpanded(messageId: string) {
    setExpandedMessageIds((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  }

  const sendDisabled = !inputVal.trim() || isConversationBusy(activeConversation);
  const activeMessages = (activeConversation?.messages || []).filter(
    (message) => showDelegateTools || message.kind !== 'delegate-tools',
  );
  const stateLabel = buildStateLabel(activeConversation);
  const composerPlaceholder = activeConversation?.pendingClarify?.awaitingText
    ? 'Answer clarify prompt... 输入你的补充说明'
    : "Ask Aegis anything... 触发关键词：'钓鱼邮件', '勒索病毒', '敏感泄露'...";

  return (
    <div className="flex h-full w-full bg-[#020408] items-stretch select-none overflow-hidden text-xs">
      <div className={`${sidebarCollapsed ? 'w-16' : 'w-80'} border-r border-slate-800 bg-[#05080F] flex flex-col pt-4 shrink-0 z-10 transition-[width] duration-200`}>
        <div className={`${sidebarCollapsed ? 'px-2 pb-3' : 'px-4 pb-3'} border-b border-slate-800 space-y-3`}>
          <div className={`flex ${sidebarCollapsed ? 'flex-col gap-2' : 'justify-between items-center'}`}>
            {!sidebarCollapsed ? (
              <span className="text-[10px] font-mono tracking-widest font-bold text-slate-500 uppercase">CENTRAL ARCHIVE</span>
            ) : null}
            <div className={`flex ${sidebarCollapsed ? 'flex-col items-center gap-2' : 'items-center gap-2 ml-auto'}`}>
              <button
                type="button"
                aria-label={sidebarCollapsed ? 'Expand session sidebar' : 'Collapse session sidebar'}
                onClick={() => setSidebarCollapsed((current) => !current)}
                className="p-2 rounded border border-slate-800 bg-[#080C14] text-slate-400 hover:text-cyan-300 hover:border-cyan-900/50 transition-all"
                title={sidebarCollapsed ? 'Expand session sidebar' : 'Collapse session sidebar'}
              >
                {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
              <button
                type="button"
                aria-label="新建对话"
                onClick={handleCreateNewConversation}
                className="text-cyan-400 hover:text-cyan-300 p-2 hover:bg-slate-800/50 rounded transition-all flex items-center gap-1 text-[11px] font-bold"
                title="New chat thread"
              >
                <Plus className="h-3.5 w-3.5" />
                {!sidebarCollapsed ? <span>新建</span> : null}
              </button>
            </div>
          </div>
          {!sidebarCollapsed ? (
            <div className="relative">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 absolute top-1/2 left-3 -translate-y-1/2 animate-pulse" />
              <div className="text-white text-xs pl-7 py-2 bg-[#080C14] border border-slate-800 rounded font-mono">
                Aegis Coordinator: <strong className="text-emerald-400 font-bold">ONLINE</strong>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
            </div>
          )}
        </div>

        {!sidebarCollapsed ? (
          <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
            {conversations.length === 0 ? (
              <div className="text-center p-6 text-slate-500 font-mono text-[11px]">No active threads</div>
            ) : (
              conversations.map((conversation) => {
                const isActive = conversation.id === activeConvId;
                return (
                  <div
                    key={conversation.id}
                    onClick={() => setActiveConvId(conversation.id)}
                    className={`group p-3 rounded-lg cursor-pointer transition-all ${
                      isActive
                        ? 'bg-[#080C14] border border-slate-800 text-white shadow-md'
                        : 'hover:bg-[#03060C] text-slate-500 hover:text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={`font-semibold text-xs ${isActive ? 'text-cyan-400' : 'text-slate-300 group-hover:text-white'} truncate`}>
                          {conversation.title}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-1 flex items-center gap-1.5">
                          <Clock className="h-3 w-3 text-slate-600" /> {conversation.timestamp}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete conversation ${conversation.title}`}
                        onClick={(event) => handleDeleteConversation(conversation.id, event)}
                        className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-800 transition-all shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-start gap-3 pt-4">
            <div className="w-10 h-10 rounded-xl border border-slate-800 bg-[#080C14] text-cyan-400 font-mono flex items-center justify-center">
              {conversations.length}
            </div>
            <div className="text-[9px] font-mono tracking-[0.3em] text-slate-600 [writing-mode:vertical-rl] rotate-180">
              HISTORY
            </div>
          </div>
        )}

        <div className="p-3 border-t border-slate-800 bg-[#03060C]">
          <button
            type="button"
            aria-label="Clear local chat cache"
            onClick={handleClearHistory}
            className={`${
              sidebarCollapsed
                ? 'w-10 h-10 mx-auto'
                : 'w-full py-1.5'
            } bg-rose-950/10 text-rose-400 hover:text-rose-300 hover:bg-rose-950/25 border border-rose-900/35 font-medium rounded transition-all text-center flex items-center justify-center gap-1.5 text-[11px]`}
          >
            <Trash2 className="h-3 w-3" />
            {!sidebarCollapsed ? <span>清空运行环境缓存</span> : null}
          </button>
        </div>
      </div>

      <div className={`flex-1 flex flex-col h-full min-w-0 bg-[#020408] relative ${composerExpanded ? 'pb-32' : 'pb-16'}`}>
        <div className="p-4 border-b border-slate-800 bg-[#03060C] flex justify-between items-center select-none">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 uppercase italic">
              {activeConversation ? activeConversation.title : '安全事件会话'}
              <span className="text-[9px] font-mono text-cyan-400 py-0.5 px-2 bg-[#080C14] rounded border border-slate-800 font-bold">
                AEGIS PROCESSOR v2.8.0
              </span>
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              INTENT ROUTING | A2A FLOW | VIP INTEGRATION PIPELINE
            </p>
          </div>
          <div className="text-[10px] font-mono text-slate-500 flex items-center gap-3">
            <button
              type="button"
              aria-label="Toggle delegate tool messages"
              onClick={() => setShowDelegateTools((current) => !current)}
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-all ${
                showDelegateTools
                  ? 'border-cyan-900/60 bg-cyan-950/30 text-cyan-300'
                  : 'border-slate-800 bg-[#080C14] text-slate-400 hover:text-cyan-300'
              }`}
            >
              {showDelegateTools ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              <span>{showDelegateTools ? 'DELEGATE TOOLS ON' : 'DELEGATE TOOLS OFF'}</span>
            </button>
            <span>State:</span>
            <span className="text-emerald-400 font-bold bg-emerald-950/30 px-2 py-0.5 border border-emerald-900/40 rounded">
              {stateLabel}
            </span>
          </div>
        </div>

        {transportError ? (
          <div className="border-b border-amber-900/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-300 flex items-center justify-between">
            <span>{transportError}</span>
            {activeConversation?.sessionId ? (
              <button
                onClick={handleResume}
                className="text-xs font-bold text-cyan-300 hover:text-cyan-200"
              >
                Resume Session
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
          {activeMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 max-w-xl mx-auto space-y-4 select-none my-auto">
              <div className="h-11 w-11 bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.4)] rounded-lg flex items-center justify-center shrink-0">
                <Layers className="h-5 w-5 text-white animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white uppercase italic tracking-wider">Aegis 协同中枢智能对话</h4>
                <p className="text-[11px] text-slate-400 leading-relaxed max-w-md">
                  向 Aegis 提交任何风险分析请求。当前页面会通过单一 WebSocket 会话持续接收主 Agent、Delegate Agent 与授权批准事件。
                </p>
              </div>
            </div>
          ) : null}

          {activeMessages.map((message) => {
            if (message.kind === 'delegate-event') {
              return (
                <div key={message.id} className="flex justify-center">
                  <div className="rounded-full border border-amber-900/40 bg-amber-950/20 px-4 py-2 text-[11px] font-mono text-amber-200">
                    {message.text}
                  </div>
                </div>
              );
            }

            const isDelegateTools = message.kind === 'delegate-tools';
            const isMainTools = message.kind === 'main-tools';
            const isExpanded = !!expandedMessageIds[message.id];
            const isAegis = message.sender === 'aegis';
            const agentBadge = isAegis ? (message.source === 'delegate' ? 'DG' : 'AE') : 'OP';
            const badgeClassName = isAegis
              ? message.source === 'delegate'
                ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-300'
                : 'bg-[#080C14] border-slate-800 text-cyan-400'
              : 'bg-[#03060C] border-slate-800 text-slate-400';
            const bubbleClassName = isAegis
              ? message.source === 'delegate'
                ? 'bg-emerald-950/10 border border-emerald-800/60 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.06)] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-full before:bg-emerald-400/70 before:content-[\"\"]'
                : 'bg-cyan-950/10 border border-cyan-800/60 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.06)]'
              : 'bg-[#080C14] border border-slate-800/80';
            const actorLabelClassName = isAegis
              ? message.source === 'delegate'
                ? 'text-emerald-300'
                : 'text-cyan-300'
              : 'text-slate-300';
            const actorLabel = isAegis
              ? message.source === 'delegate'
                ? message.srcagent || 'Delegate Agent'
                : 'Aegis Co-Pilot'
              : 'Operator';

            return (
              <div
                key={message.id}
                data-testid="chat-message"
                data-sender={message.sender}
                className={`flex gap-3 w-full ${isAegis ? 'mr-auto' : 'ml-auto flex-row-reverse'}`}
              >
                <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center border text-[11px] font-bold font-mono ${badgeClassName}`}>
                  {agentBadge}
                </div>

                <div className="space-y-2 flex-1 min-w-0">
                  <div className={`flex items-center gap-2 ${isAegis ? '' : 'justify-end'}`}>
                    <span className={`font-bold text-[11px] ${actorLabelClassName}`}>{actorLabel}</span>
                    <span className="text-[9px] text-slate-500 font-mono">{message.timestamp}</span>
                  </div>

                  <div className={`relative p-3.5 pr-12 rounded-lg text-slate-300 leading-relaxed ${bubbleClassName}`}>
                    {isDelegateTools ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-cyan-200">Delegate Tool Activity</div>
                            <div className="text-[10px] font-mono text-slate-500">
                              {(message.delegateTools || []).length} tool call{(message.delegateTools || []).length === 1 ? '' : 's'}
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-label={isExpanded ? 'Collapse delegate tool details' : 'Expand delegate tool details'}
                            onClick={() => toggleMessageExpanded(message.id)}
                            className="inline-flex items-center gap-1 rounded border border-slate-800 bg-[#080C14] px-2 py-1 text-[10px] font-mono text-slate-400 hover:text-cyan-300"
                          >
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            <span>{isExpanded ? 'HIDE DETAILS' : 'SHOW DETAILS'}</span>
                          </button>
                        </div>
                        {isExpanded ? (
                          <div className="space-y-2">
                            {(message.delegateTools || []).map((toolCall) => (
                              <div key={toolCall.id} className="rounded-lg border border-slate-800 bg-[#080C14] p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[11px] font-bold text-white">{toolCall.toolName}</span>
                                  <span className={`text-[9px] font-mono uppercase ${
                                    toolCall.status === 'completed' ? 'text-emerald-400' : 'text-cyan-400'
                                  }`}>
                                    {toolCall.status}
                                  </span>
                                </div>
                                <div className="mt-2 whitespace-pre-wrap break-words rounded border border-slate-800/80 bg-[#020408] px-2 py-1.5 text-[10px] font-mono text-slate-300">
                                  {toolCall.argsPreview || '(no args)'}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : isMainTools ? (
                      <div data-testid="message-chain" className="space-y-3">
                        <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest flex items-center gap-1.5 font-bold">
                          <Layers className="h-3.5 w-3.5 text-cyan-500" /> Orchestration Chain
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-2 relative select-none scrollbar-thin">
                          {(message.chainSteps || []).map((step) => (
                            <div key={step.id || `${step.agentName}-${step.timestamp}`} className="min-w-[240px] max-w-[240px] p-2.5 bg-[#080C14] border border-slate-800 rounded-lg relative overflow-hidden flex flex-col justify-between shrink-0">
                              <div className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-500" />
                              <div>
                                <div className="font-bold text-white flex items-center gap-1.5 text-[11px] truncate">
                                  <span className={`h-1.5 w-1.5 rounded-full ${step.type === 'agent' ? 'bg-cyan-400' : 'bg-purple-500'}`} />
                                  {step.agentName}
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1 pb-1 line-clamp-2 leading-normal">{step.message}</p>
                              </div>
                              <div className="flex justify-between items-center border-t border-slate-800 pt-1.5 mt-2 text-[9px] font-mono">
                                <span className={`font-bold uppercase flex items-center gap-0.5 ${
                                  step.status === 'Completed'
                                    ? 'text-emerald-400'
                                    : step.status === 'Failed'
                                      ? 'text-rose-400'
                                      : 'text-cyan-400'
                                }`}>
                                  <CheckCircle className="h-2.5 w-2.5" /> {step.status}
                                </span>
                                <span className="text-slate-500">{step.timestamp}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div data-testid="message-text" className="whitespace-pre-wrap text-sm leading-relaxed select-text cursor-text">
                        {message.text}
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label="Copy message"
                      onClick={() => void handleCopyMessage(message)}
                      className="absolute right-2 bottom-2 h-7 w-7 rounded border border-slate-800 bg-[#080C14] text-slate-400 hover:text-cyan-300 hover:border-cyan-900/50 transition-all flex items-center justify-center"
                      title="Copy message"
                    >
                      {copiedMessageId === message.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                </div>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>

        {activeConversation?.pendingApproval ? (
          <div className="mx-4 mb-3 rounded-xl border border-amber-900/30 bg-amber-950/20 p-4 text-amber-100">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-bold text-amber-200">Approval Required</div>
                <div className="mt-1 text-xs text-amber-100/90">{activeConversation.pendingApproval.description}</div>
                <div className="mt-2 rounded border border-amber-900/20 bg-[#080C14] px-3 py-2 font-mono text-[11px] text-amber-200">
                  {activeConversation.pendingApproval.command}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => handleApproval('once')} className="px-3 py-1.5 rounded bg-cyan-500 text-white font-bold text-xs">
                    Allow Once
                  </button>
                  <button onClick={() => handleApproval('session')} className="px-3 py-1.5 rounded border border-slate-700 text-slate-200 font-bold text-xs">
                    Session
                  </button>
                  <button onClick={() => handleApproval('always')} className="px-3 py-1.5 rounded border border-slate-700 text-slate-200 font-bold text-xs">
                    Always
                  </button>
                  <button onClick={() => handleApproval('deny')} className="px-3 py-1.5 rounded border border-rose-900/40 text-rose-300 font-bold text-xs">
                    Deny
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeConversation?.pendingClarify ? (
          <div className="mx-4 mb-3 rounded-xl border border-cyan-900/30 bg-cyan-950/20 p-4 text-cyan-100">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-bold text-cyan-200">Clarify Required</div>
                <div className="mt-1 text-xs text-cyan-100/90">{activeConversation.pendingClarify.question}</div>
                {activeConversation.pendingClarify.awaitingText ? (
                  <div className="mt-3 rounded border border-cyan-900/20 bg-[#080C14] px-3 py-2 text-[11px] text-cyan-200">
                    Type your answer below. Your next message will be sent as the clarify response.
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeConversation.pendingClarify.choices.map((choice) => (
                      <button
                        key={choice}
                        onClick={() => handleClarifyChoice(choice)}
                        className="px-3 py-1.5 rounded border border-slate-700 text-slate-200 font-bold text-xs"
                      >
                        {choice}
                      </button>
                    ))}
                    <button
                      onClick={handleClarifyOther}
                      className="px-3 py-1.5 rounded bg-cyan-500 text-white font-bold text-xs"
                    >
                      Other
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-800 bg-[#03060C] flex items-end gap-2 select-none z-10">
          <button
            type="button"
            className="p-2 bg-[#05080F] hover:bg-slate-800/80 border border-slate-800 rounded text-slate-500 hover:text-white transition-all scale-100 active:scale-95 shrink-0"
            title="Attach references"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <div className="relative flex-1">
            {composerExpanded ? (
              <textarea
                value={inputVal}
                onChange={(event) => setInputVal(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                disabled={isConversationBusy(activeConversation)}
                placeholder={composerPlaceholder}
                rows={4}
                className="w-full resize-none bg-[#020408] border border-slate-800 rounded px-3 py-2 pr-10 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            ) : (
              <input
                type="text"
                value={inputVal}
                onChange={(event) => setInputVal(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                disabled={isConversationBusy(activeConversation)}
                placeholder={composerPlaceholder}
                className="w-full bg-[#020408] border border-slate-800 rounded px-3 py-2 pr-10 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            )}
            <button
              type="button"
              aria-label={composerExpanded ? 'Collapse composer' : 'Expand composer'}
              onClick={() => setComposerExpanded((current) => !current)}
              className="absolute bottom-2 right-2 h-6 w-6 rounded text-slate-500 hover:text-cyan-300 hover:bg-slate-800/70 transition-all flex items-center justify-center"
              title={composerExpanded ? 'Collapse composer' : 'Expand composer'}
            >
              {composerExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={sendDisabled}
            className="px-4 py-2 bg-cyan-500 text-white hover:bg-cyan-600 disabled:bg-[#080C14] disabled:text-slate-600 rounded font-bold transition-all flex items-center gap-1.5 shrink-0 text-xs"
          >
            <Send className="h-3 w-3" /> 发送
          </button>
        </div>
      </div>
    </div>
  );
}
