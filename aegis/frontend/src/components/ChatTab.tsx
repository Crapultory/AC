import React, { useState, useRef, useEffect } from 'react';
import { Conversation, Message, ChainStep, Agent } from '../types';
import { initialConversations, scenarioPresets } from '../data/mockData';
import { 
  Send, 
  Trash2, 
  Plus, 
  HelpCircle, 
  ShieldAlert, 
  Layers, 
  ChevronRight, 
  Clock, 
  User, 
  Terminal,
  Paperclip,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ChatTabProps {
  agents: Agent[];
}

export default function ChatTab({ agents }: ChatTabProps) {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const saved = localStorage.getItem('aegis_convs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return initialConversations;
      }
    }
    return initialConversations;
  });

  const [activeConvId, setActiveConvId] = useState<string>(() => {
    return conversations[0]?.id || '';
  });

  const [inputVal, setInputVal] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentRunningStepIdx, setCurrentRunningStepIdx] = useState<number>(-1);
  const [tempSteps, setTempSteps] = useState<ChainStep[]>([]);
  
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('aegis_convs', JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    // Scroll to bottom on new messages
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations, activeConvId, isProcessing, tempSteps, currentRunningStepIdx]);

  const activeConversation = conversations.find(c => c.id === activeConvId);

  // Clear or start a new Chat thread
  const handleCreateNewConversation = () => {
    const newId = `conv-${Date.now()}`;
    const newConv: Conversation = {
      id: newId,
      title: 'New Investigation',
      timestamp: 'Just now',
      messages: []
    };
    setConversations(prev => [newConv, ...prev]);
    setActiveConvId(newId);
    setInputVal('');
  };

  const handleClearHistory = () => {
    if (window.confirm('确定要清除所有对话和本地缓存吗？')) {
      setConversations([]);
      localStorage.removeItem('aegis_convs');
      // Create a fresh empty conversation
      const freshId = `conv-${Date.now()}`;
      setConversations([
        {
          id: freshId,
          title: '新建安全分析会话',
          timestamp: 'Just now',
          messages: []
        }
      ]);
      setActiveConvId(freshId);
    }
  };

  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = conversations.filter(c => c.id !== id);
    setConversations(updated);
    if (activeConvId === id && updated.length > 0) {
      setActiveConvId(updated[0].id);
    }
  };

  // Submitting prompt / user message
  const triggerSimulation = (promptText: string, customPreset?: typeof scenarioPresets[0]) => {
    if (!promptText.trim() || isProcessing) return;

    const userMsg: Message = {
      id: `m-usr-${Date.now()}`,
      sender: 'user',
      text: promptText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Update conversation title if empty
    let updatedConvs = conversations.map(c => {
      if (c.id === activeConvId) {
        const updatedTitle = c.messages.length === 0 
          ? (promptText.length > 18 ? promptText.substring(0, 18) + '...' : promptText)
          : c.title;

        return {
          ...c,
          title: updatedTitle,
          messages: [...c.messages, userMsg]
        };
      }
      return c;
    });

    setConversations(updatedConvs);
    setInputVal('');
    setIsProcessing(true);

    // Determine what kind of intelligence stream is appropriate
    let chosenPreset = customPreset;
    if (!chosenPreset) {
      const txt = promptText.toLowerCase();
      if (txt.includes('钓鱼') || txt.includes('邮件') || txt.includes('email') || txt.includes('phishing')) {
        chosenPreset = scenarioPresets[0];
      } else if (txt.includes('勒索') || txt.includes('病毒') || txt.includes('malware') || txt.includes('ransomware') || txt.includes('主机')) {
        chosenPreset = scenarioPresets[1];
      } else if (txt.includes('泄露') || txt.includes('dlp') || txt.includes('leak') || txt.includes('密匙') || txt.includes('credentials')) {
        chosenPreset = scenarioPresets[2];
      } else {
        // Generic fallback preset made on the fly
        chosenPreset = {
          title: '通用安全请求分析',
          prompt: promptText,
          response: `Aegis 通过 A2A 会话链路向各对应安全域下发了分析任务。
1. **风险等级评估**：判定相关请求属常规日志审计请求。
2. **监测对象核查**：在 1,280 多台受保护的边缘系统配置中未见异常状态偏移。
3. **安全态势稳定**：暂无已知恶意漏洞或入侵痕迹指标匹配。
若有问题请提供特定的主机、样本哈希或漏洞指标以进行深度链条追索。`,
          chainSteps: [
            {
              agentName: 'Threat Intel Agent',
              type: 'agent',
              status: 'Completed',
              message: '查询当前请求关键词并提取在野安全威胁指标合规包。',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            },
            {
              agentName: 'Cloud Security Agent',
              type: 'agent',
              status: 'Completed',
              message: '审查对应资产的安全基线、权限、漏洞扫描记录。',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            },
            {
              agentName: 'Splunk VIP Tool',
              type: 'vip_tool',
              status: 'Completed',
              message: '收集最终的组件通信结果并将其汇总到统一审计日志流中。',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            }
          ]
        };
      }
    }

    // Set up intermediate running steps to simulate processing
    const stepsToRun = chosenPreset.chainSteps.map((step, index) => ({
      ...step,
      status: 'Pending' as const
    }));

    setTempSteps(stepsToRun);
    setCurrentRunningStepIdx(0);

    // Sequence through orchestration steps
    let currentStep = 0;
    const intervalTime = 1200; // ms per step simulation

    const interval = setInterval(() => {
      setTempSteps(prev => {
        const nextSteps = [...prev];
        if (nextSteps[currentStep]) {
          nextSteps[currentStep].status = 'Completed';
        }
        return nextSteps;
      });

      currentStep++;
      setCurrentRunningStepIdx(currentStep);

      if (currentStep >= stepsToRun.length) {
        clearInterval(interval);
        
        // Timeout to reveal answer text
        setTimeout(() => {
          const finalAegisMsg: Message = {
            id: `m-aegis-${Date.now()}`,
            sender: 'aegis',
            text: chosenPreset!.response,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            chainSteps: chosenPreset!.chainSteps
          };

          setConversations(currentConvs => {
            return currentConvs.map(c => {
              if (c.id === activeConvId) {
                return {
                  ...c,
                  messages: [...c.messages, finalAegisMsg]
                };
              }
              return c;
            });
          });

          setIsProcessing(false);
          setCurrentRunningStepIdx(-1);
          setTempSteps([]);
        }, 300);
      }
    }, intervalTime);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      triggerSimulation(inputVal);
    }
  };

  return (
    <div className="flex h-full w-full bg-[#020408] items-stretch select-none overflow-hidden text-xs">
      
      {/* Search & Conversations Panel Left */}
      <div className="w-80 border-r border-slate-800 bg-[#05080F] flex flex-col pt-4 shrink-0 z-10">
        <div className="px-4 pb-3 border-b border-slate-800 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-mono tracking-widest font-bold text-slate-500 uppercase">CENTRAL ARCHIVE</span>
            <button 
              onClick={handleCreateNewConversation}
              className="text-cyan-400 hover:text-cyan-300 p-1 hover:bg-slate-800/50 rounded transition-all flex items-center gap-1 text-[11px] font-bold"
              title="New chat thread"
            >
              <Plus className="h-3.5 w-3.5" /> 新建
            </button>
          </div>
          <div className="relative">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 absolute top-1/2 left-3 -translate-y-1/2 animate-pulse" />
            <div className="text-white text-xs pl-7 py-2 bg-[#080C14] border border-slate-800 rounded font-mono">
              Aegis Coordinator: <strong className="text-emerald-400 font-bold">ONLINE</strong>
            </div>
          </div>
        </div>

        {/* List of Conversations */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
          {conversations.length === 0 ? (
            <div className="text-center p-6 text-slate-500 font-mono text-[11px]">No active threads</div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeConvId;
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    // Prevent switching during pending execution
                    if (!isProcessing) {
                      setActiveConvId(c.id);
                    }
                  }}
                  className={`group p-3 rounded-lg cursor-pointer transition-all ${
                    isActive 
                      ? 'bg-[#080C14] border border-slate-800 text-white shadow-md' 
                      : 'hover:bg-[#03060C] text-slate-500 hover:text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className={`font-semibold text-xs ${isActive ? 'text-cyan-400' : 'text-slate-300 group-hover:text-white'} truncate`}>{c.title}</div>
                      <div className="text-[10px] text-slate-500 font-mono mt-1 flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-slate-600" /> {c.timestamp}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteConversation(c.id, e)}
                      disabled={isProcessing}
                      className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-800 transition-all shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Clear Button Footer */}
        <div className="p-3 border-t border-slate-800 bg-[#03060C]">
          <button 
            disabled={isProcessing}
            onClick={handleClearHistory}
            className="w-full py-1.5 bg-rose-950/10 text-rose-400 hover:text-rose-300 hover:bg-rose-950/25 border border-rose-900/35 font-medium rounded transition-all text-center flex items-center justify-center gap-1.5 text-[11px]"
          >
            <Trash2 className="h-3 w-3" /> 清空运行环境缓存
          </button>
        </div>
      </div>

      {/* Primary Conversation Screen */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-[#020408] relative pb-16">
        
        {/* Dynamic thread details header */}
        <div className="p-4 border-b border-slate-800 bg-[#03060C] flex justify-between items-center select-none">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 uppercase italic">
              {activeConversation ? activeConversation.title : '安全事件会话'}
              <span className="text-[9px] font-mono text-cyan-400 py-0.5 px-2 bg-[#080C14] rounded border border-slate-800 font-bold">
                AEGIS PROCESSOR v2.8.0
              </span>
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">INTENT ROUTING | A2A FLOW | VIP INTEGRATION PIPELINE</p>
          </div>
          <div className="text-[10px] font-mono text-slate-500 flex items-center gap-2">
            <span>Cache:</span>
            <span className="text-emerald-400 font-bold bg-emerald-950/30 px-2 py-0.5 border border-emerald-900/40 rounded">ACTIVE (15_NODES)</span>
          </div>
        </div>

        {/* Standard Message Board */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
          {activeConversation?.messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 max-w-xl mx-auto space-y-4 select-none my-auto">
              <div className="h-11 w-11 bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.4)] rounded-lg flex items-center justify-center shrink-0">
                <Layers className="h-5 w-5 text-white animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white uppercase italic tracking-wider">Aegis 协同中枢智能对话</h4>
                <p className="text-[11px] text-slate-400 leading-relaxed max-w-md">
                  向 Aegis 提交任何风险分析请求。Aegis 将通过 A2A 双通道机制自动识别意图，自动编排可用的工作 Agent 与 VIP 调试工具。
                </p>
              </div>

              {/* Presets Grid */}
              <div className="w-full text-left space-y-2 pt-2">
                <div className="text-[9px] font-mono text-cyan-400 tracking-widest uppercase font-bold">SELECT CYBER TEST SCENARIO FIRST:</div>
                <div className="grid grid-cols-1 gap-2">
                  {scenarioPresets.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => triggerSimulation(preset.prompt, preset)}
                      className="p-3 bg-[#05080F] border border-slate-800 rounded-lg text-left hover:bg-[#080C14] hover:border-slate-700 transition-all group flex justify-between items-center"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-bold text-slate-200 group-hover:text-cyan-400 flex items-center gap-1.5 text-xs">
                          <span className="h-1 w-1 rounded-full bg-cyan-400" />
                          {preset.title}
                        </div>
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">{preset.prompt}</p>
                      </div>
                      <ChevronRight className="h-4.5 w-4.5 text-slate-700 group-hover:text-cyan-400 transition-all shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Actual messages stream in */}
          {activeConversation && activeConversation.messages.map((msg, index) => {
            const isAegis = msg.sender === 'aegis';
            return (
              <div 
                key={msg.id} 
                className={`flex gap-3 max-w-4xl ${isAegis ? 'mr-auto' : 'ml-auto flex-row-reverse'}`}
              >
                {/* Visual Avatar */}
                <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center border text-[11px] font-bold font-mono ${
                  isAegis 
                    ? 'bg-[#080C14] border-slate-800 text-cyan-400' 
                    : 'bg-[#03060C] border-slate-800 text-slate-400'
                }`}>
                  {isAegis ? 'AE' : 'OP'}
                </div>

                <div className="space-y-2 flex-1 min-w-0">
                  {/* Sender & Timestamp */}
                  <div className={`flex items-center gap-2 ${isAegis ? '' : 'justify-end'}`}>
                    <span className="font-bold text-slate-300 text-[11px]">{isAegis ? 'Aegis Co-Pilot' : 'Operator'}</span>
                    <span className="text-[9px] text-slate-500 font-mono">{msg.timestamp}</span>
                  </div>

                  {/* Body Text */}
                  <div className={`p-3.5 rounded-lg text-slate-300 leading-relaxed ${
                    isAegis 
                      ? 'bg-[#05080F] border border-slate-800' 
                      : 'bg-[#080C14] border border-slate-800/80'
                  }`}>
                    {/* Render newlines */}
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</div>
                  </div>

                  {/* Visual orchestration chain mapping at the base of the Aegis text box */}
                  {isAegis && msg.chainSteps && (
                    <div className="p-4 bg-[#080C14] border border-slate-800 rounded-xl space-y-3">
                      <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest flex items-center gap-1.5 font-bold">
                        <Layers className="h-3.5 w-3.5 text-cyan-500" /> Orchestration Chain (对话链路编排可视化)
                      </div>
                      
                      {/* Horizontal Node Steps Display */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 relative select-none">
                        {msg.chainSteps.map((step, idx) => {
                          return (
                            <div key={idx} className="p-2.5 bg-[#05080F] border border-slate-800 rounded-lg relative overflow-hidden flex flex-col justify-between">
                              <div className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-500" />
                              <div>
                                <div className="font-bold text-white flex items-center gap-1.5 text-[11px] truncate">
                                  <span className={`h-1.5 w-1.5 rounded-full ${step.type === 'agent' ? 'bg-cyan-400' : 'bg-purple-500'}`} />
                                  {step.agentName}
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1 pb-1 line-clamp-2 leading-normal">{step.message}</p>
                              </div>
                              <div className="flex justify-between items-center border-t border-slate-800 pt-1.5 mt-2 text-[9px] font-mono">
                                <span className="text-emerald-400 font-bold uppercase flex items-center gap-0.5">
                                  <CheckCircle className="h-2.5 w-2.5" /> {step.status}
                                </span>
                                <span className="text-slate-500">{step.timestamp}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* SIMULATED PENDING / STREAMING ORCHESTRATION TIMELINE */}
          {isProcessing && tempSteps.length > 0 && (
            <div className="flex gap-4 max-w-4xl mr-auto">
              <div className="h-8 w-8 rounded-lg bg-[#05080F] border border-slate-800 text-cyan-400 flex items-center justify-center font-bold font-mono animate-pulse">
                AE
              </div>
              <div className="space-y-4 flex-1">
                <div className="text-[11px] text-cyan-400 font-mono animate-pulse select-none">
                  Aegis is orchestrating agent flow... (执行拓扑链路编排中)
                </div>

                {/* Animated progress blocks */}
                <div className="p-4 bg-[#080C14] border border-slate-800 rounded-xl space-y-3">
                  <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 animate-pulse" /> Live Decisioning Paths
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {tempSteps.map((step, idx) => {
                      const isCompleted = idx < currentRunningStepIdx;
                      const isRunning = idx === currentRunningStepIdx;
                      
                      return (
                        <div 
                          key={idx} 
                          className={`p-2.5 rounded-lg border flex flex-col justify-between transition-all duration-300 ${
                            isCompleted 
                              ? 'bg-emerald-950/10 border-emerald-900/30 text-emerald-300' 
                              : isRunning 
                                ? 'bg-cyan-950/20 border-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.25)] text-cyan-200 animate-pulse' 
                                : 'bg-[#05080F] border-slate-800 text-slate-600'
                          }`}
                        >
                          <div>
                            <div className="font-bold text-[11px] truncate flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 rounded-full ${isCompleted ? 'bg-emerald-400' : isRunning ? 'bg-cyan-400 animate-ping' : 'bg-slate-700'}`} />
                              {step.agentName}
                            </div>
                            <p className={`text-[10px] mt-1 line-clamp-2 leading-normal ${isRunning ? 'text-slate-300' : 'text-slate-500'}`}>{step.message}</p>
                          </div>
                          <div className="flex justify-between items-center border-t border-slate-800 pt-1.5 mt-2 text-[9px] font-mono">
                            <span className={`font-bold uppercase ${isCompleted ? 'text-emerald-400' : isRunning ? 'text-cyan-400' : 'text-slate-600'}`}>
                              {isCompleted ? 'Completed' : isRunning ? 'Running...' : 'Pending'}
                            </span>
                            <span className="text-slate-500">{isCompleted ? step.timestamp : '--:--:--'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Anchor to scroll to */}
          <div ref={bottomRef} />
        </div>

        {/* Input Form at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-800 bg-[#03060C] flex items-center gap-2 select-none z-10">
          <button 
            disabled={isProcessing}
            className="p-2 bg-[#05080F] hover:bg-slate-800/80 border border-slate-800 rounded text-slate-500 hover:text-white transition-all scale-100 active:scale-95 shrink-0" 
            title="Attach references"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyPress}
            disabled={isProcessing}
            placeholder="Ask Aegis anything... 触发关键词：'钓鱼邮件', '勒索病毒', '敏感泄露'..."
            className="flex-1 bg-[#020408] border border-slate-800 rounded px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />

          <button
            onClick={() => triggerSimulation(inputVal)}
            disabled={!inputVal.trim() || isProcessing}
            className="px-4 py-2 bg-cyan-500 text-white hover:bg-cyan-600 disabled:bg-[#080C14] disabled:text-slate-600 rounded font-bold transition-all flex items-center gap-1.5 shrink-0 text-xs"
          >
            <Send className="h-3 w-3" /> 发送
          </button>
        </div>

      </div>
    </div>
  );
}
