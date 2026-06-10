import React, { useState, useMemo } from 'react';
import { RoutingRule, Agent } from '../types';
import { initialRules } from '../data/mockData';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Layers, 
  ShieldAlert, 
  Award,
  ArrowUp,
  ArrowDown,
  X 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface PolicyTabProps {
  agents: Agent[];
  rules: RoutingRule[];
  setRules: React.Dispatch<React.SetStateAction<RoutingRule[]>>;
}

export default function PolicyTab({ agents, rules, setRules }: PolicyTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'agent' | 'global'>('agent');
  
  // Dialog State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RoutingRule | null>(null);

  // Form Fields
  const [formName, setFormName] = useState('');
  const [formAgentId, setFormAgentId] = useState('');
  const [formConditions, setFormConditions] = useState('');
  const [formStatus, setFormStatus] = useState<'Enabled' | 'Disabled'>('Enabled');

  // Filter Rules (Priority sorting removed, sorting by newest update time or ID instead)
  const filteredRules = useMemo(() => {
    return rules.filter(r => {
      const matchSearch = r.ruleName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          r.conditions.toLowerCase().includes(searchTerm.toLowerCase());
      
      const mappedAgent = agents.find(a => a.id === r.agentId);
      const isGlobal = r.conditions === 'Default' || r.agentId === 'all';
      const matchSubTab = activeSubTab === 'global' ? isGlobal : !isGlobal;

      return matchSearch && matchSubTab;
    });
  }, [rules, searchTerm, activeSubTab]);

  const handleToggleRuleStatus = (id: string) => {
    setRules(prev => prev.map(r => {
      if (r.id === id) {
        return {
          ...r,
          status: r.status === 'Enabled' ? 'Disabled' : 'Enabled',
          updateTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };
      }
      return r;
    }));
  };

  const handleOpenCreateModal = () => {
    setEditingRule(null);
    setFormName('');
    setFormAgentId(activeSubTab === 'global' ? 'all' : (agents[0]?.id || 'all'));
    setFormConditions('');
    setFormStatus('Enabled');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (rule: RoutingRule) => {
    setEditingRule(rule);
    setFormName(rule.ruleName);
    setFormAgentId(rule.agentId);
    setFormConditions(rule.conditions);
    setFormStatus(rule.status);
    setIsModalOpen(true);
  };

  const handleDeleteRule = (id: string) => {
    if (window.confirm('Delete this routing policy? (确定要删除这条路由策略/规则吗？)')) {
      setRules(prev => prev.filter(r => r.id !== id));
    }
  };

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formConditions.trim()) {
      alert('请填写规则名称与具体的路由规则内容！');
      return;
    }

    if (editingRule) {
      setRules(prev => prev.map(r => {
        if (r.id === editingRule.id) {
          return {
            ...r,
            ruleName: formName,
            agentId: activeSubTab === 'global' ? 'all' : formAgentId,
            conditions: formConditions,
            actions: 'Auto Directed',
            priority: r.priority,
            status: formStatus,
            updateTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          };
        }
        return r;
      }));
    } else {
      const newRule: RoutingRule = {
        id: `rule-custom-${Date.now()}`,
        priority: rules.length + 1,
        ruleName: formName,
        agentId: activeSubTab === 'global' ? 'all' : formAgentId,
        conditions: formConditions,
        actions: 'Auto Directed',
        status: formStatus,
        updateTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
      setRules(prev => [...prev, newRule]);
    }

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 flex-1 overflow-y-auto p-6 scrollbar-thin select-none text-xs">
      
      {/* Visual Policy Rules Explanation Card */}
      <div className="p-5 bg-[#05080F] border border-slate-800 rounded-xl relative overflow-hidden flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="absolute right-0 top-0 h-32 w-32 bg-cyan-500/5 rounded-full blur-2xl" />
        <div className="space-y-1.5 flex-1 max-w-2xl">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5 uppercase tracking-widest italic">
            Aegis Smart Policy Router (路由Policy中枢)
          </h3>
          <p className="text-slate-400 leading-relaxed">
            默认基于 <strong>Agent Card技能描述</strong> (通过 A2A / JSON-RPC 反射自描述) 进行匹配自适应路由。
            如果存在外部远程非驻留智能体 (Remote Agent) 或高优先安全级阻断拦截，
            在此 <strong>手动配置技能描述规则 (Agent Rule)</strong> 或 <strong>全局过滤规则 (Global Policy)</strong>，由 Aegis 连接器抢占优先执行。
          </p>
        </div>
        <div className="shrink-0 py-2 px-3 bg-[#03060C] border border-slate-800 rounded font-mono text-cyan-400 font-bold text-[10px]">
          Core Mode: <strong className="text-white">Profile Reflexive</strong>
        </div>
      </div>

      {/* Main Container */}
      <div className="bg-[#05080F] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
        
        {/* Toggle between tabs & Search Toolbar */}
        <div className="p-4 bg-[#03060C] border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Sub-Tabs Switches */}
          <div className="flex gap-1 bg-[#020408] p-1 border border-slate-800 rounded-lg shrink-0">
            <button
              onClick={() => setActiveSubTab('agent')}
              className={`px-3 py-1.5 rounded-md font-bold transition-all text-xs cursor-pointer ${
                activeSubTab === 'agent' 
                  ? 'bg-[#080C14] text-cyan-400 border border-slate-800' 
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Agent Card Rules (智能体技能路由)
            </button>
            <button
              onClick={() => setActiveSubTab('global')}
              className={`px-3 py-1.5 rounded-md font-bold transition-all text-xs cursor-pointer ${
                activeSubTab === 'global' 
                  ? 'bg-[#080C14] text-cyan-400 border border-slate-800' 
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Global Routing Rules (全局规则路由)
            </button>
          </div>

          {/* Sub-toolbar tools */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search rule, condition..."
                className="bg-[#020408] border border-slate-800 rounded px-3 py-1.5 pl-8 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700 w-52 font-mono"
              />
            </div>

            <button
              onClick={handleOpenCreateModal}
              className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-white rounded font-bold transition-all flex items-center gap-1 text-xs shrink-0 select-none shadow-[0_0_10px_rgba(6,182,212,0.35)] border-0"
            >
              <Plus className="h-3.5 w-3.5" /> 新建路由规则
            </button>
          </div>
        </div>

        {/* Rules Matrix Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#03060C] border-b border-slate-800 text-slate-500 font-mono text-[9px] uppercase tracking-wider">
                <th className="p-3">Rule Name & Config</th>
                <th className="p-3">Matched Agent Node</th>
                <th className="p-3">Rule Content (规则内容)</th>
                <th className="p-3">Active State</th>
                <th className="p-3">Last Change</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredRules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 font-mono text-xs">
                    No rules matching standard set.
                  </td>
                </tr>
              ) : (
                filteredRules.map((rule, idx) => {
                  const targetAgent = agents.find(a => a.id === rule.agentId);
                  return (
                    <tr key={rule.id} className="hover:bg-[#03060C]/60 transition-colors">
                      {/* Rule configuration name */}
                      <td className="p-3 min-w-[160px]">
                        <div>
                          <div className="font-bold text-slate-200 text-xs">{rule.ruleName}</div>
                          <div className="text-[10px] text-slate-500 font-mono">Rule ID: {rule.id}</div>
                        </div>
                      </td>
 
                      {/* Matched Agent node details */}
                      <td className="p-3 whitespace-nowrap">
                        {rule.agentId === 'all' ? (
                          <span className="text-slate-400 font-bold bg-[#080C14] border border-slate-800 px-1.5 py-0.5 rounded text-[10px] font-mono">
                            All Work Agents
                          </span>
                        ) : targetAgent ? (
                          <div className="flex items-center gap-1.5">
                            <span className="h-1 w-1 rounded-full bg-emerald-500" />
                            <div className="font-mono text-slate-300">{targetAgent.name}</div>
                          </div>
                        ) : (
                          <span className="text-rose-400 font-bold bg-rose-950/10 border border-rose-900/40 px-1.5 py-0.5 rounded text-[10px]">
                            Missing Node Mapping
                          </span>
                        )}
                      </td>
 
                      {/* Rule Content */}
                      <td className="p-3 max-w-sm">
                        <div className="text-cyan-400 text-xs leading-relaxed font-mono line-clamp-2">
                          {rule.conditions}
                        </div>
                      </td>
 
                      {/* Active toggle */}
                      <td className="p-3 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleRuleStatus(rule.id)}
                          className="flex items-center gap-1 transition-all cursor-pointer"
                        >
                          {rule.status === 'Enabled' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 font-mono text-[9px] font-bold">
                              ACTIVE (启用)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900/40 text-slate-500 border border-slate-800/80 font-mono text-[9px]">
                              DISABLED (停用)
                            </span>
                          )}
                        </button>
                      </td>
 
                      {/* Telemetry timestamp */}
                      <td className="p-3 font-mono text-slate-500 whitespace-nowrap">
                        {rule.updateTime}
                      </td>
 
                      {/* Actions */}
                      <td className="p-3 text-center whitespace-nowrap">
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={() => handleOpenEditModal(rule)}
                            className="p-1 bg-[#080C14] border border-slate-800 rounded text-cyan-400 hover:text-cyan-300 hover:bg-slate-850 transition-all cursor-pointer"
                            title="Edit policy values"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="p-1 bg-rose-950/10 border border-rose-900/40 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 transition-all cursor-pointer"
                            title="Purge policy"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CRUD Rule dialog modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-[#05080F] border border-slate-800 w-full max-w-md rounded-xl overflow-hidden shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="bg-[#03060C] p-4 border-b border-slate-800/80 flex justify-between items-center">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  {editingRule ? '编辑路由策略规则' : '创建自定义路由规则'}
                </h4>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 text-slate-500 hover:text-white rounded hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form Body */}
              <form onSubmit={handleSaveRule} className="p-4 space-y-4">
                <div className="space-y-3.5">
                  
                  {/* Name field */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">条目规则名称 (Rule Name) *</label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. 钓鱼邮件重设优先级"
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700 font-mono"
                    />
                  </div>

                  {/* Mapping Agent Select */}
                  {activeSubTab !== 'global' && (
                    <div className="space-y-1">
                      <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">指向处理智能体 (Decisive Agent Node) *</label>
                      <select
                        value={formAgentId}
                        onChange={(e) => setFormAgentId(e.target.value)}
                        className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-cyan-400 focus:outline-none focus:border-cyan-500 font-mono"
                      >
                        <option value="all">-- Global: All Agents (全局应用) --</option>
                        {agents.map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({a.type === 'agent' ? 'Agent' : 'VIP'})</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Rule Content Parameter */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">规则内容 (Rule Content) *</label>
                    <textarea
                      rows={4}
                      required
                      value={formConditions}
                      onChange={(e) => setFormConditions(e.target.value)}
                      placeholder="e.g. 请输入具体路由执行或过滤触发的策略描述规则内容内容..."
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder-slate-700 font-mono"
                    />
                  </div>

                  {/* Status Toggle */}
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono text-slate-500 uppercase tracking-wider font-bold">规则状态 (Status)</label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as any)}
                      className="w-full bg-[#020408] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-cyan-400 focus:outline-none focus:border-cyan-500 font-mono"
                    >
                      <option value="Enabled">Enabled (启用)</option>
                      <option value="Disabled">Disabled (停用)</option>
                    </select>
                  </div>

                </div>

                {/* Submit buttons */}
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
                    保存规则
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
