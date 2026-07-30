import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  A2AContext,
  A2AContextAgent,
  Agent,
  ChatAttachment,
  Conversation,
  Message,
  PromptTemplate,
} from "../types";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Layers,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Paperclip,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  AegisChatProvider,
  useAegisChatRuntime,
  useOptionalAegisChatRuntime,
} from "../lib/chatRuntime";
import { fetchJSON, getApiErrorMessage } from "../lib/api";
import SessionWorkflow from "./SessionWorkflow";

interface ChatTabProps {
  agents: Agent[];
}

type PromptTemplateListResponse = { templates: PromptTemplate[] };
type AttachmentUploadResponse = { attachment: ChatAttachment };

interface PendingAttachment {
  localId: string;
  file: File;
  previewUrl?: string;
  attachment?: ChatAttachment;
  status: "uploading" | "ready" | "failed";
  error?: string;
}

function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="aegis-markdown__h1">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="aegis-markdown__h2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="aegis-markdown__h3">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="aegis-markdown__paragraph">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="aegis-markdown__list aegis-markdown__list--unordered">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="aegis-markdown__list aegis-markdown__list--ordered">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="aegis-markdown__list-item">{children}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote className="aegis-markdown__quote">{children}</blockquote>
        ),
        pre: ({ children }) => (
          <pre className="aegis-markdown__pre">{children}</pre>
        ),
        code: ({ children }) => (
          <code className="aegis-markdown__code">{children}</code>
        ),
        table: ({ children }) => (
          <div className="aegis-markdown__table-wrap">
            <table className="aegis-markdown__table">{children}</table>
          </div>
        ),
        tr: ({ children }) => (
          <tr className="aegis-markdown__tr">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="aegis-markdown__th">{children}</th>
        ),
        td: ({ children }) => (
          <td className="aegis-markdown__td">{children}</td>
        ),
        a: ({ href, children }) => {
          const external = Boolean(href && /^https?:\/\//i.test(href));
          return (
            <a
              href={href}
              target={external ? "_blank" : undefined}
              rel={external ? "noreferrer" : undefined}
              className="aegis-markdown__link"
            >
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function isConversationBusy(conversation: Conversation | undefined): boolean {
  if (!conversation) {
    return false;
  }
  if (conversation.lastKnownRunState === "waiting_for_approval") {
    return true;
  }
  if (conversation.lastKnownRunState === "waiting_for_clarify") {
    return !conversation.pendingClarify?.awaitingText;
  }
  return false;
}

function agentLabel(srcagent?: string): string {
  return srcagent?.trim() || "AEGIS";
}

function describeRunState(
  state?: string,
  source: "main" | "delegate" = "main",
  srcagent?: string,
): string {
  const actor = agentLabel(srcagent);
  switch (state) {
    case "idle":
      return "SESSION COMPLETE · AWAITING NEXT REQUEST";
    case "running":
      return `${actor} · ${source === "delegate" ? "DELEGATE" : "MAIN"} EXECUTION IN PROGRESS`;
    case "waiting_for_delegate_input":
      return `${actor} · DELEGATE AWAITING INPUT`;
    case "waiting_for_approval":
      return `${actor} · APPROVAL REQUIRED TO CONTINUE`;
    case "waiting_for_clarify":
      return `${actor} · CLARIFICATION REQUIRED TO CONTINUE`;
    case "interrupted":
      return `${actor} · SESSION INTERRUPTED`;
    case "error":
      return `${actor} · SESSION ERROR · REVIEW WORKFLOW`;
    default:
      return `${actor} · ${state?.replace(/_/g, " ").toUpperCase() || "AWAITING FIRST TURN"}`;
  }
}

function buildSessionStatus(conversation?: Conversation): string {
  const hasRecordedActivity = Boolean(
    conversation?.sessionId ||
    conversation?.messages.length ||
    conversation?.workflowTrace?.length,
  );
  if (!hasRecordedActivity) {
    return "AWAITING FIRST TURN";
  }

  const latestEvent = conversation?.workflowTrace?.at(-1);
  if (latestEvent) {
    const actor = agentLabel(latestEvent.srcagent);
    if (latestEvent.type === "delegate.entered") {
      return `${actor} · DELEGATED AND ENTERED FOREGROUND`;
    }
    if (latestEvent.type === "delegate.exited") {
      return `${actor} · DELEGATION COMPLETE · CONTROL RETURNED TO MAIN`;
    }
    if (latestEvent.type === "tool.started") {
      return `${actor} · TOOL CALL RUNNING · ${latestEvent.toolName || "TOOL"}`;
    }
    if (latestEvent.type === "tool.completed") {
      return `${actor} · TOOL CALL COMPLETED · ${latestEvent.toolName || "TOOL"}`;
    }
    if (latestEvent.type === "run.state") {
      return describeRunState(
        latestEvent.state,
        latestEvent.source,
        latestEvent.srcagent,
      );
    }
    if (
      latestEvent.type === "message.completed" ||
      latestEvent.type === "message.stream.completed"
    ) {
      return `${actor} · RESPONSE RECEIVED`;
    }
    if (latestEvent.type === "message.accepted") {
      return `${actor} · REQUEST ACCEPTED`;
    }
  }

  if (conversation?.lastKnownRunState) {
    return describeRunState(
      conversation.lastKnownRunState,
      conversation.foregroundSource,
      conversation.foregroundAgentName,
    );
  }
  return "AWAITING FIRST TURN";
}

function statusSegmentTone(segment: string, index: number): string {
  if (/ERROR|INTERRUPTED/.test(segment)) {
    return "critical";
  }
  if (/COMPLETE|COMPLETED/.test(segment)) {
    return "complete";
  }
  if (/REQUIRED|AWAITING/.test(segment)) {
    return "attention";
  }
  if (/RUNNING|EXECUTION|PROCESSING|DELEGATED|CONTROL RETURNED/.test(segment)) {
    return "activity";
  }
  if (/TOOL|RESPONSE|REQUEST/.test(segment)) {
    return "object";
  }
  if (index === 0) {
    return "actor";
  }
  return index === 1 ? "detail" : "object";
}

function renderSessionStatus(status: string) {
  return status.split(" · ").map((segment, index) => (
    <React.Fragment key={`${index}:${segment}`}>
      {index > 0 ? (
        <span
          className="aegis-session-status-ticker__separator"
          aria-hidden="true"
        >
          {" "}
          ·{" "}
        </span>
      ) : null}
      <span
        className={`aegis-session-status-ticker__part aegis-session-status-ticker__part--${statusSegmentTone(segment, index)}`}
      >
        {segment}
      </span>
    </React.Fragment>
  ));
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const element = document.createElement("textarea");
  element.value = text;
  element.setAttribute("readonly", "true");
  element.style.position = "absolute";
  element.style.left = "-9999px";
  document.body.appendChild(element);
  element.select();
  document.execCommand("copy");
  document.body.removeChild(element);
}

function getMessageCopyText(message: Message): string {
  if (message.kind === "delegate-tools" && message.delegateTools?.length) {
    return message.delegateTools
      .map((toolCall) => {
        const resultLine = toolCall.resultPreview
          ? `\nResult: ${toolCall.resultPreview}`
          : "";
        return `${toolCall.toolName}\nArgs: ${toolCall.argsPreview || "(none)"}${resultLine}`;
      })
      .join("\n\n");
  }
  if (message.kind === "main-tools" && message.chainSteps?.length) {
    return message.chainSteps
      .map((step) => `${step.agentName}\n${step.status}\n${step.message}`)
      .join("\n\n");
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
  const [inputVal, setInputVal] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [showDelegateTools, setShowDelegateTools] = useState(false);
  const [markdownRenderingEnabled, setMarkdownRenderingEnabled] =
    useState(true);
  const [expandedMessageIds, setExpandedMessageIds] = useState<
    Record<string, boolean>
  >({});
  const [sessionStatusPhase, setSessionStatusPhase] = useState<
    "announce" | "static" | "scroll"
  >("announce");
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false);
  const [workflowFullscreen, setWorkflowFullscreen] = useState(false);
  const [promptTemplateDrawerOpen, setPromptTemplateDrawerOpen] =
    useState(false);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [promptTemplateLoading, setPromptTemplateLoading] = useState(false);
  const [promptTemplateError, setPromptTemplateError] = useState("");
  const [a2aDialogOpen, setA2ADialogOpen] = useState(false);
  const [a2aContext, setA2AContext] = useState<A2AContext | null>(null);
  const [a2aLoading, setA2ALoading] = useState(false);
  const [a2aRefreshing, setA2ARefreshing] = useState(false);
  const [a2aError, setA2AError] = useState("");
  const [selectedA2AAgent, setSelectedA2AAgent] =
    useState<A2AContextAgent | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(
    () => () => {
      pendingAttachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
    },
    [],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations, activeConvId]);

  const sessionStatus = buildSessionStatus(activeConversation);
  const sessionStatusNeedsMarquee = sessionStatus.length > 36;

  useEffect(() => {
    setSessionStatusPhase("announce");
    const tickerTimer = window.setTimeout(
      () =>
        setSessionStatusPhase(sessionStatusNeedsMarquee ? "scroll" : "static"),
      1500,
    );
    return () => window.clearTimeout(tickerTimer);
  }, [sessionStatus, sessionStatusNeedsMarquee]);

  useEffect(() => {
    if (!workflowDrawerOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (workflowFullscreen) {
          setWorkflowFullscreen(false);
        } else {
          setWorkflowDrawerOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [workflowDrawerOpen, workflowFullscreen]);

  useEffect(() => {
    if (!a2aDialogOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setA2ADialogOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [a2aDialogOpen]);

  function closeWorkflow() {
    setWorkflowFullscreen(false);
    setWorkflowDrawerOpen(false);
  }

  function openWorkflowFromSessionStatus() {
    setWorkflowFullscreen(false);
    setWorkflowDrawerOpen(true);
  }

  function handleSessionStatusKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWorkflowFromSessionStatus();
    }
  }

  function handleCreateNewConversation() {
    createConversation();
    setInputVal("");
    clearPendingAttachments();
    setTransportError("");
  }

  function handleClearHistory() {
    if (clearHistory()) {
      setInputVal("");
      clearPendingAttachments();
      setTransportError("");
    }
  }

  function handleDeleteConversation(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    deleteConversation(id);
  }

  function handleSubmit() {
    const attachments = pendingAttachments
      .filter(
        (attachment) => attachment.status === "ready" && attachment.attachment,
      )
      .map((attachment) => attachment.attachment as ChatAttachment);
    if (!inputVal.trim() && attachments.length === 0) {
      return;
    }
    submitInput(inputVal, attachments);
    setInputVal("");
    clearPendingAttachments();
  }

  function clearPendingAttachments() {
    setPendingAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      return [];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadAttachment(localId: string, file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      const response = await fetchJSON<AttachmentUploadResponse>(
        "/api/chat/attachments",
        {
          method: "POST",
          body: form,
        },
      );
      setPendingAttachments((current) =>
        current.map((attachment) =>
          attachment.localId === localId
            ? {
                ...attachment,
                status: "ready",
                attachment: response.attachment,
                error: undefined,
              }
            : attachment,
        ),
      );
    } catch (error) {
      setPendingAttachments((current) =>
        current.map((attachment) =>
          attachment.localId === localId
            ? {
                ...attachment,
                status: "failed",
                error: getApiErrorMessage(error, "Upload failed."),
              }
            : attachment,
        ),
      );
    }
  }

  function queueAttachments(files: FileList | File[]) {
    const nextFiles = Array.from(files);
    if (nextFiles.length === 0) return;
    const uploads = nextFiles.map((file) => ({
      localId: `upload-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`,
      file,
      previewUrl: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined,
      status: "uploading" as const,
    }));
    setPendingAttachments((current) => [...current, ...uploads]);
    uploads.forEach(
      (upload) => void uploadAttachment(upload.localId, upload.file),
    );
  }

  function removePendingAttachment(localId: string) {
    setPendingAttachments((current) =>
      current.filter((attachment) => {
        if (attachment.localId === localId && attachment.previewUrl)
          URL.revokeObjectURL(attachment.previewUrl);
        return attachment.localId !== localId;
      }),
    );
  }

  function retryPendingAttachment(localId: string) {
    const attachment = pendingAttachments.find(
      (item) => item.localId === localId,
    );
    if (!attachment) return;
    setPendingAttachments((current) =>
      current.map((item) =>
        item.localId === localId
          ? { ...item, status: "uploading", error: undefined }
          : item,
      ),
    );
    void uploadAttachment(localId, attachment.file);
  }

  function handleComposerPaste(
    event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const images = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length === 0) return;
    event.preventDefault();
    queueAttachments(images);
  }

  function handleApproval(choice: "once" | "session" | "always" | "deny") {
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

  async function openPromptTemplateDrawer() {
    setPromptTemplateDrawerOpen(true);
    setPromptTemplateLoading(true);
    setPromptTemplateError("");
    try {
      const response = await fetchJSON<PromptTemplateListResponse>(
        "/api/prompt-templates",
      );
      setPromptTemplates(response.templates);
    } catch (loadError) {
      setPromptTemplateError(
        getApiErrorMessage(loadError, "Unable to load prompt templates."),
      );
    } finally {
      setPromptTemplateLoading(false);
    }
  }

  function appendPromptTemplate(template: PromptTemplate) {
    setInputVal((current) =>
      current ? `${current} ${template.prompt}` : template.prompt,
    );
    setPromptTemplateDrawerOpen(false);
  }

  async function loadA2AContext(refresh = false) {
    if (refresh) {
      setA2ARefreshing(true);
    } else {
      setA2ALoading(true);
    }
    setA2AError("");
    try {
      const response = await fetchJSON<A2AContext>(
        refresh ? "/api/a2a/context/refresh" : "/api/a2a/context",
        refresh ? { method: "POST" } : undefined,
      );
      setA2AContext(response);
      setSelectedA2AAgent(null);
    } catch (loadError) {
      setA2AError(getApiErrorMessage(loadError, "Unable to load A2A agents."));
    } finally {
      setA2ALoading(false);
      setA2ARefreshing(false);
    }
  }

  function openA2AAgents() {
    setA2ADialogOpen(true);
    setSelectedA2AAgent(null);
    void loadA2AContext();
  }

  async function handleCopyMessage(message: Message) {
    try {
      await writeClipboardText(getMessageCopyText(message));
      setCopiedMessageId(message.id);
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId("");
        copyFeedbackTimeoutRef.current = null;
      }, 1600);
    } catch {
      setTransportError("Unable to copy this message right now.");
    }
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (!composerExpanded && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
      return;
    }
    if (
      composerExpanded &&
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey)
    ) {
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

  const attachmentUploadPending = pendingAttachments.some(
    (attachment) => attachment.status !== "ready",
  );
  const sendDisabled =
    (!inputVal.trim() && pendingAttachments.length === 0) ||
    attachmentUploadPending ||
    isConversationBusy(activeConversation);
  const activeMessages = (activeConversation?.messages || []).filter(
    (message) => showDelegateTools || message.kind !== "delegate-tools",
  );
  const composerPlaceholder = activeConversation?.pendingClarify?.awaitingText
    ? "Answer clarify prompt... 输入你的补充说明"
    : "Ask Aegis anything... 触发关键词：'钓鱼邮件', '勒索病毒', '敏感泄露'...";
  const templatesByTag = promptTemplates.reduce<
    Record<string, PromptTemplate[]>
  >((groups, template) => {
    (groups[template.tag] ||= []).push(template);
    return groups;
  }, {});
  return (
    <div
      className={`flex bg-[#020408] items-stretch overflow-hidden text-xs ${
        workflowDrawerOpen
          ? "fixed inset-0 z-50 h-screen w-screen"
          : "h-full w-full"
      }`}
    >
      {!workflowDrawerOpen ? (
        <div
          className={`${sidebarCollapsed ? "w-16" : "w-80"} border-r border-slate-800 bg-[#05080F] flex flex-col pt-4 shrink-0 z-10 transition-[width] duration-200`}
        >
          <div
            className={`${sidebarCollapsed ? "px-2 pb-3" : "px-4 pb-3"} border-b border-slate-800 space-y-3`}
          >
            <div
              className={`flex ${sidebarCollapsed ? "flex-col gap-2" : "justify-between items-center"}`}
            >
              {!sidebarCollapsed ? (
                <span className="text-[10px] font-mono tracking-widest font-bold text-slate-500 uppercase">
                  CENTRAL ARCHIVE
                </span>
              ) : null}
              <div
                className={`flex ${sidebarCollapsed ? "flex-col items-center gap-2" : "items-center gap-2 ml-auto"}`}
              >
                <button
                  type="button"
                  aria-label={
                    sidebarCollapsed
                      ? "Expand session sidebar"
                      : "Collapse session sidebar"
                  }
                  onClick={() => setSidebarCollapsed((current) => !current)}
                  className="p-2 rounded border border-slate-800 bg-[#080C14] text-slate-400 hover:text-cyan-300 hover:border-cyan-900/50 transition-all"
                  title={
                    sidebarCollapsed
                      ? "Expand session sidebar"
                      : "Collapse session sidebar"
                  }
                >
                  {sidebarCollapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronLeft className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Open workflow visualization"
                  aria-pressed={workflowDrawerOpen}
                  onClick={() => {
                    setWorkflowFullscreen(false);
                    setWorkflowDrawerOpen(true);
                  }}
                  className="p-2 rounded border border-slate-800 bg-[#080C14] text-slate-400 hover:text-cyan-300 hover:border-cyan-900/50 transition-all"
                  title="Open session workflow"
                >
                  <Workflow className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Open A2A agents"
                  aria-pressed={a2aDialogOpen}
                  onClick={openA2AAgents}
                  className="p-2 rounded border border-slate-800 bg-[#080C14] text-slate-400 hover:text-cyan-300 hover:border-cyan-900/50 transition-all"
                  title="Browse A2A agents"
                >
                  <Bot className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="新建对话"
                  onClick={handleCreateNewConversation}
                  className="rounded border border-slate-800 bg-[#080C14] p-2 text-cyan-400 transition-all hover:border-cyan-900/50 hover:text-cyan-300"
                  title="New chat thread"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            {!sidebarCollapsed ? (
              <div className="relative">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 absolute top-1/2 left-3 -translate-y-1/2 animate-pulse" />
                <div className="text-white text-xs pl-7 py-2 bg-[#080C14] border border-slate-800 rounded font-mono">
                  Aegis Coordinator:{" "}
                  <strong className="text-emerald-400 font-bold">ONLINE</strong>
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
                <div className="text-center p-6 text-slate-500 font-mono text-[11px]">
                  No active threads
                </div>
              ) : (
                conversations.map((conversation) => {
                  const isActive = conversation.id === activeConvId;
                  return (
                    <div
                      key={conversation.id}
                      onClick={() => setActiveConversation(conversation.id)}
                      className={`group p-3 rounded-lg cursor-pointer transition-all ${
                        isActive
                          ? "aegis-conversation--active border text-white shadow-md"
                          : "hover:bg-[#03060C] text-slate-500 hover:text-slate-300 border border-transparent"
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div
                            className={`font-semibold text-xs ${isActive ? "text-cyan-400" : "text-slate-300 group-hover:text-white"} truncate`}
                          >
                            {conversation.title}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                            <Clock className="h-3 w-3 text-slate-600" />{" "}
                            {conversation.timestamp}
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
                            conversation.lastKnownRunState === "running" ? (
                              <span className="aegis-status-badge aegis-status-badge--success">
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
                          onClick={(event) =>
                            handleDeleteConversation(conversation.id, event)
                          }
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
                sidebarCollapsed ? "w-10 h-10 mx-auto" : "w-full py-1.5"
              } bg-rose-950/10 text-rose-400 hover:text-rose-300 hover:bg-rose-950/25 border border-rose-900/35 font-medium rounded transition-all text-center flex items-center justify-center gap-1.5 text-[11px]`}
            >
              <Trash2 className="h-3 w-3" />
              {!sidebarCollapsed ? <span>清空运行环境缓存</span> : null}
            </button>
          </div>
        </div>
      ) : null}

      {workflowDrawerOpen ? (
        <SessionWorkflow
          conversation={activeConversation}
          fullscreen={workflowFullscreen}
          onFullscreenChange={setWorkflowFullscreen}
          onClose={closeWorkflow}
        />
      ) : null}

      {!workflowFullscreen ? (
        <div
          data-testid="chat-workspace"
          className={`${workflowDrawerOpen ? "w-1/2 shrink-0" : "flex-1"} flex flex-col h-full min-w-0 bg-[#020408] relative ${composerExpanded ? "pb-32" : "pb-16"}`}
        >
          <div className="min-h-16 p-4 border-b border-slate-800 bg-[#03060C] flex items-center gap-3">
            <h3
              className="shrink-0 max-w-[34%] truncate text-sm font-bold text-white uppercase italic"
              title={
                activeConversation ? activeConversation.title : "安全事件会话"
              }
            >
              {activeConversation ? activeConversation.title : "安全事件会话"}
            </h3>
            <button
              type="button"
              data-testid="session-status-ticker"
              aria-label={`Open session workflow. Latest status: ${sessionStatus}`}
              onClick={openWorkflowFromSessionStatus}
              onKeyDown={handleSessionStatusKeyDown}
              className="aegis-session-status-ticker min-w-0 flex-1 rounded border border-cyan-950/70 bg-cyan-950/10 px-2.5 py-1.5 text-left font-mono text-[10px] text-cyan-200 transition-colors hover:border-cyan-700/70 hover:bg-cyan-950/25 focus-visible:border-cyan-400 focus-visible:outline-none"
              title="Open session workflow"
            >
              <span
                className={`aegis-session-status-ticker__viewport aegis-session-status-ticker__viewport--${sessionStatusPhase}`}
                aria-live="polite"
              >
                {sessionStatusPhase !== "scroll" ? (
                  <span
                    key={sessionStatus}
                    className="aegis-session-status-ticker__announcement"
                  >
                    {renderSessionStatus(sessionStatus)}
                  </span>
                ) : (
                  <span
                    key={sessionStatus}
                    className="aegis-session-status-ticker__track"
                  >
                    <span className="aegis-session-status-ticker__item">
                      {renderSessionStatus(sessionStatus)}
                    </span>
                    <span
                      className="aegis-session-status-ticker__item"
                      aria-hidden="true"
                    >
                      {renderSessionStatus(sessionStatus)}
                    </span>
                  </span>
                )}
              </span>
            </button>
            <div className="shrink-0 text-[10px] font-mono text-slate-500 flex items-center gap-3">
              <button
                type="button"
                aria-label="Toggle delegate tool messages"
                onClick={() => setShowDelegateTools((current) => !current)}
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-all ${
                  showDelegateTools
                    ? "border-cyan-900/60 bg-cyan-950/30 text-cyan-300"
                    : "border-slate-800 bg-[#080C14] text-slate-400 hover:text-cyan-300"
                }`}
              >
                {showDelegateTools ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                <span>
                  {showDelegateTools
                    ? "DELEGATE TOOLS ON"
                    : "DELEGATE TOOLS OFF"}
                </span>
              </button>
              <button
                type="button"
                aria-label={
                  markdownRenderingEnabled
                    ? "Disable Markdown rendering"
                    : "Enable Markdown rendering"
                }
                aria-pressed={markdownRenderingEnabled}
                onClick={() =>
                  setMarkdownRenderingEnabled((current) => !current)
                }
                className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-all ${
                  markdownRenderingEnabled
                    ? "border-cyan-900/60 bg-cyan-950/30 text-cyan-300 hover:border-cyan-700 hover:text-cyan-100"
                    : "border-slate-800 bg-[#080C14] text-slate-500 hover:border-cyan-900/50 hover:text-cyan-300"
                }`}
                title={
                  markdownRenderingEnabled
                    ? "Disable Markdown rendering"
                    : "Enable Markdown rendering"
                }
              >
                <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
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
              <div className="h-full flex flex-col items-center justify-center text-center p-6 max-w-xl mx-auto space-y-4 my-auto">
                <div className="h-11 w-11 bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.4)] rounded-lg flex items-center justify-center shrink-0">
                  <Layers className="h-5 w-5 text-white animate-pulse" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white uppercase italic tracking-wider">
                    Aegis 协同中枢智能对话
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-md">
                    向 Aegis 提交任何风险分析请求。Aegis
                    会为活跃会话保持独立实时通道，持续接收主 Agent、Delegate
                    Agent 与授权批准事件。
                  </p>
                </div>
              </div>
            ) : null}

            {activeMessages.map((message) => {
              if (message.kind === "delegate-event") {
                return (
                  <div key={message.id} className="flex justify-center">
                    <div className="aegis-delegate-event">{message.text}</div>
                  </div>
                );
              }

              const isDelegateTools = message.kind === "delegate-tools";
              const isMainTools = message.kind === "main-tools";
              const isExpanded = !!expandedMessageIds[message.id];
              const isAegis = message.sender === "aegis";
              const agentBadge = isAegis
                ? message.source === "delegate"
                  ? "DG"
                  : "AE"
                : "OP";
              const badgeClassName = isAegis
                ? message.source === "delegate"
                  ? "aegis-delegate-badge"
                  : "bg-[#080C14] border-slate-800 text-cyan-400"
                : "bg-[#03060C] border-slate-800 text-slate-400";
              const bubbleClassName = isAegis
                ? message.source === "delegate"
                  ? "aegis-delegate-bubble"
                  : "bg-cyan-950/10 border border-cyan-800/60 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.06)]"
                : "bg-[#080C14] border border-slate-800/80";
              const actorLabelClassName = isAegis
                ? message.source === "delegate"
                  ? "aegis-delegate-label"
                  : "text-cyan-300"
                : "text-slate-300";
              const actorLabel = isAegis
                ? message.source === "delegate"
                  ? message.srcagent || "Delegate Agent"
                  : "Aegis Co-Pilot"
                : "Operator";

              return (
                <div
                  key={message.id}
                  data-testid="chat-message"
                  data-sender={message.sender}
                  className={`flex gap-3 w-full ${isAegis ? "mr-auto" : "ml-auto flex-row-reverse"}`}
                >
                  <div
                    className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center border text-[11px] font-bold font-mono ${badgeClassName}`}
                  >
                    {agentBadge}
                  </div>

                  <div className="space-y-2 flex-1 min-w-0">
                    <div
                      className={`flex items-center gap-2 ${isAegis ? "" : "justify-end"}`}
                    >
                      <span
                        className={`font-bold text-[11px] ${actorLabelClassName}`}
                      >
                        {actorLabel}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono">
                        {message.timestamp}
                      </span>
                    </div>

                    <div
                      className={`relative p-3.5 pr-12 rounded-lg text-slate-300 leading-relaxed ${bubbleClassName}`}
                    >
                      {isDelegateTools ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-cyan-200">
                                Delegate Tool Activity
                              </div>
                              <div className="text-[10px] font-mono text-slate-500">
                                {(message.delegateTools || []).length} tool call
                                {(message.delegateTools || []).length === 1
                                  ? ""
                                  : "s"}
                              </div>
                            </div>
                            <button
                              type="button"
                              aria-label={
                                isExpanded
                                  ? "Collapse delegate tool details"
                                  : "Expand delegate tool details"
                              }
                              onClick={() => toggleMessageExpanded(message.id)}
                              className="inline-flex items-center gap-1 rounded border border-slate-800 bg-[#080C14] px-2 py-1 text-[10px] font-mono text-slate-400 hover:text-cyan-300"
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                              <span>
                                {isExpanded ? "HIDE DETAILS" : "SHOW DETAILS"}
                              </span>
                            </button>
                          </div>
                          {isExpanded ? (
                            <div className="space-y-2">
                              {(message.delegateTools || []).map((toolCall) => (
                                <div
                                  key={toolCall.id}
                                  className="rounded-lg border border-slate-800 bg-[#080C14] p-3"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-[11px] font-bold text-white">
                                      {toolCall.toolName}
                                    </span>
                                    <span
                                      className={`text-[9px] font-mono uppercase ${
                                        toolCall.status === "completed"
                                          ? "aegis-status-text--success"
                                          : "aegis-status-text--accent"
                                      }`}
                                    >
                                      {toolCall.status}
                                    </span>
                                  </div>
                                  <div className="mt-2 whitespace-pre-wrap break-words rounded border border-slate-800/80 bg-[#020408] px-2 py-1.5 text-[10px] font-mono text-slate-300">
                                    {toolCall.argsPreview || "(no args)"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : isMainTools ? (
                        <div data-testid="message-chain" className="space-y-3">
                          <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest flex items-center gap-1.5 font-bold">
                            <Layers className="h-3.5 w-3.5 text-cyan-500" />{" "}
                            Orchestration Chain
                          </div>
                          <div className="flex gap-3 overflow-x-auto pb-2 relative scrollbar-thin">
                            {(message.chainSteps || []).map((step) => (
                              <div
                                key={
                                  step.id ||
                                  `${step.agentName}-${step.timestamp}`
                                }
                                className="min-w-[240px] max-w-[240px] p-2.5 bg-[#080C14] border border-slate-800 rounded-lg relative overflow-hidden flex flex-col justify-between shrink-0"
                              >
                                <div className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-500" />
                                <div>
                                  <div className="font-bold text-white flex items-center gap-1.5 text-[11px] truncate">
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${step.type === "agent" ? "bg-cyan-400" : "bg-purple-500"}`}
                                    />
                                    {step.agentName}
                                  </div>
                                  <p className="text-[10px] text-slate-400 mt-1 pb-1 line-clamp-2 leading-normal">
                                    {step.message}
                                  </p>
                                </div>
                                <div className="flex justify-between items-center border-t border-slate-800 pt-1.5 mt-2 text-[9px] font-mono">
                                  <span
                                    className={`font-bold uppercase flex items-center gap-0.5 ${
                                      step.status === "Completed"
                                        ? "aegis-status-text--success"
                                        : step.status === "Failed"
                                          ? "aegis-status-text--danger"
                                          : "aegis-status-text--accent"
                                    }`}
                                  >
                                    <CheckCircle className="h-2.5 w-2.5" />{" "}
                                    {step.status}
                                  </span>
                                  <span className="text-slate-500">
                                    {step.timestamp}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {message.attachments?.length ? (
                            <div
                              className="flex flex-wrap gap-1.5"
                              data-testid="message-attachments"
                            >
                              {message.attachments.map((attachment) => (
                                <span
                                  key={attachment.id}
                                  className="inline-flex max-w-full items-center gap-1.5 rounded border border-cyan-900/50 bg-cyan-950/20 px-2 py-1 font-mono text-[10px] text-cyan-200"
                                >
                                  {attachment.kind === "image" ? (
                                    <ImageIcon className="h-3 w-3 shrink-0 text-cyan-400" />
                                  ) : (
                                    <FileText className="h-3 w-3 shrink-0 text-slate-400" />
                                  )}
                                  <span className="truncate">
                                    {attachment.display_name}
                                  </span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {message.text ? (
                            <div
                              data-testid="message-text"
                              data-markdown-rendered={markdownRenderingEnabled}
                              className={`${markdownRenderingEnabled ? "aegis-markdown" : "whitespace-pre-wrap"} text-sm leading-relaxed select-text cursor-text`}
                            >
                              {markdownRenderingEnabled ? (
                                <ChatMarkdown content={message.text} />
                              ) : (
                                message.text
                              )}
                            </div>
                          ) : null}
                        </div>
                      )}
                      <button
                        type="button"
                        aria-label="Copy message"
                        onClick={() => void handleCopyMessage(message)}
                        className="absolute right-2 bottom-2 h-7 w-7 rounded border border-slate-800 bg-[#080C14] text-slate-400 hover:text-cyan-300 hover:border-cyan-900/50 transition-all flex items-center justify-center"
                        title="Copy message"
                      >
                        {copiedMessageId === message.id ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
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
                  <div className="text-sm font-bold text-amber-200">
                    Approval Required
                  </div>
                  <div className="mt-1 text-xs text-amber-100/90">
                    {activeConversation.pendingApproval.description}
                  </div>
                  <div className="mt-2 rounded border border-amber-900/20 bg-[#080C14] px-3 py-2 font-mono text-[11px] text-amber-200">
                    {activeConversation.pendingApproval.command}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => handleApproval("once")}
                      className="px-3 py-1.5 rounded bg-cyan-500 text-white font-bold text-xs"
                    >
                      Allow Once
                    </button>
                    <button
                      onClick={() => handleApproval("session")}
                      className="px-3 py-1.5 rounded border border-slate-700 text-slate-200 font-bold text-xs"
                    >
                      Session
                    </button>
                    <button
                      onClick={() => handleApproval("always")}
                      className="px-3 py-1.5 rounded border border-slate-700 text-slate-200 font-bold text-xs"
                    >
                      Always
                    </button>
                    <button
                      onClick={() => handleApproval("deny")}
                      className="px-3 py-1.5 rounded border border-rose-900/40 text-rose-300 font-bold text-xs"
                    >
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
                  <div className="text-sm font-bold text-cyan-200">
                    Clarify Required
                  </div>
                  <div className="mt-1 text-xs text-cyan-100/90">
                    {activeConversation.pendingClarify.question}
                  </div>
                  {activeConversation.pendingClarify.awaitingText ? (
                    <div className="mt-3 rounded border border-cyan-900/20 bg-[#080C14] px-3 py-2 text-[11px] text-cyan-200">
                      Type your answer below. Your next message will be sent as
                      the clarify response.
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeConversation.pendingClarify.choices.map(
                        (choice) => (
                          <button
                            key={choice}
                            onClick={() => handleClarifyChoice(choice)}
                            className="px-3 py-1.5 rounded border border-slate-700 text-slate-200 font-bold text-xs"
                          >
                            {choice}
                          </button>
                        ),
                      )}
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

          <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-slate-800 bg-[#03060C] p-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              aria-label="Upload chat attachments"
              onChange={(event) => queueAttachments(event.target.files || [])}
            />
            <div className="space-y-2">
              {pendingAttachments.length ? (
                <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded border border-cyan-950/60 bg-[#05080F] p-1.5">
                  {pendingAttachments.map((attachment) => (
                    <div
                      key={attachment.localId}
                      className={`group flex max-w-[220px] items-center gap-1.5 rounded border px-1.5 py-1 text-[10px] font-mono ${attachment.status === "failed" ? "border-rose-900/70 bg-rose-950/20 text-rose-200" : "border-slate-700 bg-[#080C14] text-slate-300"}`}
                    >
                      {attachment.previewUrl ? (
                        <img
                          src={attachment.previewUrl}
                          alt=""
                          className="h-5 w-5 rounded object-cover"
                        />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      )}
                      <span className="max-w-[116px] truncate">
                        {attachment.file.name}
                      </span>
                      {attachment.status === "uploading" ? (
                        <LoaderCircle
                          className="h-3 w-3 shrink-0 animate-spin text-cyan-400"
                          aria-label="Uploading"
                        />
                      ) : null}
                      {attachment.status === "failed" ? (
                        <button
                          type="button"
                          onClick={() =>
                            retryPendingAttachment(attachment.localId)
                          }
                          className="text-rose-300 hover:text-white"
                          title={attachment.error || "Retry upload"}
                        >
                          RETRY
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          removePendingAttachment(attachment.localId)
                        }
                        className="text-slate-500 hover:text-white"
                        aria-label={`Remove ${attachment.file.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isConversationBusy(activeConversation)}
                  className="shrink-0 rounded border border-slate-800 bg-[#05080F] p-2 text-slate-500 transition-all hover:bg-slate-800/80 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Attach images or files"
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <div className="relative min-w-0 flex-1">
                  {composerExpanded ? (
                    <textarea
                      value={inputVal}
                      onChange={(event) => setInputVal(event.target.value)}
                      onKeyDown={handleComposerKeyDown}
                      onPaste={handleComposerPaste}
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
                      onPaste={handleComposerPaste}
                      disabled={isConversationBusy(activeConversation)}
                      placeholder={composerPlaceholder}
                      className="w-full bg-[#020408] border border-slate-800 rounded px-3 py-2 pr-10 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  )}
                  <button
                    type="button"
                    aria-label={
                      composerExpanded ? "Collapse composer" : "Expand composer"
                    }
                    onClick={() => setComposerExpanded((current) => !current)}
                    className="absolute bottom-2 right-2 h-6 w-6 rounded text-slate-500 hover:text-cyan-300 hover:bg-slate-800/70 transition-all flex items-center justify-center"
                    title={
                      composerExpanded ? "Collapse composer" : "Expand composer"
                    }
                  >
                    {composerExpanded ? (
                      <Minimize2 className="h-3.5 w-3.5" />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                <button
                  type="button"
                  aria-label="Open prompt templates"
                  onClick={() => void openPromptTemplateDrawer()}
                  className="shrink-0 rounded border border-slate-800 bg-[#05080F] p-2 text-slate-400 transition-all hover:border-cyan-900/50 hover:bg-slate-800/80 hover:text-cyan-300"
                  title="Prompt templates"
                >
                  <PanelRightOpen className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={sendDisabled}
                  className="aegis-send-button shrink-0"
                >
                  <Send className="h-3 w-3" /> 发送
                </button>
              </div>
            </div>
          </div>
          {promptTemplateDrawerOpen ? (
            <aside
              aria-label="Prompt templates"
              className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-slate-700 bg-[#05080F] shadow-[-20px_0_55px_rgba(0,0,0,0.45)]"
            >
              <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
                <div>
                  <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-cyan-400">
                    USER PROMPT LIBRARY
                  </p>
                  <h4 className="mt-1 text-sm font-semibold text-white">
                    选择模版
                  </h4>
                  <p className="mt-1 text-[11px] text-slate-500">
                    点击后追加到当前消息草稿，不会自动发送。
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close prompt templates"
                  onClick={() => setPromptTemplateDrawerOpen(false)}
                  className="rounded p-2 text-slate-500 hover:bg-slate-800 hover:text-white"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </header>
              <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
                {promptTemplateLoading ? (
                  <div className="py-10 text-center font-mono text-xs text-slate-500">
                    LOADING TEMPLATES…
                  </div>
                ) : null}
                {promptTemplateError ? (
                  <div
                    role="alert"
                    className="rounded border border-rose-900/50 bg-rose-950/20 px-3 py-2 text-xs text-rose-200"
                  >
                    {promptTemplateError}
                  </div>
                ) : null}
                {!promptTemplateLoading &&
                !promptTemplateError &&
                promptTemplates.length === 0 ? (
                  <div className="rounded border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">
                    No templates yet. Create them from User Profile / Prompt
                    Template.
                  </div>
                ) : null}
                {!promptTemplateLoading && !promptTemplateError
                  ? Object.entries(templatesByTag).map(([tag, templates]) => (
                      <section
                        key={tag}
                        className="mb-5 last:mb-0"
                        aria-label={`${tag} templates`}
                      >
                        <h5 className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold tracking-widest text-cyan-400">
                          <span className="h-px flex-1 bg-cyan-950" />
                          {tag}
                          <span className="h-px flex-1 bg-cyan-950" />
                        </h5>
                        <div className="space-y-2">
                          {templates.map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => appendPromptTemplate(template)}
                              className="w-full rounded-lg border border-slate-800 bg-[#03060C] p-3 text-left transition hover:border-cyan-700 hover:bg-cyan-950/20"
                            >
                              <div className="text-xs font-medium text-slate-200">
                                {template.desc || template.tag}
                              </div>
                              <div className="mt-1 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-slate-500">
                                {template.prompt}
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))
                  : null}
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}
      {a2aDialogOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[#020408]/80 p-4 backdrop-blur-sm"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="A2A agents"
            className="flex max-h-[min(720px,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#05080F] shadow-[0_25px_90px_rgba(0,0,0,0.68)]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
              <div>
                <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-cyan-400">
                  A2A AGENT CONTEXT
                </p>
                <h4 className="mt-1 text-sm font-semibold text-white">
                  {selectedA2AAgent ? selectedA2AAgent.name : "Active Agents"}
                </h4>
                <p className="mt-1 text-[11px] text-slate-500">
                  {selectedA2AAgent
                    ? "Inspect the available capability set for this agent."
                    : "Live registry snapshot; opening this window does not send a chat message."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Refresh A2A agents"
                  onClick={() => void loadA2AContext(true)}
                  disabled={a2aLoading || a2aRefreshing}
                  className="rounded border border-slate-800 bg-[#080C14] p-2 text-slate-400 transition hover:border-cyan-900/50 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Refresh A2A agents"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${a2aRefreshing ? "animate-spin" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  aria-label="Close A2A agents"
                  onClick={() => setA2ADialogOpen(false)}
                  className="rounded border border-slate-800 bg-[#080C14] p-2 text-slate-400 transition hover:border-slate-600 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
              {a2aLoading ? (
                <div className="py-14 text-center font-mono text-xs text-slate-500">
                  LOADING AGENT CONTEXT…
                </div>
              ) : null}
              {a2aError ? (
                <div
                  role="alert"
                  className="rounded border border-rose-900/50 bg-rose-950/20 px-3 py-2 text-xs text-rose-200"
                >
                  {a2aError}
                </div>
              ) : null}
              {!a2aLoading && !a2aError && a2aContext?.refresh_error ? (
                <div
                  role="alert"
                  className="mb-4 rounded border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200"
                >
                  Showing the last successful snapshot. Refresh failed:{" "}
                  {a2aContext.refresh_error}
                </div>
              ) : null}
              {!a2aLoading && !a2aError && selectedA2AAgent ? (
                <div className="space-y-5">
                  <button
                    type="button"
                    aria-label="Back to agents"
                    onClick={() => setSelectedA2AAgent(null)}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-800 bg-[#080C14] px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-cyan-900/50 hover:text-cyan-300"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to agents
                  </button>
                  <div className="grid gap-3 rounded-lg border border-slate-800 bg-[#03060C] p-4 sm:grid-cols-2">
                    <div>
                      <p className="font-mono text-[10px] tracking-widest text-slate-500">
                        URL
                      </p>
                      <p className="mt-1 break-all text-xs text-slate-200">
                        {selectedA2AAgent.url || "Not provided"}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] tracking-widest text-slate-500">
                        STATUS
                      </p>
                      <p
                        className={`mt-1 text-xs font-semibold ${selectedA2AAgent.available ? "aegis-status-text--success" : "aegis-status-text--warning"}`}
                      >
                        {selectedA2AAgent.status || "unknown"} ·{" "}
                        {selectedA2AAgent.available
                          ? "available"
                          : "unavailable"}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="font-mono text-[10px] tracking-widest text-slate-500">
                        DESCRIPTION
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-300">
                        {selectedA2AAgent.description ||
                          "No description provided."}
                      </p>
                    </div>
                    {selectedA2AAgent.error ? (
                      <div className="sm:col-span-2 rounded border border-rose-900/50 bg-rose-950/20 px-3 py-2 text-xs text-rose-200">
                        {selectedA2AAgent.error}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-cyan-400">
                      CAPABILITIES · {selectedA2AAgent.capabilities.length}
                    </p>
                    {selectedA2AAgent.capabilities.length === 0 ? (
                      <p className="mt-3 rounded border border-dashed border-slate-700 p-4 text-xs text-slate-500">
                        No capabilities were published by this agent.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {selectedA2AAgent.capabilities.map(
                          (capability, index) => (
                            <li
                              key={`${capability}-${index}`}
                              className="rounded border border-slate-800 bg-[#03060C] px-3 py-2 text-xs leading-relaxed text-slate-300"
                            >
                              {capability}
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
              {!a2aLoading &&
              !a2aError &&
              !selectedA2AAgent &&
              a2aContext &&
              a2aContext.agents.length === 0 ? (
                <div className="rounded border border-dashed border-slate-700 p-8 text-center text-xs text-slate-500">
                  No active A2A agents are available in the current registry
                  snapshot.
                </div>
              ) : null}
              {!a2aLoading &&
              !a2aError &&
              !selectedA2AAgent &&
              a2aContext &&
              a2aContext.agents.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {a2aContext.agents.map((agent) => (
                    <button
                      key={`${agent.name}-${agent.url || ""}`}
                      type="button"
                      aria-label={`View agent ${agent.name}`}
                      onClick={() => setSelectedA2AAgent(agent)}
                      className="aegis-a2a-agent-card group flex min-h-44 flex-col rounded-lg p-4 text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm font-semibold text-white group-hover:text-cyan-200">
                          {agent.name}
                        </span>
                        <span
                          className={`aegis-status-badge ${agent.available ? "aegis-status-badge--success" : "aegis-status-badge--warning"}`}
                        >
                          {agent.available ? "available" : "unavailable"}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-400">
                        {agent.description || "No description provided."}
                      </p>
                      <div className="mt-auto flex items-center justify-between border-t border-slate-800 pt-3 font-mono text-[10px] text-slate-500">
                        <span>{agent.status || "unknown"}</span>
                        <span>{agent.capabilities.length} capabilities</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
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
