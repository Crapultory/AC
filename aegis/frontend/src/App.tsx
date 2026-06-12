import { useEffect, useState } from 'react';
import { Bell, Settings } from 'lucide-react';
import Sidebar from './components/Sidebar';
import OverviewTab from './components/OverviewTab';
import ChatTab from './components/ChatTab';
import AgentTab from './components/AgentTab';
import PolicyTab from './components/PolicyTab';
import LoginScreen from './components/LoginScreen';
import { clearStoredToken, hasStoredToken, setStoredToken } from './lib/auth';
import { fetchJSON, ApiError } from './lib/api';
import {
  BackendAgent,
  BackendAgentList,
  BackendRoutingRule,
  BackendRoutingRuleList,
  backendAgentToUi,
  backendRuleToUi,
  uiAgentDraftToApi,
  uiRoutingDraftToApi,
} from './lib/adapters';
import { Agent, AgentDraft, RoutingRule, RoutingRuleDraft } from './types';

type AppTab = 'overview' | 'chat' | 'orchestration' | 'policy';

const TAB_TO_PATH: Record<AppTab, string> = {
  overview: '/overview',
  chat: '/chat',
  orchestration: '/orchestration',
  policy: '/policy',
};

const getUtcTimestamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function resolveTabFromPath(pathname: string): AppTab | null {
  if (pathname === '/login') {
    return null;
  }
  if (pathname === '/chat') {
    return 'chat';
  }
  if (pathname === '/orchestration') {
    return 'orchestration';
  }
  if (pathname === '/policy') {
    return 'policy';
  }
  return 'overview';
}

function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((left, right) => left.id.localeCompare(right.id));
}

function sortRules(rules: RoutingRule[]): RoutingRule[] {
  return [...rules]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((rule, index) => ({ ...rule, priority: index + 1 }));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(() => resolveTabFromPath(window.location.pathname) || 'overview');
  const [currentUtcTime, setCurrentUtcTime] = useState<string>(() => getUtcTimestamp());
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentUtcTime(getUtcTimestamp());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextTab = resolveTabFromPath(window.location.pathname);
      if (nextTab) {
        setActiveTab(nextTab);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    async function bootstrap() {
      setIsBootstrapping(true);
      setAuthError('');
      setSyncError('');

      if (!hasStoredToken()) {
        setIsAuthenticated(false);
        if (window.location.pathname !== '/login') {
          window.history.replaceState({}, '', '/login');
        }
        setIsBootstrapping(false);
        return;
      }

      try {
        const session = await fetchJSON<{ authenticated: boolean }>(
          '/api/auth/session',
        );
        if (!session.authenticated) {
          clearStoredToken();
          setIsAuthenticated(false);
          window.history.replaceState({}, '', '/login');
          setIsBootstrapping(false);
          return;
        }

        setIsAuthenticated(true);
        await loadConsoleData();
        const nextTab = resolveTabFromPath(window.location.pathname);
        if (nextTab) {
          setActiveTab(nextTab);
        } else {
          setActiveTab('overview');
          window.history.replaceState({}, '', '/overview');
        }
      } catch (error) {
        clearStoredToken();
        setIsAuthenticated(false);
        setAuthError(error instanceof Error ? error.message : 'Authentication failed.');
        window.history.replaceState({}, '', '/login');
      } finally {
        setIsBootstrapping(false);
      }
    }

    void bootstrap();
  }, []);

  async function loadConsoleData() {
    setIsSyncing(true);
    setSyncError('');
    try {
      const [agentResponse, routingResponse] = await Promise.all([
        fetchJSON<BackendAgentList>('/api/agents'),
        fetchJSON<BackendRoutingRuleList>('/api/routing/global'),
      ]);

      setAgents(sortAgents(agentResponse.agents.map(backendAgentToUi)));
      setRules(sortRules(routingResponse.rules.map(backendRuleToUi)));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      setSyncError(error instanceof Error ? error.message : 'Failed to sync Aegis console data.');
    } finally {
      setIsSyncing(false);
    }
  }

  function navigateTo(tab: AppTab) {
    setActiveTab(tab);
    if (window.location.pathname !== TAB_TO_PATH[tab]) {
      window.history.pushState({}, '', TAB_TO_PATH[tab]);
    }
  }

  function handleAuthExpired() {
    clearStoredToken();
    setIsAuthenticated(false);
    setAgents([]);
    setRules([]);
    setAuthError('Session expired. Please sign in again.');
    window.history.replaceState({}, '', '/login');
  }

  async function handleLogin(token: string) {
    setAuthPending(true);
    setAuthError('');

    try {
      const response = await fetchJSON<{ authenticated: boolean }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ token }),
        },
        false,
      );
      if (!response.authenticated) {
        setAuthError('Token validation failed.');
        return;
      }

      setStoredToken(token);
      setIsAuthenticated(true);
      await loadConsoleData();
      navigateTo('overview');
    } catch (error) {
      setAuthError('Authentication failed. Please verify your token.');
    } finally {
      setAuthPending(false);
    }
  }

  async function handleCreateAgent(draft: AgentDraft) {
    try {
      const created = await fetchJSON<BackendAgent>(
        `/api/agents/${encodeURIComponent(draft.agentId)}`,
        {
          method: 'POST',
          body: JSON.stringify(uiAgentDraftToApi(draft)),
        },
      );
      setAgents((current) => sortAgents([...current, backendAgentToUi(created)]));
      setSyncError('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      throw error;
    }
  }

  async function handleUpdateAgent(agentId: string, draft: AgentDraft) {
    try {
      const updated = await fetchJSON<BackendAgent>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify(uiAgentDraftToApi(draft)),
        },
      );
      setAgents((current) =>
        sortAgents(current.map((agent) => (agent.id === agentId ? backendAgentToUi(updated) : agent))),
      );
      setSyncError('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      throw error;
    }
  }

  async function handleDeleteAgent(agentId: string) {
    try {
      await fetchJSON<{ deleted: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        { method: 'DELETE' },
      );
      setAgents((current) => current.filter((agent) => agent.id !== agentId));
      setSyncError('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      throw error;
    }
  }

  async function handleCreateRule(draft: RoutingRuleDraft) {
    try {
      const created = await fetchJSON<BackendRoutingRule>(
        '/api/routing/global',
        {
          method: 'POST',
          body: JSON.stringify(uiRoutingDraftToApi(draft)),
        },
      );
      setRules((current) => sortRules([...current, backendRuleToUi(created, current.length)]));
      setSyncError('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      throw error;
    }
  }

  async function handleUpdateRule(ruleId: string, draft: RoutingRuleDraft) {
    try {
      const updated = await fetchJSON<BackendRoutingRule>(
        `/api/routing/global/${encodeURIComponent(ruleId)}`,
        {
          method: 'PUT',
          body: JSON.stringify(uiRoutingDraftToApi(draft)),
        },
      );
      setRules((current) =>
        sortRules(current.map((rule, index) => (rule.id === ruleId ? backendRuleToUi(updated, index) : rule))),
      );
      setSyncError('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      throw error;
    }
  }

  async function handleDeleteRule(ruleId: string) {
    try {
      await fetchJSON<{ deleted: boolean }>(
        `/api/routing/global/${encodeURIComponent(ruleId)}`,
        { method: 'DELETE' },
      );
      setRules((current) => sortRules(current.filter((rule) => rule.id !== ruleId)));
      setSyncError('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      throw error;
    }
  }

  if (isBootstrapping) {
    return (
      <div className="min-h-screen bg-[#020408] text-slate-300 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
          <p className="mt-4 text-sm font-mono text-slate-500">Bootstrapping Aegis Console...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        error={authError}
        onSubmit={handleLogin}
        pending={authPending}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden border border-slate-800 bg-[#020408] font-sans text-slate-300 antialiased select-none">
      <Sidebar activeTab={activeTab} setActiveTab={navigateTo} />

      <div className="relative flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-[#020408]">
        <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-[#03060C] px-6">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-mono text-slate-500">PATH: ROOT/{activeTab.toUpperCase()}</span>
            <span className="h-4 w-px bg-slate-800" />
            <span className={`flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-mono font-bold ${
              syncError
                ? 'border-amber-900/30 bg-amber-950/30 text-amber-400'
                : 'border-emerald-900/30 bg-emerald-950/30 text-emerald-400'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${syncError ? 'bg-amber-400' : 'bg-emerald-500 animate-pulse'}`} />
              {isSyncing ? 'LIVE_SYNC: SYNCING' : syncError ? 'LIVE_SYNC: DEGRADED' : 'LIVE_SYNC: CONNECTED'}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-1.5 rounded border border-slate-800 bg-[#05080F] px-2.5 py-1 font-mono text-[11px] text-slate-400 shadow-inner md:flex">
              <span className="font-bold text-cyan-400">UTC:</span>
              <span className="text-white">{currentUtcTime}</span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                title="Notifications panel"
                className="relative shrink-0 rounded border border-slate-800 bg-[#05080F] p-1.5 text-slate-400 transition-all hover:bg-[#080C14] hover:text-cyan-400"
              >
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_6px_#f43f5e]" />
                <Bell className="h-4 w-4" />
              </button>
              <button
                title="Configure platform settings"
                className="shrink-0 rounded border border-slate-800 bg-[#05080F] p-1.5 text-slate-400 transition-all hover:bg-[#080C14] hover:text-cyan-400"
              >
                <Settings className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-2.5 border-l border-slate-800 pl-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-gradient-to-tr from-slate-700 to-slate-900 p-[1px] font-mono text-[10px] font-bold text-white">
                  AD
                </div>
                <div className="hidden text-left text-[11px] leading-tight sm:block">
                  <div className="font-bold text-white">Amber SOC Security</div>
                  <div className="mt-0.5 text-[9px] font-mono text-[#22d3ee]">Super Admin</div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="relative flex flex-1 flex-col overflow-hidden bg-[#020408]" id="main-content-viewport">
          {syncError ? (
            <div className="border-b border-amber-900/30 bg-amber-950/20 px-6 py-3 text-sm text-amber-300">
              {syncError}
            </div>
          ) : null}
          {activeTab === 'overview' && (
            <OverviewTab agents={agents} currentUtcTime={currentUtcTime} setTab={navigateTo} />
          )}
          {activeTab === 'chat' && (
            <ChatTab agents={agents} />
          )}
          {activeTab === 'orchestration' && (
            <AgentTab
              agents={agents}
              busy={isSyncing}
              onCreate={handleCreateAgent}
              onDelete={handleDeleteAgent}
              onRefresh={loadConsoleData}
              onUpdate={handleUpdateAgent}
            />
          )}
          {activeTab === 'policy' && (
            <PolicyTab
              busy={isSyncing}
              onCreate={handleCreateRule}
              onDelete={handleDeleteRule}
              onRefresh={loadConsoleData}
              onUpdate={handleUpdateRule}
              rules={rules}
            />
          )}
        </main>
      </div>
    </div>
  );
}
