export interface Agent {
  id: string;
  name: string;
  type: 'agent' | 'vip_tool';
  description: string;
  status: 'Active' | 'Idle' | 'Offline';
  tasksCount: number;
  lastUpdated: string;
  skillDescription?: string; // For remote agent skills configuration
  a2aAddr?: string;
  authHeaderKey?: string;
  authHeaderValue?: string;
}

export interface RoutingRule {
  id: string;
  priority: number;
  ruleName: string;
  agentId: string; // The agent mapped by this rule
  conditions: string; // e.g. "Severity == Critical"
  actions: string; // e.g. "Assign to SOAR Agent"
  status: 'Enabled' | 'Disabled';
  updateTime: string;
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
