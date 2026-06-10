import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import OverviewTab from './components/OverviewTab';
import ChatTab from './components/ChatTab';
import AgentTab from './components/AgentTab';
import PolicyTab from './components/PolicyTab';
import { initialAgents, initialRules } from './data/mockData';
import { Agent, RoutingRule } from './types';
import { Settings, Bell } from 'lucide-react';

const getUtcTimestamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [currentUtcTime, setCurrentUtcTime] = useState<string>(() => getUtcTimestamp());

  // Lift state for active agents & rules so CRUD updates reflect globally
  const [agents, setAgents] = useState<Agent[]>(() => {
    const saved = localStorage.getItem('aegis_agents');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return initialAgents; }
    }
    return initialAgents;
  });

  const [rules, setRules] = useState<RoutingRule[]>(() => {
    const saved = localStorage.getItem('aegis_rules');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return initialRules; }
    }
    return initialRules;
  });

  // Persist lifts to local storage
  useEffect(() => {
    localStorage.setItem('aegis_agents', JSON.stringify(agents));
  }, [agents]);

  useEffect(() => {
    localStorage.setItem('aegis_rules', JSON.stringify(rules));
  }, [rules]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentUtcTime(getUtcTimestamp());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex h-screen w-screen bg-[#020408] text-slate-300 overflow-hidden font-sans select-none antialiased border border-slate-800">
      
      {/* Sidebar navigation */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main viewport Container */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 bg-[#020408] relative">
        
        {/* Dynamic header row */}
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-[#03060C] shrink-0 select-none z-20">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-mono text-slate-500">PATH: ROOT/{activeTab.toUpperCase()}</span>
            <span className="h-4 w-px bg-slate-800"></span>
            <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/30 px-2 py-0.5 border border-emerald-900/30 rounded flex items-center gap-1.5 font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              LIVE_SYNC: CONNECTED
            </span>
          </div>
          
          <div className="flex items-center gap-4 select-none">
            <div className="hidden md:flex items-center gap-1.5 text-[11px] font-mono text-slate-400 bg-[#05080F] px-2.5 py-1 border border-slate-800 rounded shadow-inner">
              <span className="text-cyan-400 font-bold">UTC:</span>
              <span className="text-white">{currentUtcTime}</span>
            </div>
            
            <div className="flex items-center gap-2.5">
              <button 
                title="Notifications panel"
                className="p-1.5 bg-[#05080F] hover:bg-[#080C14] rounded border border-slate-800 text-slate-400 hover:text-cyan-400 transition-all relative shrink-0"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 absolute -top-0.5 -right-0.5 shadow-[0_0_6px_#f43f5e]" />
                <Bell className="h-4 w-4" />
              </button>
              <button 
                title="Configure platform settings"
                className="p-1.5 bg-[#05080F] hover:bg-[#080C14] rounded border border-slate-800 text-slate-400 hover:text-cyan-400 transition-all shrink-0"
              >
                <Settings className="h-4 w-4" />
              </button>
              
              <div className="flex items-center gap-2.5 border-l border-slate-800 pl-3">
                <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-slate-700 to-slate-900 border border-slate-600 p-[1px] flex items-center justify-center font-mono text-[10px] font-bold text-white shrink-0">
                  AD
                </div>
                <div className="hidden sm:block text-left text-[11px] leading-tight">
                  <div className="font-bold text-white">Amber SOC Security</div>
                  <div className="text-[9px] text-[#22d3ee] font-mono mt-0.5">Super Admin</div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Viewport contents */}
        <main className="flex-1 overflow-hidden flex flex-col relative bg-[#020408]" id="main-content-viewport">
          {activeTab === 'overview' && (
            <OverviewTab agents={agents} currentUtcTime={currentUtcTime} setTab={setActiveTab} />
          )}
          {activeTab === 'chat' && (
            <ChatTab agents={agents} />
          )}
          {activeTab === 'orchestration' && (
            <AgentTab agents={agents} setAgents={setAgents} />
          )}
          {activeTab === 'policy' && (
            <PolicyTab agents={agents} rules={rules} setRules={setRules} />
          )}
        </main>
      </div>

    </div>
  );
}
