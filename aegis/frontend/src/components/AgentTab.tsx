import React, { useState, useMemo } from 'react';
import { Agent } from '../types';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Layout, 
  Settings, 
  Activity, 
  Users, 
  CheckCircle, 
  AlertCircle,
  HelpCircle,
  X,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AgentTabProps {
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
}

export default function AgentTab({ agents, setAgents }: AgentTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // Form Fields
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'agent' | 'vip_tool'>('agent');
  const [formStatus, setFormStatus] = useState<'Active' | 'Idle' | 'Offline'>('Active');
  const [formDesc, setFormDesc] = useState('');
  const [formTasks, setFormTasks] = useState(0);
  const [formSkill, setFormSkill] = useState('');
  const [formA2aAddr, setFormA2aAddr] = useState('');
  const [formAuthHeaderKey, setFormAuthHeaderKey] = useState('Authorization');
  const [formAuthHeaderValue, setFormAuthHeaderValue] = useState('');

  // Count helper metrics
  const total = agents.length;
  const active = agents.filter(a => a.status === 'Active').length;
  const idle = agents.filter(a => a.status === 'Idle').length;
  const offline = agents.filter(a => a.status === 'Offline').length;

  // Filter logic
  const filtered = useMemo(() => {
    return agents.filter(a => {
      const matchSearch = a.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          a.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (a.skillDescription && a.skillDescription.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchStatus = statusFilter === 'All' || a.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [agents, searchTerm, statusFilter]);

  const handleOpenCreateModal = () => {
    setEditingAgent(null);
    setFormName('');
    setFormType('agent');
    setFormStatus('Active');
    setFormDesc('');
    setFormTasks(0);
    setFormSkill('');
    setFormA2aAddr('');
    setFormAuthHeaderKey('Authorization');
    setFormAuthHeaderValue('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (agent: Agent) => {
    setEditingAgent(agent);
    setFormName(agent.name);
    setFormType(agent.type);
    setFormStatus(agent.status);
    setFormDesc(agent.description);
    setFormTasks(agent.tasksCount);
    setFormSkill(agent.skillDescription || '');
    setFormA2aAddr(agent.a2aAddr || '');
    setFormAuthHeaderKey(agent.authHeaderKey || 'Authorization');
    setFormAuthHeaderValue(agent.authHeaderValue || '');
    setIsModalOpen(true);
  };

  const handleDeleteAgent = (id: string) => {
    if (window.confirm('Delete this agent? (确定删除该工作智能体吗？此操作不可逆)')) {
      setAgents(prev => prev.filter(a => a.id !== id));
    }
  };

  const handleSaveAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formDesc.trim()) {
      alert('请填写智能体名称与基本功能描述！');
      return;
    }

    if (editingAgent) {
      // Edit mode
      setAgents(prev => prev.map(a => {
        if (a.id === editingAgent.id) {
          return {
            ...a,
            name: formName,
            type: formType,
            status: formStatus,
            description: formDesc,
            tasksCount: formTasks,
            skillDescription: formSkill,
            a2aAddr: formA2aAddr,
            authHeaderKey: formAuthHeaderKey,
            authHeaderValue: formAuthHeaderValue,
            lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          };
        }
        return a;
      }));
    } else {
      // Create mode
      const newAgent: Agent = {
        id: `agent-custom-${Date.now()}`,
        name: formName,
        type: formType,
        description: formDesc,
        status: formStatus,
        tasksCount: formTasks,
        skillDescription: formSkill || '无特定路由技能描述，将采用通用 fallback 路由。',
        a2aAddr: formA2aAddr,
        authHeaderKey: formAuthHeaderKey,
        authHeaderValue: formAuthHeaderValue,
        lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
      setAgents(prev => [newAgent, ...prev]);
    }

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 flex-1 overflow-y-auto p-6 scrollbar-thin select-none text-xs">
      {/* Top Controller Metric Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#05080F] border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-slate-500 font-mono text-[9px] uppercase tracking-wider font-bold">Total Registered</div>
            <div className="text-2xl font-black text-white font-mono mt-0.5">{total}</div>
          </div>
          <Users className="h-6 w-6 text-slate-500 opacity-60" />
        </div>
        <div className="bg-[#05080F] border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-emerald-400 font-mono text-[9px] uppercase tracking-wider font-bold">Active & Working</div>
            <div className="text-2xl font-black text-white font-mono mt-0.5">{active}</div>
          </div>
          <Activity className="h-6 w-6 text-emerald-400 opacity-60 animate-pulse" />
        </div>
        <div className="bg-[#05080F] border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-amber-400 font-mono text-[9px] uppercase tracking-wider font-bold">Idle Status</div>
            <div className="text-2xl font-black text-white font-mono mt-0.5">{idle}</div>
          </div>
          <CheckCircle className="h-6 w-6 text-amber-400 opacity-60" />
        </div>
        <div className="bg-[#05080F] border border-slate-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-rose-400 font-mono text-[9px] uppercase tracking-wider font-bold">Offline Status</div>
            <div className="text-2xl font-black text-white font-mono mt-0.5">{offline}</div>
          </div>
          <AlertCircle className="h-6 w-6 text-rose-500 opacity-60" />
        </div>
      </div>

      {/* Main Table Interface */}
      <div className="bg-[#05080F] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
        {/* Table filtering toolbar */}
        <div className="p-4 bg-[#03060C] border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 uppercase tracking-widest italic">
              Work Agent Register (工作智能体管理)
            </h3>
            <p className="text-[10px] text-slate-500">管理并配置部署在此协同底盘上的边缘智能体卡片、心跳、与其对应技能条件</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, description..."
                className="bg-[#020408] border border-slate-800 rounded px-3 py-1.5 pl-8 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700 w-60 font-mono"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-cyan-400 focus:outline-none focus:border-cyan-500 font-mono"
            >
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              <option value="Idle">Idle</option>
              <option value="Offline">Offline</option>
            </select>

            <button
              onClick={handleOpenCreateModal}
              className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-white rounded font-bold transition-all flex items-center gap-1 text-xs shrink-0 select-none shadow-[0_0_10px_rgba(6,182,212,0.3)] border-0"
            >
              <Plus className="h-3.5 w-3.5" /> 注册智能体
            </button>
          </div>
        </div>

        {/* The Grid / List view of Agents */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#03060C] border-b border-slate-800 text-slate-500 font-mono text-[9px] uppercase tracking-wider">
                <th className="p-3">Agent Name</th>
                <th className="p-3">Status</th>
                <th className="p-3">A2A Address</th>
                <th className="p-3">Base Functions</th>
                <th className="p-3">Remote Skill Rule</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 font-mono text-xs">
                    No matching work agents found.
                  </td>
                </tr>
              ) : (
                filtered.map((agent) => (
                  <tr key={agent.id} className="hover:bg-[#03060C]/60 transition-colors">
                    <td className="p-3 whitespace-nowrap min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          agent.status === 'Active' 
                            ? 'bg-[#10b981] shadow-[0_0_5px_rgba(16,185,129,0.5)]' 
                            : agent.status === 'Idle' 
                              ? 'bg-amber-400' 
                              : 'bg-slate-600'
                        }`} />
                        <div>
                          <div className="font-bold text-slate-200 text-xs">{agent.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">ID: {agent.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border uppercase ${
                        agent.status === 'Active' 
                          ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/40' 
                          : agent.status === 'Idle' 
                            ? 'bg-amber-950/20 text-amber-400 border-amber-900/40' 
                            : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}>
                        {agent.status}
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap font-mono text-xs text-cyan-400">
                      {agent.a2aAddr || `a2a://${agent.id}.aegis.local`}
                    </td>
                    <td className="p-3 max-w-xs">
                      <div className="text-slate-400 line-clamp-2 leading-relaxed">{agent.description}</div>
                    </td>
                    <td className="p-3 max-w-sm">
                      <div className="text-cyan-400 font-mono text-[10px] leading-relaxed line-clamp-2">
                        {agent.skillDescription || '--'}
                      </div>
                    </td>
                    <td className="p-3 text-center whitespace-nowrap">
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => handleOpenEditModal(agent)}
                          className="p-1 bg-[#080C14] border border-slate-800 rounded text-cyan-400 hover:text-cyan-300 hover:bg-slate-850 transition-all cursor-pointer"
                          title="Edit Agent details"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteAgent(agent.id)}
                          className="p-1 bg-rose-950/10 border border-rose-900/40 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 transition-all cursor-pointer"
                          title="Delete Agent profile"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CRUD Add/Edit Dialog modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-[#05080F] border border-slate-800 w-full max-w-lg rounded-xl overflow-hidden shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="bg-[#03060C] p-4 border-b border-slate-800/80 flex justify-between items-center">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  {editingAgent ? '编辑智能体配置' : '注册新网络安全智能体'}
                </h4>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 text-slate-500 hover:text-white rounded hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form Body */}
              <form onSubmit={handleSaveAgent} className="p-4 space-y-4 flex-1">
                <div className="grid grid-cols-2 gap-3.5">
                  {/* Name field */}
                  <div className="col-span-2 space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">智能体名称 (Agent Name) *</label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Host Privilege Analyzer"
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700 font-mono"
                    />
                  </div>

                  {/* A2A address field */}
                  <div className="col-span-2 space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">A2A 地址 (A2A Addr) *</label>
                    <input
                      type="text"
                      required
                      value={formA2aAddr}
                      onChange={(e) => setFormA2aAddr(e.target.value)}
                      placeholder="e.g. http://10.233.1.25:8080 or a2a://threat-analyzer"
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700 font-mono"
                    />
                  </div>

                  {/* HTTP Auth key name & default value */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">验证头字段 (Http Key Name)</label>
                    <input
                      type="text"
                      required
                      value={formAuthHeaderKey}
                      onChange={(e) => setFormAuthHeaderKey(e.target.value)}
                      placeholder="e.g. Authorization"
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700 font-mono"
                    />
                  </div>

                  {/* HTTP Auth value */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">验证字段值 (Value)</label>
                    <input
                      type="text"
                      value={formAuthHeaderValue}
                      onChange={(e) => setFormAuthHeaderValue(e.target.value)}
                      placeholder="e.g. Key / Bearer Token"
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700 font-mono"
                    />
                  </div>

                  {/* Status Field */}
                  <div className="col-span-2 space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">通信心跳状态 (Status)</label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as any)}
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-cyan-400 focus:outline-none focus:border-cyan-500 font-mono"
                    >
                      <option value="Active">Active (心跳活跃)</option>
                      <option value="Idle">Idle (空闲待命)</option>
                      <option value="Offline">Offline (临时离线)</option>
                    </select>
                  </div>

                  {/* Description Field */}
                  <div className="col-span-2 space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">功能描述 (Description) *</label>
                    <input
                      type="text"
                      required
                      value={formDesc}
                      onChange={(e) => setFormDesc(e.target.value)}
                      placeholder="e.g. 审计服务器特权指令偏差、越权和容器越权"
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700"
                    />
                  </div>

                  {/* Skill Descriptions/Remote agent specifications */}
                  <div className="col-span-2 space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">
                      手动添加技能描述/触发规则 (Skill Card Descriptions / Agent Rule)
                    </label>
                    <textarea
                      rows={3}
                      value={formSkill}
                      onChange={(e) => setFormSkill(e.target.value)}
                      placeholder="e.g. 提取威胁指标 (IP/Domain/Hash), 关联全球威胁态势, 提供自动化处置规制。"
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700 font-mono"
                    />
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="pt-4 border-t border-slate-800 flex justify-end gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 border border-slate-800 bg-[#020408] hover:bg-slate-800/50 text-slate-400 hover:text-white rounded transition-all font-semibold cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded hover:shadow-[0_0_10px_rgba(6,182,212,0.4)] transition-all font-semibold border-0 cursor-pointer"
                  >
                    保存 (Save)
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
