import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { StarmappingTopology, TopologyAgentNode, TopologyStarKind } from '../types';

interface StarmappingTopologyProps {
  topology: StarmappingTopology | null;
  error: string;
}

type RenderNodeKind = 'center' | 'agent' | 'star';

interface RenderNode {
  id: string;
  parentId?: string;
  kind: RenderNodeKind;
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  symbol: string;
  agent?: TopologyAgentNode;
  starKind?: TopologyStarKind;
  name: string;
  detail: string;
  integration?: string;
  required?: boolean;
}

const CANVAS = { width: 1000, height: 700, centerX: 500, centerY: 365, agentRadius: 184 };

const AGENT_COLORS: Record<string, string> = {
  'ai-soc': '#50c8e8',
  'ai-grc': '#63d5bd',
  'ai-redteam': '#b88ae9',
  'ai-sdlc': '#d9a166',
  'ai-ueba': '#4dbbd8',
  'ai-itops': '#779fe5',
  'ai-web3': '#9b7ee1',
};

const STAR_COLORS: Record<TopologyStarKind, string> = {
  tool: '#7bd6e8',
  api: '#ac91e8',
  data: '#7796b8',
};

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function nodeStatusLabel(status: TopologyAgentNode['runtime']['status']): string {
  return status === 'planned' ? 'BASELINE' : status.toUpperCase();
}

function TopologyGlyph({ symbol, color, size, lit }: { symbol: string; color: string; size: number; lit: boolean }) {
  const stroke = lit ? color : `${color}cc`;
  const common = {
    fill: 'none',
    stroke,
    strokeWidth: Math.max(1.4, size * 0.065),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const dot = (x: number, y: number, r = size * 0.07) => <circle cx={x} cy={y} r={r} fill={stroke} />;
  const half = size / 2;

  if (symbol === 'aegis-connection') {
    const points = [[-0.32, -0.25], [0.3, -0.2], [-0.25, 0.28], [0.02, 0.04], [0.35, 0.3], [0.05, 0.43]];
    const point = (index: number) => ({ x: points[index][0] * size, y: points[index][1] * size });
    return (
      <g>
        <path d={`M ${point(0).x} ${point(0).y} L ${point(3).x} ${point(3).y} L ${point(1).x} ${point(1).y} M ${point(2).x} ${point(2).y} L ${point(3).x} ${point(3).y} L ${point(4).x} ${point(4).y} M ${point(3).x} ${point(3).y} L ${point(5).x} ${point(5).y}`} {...common} />
        {points.map(([x, y], index) => <circle key={index} cx={x * size} cy={y * size} r={size * 0.085} fill="#07111f" stroke={stroke} strokeWidth={common.strokeWidth} />)}
      </g>
    );
  }

  if (symbol === 'argus-eyes') {
    return <g>{[-0.25, 0, 0.25].map((x) => [-0.2, 0.18].map((y) => <g key={`${x}-${y}`} transform={`translate(${x * size} ${y * size})`}><path d={`M ${-size * 0.1} 0 Q 0 ${-size * 0.09} ${size * 0.1} 0 Q 0 ${size * 0.09} ${-size * 0.1} 0`} {...common} />{dot(0, 0, size * 0.028)}</g>))}</g>;
  }
  if (symbol === 'themis-scales') {
    return <g><path d={`M 0 ${-half * 0.34} V ${half * 0.36} M ${-half * 0.34} ${-half * 0.2} H ${half * 0.34} M ${-half * 0.31} ${-half * 0.2} L ${-half * 0.45} ${half * 0.11} H ${-half * 0.17} Z M ${half * 0.31} ${-half * 0.2} L ${half * 0.17} ${half * 0.11} H ${half * 0.45} Z M ${-half * 0.17} ${half * 0.36} H ${half * 0.17}`} {...common} /></g>;
  }
  if (symbol === 'loki-knot') {
    return <g><path d={`M ${-half * 0.32} ${half * 0.28} C ${-half * 0.55} ${-half * 0.05}, ${-half * 0.12} ${-half * 0.45}, 0 ${-half * 0.1} C ${half * 0.12} ${-half * 0.45}, ${half * 0.55} ${-half * 0.05}, ${half * 0.32} ${half * 0.28} M ${-half * 0.37} ${-half * 0.34} C ${-half * 0.06} ${-half * 0.2}, ${half * 0.06} ${-half * 0.2}, ${half * 0.37} ${-half * 0.34} M ${-half * 0.12} ${half * 0.37} Q 0 ${half * 0.14} ${half * 0.12} ${half * 0.37}`} {...common} /></g>;
  }
  if (symbol === 'vulcan-anvil') {
    return <g><path d={`M ${-half * 0.48} ${half * 0.06} H ${half * 0.18} L ${half * 0.42} ${half * 0.23} H ${-half * 0.3} L ${-half * 0.12} ${half * 0.06} M ${-half * 0.2} ${half * 0.23} L ${-half * 0.28} ${half * 0.43} H ${half * 0.21} L ${half * 0.13} ${half * 0.23} M ${half * 0.16} ${-half * 0.45} L ${half * 0.43} ${-half * 0.18} M ${half * 0.28} ${-half * 0.33} L ${half * 0.45} ${-half * 0.5}`} {...common} /></g>;
  }
  if (symbol === 'heimdall-eye') {
    return <g><path d={`M ${-half * 0.48} 0 Q 0 ${-half * 0.34} ${half * 0.48} 0 Q 0 ${half * 0.34} ${-half * 0.48} 0`} {...common} />{dot(0, 0, size * 0.09)}<path d={`M ${-half * 0.4} ${-half * 0.31} Q 0 ${-half * 0.56} ${half * 0.4} ${-half * 0.31}`} {...common} /></g>;
  }
  if (symbol === 'janus-duality') {
    return <g><path d={`M 0 ${-half * 0.45} C ${-half * 0.38} ${-half * 0.33}, ${-half * 0.42} ${half * 0.15}, 0 ${half * 0.42} M 0 ${-half * 0.45} C ${half * 0.38} ${-half * 0.33}, ${half * 0.42} ${half * 0.15}, 0 ${half * 0.42} M 0 ${-half * 0.38} V ${half * 0.31} M ${-half * 0.23} ${-half * 0.04} H ${-half * 0.08} M ${half * 0.08} ${-half * 0.04} H ${half * 0.23}`} {...common} /></g>;
  }
  if (symbol === 'wedjat-eye') {
    return <g><path d={`M ${-half * 0.5} ${-half * 0.03} Q 0 ${-half * 0.36} ${half * 0.5} ${-half * 0.03} Q 0 ${half * 0.31} ${-half * 0.5} ${-half * 0.03} M ${half * 0.24} ${half * 0.16} Q ${half * 0.45} ${half * 0.23} ${half * 0.31} ${half * 0.43} M ${-half * 0.12} ${half * 0.23} Q 0 ${half * 0.43} ${half * 0.1} ${half * 0.3}`} {...common} />{dot(0, -half * 0.03, size * 0.09)}</g>;
  }
  if (symbol === 'tool') return <g><path d={`M ${-half * 0.32} ${-half * 0.35} L ${half * 0.27} ${half * 0.25} M ${half * 0.32} ${-half * 0.33} L ${-half * 0.28} ${half * 0.27}`} {...common} />{dot(-half * 0.32, -half * 0.35, size * 0.055)}{dot(half * 0.32, -half * 0.33, size * 0.055)}</g>;
  if (symbol === 'api') return <g><path d={`M ${-half * 0.4} 0 H ${half * 0.4} M ${-half * 0.1} ${-half * 0.25} L ${-half * 0.4} 0 L ${-half * 0.1} ${half * 0.25} M ${half * 0.1} ${-half * 0.25} L ${half * 0.4} 0 L ${half * 0.1} ${half * 0.25}`} {...common} /></g>;
  return <g><ellipse cx="0" cy={-half * 0.22} rx={half * 0.32} ry={half * 0.13} {...common} /><path d={`M ${-half * 0.32} ${-half * 0.22} V ${half * 0.25} Q 0 ${half * 0.47} ${half * 0.32} ${half * 0.25} V ${-half * 0.22}`} {...common} /></g>;
}

function buildRenderNodes(topology: StarmappingTopology): RenderNode[] {
  const center: RenderNode = {
    id: topology.center.id,
    kind: 'center',
    x: CANVAS.centerX,
    y: CANVAS.centerY,
    r: 44,
    color: '#3ba9ef',
    label: 'Aegis Core',
    symbol: topology.center.symbol,
    name: topology.center.name,
    detail: topology.center.description,
  };
  const nodes: RenderNode[] = [center];

  for (const agent of topology.agents) {
    const angle = radians(agent.layout.angle_degrees);
    const x = CANVAS.centerX + Math.cos(angle) * CANVAS.agentRadius;
    const y = CANVAS.centerY + Math.sin(angle) * CANVAS.agentRadius;
    const color = AGENT_COLORS[agent.id] || '#77b5e8';
    nodes.push({
      id: agent.id,
      kind: 'agent',
      x,
      y,
      r: 29,
      color,
      label: agent.business_domain,
      symbol: agent.symbol,
      agent,
      name: agent.display_name,
      detail: agent.business_fit,
    });

    for (const [index, star] of agent.star_nodes.entries()) {
      const clusterOffset = ((index % 6) - 2.5) * 12;
      const starAngle = angle + radians(clusterOffset);
      const starRadius = 82 + Math.floor(index / 6) * 25;
      nodes.push({
        id: star.id,
        parentId: agent.id,
        kind: 'star',
        x: x + Math.cos(starAngle) * starRadius,
        y: y + Math.sin(starAngle) * starRadius,
        r: index % 3 === 0 ? 6 : 4.5,
        color: STAR_COLORS[star.kind],
        label: star.name,
        symbol: star.kind,
        starKind: star.kind,
        name: star.name,
        detail: star.purpose,
        integration: star.integration,
        required: star.required,
      });
    }
  }
  return nodes;
}

function NodeInsight({ node }: { node: RenderNode }) {
  if (node.kind === 'center') {
    return <><p className="text-[10px] font-mono tracking-[0.18em] text-cyan-300">CENTER · ORCHESTRATION CORE</p><h4 className="mt-1 text-base font-semibold text-slate-100">{node.name}</h4><p className="mt-1.5 max-w-xl text-[11px] leading-relaxed text-slate-400">{node.detail}</p><p className="mt-2 text-[10px] font-mono text-slate-500">COORDINATING 7 DOMAIN AGENTS · 84 REQUIRED CAPABILITIES</p></>;
  }
  if (node.kind === 'agent' && node.agent) {
    return <><div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-mono tracking-[0.18em] text-cyan-300">{node.agent.business_domain} · AGENT RING</p><span className="rounded border border-cyan-900/60 bg-cyan-950/30 px-1.5 py-0.5 text-[9px] font-mono text-cyan-200">{nodeStatusLabel(node.agent.runtime.status)}</span></div><h4 className="mt-1 text-base font-semibold text-slate-100">{node.name} <span className="text-xs font-normal text-slate-500">{node.agent.marketing_name}</span></h4><p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{node.detail}</p><p className="mt-2 text-[10px] font-mono text-slate-500">{node.agent.cultural_origin} · {node.agent.star_nodes.length} STARS · {node.agent.runtime.source}</p></>;
  }
  return <><p className="text-[10px] font-mono tracking-[0.18em] text-cyan-300">{node.starKind?.toUpperCase()} · STAR FIELD</p><h4 className="mt-1 text-base font-semibold text-slate-100">{node.name}</h4><p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{node.detail}</p><p className="mt-2 text-[10px] font-mono text-slate-500">{node.integration} · {node.required ? 'REQUIRED' : 'OPTIONAL'}</p></>;
}

export default function StarmappingTopology({ topology, error }: StarmappingTopologyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const nodes = useMemo(() => topology ? buildRenderNodes(topology) : [], [topology]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const activeNodeId = hoveredNodeId;
  const activeNode = activeNodeId ? nodeById.get(activeNodeId) : undefined;
  const litIds = useMemo(() => {
    const lit = new Set<string>();
    if (!activeNode || !topology) return lit;
    lit.add(activeNode.id);
    if (activeNode.kind === 'agent') {
      lit.add(topology.center.id);
      activeNode.agent?.star_nodes.forEach((star) => lit.add(star.id));
    } else if (activeNode.kind === 'star' && activeNode.parentId) {
      lit.add(topology.center.id);
      lit.add(activeNode.parentId);
    }
    return lit;
  }, [activeNode, topology]);

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const showTooltip = (id: string, event: PointerEvent<SVGGElement>) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = 320;
    const height = 156;
    const pointerX = Number.isFinite(event.clientX) ? event.clientX : bounds.left + (bounds.width / 2);
    const pointerY = Number.isFinite(event.clientY) ? event.clientY : bounds.top + (bounds.height / 2);
    const x = Math.max(12, Math.min(pointerX - bounds.left + 16, bounds.width - width - 12));
    const y = Math.max(48, Math.min(pointerY - bounds.top + 16, bounds.height - height - 12));
    setHoveredNodeId(id);
    setTooltip({ id, x, y });
  };

  const hideTooltip = () => {
    setHoveredNodeId(null);
    setTooltip(null);
  };

  const focusNode = (id: string) => {
    setHoveredNodeId(id);
    setTooltip({ id, x: 20, y: 72 });
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await containerRef.current?.requestFullscreen();
  };

  const handleNodeKeyDown = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      focusNode(id);
    }
  };

  if (!topology) {
    return <div className="flex min-h-[520px] flex-1 items-center justify-center bg-[#03070d] px-8 text-center"><div><p className="text-xs font-mono tracking-[0.2em] text-cyan-400">STARMAPPING UNAVAILABLE</p><p className="mt-3 max-w-sm text-xs leading-relaxed text-slate-500">{error || 'The three-layer topology is loading from the Aegis API.'}</p></div></div>;
  }

  return (
    <div ref={containerRef} className={`relative overflow-hidden bg-[#02060d] ${isFullscreen ? 'h-screen w-screen' : 'min-h-[560px]'}`}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_48%,rgba(23,83,118,0.2),transparent_39%),radial-gradient(ellipse_at_50%_80%,rgba(23,35,76,0.23),transparent_48%)]" />
      <svg className={`relative h-full w-full ${isFullscreen ? 'min-h-full' : 'min-h-[560px]'}`} viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`} role="img" aria-label="Aegis three-layer orchestration topology">
        <defs>
          <radialGradient id="star-map-core" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#1d75a5" stopOpacity="0.26" /><stop offset="100%" stopColor="#02060d" stopOpacity="0" /></radialGradient>
          <filter id="star-map-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <pattern id="star-map-hex" width="36" height="31" patternUnits="userSpaceOnUse"><path d="M9 1h18l9 15-9 14H9L0 16z" fill="none" stroke="#365876" strokeOpacity="0.2" strokeWidth="0.7" /></pattern>
        </defs>
        <rect width={CANVAS.width} height={CANVAS.height} fill="url(#star-map-core)" />
        <path d="M 16 680 Q 500 -114 984 680" fill="none" stroke="#4b94bb" strokeOpacity="0.17" strokeWidth="1.25" />
        <path d="M 66 674 Q 500 -58 934 674" fill="none" stroke="#355f88" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="4 9" />
        <path d="M 16 680 Q 500 -114 984 680 L 984 700 L 16 700 Z" fill="url(#star-map-hex)" opacity="0.72" />
        <circle cx={CANVAS.centerX} cy={CANVAS.centerY} r={CANVAS.agentRadius} fill="none" stroke="#5b88aa" strokeOpacity="0.55" strokeWidth="1" />
        <circle cx={CANVAS.centerX} cy={CANVAS.centerY} r="70" fill="none" stroke="#2f658c" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="3 7" />

        {topology.edges.map((edge) => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          if (!source || !target) return null;
          const active = litIds.has(edge.source) && litIds.has(edge.target);
          return <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={active ? '#68d8f7' : '#31526c'} strokeOpacity={active ? 0.9 : edge.mode === 'requires' ? 0.28 : 0.48} strokeWidth={active ? 1.5 : 0.7} strokeDasharray={edge.mode === 'requires' ? '2 5' : undefined} />;
        })}

        {nodes.map((node) => {
          const lit = litIds.has(node.id);
          const isActive = activeNode?.id === node.id;
          const opacity = node.kind === 'star' ? (lit ? 1 : 0.64) : 1;
          return (
            <g
              key={node.id}
              transform={`translate(${node.x} ${node.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${node.name}: ${node.detail}`}
              onPointerEnter={(event) => showTooltip(node.id, event)}
              onPointerMove={(event) => showTooltip(node.id, event)}
              onPointerLeave={hideTooltip}
              onFocus={() => focusNode(node.id)}
              onBlur={hideTooltip}
              onClick={() => focusNode(node.id)}
              onKeyDown={(event) => handleNodeKeyDown(event, node.id)}
              className="cursor-pointer outline-none"
              opacity={opacity}
            >
              {node.kind !== 'star' ? <circle r={node.r + (isActive ? 10 : 6)} fill="none" stroke={node.color} strokeOpacity={lit ? 0.55 : 0.22} strokeWidth={lit ? 1.35 : 0.7} /> : null}
              <circle r={node.r} fill="#07111d" fillOpacity={node.kind === 'star' ? 0.96 : 0.9} stroke={node.color} strokeOpacity={lit ? 0.95 : 0.48} strokeWidth={isActive ? 1.7 : node.kind === 'star' ? 0.8 : 1.1} filter={lit ? 'url(#star-map-glow)' : undefined} />
              <TopologyGlyph symbol={node.symbol} color={node.color} size={node.kind === 'center' ? 39 : node.kind === 'agent' ? 28 : 8} lit={lit} />
              {node.kind === 'agent' ? <text y={node.r + 17} textAnchor="middle" fill={lit ? '#d9f3ff' : '#7f9bb0'} fontSize="9.5" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" letterSpacing="0.8">{node.label}</text> : null}
            </g>
          );
        })}
      </svg>

      {tooltip && activeNode?.id === tooltip.id ? <div role="status" className="pointer-events-none absolute z-20 w-80 rounded-lg border border-cyan-900/80 bg-[#030912]/95 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.48)] backdrop-blur-md" style={{ left: tooltip.x, top: tooltip.y }}><NodeInsight node={activeNode} /></div> : null}
      <div className="pointer-events-none absolute right-14 top-4 flex gap-3 text-[9px] font-mono tracking-wide text-slate-500"><span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-300" />CORE</span><span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-teal-300" />AGENT RING</span><span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-indigo-300" />STAR FIELD</span></div>
      <button type="button" aria-label={isFullscreen ? 'Exit topology fullscreen' : 'Enter topology fullscreen'} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen topology'} onClick={() => void toggleFullscreen()} className="absolute right-4 top-3 z-30 rounded-md border border-slate-700/80 bg-[#06101b]/85 p-2 text-slate-400 shadow-lg backdrop-blur transition hover:border-cyan-600 hover:text-cyan-200">
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
