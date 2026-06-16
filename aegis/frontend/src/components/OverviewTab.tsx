import React, { useState, useMemo } from 'react';
import { Agent } from '../types';
import { 
  Search, 
  Terminal, 
  Server, 
  Activity, 
  ShieldCheck, 
  RefreshCw, 
  Play, 
  Award,
  AlertTriangle,
  Cpu,
  Clock,
  Eye,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface OverviewTabProps {
  agents: Agent[];
  currentUtcTime: string;
  setTab: (tab: string) => void;
}

export default function OverviewTab({ agents, currentUtcTime, setTab }: OverviewTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedNode, setSelectedNode] = useState<string | null>('threat-intel'); // Default highlight some node

  // Filter agents for the orchestration list
  const filteredAgents = useMemo(() => {
    return agents.filter(agent => {
      const matchSearch = agent.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          agent.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = selectedStatus === 'All' || agent.status === selectedStatus;
      return matchSearch && matchStatus;
    });
  }, [agents, searchTerm, selectedStatus]);

  // Counts
  const totalCount = agents.length;
  const activeCount = agents.filter(a => a.status === 'Active').length;
  const idleCount = agents.filter(a => a.status === 'Idle').length;
  const offlineCount = agents.filter(a => a.status === 'Offline').length;
  const activeRatio = totalCount === 0 ? 0 : (activeCount / totalCount) * 100;

  // Selected agent details for panel
  const currentAgent = useMemo(() => {
    return agents.find(a => a.id === selectedNode) || agents[0];
  }, [agents, selectedNode]);

  // Nodes for star map with coordinates (relative to SVG viewBox 0 0 700 500)
  const starMapNodes = useMemo(() => {
    return [
      { id: 'aegis', name: 'Aegis', x: 350, y: 230, r: 42, color: '#38bdf8', isCenter: true, type: 'core' },
      // Agents (inner ring)
      { id: 'email-sec', name: 'Email Sec Agent', x: 210, y: 130, r: 24, color: '#14b8a6', type: 'agent' },
      { id: 'threat-intel', name: 'Threat Intel Agent', x: 350, y: 80, r: 24, color: '#0ea5e9', type: 'agent' },
      { id: 'cloud-sec', name: 'Cloud Sec Agent', x: 490, y: 130, r: 24, color: '#10b981', type: 'agent' },
      { id: 'dlp', name: 'DLP Agent', x: 530, y: 220, r: 24, color: '#6366f1', type: 'agent' },
      { id: 'soar', name: 'SOAR Agent', x: 350, y: 370, r: 24, color: '#a855f7', type: 'agent' },
      { id: 'ueba', name: 'UEBA Agent', x: 200, y: 320, r: 24, color: '#f59e0b', type: 'agent' },
      { id: 'endpoint-sec', name: 'Endpoint Agent', x: 170, y: 210, r: 24, color: '#3b82f6', type: 'agent' },
      { id: 'vul-mgmt', name: 'Vulnerability Agent', x: 490, y: 310, r: 24, color: '#ec4899', type: 'agent' },
      // VIP Tools (outer endpoints)
      { id: 'misp', name: 'MISP Tool', x: 90, y: 110, r: 20, color: '#f43f5e', type: 'vip' },
      { id: 'virustotal', name: 'VirusTotal', x: 580, y: 90, r: 20, color: '#8b5cf6', type: 'vip' },
      { id: 'servicenow', name: 'ServiceNow', x: 620, y: 270, r: 20, color: '#06b6d4', type: 'vip' },
      { id: 'jira', name: 'Jira Tool', x: 560, y: 410, r: 20, color: '#3b82f6', type: 'vip' },
      { id: 'splunk', name: 'Splunk VIP', x: 110, y: 390, r: 20, color: '#f97316', type: 'vip' }
    ];
  }, []);

  // Connections (source ID -> target ID)
  const starMapLinks = useMemo(() => {
    return [
      // Outer to Inner
      { source: 'misp', target: 'email-sec', mode: 'alert' },
      { source: 'virustotal', target: 'cloud-sec', mode: 'data' },
      { source: 'servicenow', target: 'vul-mgmt', mode: 'task' },
      { source: 'jira', target: 'soar', mode: 'task' },
      { source: 'splunk', target: 'ueba', mode: 'alert' },
      // Inner to Center (Aegis)
      { source: 'email-sec', target: 'aegis', mode: 'data' },
      { source: 'threat-intel', target: 'aegis', mode: 'data' },
      { source: 'cloud-sec', target: 'aegis', mode: 'alert' },
      { source: 'dlp', target: 'aegis', mode: 'data' },
      { source: 'soar', target: 'aegis', mode: 'task' },
      { source: 'ueba', target: 'aegis', mode: 'data' },
      { source: 'endpoint-sec', target: 'aegis', mode: 'alert' },
      { source: 'vul-mgmt', target: 'aegis', mode: 'task' },
    ];
  }, []);

  return (
    <div className="space-y-4 flex-1 overflow-y-auto p-4 scrollbar-thin">
      {/* Top Banner & Control Status */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#05080F] border border-slate-800 rounded-xl p-4 shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 italic">
              Aegis Center Overview <span className="text-[10px] bg-cyan-950/40 border border-cyan-800/40 px-2 py-0.5 rounded text-cyan-400 font-mono font-normal">LIVE</span>
            </h2>
          </div>
          <p className="text-[10px] text-slate-500 font-mono mt-1">System Time: {currentUtcTime} (UTC) | Coordinator State: Root Active</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setTab('chat')} 
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.3)] text-white hover:bg-cyan-600 font-medium text-xs rounded transition-colors"
          >
            <Play className="h-3 w-3" /> 启动智能对话
          </button>
          <div className="flex items-center gap-1.5 px-2 bg-[#080C14] border border-slate-800 py-1 text-[11px] rounded">
            <Server className="h-3 w-3 text-cyan-400" />
            <span className="text-slate-400 font-mono">Channel: A2A RPC</span>
          </div>
        </div>
      </div>

      {/* Metrics Cards Wrap */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Dynamic Metric 1 */}
        <div className="bg-[#05080F] border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors relative overflow-hidden group">
          <div className="absolute right-3 top-3 h-9 w-9 rounded-lg bg-cyan-500/5 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500/10 transition-colors">
            <Activity className="h-4 w-4" />
          </div>
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Active Work Agents</div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-white font-mono tracking-tight">{activeCount}</span>
            <span className="text-xs text-slate-500">/ {totalCount} Total</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)] rounded-full" style={{ width: `${activeRatio}%` }} />
            </div>
            <span className="text-[10px] font-mono text-cyan-400 font-bold">{Math.round(activeRatio)}%</span>
          </div>
        </div>

        {/* Dynamic Metric 2 */}
        <div className="bg-[#05080F] border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors relative overflow-hidden group">
          <div className="absolute right-3 top-3 h-9 w-9 rounded-lg bg-purple-500/5 flex items-center justify-center text-purple-400 group-hover:bg-purple-500/10 transition-colors">
            <Cpu className="h-4 w-4" />
          </div>
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Tasks in Progress</div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-white font-mono tracking-tight">37</span>
            <span className="text-[10px] text-emerald-500 font-mono font-bold flex items-center gap-0.5">↑ 12%</span>
          </div>
          <div className="mt-2.5 h-6 flex items-center gap-1">
            {/* Sparkline simulation */}
            {[23, 29, 21, 35, 27, 41, 31, 37].map((h, i) => (
              <div 
                key={i} 
                className="flex-1 bg-purple-500/30 rounded-t hover:bg-purple-400 transition-colors cursor-pointer" 
                style={{ height: `${h}%` }}
                title={`Interval ${i}: ${h} Active Tasks`}
              />
            ))}
          </div>
        </div>

        {/* Dynamic Metric 3 */}
        <div className="bg-[#05080F] border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors relative overflow-hidden group">
          <div className="absolute right-3 top-3 h-9 w-9 rounded-lg bg-rose-500/5 flex items-center justify-center text-rose-400 group-hover:bg-rose-500/10 transition-colors">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Unchecked Alerts (24h)</div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-rose-500 font-mono tracking-tight">8</span>
            <span className="text-[9px] text-rose-500 bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.5 rounded font-mono font-bold">HIGH RISK</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 truncate font-mono">Critical S3 breach vector mapped</p>
        </div>

        {/* Dynamic Metric 4 */}
        <div className="bg-[#05080F] border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors relative overflow-hidden group">
          <div className="absolute right-3 top-3 h-9 w-9 rounded-lg bg-emerald-500/5 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-500/10 transition-colors">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Security Posture Score</div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-emerald-400 font-mono tracking-tight">92</span>
            <span className="text-xs text-slate-400 uppercase">Excellent</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
            <span className="text-slate-400 font-mono">1,284 Assets Shielded</span>
          </div>
        </div>
      </div>

      {/* Main Star Map Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        
        {/* Hub Star Map Graph Card (Grid size 2cols span) */}
        <div className="bg-[#05080F] border border-slate-800 rounded-xl xl:col-span-2 overflow-hidden flex flex-col relative min-h-[500px]">
          {/* Header Controls */}
          <div className="p-4 border-b border-slate-800 bg-[#03060C] flex justify-between items-center z-10">
            <div>
              <h3 className="text-xs font-bold text-white flex items-center gap-2 uppercase italic tracking-wider">
                Aegis Orchestration Topology <span className="text-[10px] text-cyan-400 font-mono border border-cyan-800 rounded px-1.5 py-0.5">STARMAPPING</span>
              </h3>
              <p className="text-[10px] text-slate-500 mt-1">Click a node to highlight its operational data flow</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[10px]">
              <span className="inline-flex items-center gap-1.5 text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> Agent</span>
              <span className="inline-flex items-center gap-1.5 text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-purple-500" /> VIP Tool</span>
              <span className="inline-flex items-center gap-1.5 text-slate-400"><span className="h-1 w-4 bg-[#080C14] rounded-full border border-slate-700" /> Live Dataflow</span>
            </div>
          </div>

          {/* Interactive Star Map SVG Container */}
          <div className="flex-1 bg-[#020408] relative flex items-center justify-center p-4">
            
            {/* Grid overlay */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(100,116,139,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(100,116,139,0.03)_1px,transparent_1px)] bg-[size:30px_30px] pointer-events-none" />

            <svg id="aegis-star-map" className="w-full h-full max-w-[680px] max-h-[480px] overflow-visible" viewBox="0 0 700 460">
              {/* Star Map Links */}
              {starMapLinks.map((link, idx) => {
                const sourceNode = starMapNodes.find(n => n.id === link.source);
                const targetNode = starMapNodes.find(n => n.id === link.target);
                if (!sourceNode || !targetNode) return null;

                const isSelected = selectedNode === sourceNode.id;
                
                return (
                  <g key={`l-${idx}`}>
                    {/* Background Connection Path Line */}
                    <line
                      x1={sourceNode.x}
                      y1={sourceNode.y}
                      x2={targetNode.x}
                      y2={targetNode.y}
                      stroke={isSelected ? '#22d3ee' : '#1e293b'}
                      strokeWidth={isSelected ? '2' : '1'}
                      opacity={isSelected ? '0.85' : '0.35'}
                      className="transition-all duration-300"
                    />
                    
                    {/* Flow Particles along selected or active paths */}
                    {isSelected && (
                      <circle r="3" fill="#22d3ee" className="shadow-[0_0_8px_#22d3ee]">
                        <animateMotion
                          dur="2.5s"
                          repeatCount="indefinite"
                          path={`M ${sourceNode.x} ${sourceNode.y} L ${targetNode.x} ${targetNode.y}`}
                        />
                      </circle>
                    )}
                  </g>
                );
              })}

              {/* Star Map Rings */}
              <circle cx="350" cy="230" r="140" fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="4,4" opacity="0.4" />
              <circle cx="350" cy="230" r="230" fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="8,6" opacity="0.25" />

              {/* Star Map Nodes */}
              {starMapNodes.map((node) => {
                const isSelected = selectedNode === node.id;
                const isCenter = node.isCenter;
                const fillGrad = `url(#grad-${node.id})`;

                return (
                  <g 
                    key={node.id} 
                    transform={`translate(${node.x}, ${node.y})`}
                    className="cursor-pointer group"
                    onClick={() => {
                      if (node.id !== 'aegis') {
                        setSelectedNode(node.id);
                      }
                    }}
                  >
                    {/* Defs gradient mapping */}
                    <defs>
                      <radialGradient id={`grad-${node.id}`} cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor={node.color} stopOpacity="0.4" />
                        <stop offset="90%" stopColor="#05080F" stopOpacity="0.95" />
                        <stop offset="100%" stopColor={node.color} stopOpacity="0.1" />
                      </radialGradient>
                    </defs>

                    {/* Outer glow ring */}
                    <circle 
                      r={node.r + (isSelected ? 6 : 3)} 
                      fill="none" 
                      stroke={node.color} 
                      strokeWidth={isSelected ? '2' : '1'} 
                      opacity={isSelected ? '0.9' : '0.15'} 
                      className="transition-all duration-300"
                    />

                    {/* Concentric node circle */}
                    <circle 
                      r={node.r} 
                      fill={fillGrad}
                      stroke={node.color} 
                      strokeWidth={isSelected ? '1.5' : '1'} 
                      className="transition-all duration-300 group-hover:scale-105" 
                    />

                    {/* Mini core shield anchor */}
                    {isCenter && (
                      <path 
                        d="M -10 -12 L 10 -12 L 15 -2 L 0 16 L -15 -2 Z" 
                        fill="#06b6d4" 
                        opacity="0.8" 
                        className="animate-pulse"
                      />
                    )}

                    {/* Node Text Label */}
                    <text
                      y={node.r + 14}
                      textAnchor="middle"
                      fill={isSelected ? '#ffffff' : '#64748b'}
                      fontSize="9"
                      fontFamily="var(--font-mono)"
                      fontWeight={isSelected ? '700' : '500'}
                      className="transition-colors pointer-events-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] text-[10px]"
                    >
                      {node.name}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Float-Console for current agent node details */}
            <AnimatePresence mode="wait">
              {selectedNode && currentAgent && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98, y: 5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: 5 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-3 left-3 right-3 bg-[#03060C]/95 backdrop-blur-md border border-slate-800 p-3 rounded-lg flex flex-col md:flex-row justify-between gap-3 text-xs"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${currentAgent.status === 'Active' ? 'bg-[#10b981]' : currentAgent.status === 'Idle' ? 'bg-amber-500' : 'bg-gray-500'}`} />
                      <span className="font-bold text-white text-sm">{currentAgent.name}</span>
                      <span className="text-[10px] bg-slate-800 text-cyan-400 px-1.5 py-0.5 rounded font-mono border border-slate-700">
                        {currentAgent.type === 'agent' ? 'CO-AGENT' : 'VIP TOOL'}
                      </span>
                    </div>
                    <p className="text-slate-300 mt-1.5 leading-relaxed text-[11px]">{currentAgent.description}</p>
                    {currentAgent.skillDescription && (
                      <p className="text-[10px] text-cyan-400 font-mono mt-1 pt-1 border-t border-slate-800/80">Ruleset capability: {currentAgent.skillDescription}</p>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col justify-between items-end border-t md:border-t-0 md:border-l border-slate-800 pt-2.5 md:pt-0 md:pl-4 self-stretch min-w-[140px]">
                    <div className="text-right text-[10px] space-y-0.5 font-mono text-slate-500">
                      <div>Active Queue: <strong className="text-white text-xs">{currentAgent.tasksCount}</strong></div>
                      <div>Telemetry: {currentAgent.lastUpdated}</div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button 
                        onClick={() => setTab('orchestration')}
                        className="text-[9px] bg-slate-800 border border-slate-700 px-2 py-1 text-slate-300 hover:text-white rounded hover:bg-slate-700 transition-all font-mono"
                      >
                        ORCHESTRATE
                      </button>
                      <button 
                        onClick={() => setTab('policy')}
                        className="text-[9px] bg-cyan-950 border border-cyan-800/40 px-2 py-1 text-cyan-400 rounded hover:bg-cyan-900 transition-all font-mono"
                      >
                        RULES_CONFIG
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Side Panel: Agent Statistics & Live Directory (Equivalent to "Agent Orchestration" right col) */}
        <div className="flex flex-col gap-4">

          {/* Sec Posture Progress Circle widget */}
          <div className="bg-[#05080F] border border-slate-800 rounded-xl p-4 relative overflow-hidden flex items-center justify-between">
            <div className="absolute top-0 right-0 h-24 w-24 bg-cyan-500/5 rounded-full blur-2xl" />
            <div className="mr-2">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Aegis Sec Posture</div>
              <h4 className="text-sm font-bold text-white mt-1 italic">Excellent Protection</h4>
              <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                所有安全网关和 VIP 工具连接建立成功。
              </p>
            </div>
            <div className="relative shrink-0 flex items-center justify-center">
              <svg width="72" height="72" viewBox="0 0 36 36" className="transform -rotate-90">
                <circle cx="18" cy="18" r="15.91" fill="none" stroke="#1e293b" strokeWidth="2.5" />
                <circle cx="18" cy="18" r="15.91" fill="none" stroke="url(#postureGradient)" strokeWidth="2.5" strokeDasharray="92 100" />
                <defs>
                  <linearGradient id="postureGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#06b6d4" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="absolute text-white font-mono text-sm font-extrabold">92%</span>
            </div>
          </div>

          {/* Quick Orchestration Table Card */}
          <div className="bg-[#05080F] border border-slate-800 rounded-xl flex-1 flex flex-col overflow-hidden min-h-[360px]">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-800 bg-[#03060C] space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="text-[11px] font-bold text-white uppercase tracking-widest italic">Agent Index</h4>
                <div className="flex gap-1 text-[9px] font-mono">
                  <span className="bg-[#080C14] text-cyan-400 border border-slate-800 px-1.5 py-0.5 rounded font-bold">
                    Total: {totalCount}
                  </span>
                </div>
              </div>

              {/* Filter controls */}
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search agents..."
                    className="w-full bg-[#020408] border border-slate-800 rounded px-2 py-1 text-xs text-white pl-8 focus:outline-none focus:border-cyan-500 placeholder-slate-600 font-mono"
                  />
                </div>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="bg-[#020408] border border-slate-800 rounded px-1.5 py-1 text-[11px] text-cyan-400 focus:outline-none focus:border-cyan-500 font-mono"
                >
                  <option value="All">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Idle">Idle</option>
                  <option value="Offline">Offline</option>
                </select>
              </div>
            </div>

            {/* Inner Directory List */}
            <div className="flex-1 overflow-y-auto max-h-[380px] divide-y divide-slate-800/60 scrollbar-thin">
              {filteredAgents.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 font-mono">No agents found</div>
              ) : (
                filteredAgents.map((agent) => {
                  const isNodeSelected = selectedNode === agent.id;
                  return (
                    <div
                      key={agent.id}
                      onClick={() => setSelectedNode(agent.id)}
                      className={`p-3 text-[11px] flex justify-between items-center cursor-pointer transition-all ${
                        isNodeSelected 
                          ? 'bg-[#080C14] border-l-2 border-cyan-500' 
                          : 'hover:bg-[#03060C] border-l-2 border-transparent'
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${agent.status === 'Active' ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]' : agent.status === 'Idle' ? 'bg-amber-400' : 'bg-gray-600'}`} />
                          <span className="font-bold text-slate-200 truncate">{agent.name}</span>
                          <span className="text-[8px] text-slate-500 font-mono uppercase bg-slate-800/40 px-1 rounded">
                            {agent.type === 'agent' ? 'Co-Agent' : 'VIP'}
                          </span>
                        </div>
                        <p className="text-slate-500 text-[10px] truncate mt-0.5">{agent.description}</p>
                      </div>
                      <div className="shrink-0 text-right font-mono text-[9px] text-slate-500">
                        <div className="text-cyan-400 font-semibold">Tasks: {agent.tasksCount}</div>
                        <div>{agent.lastUpdated}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            {/* Table Footer */}
            <div className="p-2.5 bg-[#03060C] border-t border-slate-800 text-[9px] text-center text-slate-500 font-mono">
              UNIFIED_COORDINATOR_ROUTING: ACTIVE
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
