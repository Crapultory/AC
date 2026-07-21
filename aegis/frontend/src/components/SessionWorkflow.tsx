import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Focus,
  Maximize2,
  Minimize2,
  RotateCcw,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Conversation, WorkflowGraphNode } from '../types';
import {
  compactWorkflowGraph,
  projectSessionWorkflow,
  WorkflowToolRunExpansion,
} from '../lib/sessionWorkflow';

interface SessionWorkflowProps {
  conversation?: Conversation;
  fullscreen: boolean;
  onFullscreenChange: (fullscreen: boolean) => void;
  onClose: () => void;
}

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.5;

const NODE_COLORS: Record<WorkflowGraphNode['kind'], { fill: string; stroke: string; glow: string }> = {
  root: { fill: '#f8d36a', stroke: '#fff1ae', glow: 'rgba(248,211,106,0.42)' },
  input: { fill: '#f2b557', stroke: '#ffd994', glow: 'rgba(242,181,87,0.32)' },
  delegate: { fill: '#d73b68', stroke: '#ff8eaa', glow: 'rgba(215,59,104,0.36)' },
  tool: { fill: '#4aa8df', stroke: '#a5dcff', glow: 'rgba(74,168,223,0.32)' },
  'tool-group': { fill: '#3979c6', stroke: '#9fdcff', glow: 'rgba(66,153,225,0.4)' },
  end: { fill: '#42c79a', stroke: '#a6f3d8', glow: 'rgba(66,199,154,0.3)' },
};

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function nodeRadius(node: WorkflowGraphNode, nodeCount: number): number {
  const density = nodeCount > 100 ? 0.72 : nodeCount > 45 ? 0.84 : 1;
  const base =
    node.kind === 'root'
      ? 25
      : node.kind === 'delegate'
        ? 17
        : node.kind === 'input'
          ? 14
          : node.kind === 'tool-group'
            ? 13
            : 11;
  return base * density;
}

function nodeHaloSize(node: WorkflowGraphNode, radius: number, nodeCount: number): number {
  const density = nodeCount > 100 ? 0.45 : nodeCount > 45 ? 0.7 : 1;
  const extension =
    node.kind === 'root'
      ? 18
      : node.kind === 'delegate' || node.kind === 'tool-group'
        ? 12
        : node.kind === 'input'
          ? 9
          : 7;
  return radius + extension * density;
}

function edgePath(from: WorkflowGraphNode, to: WorkflowGraphNode): string {
  const bend = Math.max(44, (to.x - from.x) * 0.48);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) {
    return '—';
  }
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function isWorkflowOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-workflow-overlay]'));
}

export default function SessionWorkflow({
  conversation,
  fullscreen,
  onFullscreenChange,
  onClose,
}: SessionWorkflowProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [transform, setTransform] = useState<ViewportTransform>({ x: 36, y: 36, scale: 1 });
  const [userMovedViewport, setUserMovedViewport] = useState(false);
  const [revealedByRun, setRevealedByRun] = useState<WorkflowToolRunExpansion>({});
  const legacyTraceAvailable = Boolean(
    conversation?.messages.some(
      (message) =>
        message.turnId ||
        message.kind === 'main-tools' ||
        message.kind === 'delegate-tools' ||
        (message.sender === 'user' && !message.clientMsgId),
    ) && !conversation?.workflowTraceVersion,
  );

  const logicalGraph = useMemo(
    () =>
      projectSessionWorkflow({
        conversationId: conversation?.id || 'empty',
        title: conversation?.title || 'Current Session',
        messages: conversation?.messages || [],
        trace: conversation?.workflowTrace || [],
        partial: legacyTraceAvailable,
      }),
    [conversation, legacyTraceAvailable],
  );
  const graph = useMemo(
    () => compactWorkflowGraph(logicalGraph, revealedByRun),
    [logicalGraph, revealedByRun],
  );
  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
  const highlightedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    let cursor = selectedNode;
    while (cursor) {
      ids.add(cursor.id);
      cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
    }
    return ids;
  }, [nodeById, selectedNode]);

  const fitGraph = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const viewportWidth = Math.max(320, bounds?.width || 900);
    const viewportHeight = Math.max(260, bounds?.height || 560);
    const padding = fullscreen ? 72 : 44;
    const scale = clampScale(
      Math.min(
        (viewportWidth - padding * 2) / graph.width,
        (viewportHeight - padding * 2) / graph.height,
      ),
    );
    setTransform({
      x: (viewportWidth - graph.width * scale) / 2,
      y: (viewportHeight - graph.height * scale) / 2,
      scale,
    });
    setUserMovedViewport(false);
  }, [fullscreen, graph.height, graph.width]);
  const fitGraphRef = useRef(fitGraph);
  fitGraphRef.current = fitGraph;

  useEffect(() => {
    setSelectedNodeId(undefined);
    setRevealedByRun({});
    setUserMovedViewport(false);
    const frame = window.requestAnimationFrame(() => fitGraphRef.current());
    return () => window.cancelAnimationFrame(frame);
  }, [conversation?.id]);

  useEffect(() => {
    if (selectedNodeId && !nodeById.has(selectedNodeId)) {
      setSelectedNodeId(undefined);
    }
  }, [nodeById, selectedNodeId]);

  useEffect(() => {
    if (userMovedViewport || typeof ResizeObserver === 'undefined') {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const observer = new ResizeObserver(() => fitGraph());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fitGraph, userMovedViewport]);

  const zoomBy = useCallback((factor: number) => {
    setUserMovedViewport(true);
    setTransform((current) => ({ ...current, scale: clampScale(current.scale * factor) }));
  }, []);

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (isWorkflowOverlayTarget(event.target)) {
      return;
    }
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    setUserMovedViewport(true);
    setTransform((current) => {
      const nextScale = clampScale(current.scale * factor);
      const ratio = nextScale / current.scale;
      return {
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
        scale: nextScale,
      };
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (isWorkflowOverlayTarget(event.target)) {
      return;
    }
    if (event.target !== event.currentTarget && (event.target as Element).closest('[data-workflow-node]')) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setUserMovedViewport(true);
    setTransform((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y,
    }));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }

  const revealToolGroup = useCallback((node: WorkflowGraphNode) => {
    if (node.kind !== 'tool-group' || !node.toolRunId || !node.hiddenToolCount) {
      return;
    }
    setUserMovedViewport(true);
    setRevealedByRun((current) => {
      const currentRevealCount = current[node.toolRunId] || 0;
      return {
        ...current,
        [node.toolRunId]: node.hiddenToolCount <= 3
          ? Number.POSITIVE_INFINITY
          : currentRevealCount + 3,
      };
    });
  }, []);

  const actionCount = Math.max(0, logicalGraph.nodes.length - 1);

  return (
    <aside
      role="complementary"
      aria-label={`Workflow for ${conversation?.title || 'Current Session'}`}
      className={`${fullscreen ? 'w-full' : 'w-1/2'} h-full shrink-0 flex flex-col border-r border-cyan-900/50 bg-[#041019] shadow-[20px_0_60px_rgba(0,0,0,0.55)]`}
      data-testid="session-workflow"
    >
      <header className="h-16 shrink-0 px-4 border-b border-slate-800/90 bg-[#03080f]/95 flex items-center gap-3">
        <div className="h-8 w-8 rounded-full border border-cyan-700/50 bg-cyan-950/30 text-cyan-300 flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.12)]">
          <Workflow className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold tracking-[0.18em] text-white">SESSION WORKFLOW</div>
          <div className="mt-0.5 truncate text-[10px] font-mono text-slate-500">
            {conversation?.title || 'Current Session'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-label={fullscreen ? 'Exit workflow fullscreen' : 'Enter workflow fullscreen'}
            onClick={() => onFullscreenChange(!fullscreen)}
            className="h-8 w-8 rounded border border-slate-800 bg-[#07131d] text-slate-400 hover:text-amber-200 hover:border-amber-700/50 transition-colors flex items-center justify-center"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label="Close workflow visualization"
            onClick={onClose}
            className="h-8 w-8 rounded border border-slate-800 bg-[#07131d] text-slate-400 hover:text-cyan-300 hover:border-cyan-800/60 transition-colors flex items-center justify-center"
            title="Close workflow"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={canvasRef}
        className="relative flex-1 min-h-0 overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing bg-[#03131e]"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedNodeId(undefined);
          }
        }}
        data-testid="workflow-canvas"
        data-scale={transform.scale.toFixed(2)}
        data-offset-x={transform.x.toFixed(2)}
        data-offset-y={transform.y.toFixed(2)}
      >
        <div className="absolute inset-0 pointer-events-none opacity-80 bg-[radial-gradient(circle_at_16%_18%,rgba(14,116,144,0.16),transparent_34%),radial-gradient(circle_at_88%_78%,rgba(190,24,93,0.08),transparent_30%)]" />
        <div className="absolute inset-0 pointer-events-none opacity-25 bg-[radial-gradient(rgba(125,211,252,0.35)_0.75px,transparent_0.75px)] [background-size:19px_19px]" />

        <div data-workflow-overlay className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded border border-slate-800/90 bg-[#03080f]/90 p-1 shadow-xl backdrop-blur">
          <button type="button" aria-label="Zoom in workflow" onClick={() => zoomBy(1.15)} className="h-7 w-7 text-slate-400 hover:text-cyan-200 flex items-center justify-center">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Zoom out workflow" onClick={() => zoomBy(0.87)} className="h-7 w-7 text-slate-400 hover:text-cyan-200 flex items-center justify-center">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Fit workflow to view" onClick={fitGraph} className="h-7 w-7 text-slate-400 hover:text-amber-200 flex items-center justify-center">
            <Focus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reset workflow view"
            onClick={() => {
              setUserMovedViewport(true);
              setTransform({ x: 36, y: 36, scale: 1 });
            }}
            className="h-7 w-7 text-slate-400 hover:text-amber-200 flex items-center justify-center"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <span className="px-1.5 text-[9px] font-mono tabular-nums text-slate-500">
            {Math.round(transform.scale * 100)}%
          </span>
        </div>

        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-label="Session execution tree"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedNodeId(undefined);
            }
          }}
        >
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
            {graph.edges.map((edge, edgeIndex) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (!from || !to) {
                return null;
              }
              const highlighted = !selectedNode || (highlightedNodeIds.has(edge.from) && highlightedNodeIds.has(edge.to));
              const delegate = edge.source === 'delegate';
              return (
                <g key={edge.id} opacity={highlighted ? 1 : 0.22} className="transition-opacity duration-200">
                  <path
                    data-testid={`workflow-edge-base-${edge.id}`}
                    data-edge-layer="base"
                    d={edgePath(from, to)}
                    fill="none"
                    stroke={delegate ? '#d94673' : '#55b8d7'}
                    strokeWidth={highlighted ? 2 : 1.25}
                    strokeDasharray={delegate ? '7 6' : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    data-testid={`workflow-edge-flow-${edge.id}`}
                    data-edge-layer="flow"
                    d={edgePath(from, to)}
                    fill="none"
                    stroke={delegate ? '#ff6e9a' : '#a7edff'}
                    strokeWidth={highlighted ? 2.25 : 1.5}
                    strokeDasharray="3 18"
                    vectorEffect="non-scaling-stroke"
                    pathLength="100"
                    className="workflow-edge-flow pointer-events-none"
                    style={{ animationDelay: `${-(edgeIndex % 9) * 0.12}s` }}
                  />
                  {edge.label ? (
                    <text
                      x={(from.x + to.x) / 2}
                      y={(from.y + to.y) / 2 - 9}
                      fill={delegate ? '#ff8eaa' : '#7dd3e7'}
                      fontSize="8"
                      fontFamily="JetBrains Mono, monospace"
                      letterSpacing="0.08em"
                      textAnchor="middle"
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {graph.nodes.map((node) => {
              const radius = nodeRadius(node, graph.nodes.length);
              const haloRadius = nodeHaloSize(node, radius, graph.nodes.length);
              const selected = node.id === selectedNodeId;
              const highlighted = !selectedNode || highlightedNodeIds.has(node.id);
              const failed = node.kind === 'end' && node.status !== 'completed';
              const toolGroup = node.kind === 'tool-group';
              const colors = failed
                ? { fill: '#e45168', stroke: '#ffabb9', glow: 'rgba(228,81,104,0.35)' }
                : NODE_COLORS[node.kind];
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    toolGroup
                      ? `Show next ${Math.min(3, node.hiddenToolCount || 0)} of ${node.hiddenToolCount || 0} hidden tools`
                      : `Select ${node.detail || node.label}`
                  }
                  data-workflow-node
                  data-node-kind={node.kind}
                  data-testid={`workflow-node-${node.id}`}
                  data-highlighted={highlighted ? 'true' : 'false'}
                  transform={`translate(${node.x} ${node.y})`}
                  opacity={highlighted ? 1 : 0.24}
                  className="workflow-node cursor-pointer outline-none transition-opacity duration-200 motion-safe:animate-[pulse_420ms_ease-out_1]"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (toolGroup) {
                      revealToolGroup(node);
                    } else {
                      setSelectedNodeId(node.id);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (toolGroup) {
                        revealToolGroup(node);
                      } else {
                        setSelectedNodeId(node.id);
                      }
                    }
                  }}
                >
                  <circle
                    data-testid={`workflow-node-halo-${node.kind}`}
                    r={haloRadius}
                    fill={colors.glow}
                    opacity={selected ? 0.88 : 0.58}
                    className="workflow-node-halo pointer-events-none transition-opacity duration-200"
                  />
                  <circle
                    data-testid={`workflow-node-focus-${node.kind}`}
                    r={haloRadius + 3}
                    fill="none"
                    stroke="#f8fafc"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                    className="workflow-node-focus-ring pointer-events-none"
                  />
                  {node.kind === 'root' || node.kind === 'delegate' || toolGroup ? (
                    <circle
                      r={radius + (node.kind === 'root' ? 8 : 5)}
                      fill="none"
                      stroke={colors.stroke}
                      strokeWidth="0.8"
                      opacity={selected ? 0.8 : 0.3}
                      className="pointer-events-none"
                    />
                  ) : null}
                  {node.status === 'running' ? (
                    <circle
                      r={radius + 7}
                      fill="none"
                      stroke={colors.stroke}
                      strokeWidth="1"
                      opacity="0.45"
                      className="motion-safe:animate-pulse"
                    />
                  ) : null}
                  <circle
                    r={radius}
                    fill={colors.fill}
                    stroke={selected ? '#ffffff' : colors.stroke}
                    strokeWidth={selected ? 2.5 : 1.25}
                    style={{ filter: selected ? `drop-shadow(0 0 10px ${colors.stroke})` : undefined }}
                  />
                  {node.kind === 'delegate' ? (
                    <circle r={radius * 0.28} fill="#06121b" opacity="0.82" />
                  ) : null}
                  {toolGroup ? (
                    <text
                      x="0"
                      y="3"
                      fill="#e6f7ff"
                      fontSize="9"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      …
                    </text>
                  ) : null}
                  <text
                    x={radius + 9}
                    y="3.5"
                    fill={highlighted ? '#d8e5ed' : '#738493'}
                    fontSize={graph.nodes.length > 100 ? 8 : graph.nodes.length > 45 ? 9 : 10}
                    fontWeight={node.kind === 'root' || node.kind === 'delegate' || toolGroup ? 700 : 500}
                    fontFamily="JetBrains Mono, monospace"
                    paintOrder="stroke"
                    stroke="#03131e"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {logicalGraph.status === 'empty' ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="mt-24 text-center">
              <div className="text-[10px] font-mono tracking-[0.2em] text-cyan-500/70">AWAITING FIRST TURN</div>
              <div className="mt-2 text-[11px] text-slate-600">Execution branches will grow from Aegis in real time.</div>
            </div>
          </div>
        ) : null}

        {selectedNode ? (
          <section
            data-workflow-overlay
            className="absolute bottom-4 right-4 z-30 w-[min(22rem,calc(100%-2rem))] overflow-hidden rounded-lg border border-slate-700/80 bg-[#040b12]/95 shadow-[0_18px_70px_rgba(0,0,0,0.65)] backdrop-blur-md select-text touch-pan-y"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
              <span className="text-[9px] font-mono font-bold tracking-[0.18em] text-cyan-300">NODE DETAILS</span>
              <button type="button" aria-label="Close node details" onClick={() => setSelectedNodeId(undefined)} className="text-slate-500 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div
              data-testid="workflow-node-details-scroll"
              className="max-h-64 space-y-3 overflow-y-auto overscroll-contain p-3 text-[10px]"
            >
              <div>
                <div className="font-mono uppercase tracking-wider text-slate-600">Name</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{selectedNode.label}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 font-mono">
                <div><span className="text-slate-600">TYPE</span><div className="mt-0.5 uppercase text-slate-300">{selectedNode.kind}</div></div>
                <div><span className="text-slate-600">STATUS</span><div className="mt-0.5 uppercase text-slate-300">{selectedNode.status}</div></div>
                <div><span className="text-slate-600">SOURCE</span><div className="mt-0.5 uppercase text-slate-300">{selectedNode.source}</div></div>
                <div><span className="text-slate-600">TIME</span><div className="mt-0.5 text-slate-300">{formatTimestamp(selectedNode.timestamp)}</div></div>
              </div>
              {selectedNode.turnId ? <div className="break-all font-mono text-slate-500">TURN · {selectedNode.turnId}</div> : null}
              {selectedNode.agent ? <div className="font-mono text-rose-300">AGENT · {selectedNode.agent}</div> : null}
              {selectedNode.detail ? <div className="whitespace-pre-wrap break-words rounded border border-slate-800 bg-[#02070c] p-2.5 leading-relaxed text-slate-200">{selectedNode.detail}</div> : null}
              {selectedNode.argsPreview ? <div><div className="mb-1 font-mono text-slate-600">ARGUMENTS</div><pre className="whitespace-pre-wrap break-words rounded bg-[#02070c] p-2 text-cyan-100/80">{selectedNode.argsPreview}</pre></div> : null}
              {selectedNode.resultPreview ? <div><div className="mb-1 font-mono text-slate-600">RESULT</div><pre className="whitespace-pre-wrap break-words rounded bg-[#02070c] p-2 text-emerald-100/80">{selectedNode.resultPreview}</pre></div> : null}
              {selectedNode.finalMessage ? (
                <div>
                  <div className="mb-1 font-mono font-semibold tracking-wider text-emerald-400/80">FINAL MESSAGE</div>
                  <div className="whitespace-pre-wrap break-words rounded border border-emerald-900/40 bg-emerald-950/10 p-2.5 leading-relaxed text-emerald-50/90">
                    {selectedNode.finalMessage}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <footer className="shrink-0 px-4 py-2.5 border-t border-slate-800 bg-[#03080f] flex items-center justify-between text-[9px] font-mono tracking-wider text-slate-500">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${logicalGraph.status === 'live' ? 'bg-amber-400 motion-safe:animate-pulse' : logicalGraph.status === 'complete' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          <span>{logicalGraph.status === 'partial' ? 'PARTIAL TRACE' : logicalGraph.status === 'live' ? 'LIVE TRACE' : logicalGraph.status === 'complete' ? 'STATIC TRACE' : 'SESSION TRACE'}</span>
        </div>
        <span>{actionCount} ACTIONS · {logicalGraph.nodes.filter((node) => node.kind === 'tool').length} TOOLS</span>
      </footer>
    </aside>
  );
}
