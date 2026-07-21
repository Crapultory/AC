export type AgentStatus = 'Active' | 'Idle' | 'Offline';
export type RoutingRuleStatus = 'Enabled' | 'Disabled';
export type UserStatus = 'enabled' | 'disabled';

export interface AuthenticatedUser {
  uid: string;
  username: string;
  email: string;
  status: UserStatus;
  create_time: string;
  last_login?: string | null;
  is_admin: boolean;
}

export interface UserDraft {
  username: string;
  password: string;
  email: string;
  status: UserStatus;
}

export interface Agent {
  id: string;
  name: string;
  type: 'agent' | 'vip_tool';
  description: string;
  status: AgentStatus;
  tasksCount: number;
  lastUpdated: string;
  skillDescription?: string;
  a2aAddr?: string;
  authHeaderKey?: string;
  authHeaderValue?: string;
  extCapabilities?: string[];
}

export interface RoutingRule {
  id: string;
  priority: number;
  ruleName: string;
  agentId: string;
  conditions: string;
  actions: string;
  status: RoutingRuleStatus;
  updateTime: string;
}

export interface AgentDraft {
  agentId: string;
  url: string;
  description: string;
  status: AgentStatus;
  authHeaderKey: string;
  authHeaderValue: string;
  extCapabilitiesText: string;
}

export interface RoutingRuleDraft {
  name: string;
  policy: string;
  status: RoutingRuleStatus;
}

export interface ChainStep {
  id?: string;
  agentName: string;
  type: 'agent' | 'vip_tool';
  status: 'Completed' | 'Processing' | 'Pending' | 'Failed';
  message: string;
  timestamp: string;
}

export interface DelegateToolCall {
  id: string;
  toolName: string;
  argsPreview: string;
  resultPreview?: string;
  status: 'running' | 'completed';
}

export type WorkflowTraceEventType =
  | 'message.accepted'
  | 'message.completed'
  | 'message.stream.completed'
  | 'tool.started'
  | 'tool.completed'
  | 'run.state'
  | 'delegate.entered'
  | 'delegate.exited';

export interface WorkflowTraceEvent {
  id: string;
  type: WorkflowTraceEventType;
  timestamp: number;
  turnId?: string;
  parentTurnId?: string;
  source: 'main' | 'delegate';
  srcagent?: string;
  clientMsgId?: string;
  messageId?: string;
  content?: string;
  toolName?: string;
  toolCallId?: string;
  argsPreview?: string;
  resultPreview?: string;
  childSessionId?: string;
  delegateId?: string;
  state?: string;
  reason?: string;
}

export type WorkflowGraphNodeKind = 'root' | 'input' | 'delegate' | 'tool' | 'end';
export type WorkflowGraphStatus = 'empty' | 'partial' | 'live' | 'complete';

export interface WorkflowGraphNode {
  id: string;
  kind: WorkflowGraphNodeKind;
  label: string;
  detail: string;
  status: string;
  source: 'main' | 'delegate';
  turnId?: string;
  parentId?: string;
  agent?: string;
  timestamp?: number;
  argsPreview?: string;
  resultPreview?: string;
  finalMessage?: string;
  x: number;
  y: number;
  depth: number;
}

export interface WorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  source: 'main' | 'delegate';
  label?: string;
}

export interface WorkflowGraph {
  rootId: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  status: WorkflowGraphStatus;
  width: number;
  height: number;
}

export interface Message {
  id: string;
  sender: 'user' | 'aegis' | string;
  text: string;
  timestamp: string;
  kind?: 'chat' | 'delegate-event' | 'delegate-tools' | 'main-tools';
  chainSteps?: ChainStep[];
  delegateTools?: DelegateToolCall[];
  source?: 'main' | 'delegate';
  srcagent?: string;
  turnId?: string;
  pending?: boolean;
  clientMsgId?: string;
  workflowParentId?: string;
}

export interface Conversation {
  id: string;
  sessionId?: string;
  title: string;
  messages: Message[];
  timestamp: string;
  lastUpdatedAt?: string;
  lastKnownRunState?: string;
  foregroundSource?: 'main' | 'delegate';
  foregroundAgentName?: string;
  liveChainTurnId?: string;
  liveChainSteps?: ChainStep[];
  pendingApproval?: {
    approvalId: string;
    command: string;
    description: string;
    choices: string[];
  } | null;
  pendingClarify?: {
    clarifyId: string;
    question: string;
    choices: string[];
    awaitingText: boolean;
  } | null;
  hasUnread?: boolean;
  transportState?: 'idle' | 'connecting' | 'connected' | 'error' | 'closed';
  workflowTraceVersion?: 1;
  workflowTrace?: WorkflowTraceEvent[];
}
