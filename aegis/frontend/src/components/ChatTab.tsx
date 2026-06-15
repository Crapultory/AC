import React, { useEffect, useRef, useState } from 'react';
import { Agent, Conversation, Message } from '../types';
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
import {
  AegisChatProvider,
  useAegisChatRuntime,
  useOptionalAegisChatRuntime,
} from '../lib/chatRuntime';

interface ChatTabProps {
  agents: Agent[];
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

function ChatTabContent({ agents }: ChatTabProps) {
  void agents;
  const {
    conversations,
    activeConvId,
    activeConversation,
    transportError,
    setActiveConversation,
    createConversation,
    clearHistory,
    deleteConversation,
    submitInput,
    respondApproval,
    respondClarify,
    markClarifyAwaitingText,
    resumeActiveConversation,
    setTransportError,
  } = useAegisChatRuntime();
  const [inputVal, setInputVal] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [showDelegateTools, setShowDelegateTools] = useState(false);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations, activeConvId]);

  function handleCreateNewConversation() {
    createConversation();
    setInputVal('');
    setTransportError('');
  }

  function handleClearHistory() {
    if (clearHistory()) {
      setInputVal('');
      setTransportError('');
    }
  }

  function handleDeleteConversation(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    deleteConversation(id);
  }

  function handleSubmit() {
    if (!inputVal.trim()) {
      return;
    }
    submitInput(inputVal);
    setInputVal('');
  }

  function handleApproval(choice: 'once' | 'session' | 'always' | 'deny') {
    respondApproval(choice);
  }

  function handleClarifyChoice(answer: string) {
    respondClarify(answer);
  }

  function handleClarifyOther() {
    markClarifyAwaitingText();
  }

  function handleResume() {
    resumeActiveConversation();
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
                    onClick={() => setActiveConversation(conversation.id)}
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
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                          <Clock className="h-3 w-3 text-slate-600" /> {conversation.timestamp}
                          {conversation.pendingApproval ? (
                            <span className="rounded border border-amber-900/40 bg-amber-950/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">
                              approval
                            </span>
                          ) : null}
                          {conversation.pendingClarify ? (
                            <span className="rounded border border-cyan-900/40 bg-cyan-950/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-cyan-300">
                              clarify
                            </span>
                          ) : null}
                          {!conversation.pendingApproval &&
                          !conversation.pendingClarify &&
                          conversation.lastKnownRunState === 'running' ? (
                            <span className="rounded border border-emerald-900/40 bg-emerald-950/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">
                              running
                            </span>
                          ) : null}
                          {conversation.hasUnread ? (
                            <span className="rounded border border-cyan-900/40 bg-cyan-950/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-cyan-300">
                              new
                            </span>
                          ) : null}
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
                  向 Aegis 提交任何风险分析请求。Aegis 会为活跃会话保持独立实时通道，持续接收主 Agent、Delegate Agent 与授权批准事件。
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

export default function ChatTab(props: ChatTabProps) {
  const runtime = useOptionalAegisChatRuntime();
  if (runtime) {
    return <ChatTabContent {...props} />;
  }
  return (
    <AegisChatProvider isChatVisible={true}>
      <ChatTabContent {...props} />
    </AegisChatProvider>
  );
}
