export type AgentStatus = 'Active' | 'Idle' | 'Offline';
export type RoutingRuleStatus = 'Enabled' | 'Disabled';

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
  agentName: string;
  type: 'agent' | 'vip_tool';
  status: 'Completed' | 'Processing' | 'Pending' | 'Failed';
  message: string;
  timestamp: string;
}

export interface Message {
  id: string;
  sender: 'user' | 'aegis' | string;
  text: string;
  timestamp: string;
  chainSteps?: ChainStep[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  timestamp: string;
}
