import { useEffect, useMemo, useState } from 'react';
import { Bell, ChevronDown, KeyRound, LogOut, Settings } from 'lucide-react';
import Sidebar from './components/Sidebar';
import OverviewTab from './components/OverviewTab';
import ChatTab from './components/ChatTab';
import AgentTab from './components/AgentTab';
import PolicyTab from './components/PolicyTab';
import LoginScreen from './components/LoginScreen';
import RegisterScreen from './components/RegisterScreen';
import UserManagementTab from './components/UserManagementTab';
import ChangePasswordDialog from './components/ChangePasswordDialog';
import { AegisChatProvider, useAegisChatRuntime } from './lib/chatRuntime';
import { clearStoredAuth, getStoredUser, hasStoredToken, setStoredAuth, setStoredUser } from './lib/auth';
import { fetchJSON, ApiError, alertApiError, getApiErrorMessage } from './lib/api';
import {
  BackendAgent,
  BackendAgentList,
  BackendOverviewAgentList,
  BackendRoutingRule,
  BackendRoutingRuleList,
  backendAgentToUi,
  backendRuleToUi,
  uiAgentDraftToApi,
  uiRoutingDraftToApi,
} from './lib/adapters';
import { Agent, AgentDraft, AuthenticatedUser, RoutingRule, RoutingRuleDraft, UserDraft } from './types';

type AppTab = 'overview' | 'chat' | 'orchestration' | 'policy' | 'users';

type AuthLoginResponse = {
  authenticated: boolean;
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthenticatedUser;
};

type AuthSessionResponse = {
  authenticated: boolean;
  expires_in?: number;
  user?: AuthenticatedUser | null;
};

type BackendUserList = {
  users: AuthenticatedUser[];
};

const TAB_TO_PATH: Record<AppTab, string> = {
  overview: '/overview',
  chat: '/chat',
  orchestration: '/orchestration',
  policy: '/policy',
  users: '/users',
};

function isAdminOnlyTab(tab: AppTab | null): boolean {
  return tab === 'orchestration' || tab === 'policy' || tab === 'users';
}

const getUtcTimestamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function resolveTabFromPath(pathname: string): AppTab | null {
  if (pathname === '/login' || pathname === '/register') {
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
  if (pathname === '/users') {
    return 'users';
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

function sortUsers(users: AuthenticatedUser[]): AuthenticatedUser[] {
  return [...users].sort((left, right) => left.username.localeCompare(right.username));
}

function getInitials(user?: AuthenticatedUser | null): string {
  const username = user?.username?.trim() || 'AU';
  return username.slice(0, 2).toUpperCase();
}

function getUserRoleLabel(user?: AuthenticatedUser | null): string {
  return user?.is_admin ? 'Administrator' : 'User';
}

function AuthenticatedAppShell({
  activeTab,
  agents,
  currentUser,
  currentUtcTime,
  isSyncing,
  navigateTo,
  onChangePassword,
  onCreateAgent,
  onCreateRule,
  onCreateUser,
  onDeleteAgent,
  onDeleteRule,
  onDeleteUser,
  onLogout,
  onRefresh,
  onResetUserPassword,
  onToggleUserStatus,
  onUpdateAgent,
  onUpdateRule,
  overviewAgents,
  rules,
  syncError,
  users,
}: {
  activeTab: AppTab;
  agents: Agent[];
  currentUser: AuthenticatedUser;
  currentUtcTime: string;
  isSyncing: boolean;
  navigateTo: (tab: AppTab) => void;
  onChangePassword: () => void;
  onCreateAgent: (draft: AgentDraft) => Promise<void>;
  onCreateRule: (draft: RoutingRuleDraft) => Promise<void>;
  onCreateUser: (draft: UserDraft) => Promise<void>;
  onDeleteAgent: (agentId: string) => Promise<void>;
  onDeleteRule: (ruleId: string) => Promise<void>;
  onDeleteUser: (uid: string) => Promise<void>;
  onLogout: () => void;
  onRefresh: () => Promise<void>;
  onResetUserPassword: (uid: string, password: string) => Promise<void>;
  onToggleUserStatus: (uid: string, status: 'enabled' | 'disabled') => Promise<void>;
  onUpdateAgent: (agentId: string, draft: AgentDraft) => Promise<void>;
  onUpdateRule: (ruleId: string, draft: RoutingRuleDraft) => Promise<void>;
  overviewAgents: Agent[];
  rules: RoutingRule[];
  syncError: string;
  users: AuthenticatedUser[];
}) {
  const { chatAttentionCount } = useAegisChatRuntime();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = currentUser.is_admin;

  useEffect(() => {
    setMenuOpen(false);
  }, [activeTab]);

  return (
    <div className="flex h-screen w-screen overflow-hidden border border-slate-800 bg-[#020408] font-sans text-slate-300 antialiased">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={(tab) => navigateTo(tab as AppTab)}
        chatAttentionCount={chatAttentionCount}
        isAdmin={isAdmin}
      />

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

              <div className="relative flex items-center gap-2.5 border-l border-slate-800 pl-3">
                <button
                  type="button"
                  aria-label="User Menu"
                  onClick={() => setMenuOpen((current) => !current)}
                  className="flex items-center gap-2 rounded-xl border border-slate-800 bg-[#05080F] px-2.5 py-1.5 text-left transition hover:border-cyan-500"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-gradient-to-tr from-slate-700 to-slate-900 p-[1px] font-mono text-[10px] font-bold text-white">
                    {getInitials(currentUser)}
                  </div>
                  <div className="hidden text-left text-[11px] leading-tight sm:block">
                    <div className="font-bold text-white">{currentUser.username}</div>
                    <div className="mt-0.5 text-[9px] font-mono text-[#22d3ee]">
                      {getUserRoleLabel(currentUser)}
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                </button>

                {menuOpen ? (
                  <div className="absolute right-0 top-12 z-30 w-56 rounded-2xl border border-slate-800 bg-[#05080F] p-2 shadow-2xl">
                    <div className="border-b border-slate-800 px-3 py-2">
                      <div className="text-sm font-semibold text-white">{currentUser.username}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{currentUser.email}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onChangePassword();
                      }}
                      className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-300 transition hover:bg-[#080C14] hover:text-white"
                    >
                      <KeyRound className="h-4 w-4" />
                      Change Password
                    </button>
                    <button
                      type="button"
                      onClick={onLogout}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-300 transition hover:bg-rose-950/30"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="relative flex flex-1 flex-col overflow-hidden bg-[#020408]" id="main-content-viewport">
          {activeTab === 'overview' ? (
            <OverviewTab
              agents={overviewAgents}
              currentUtcTime={currentUtcTime}
              isAdmin={isAdmin}
              setTab={(tab) => navigateTo(tab as AppTab)}
            />
          ) : null}
          {activeTab === 'chat' ? <ChatTab agents={agents} /> : null}
          {activeTab === 'orchestration' ? (
            <AgentTab
              agents={agents}
              busy={isSyncing}
              onCreate={onCreateAgent}
              onDelete={onDeleteAgent}
              onRefresh={onRefresh}
              onUpdate={onUpdateAgent}
            />
          ) : null}
          {activeTab === 'policy' ? (
            <PolicyTab
              busy={isSyncing}
              onCreate={onCreateRule}
              onDelete={onDeleteRule}
              onRefresh={onRefresh}
              onUpdate={onUpdateRule}
              rules={rules}
            />
          ) : null}
          {activeTab === 'users' ? (
            <UserManagementTab
              busy={isSyncing}
              onCreate={onCreateUser}
              onDelete={onDeleteUser}
              onRefresh={onRefresh}
              onResetPassword={onResetUserPassword}
              onUpdateStatus={onToggleUserStatus}
              users={users}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [currentUtcTime, setCurrentUtcTime] = useState<string>(() => getUtcTimestamp());
  const [agents, setAgents] = useState<Agent[]>([]);
  const [overviewAgents, setOverviewAgents] = useState<Agent[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [users, setUsers] = useState<AuthenticatedUser[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(() => getStoredUser());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [authPending, setAuthPending] = useState(false);
  const [registerPending, setRegisterPending] = useState(false);
  const [passwordPending, setPasswordPending] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [syncError, setSyncError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  const activeTab = useMemo(() => resolveTabFromPath(pathname) || 'overview', [pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentUtcTime(getUtcTimestamp());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setPathname(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    async function bootstrap() {
      setIsBootstrapping(true);
      setSyncError('');

      if (!hasStoredToken()) {
        setIsAuthenticated(false);
        if (window.location.pathname !== '/register') {
          window.history.replaceState({}, '', '/login');
          setPathname('/login');
        }
        setIsBootstrapping(false);
        return;
      }

      try {
        const session = await fetchJSON<AuthSessionResponse>('/api/auth/session');
        if (!session.authenticated || !session.user) {
          clearStoredAuth();
          setCurrentUser(null);
          setIsAuthenticated(false);
          window.history.replaceState({}, '', '/login');
          setPathname('/login');
          setIsBootstrapping(false);
          return;
        }

        setStoredUser(session.user);
        setCurrentUser(session.user);
        setIsAuthenticated(true);
        await loadConsoleData(session.user);

        const nextTab = resolveTabFromPath(window.location.pathname);
        if (window.location.pathname === '/login' || window.location.pathname === '/register') {
          window.history.replaceState({}, '', '/overview');
          setPathname('/overview');
        } else {
          setPathname(window.location.pathname);
        }
      } catch (error) {
        clearStoredAuth();
        setCurrentUser(null);
        setIsAuthenticated(false);
        alertApiError(error, 'Authentication failed.');
        window.history.replaceState({}, '', '/login');
        setPathname('/login');
      } finally {
        setIsBootstrapping(false);
      }
    }

    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!currentUser || currentUser.is_admin) {
      return;
    }

    const requestedTab = resolveTabFromPath(pathname);
    if (!isAdminOnlyTab(requestedTab)) {
      return;
    }

    window.alert('Admin access required.');
    window.history.replaceState({}, '', TAB_TO_PATH.overview);
    setPathname(TAB_TO_PATH.overview);
  }, [currentUser, pathname]);

  async function loadConsoleData(userOverride?: AuthenticatedUser | null) {
    const activeUser = userOverride ?? currentUser;
    if (!activeUser) {
      return;
    }

    setIsSyncing(true);
    setSyncError('');
    try {
      const overviewResponse = await fetchJSON<BackendOverviewAgentList>('/api/overview/agents');
      setOverviewAgents(sortAgents(overviewResponse.agents.map(backendAgentToUi)));

      if (!activeUser.is_admin) {
        setAgents([]);
        setRules([]);
        setUsers([]);
        return;
      }

      const [agentResponse, routingResponse, userResponse] = await Promise.all([
        fetchJSON<BackendAgentList>('/api/agents'),
        fetchJSON<BackendRoutingRuleList>('/api/routing/global'),
        fetchJSON<BackendUserList>('/api/users'),
      ]);

      setAgents(sortAgents(agentResponse.agents.map(backendAgentToUi)));
      setRules(sortRules(routingResponse.rules.map(backendRuleToUi)));
      setUsers(sortUsers(userResponse.users));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      setSyncError(getApiErrorMessage(error, 'Failed to sync Aegis console data.'));
      alertApiError(error, 'Failed to sync Aegis console data.');
    } finally {
      setIsSyncing(false);
    }
  }

  function navigateTo(tab: AppTab) {
    if (isAdminOnlyTab(tab) && !currentUser?.is_admin) {
      window.alert('Admin access required.');
      tab = 'overview';
    }
    const nextPath = TAB_TO_PATH[tab];
    setPathname(nextPath);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
  }

  function navigateAuth(path: '/login' | '/register') {
    setPathname(path);
    if (window.location.pathname !== path) {
      window.history.replaceState({}, '', path);
    }
  }

  function handleAuthExpired() {
    clearStoredAuth();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setAgents([]);
    setOverviewAgents([]);
    setRules([]);
    setUsers([]);
    setAuthNotice('');
    navigateAuth('/login');
  }

  async function handleLogin(username: string, password: string) {
    setAuthPending(true);
    setAuthNotice('');

    try {
      const response = await fetchJSON<AuthLoginResponse>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        },
        false,
      );

      setStoredAuth(response.access_token, response.user);
      setCurrentUser(response.user);
      setIsAuthenticated(true);
      await loadConsoleData(response.user);
      navigateTo('overview');
    } catch (error) {
      alertApiError(error, 'Authentication failed.');
    } finally {
      setAuthPending(false);
    }
  }

  async function handleRegister(username: string, password: string, email: string) {
    setRegisterPending(true);
    setAuthNotice('');
    try {
      await fetchJSON<{ registered: boolean }>(
        '/api/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ username, password, email }),
        },
        false,
      );
      setAuthNotice('Registration submitted. Wait for an administrator to enable your account.');
      navigateAuth('/login');
    } catch (error) {
      alertApiError(error, 'Registration failed.');
    } finally {
      setRegisterPending(false);
    }
  }

  function handleLogout() {
    clearStoredAuth();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setAgents([]);
    setOverviewAgents([]);
    setRules([]);
    setUsers([]);
    setShowPasswordDialog(false);
    navigateAuth('/login');
  }

  async function handleChangePassword(oldPassword: string, newPassword: string) {
    setPasswordPending(true);
    try {
      await fetchJSON<{ updated: boolean }>(
        '/api/auth/password',
        {
          method: 'PUT',
          body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
        },
      );
      setShowPasswordDialog(false);
      setAuthNotice('Password updated successfully.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      alertApiError(error, 'Failed to update password.');
    } finally {
      setPasswordPending(false);
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

  async function handleCreateUser(draft: UserDraft) {
    try {
      const created = await fetchJSON<AuthenticatedUser>(
        '/api/users',
        {
          method: 'POST',
          body: JSON.stringify(draft),
        },
      );
      setUsers((current) => sortUsers([...current, created]));
      setSyncError('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      throw error;
    }
  }

  async function handleDeleteUser(uid: string) {
    try {
      await fetchJSON<{ deleted: boolean }>(`/api/users/${encodeURIComponent(uid)}`, { method: 'DELETE' });
      setUsers((current) => sortUsers(current.filter((user) => user.uid !== uid)));
      setSyncError('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      throw error;
    }
  }

  async function handleToggleUserStatus(uid: string, status: 'enabled' | 'disabled') {
    try {
      const updated = await fetchJSON<AuthenticatedUser>(
        `/api/users/${encodeURIComponent(uid)}/status`,
        {
          method: 'PUT',
          body: JSON.stringify({ status }),
        },
      );
      setUsers((current) => sortUsers(current.map((user) => (user.uid === uid ? updated : user))));
      if (currentUser?.uid === uid) {
        setCurrentUser(updated);
        setStoredUser(updated);
      }
      setSyncError('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthExpired();
        return;
      }
      throw error;
    }
  }

  async function handleResetUserPassword(uid: string, password: string) {
    try {
      await fetchJSON<{ updated: boolean }>(
        `/api/users/${encodeURIComponent(uid)}/password`,
        {
          method: 'PUT',
          body: JSON.stringify({ password }),
        },
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

  if (!isAuthenticated || !currentUser) {
    if (pathname === '/register') {
      return (
        <RegisterScreen
          onSubmit={handleRegister}
          onSwitchToLogin={() => navigateAuth('/login')}
          pending={registerPending}
        />
      );
    }

    return (
      <LoginScreen
        notice={authNotice}
        onSubmit={handleLogin}
        onSwitchToRegister={() => navigateAuth('/register')}
        pending={authPending}
      />
    );
  }

  return (
    <>
      <ChangePasswordDialog
        open={showPasswordDialog}
        onClose={() => {
          setShowPasswordDialog(false);
        }}
        onSubmit={handleChangePassword}
        pending={passwordPending}
      />
      <AegisChatProvider isChatVisible={activeTab === 'chat'}>
        <AuthenticatedAppShell
          activeTab={activeTab}
          agents={agents}
          currentUser={currentUser}
          currentUtcTime={currentUtcTime}
          isSyncing={isSyncing}
          navigateTo={navigateTo}
          onChangePassword={() => setShowPasswordDialog(true)}
          onCreateAgent={handleCreateAgent}
          onCreateRule={handleCreateRule}
          onCreateUser={handleCreateUser}
          onDeleteAgent={handleDeleteAgent}
          onDeleteRule={handleDeleteRule}
          onDeleteUser={handleDeleteUser}
          onLogout={handleLogout}
          onRefresh={() => loadConsoleData(currentUser)}
          onResetUserPassword={handleResetUserPassword}
          onToggleUserStatus={handleToggleUserStatus}
          onUpdateAgent={handleUpdateAgent}
          onUpdateRule={handleUpdateRule}
          overviewAgents={overviewAgents}
          rules={rules}
          syncError={syncError}
          users={users}
        />
      </AegisChatProvider>
    </>
  );
}
