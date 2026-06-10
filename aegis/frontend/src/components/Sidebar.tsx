import { 
  LayoutDashboard, 
  MessageSquare, 
  Workflow, 
  Route, 
  FileText, 
  Sliders
} from 'lucide-react';
import aegisLogo from '../../logo/aegis-icon-brand-tile-color.svg';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  // Navigation item helper
  const navItems = [
    { id: 'overview', label: 'Overview', desc: '中控概览', icon: LayoutDashboard },
    { id: 'chat', label: 'Aegis Chat', desc: '智能智能对话', icon: MessageSquare },
    { id: 'orchestration', label: 'Agent Orchestration', desc: '工作智能体编排', icon: Workflow },
    { id: 'policy', label: 'Routing Policy', desc: '路由策略配置', icon: Route },
  ];

  const admins = [
    { label: 'System Settings', sub: '系统设置', icon: Sliders },
    { label: 'Audit Logs', sub: '审计日志', icon: FileText },
  ];

  return (
    <aside id="sidebar-container" className="w-64 bg-[#05080F] border-r border-slate-800 flex flex-col h-screen overflow-y-auto shrink-0 select-none scrollbar-thin">
      {/* Brand Header */}
      <div className="p-6 border-b border-slate-800 bg-[#05080F]">
        <div className="flex min-h-[72px] items-center gap-4">
          <div className="relative h-16 w-16 overflow-hidden rounded-2xl bg-[#09101B] border border-cyan-950/60 shadow-[0_0_22px_rgba(6,182,212,0.24)] shrink-0">
            <img
              id="aegis-logo-icon"
              src={aegisLogo}
              alt="Aegis logo"
              className="h-full w-full scale-[1.03] object-contain drop-shadow-[0_0_14px_rgba(6,182,212,0.38)]"
            />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-white uppercase italic leading-none">Aegis</span>
            <p className="text-[9px] text-slate-500 font-mono tracking-tighter uppercase mt-0.5">Unified Co-Pilot</p>
          </div>
        </div>
      </div>

      {/* Main Tab Links */}
      <div className="px-1.5 py-4 flex-1">
        <div className="text-[10px] font-mono tracking-widest text-slate-500 px-4 mb-2 uppercase font-bold">CORE MODULES</div>
        <div className="space-y-0.5 mb-6">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-all duration-150 group relative ${
                  isActive 
                    ? 'bg-[#080c14] border-l-2 border-cyan-500 text-cyan-400 font-medium' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-[#080C14] border-l-2 border-transparent'
                }`}
              >
                <Icon className={`h-4.5 w-4.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                <div className="flex-1">
                  <div className={`text-xs font-semibold tracking-wide ${isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-white'}`}>{item.label}</div>
                  <div className="text-[10px] text-slate-500 font-normal leading-tight mt-0.5">{item.desc}</div>
                </div>
                {isActive && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Section: Administration */}
        <div className="text-[10px] font-mono tracking-widest text-slate-500 px-4 mb-2 uppercase font-bold">ADMIN</div>
        <div className="space-y-0.5">
          {admins.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="group w-full px-4 py-2 flex items-center gap-3 text-slate-500 hover:text-slate-300 cursor-not-allowed text-left transition-colors duration-150"
              >
                <Icon className="h-4 w-4 shrink-0 text-slate-600 group-hover:text-cyan-500" />
                <div className="flex-1">
                  <div className="text-xs font-medium text-slate-400 group-hover:text-white">{item.label}</div>
                  <div className="text-[9px] text-slate-600 font-mono mt-0.5">{item.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* System Integrity & Footer Info */}
      <div className="p-6 border-t border-slate-800/50 bg-[#03060C] shrink-0">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-bold select-none">
          <span>System Integrity</span>
          <span className="text-emerald-500 font-mono">Secure</span>
        </div>
        <div className="h-1 bg-slate-800 rounded-full overflow-hidden mb-4">
          <div className="w-3/4 h-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
        </div>
        <div className="flex items-center gap-2.5">
          <img
            src={aegisLogo}
            alt="Aegis logo"
            className="h-4 w-4 shrink-0 object-contain"
          />
          <div className="overflow-hidden">
            <div className="text-[11px] font-bold text-white truncate leading-none">Aegis Hub</div>
            <div className="text-[9px] text-slate-500 font-mono truncate mt-1">v2.4.0-NEXUS</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
