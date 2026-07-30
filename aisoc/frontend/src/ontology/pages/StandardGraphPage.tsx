import { useMemo, useState } from 'react';
import { RefreshCw, Database, Boxes, Share2, Scale, Tag } from 'lucide-react';
import { useOntologyArtifact, useOntologyCompile } from '../hooks/useOntology';
import { GraphCanvas } from '../components/GraphCanvas';
import { NodeDetail } from '../components/NodeDetail';
import { StatCard } from '../components/ui/Stat';
import { DOMAIN_META } from '../design/tokens';
import { MutationStatus, extractErrorMessage } from '../components/MutationStatus';

const RELATION_HINTS: { type: string; label: string; color: string }[] = [
  { type: 'contains', label: '包含（层级）', color: '#2A3E5C' },
  { type: 'semantic', label: '语义关系（同域）', color: '#3C5A86' },
  { type: 'cross', label: '跨域关系', color: '#4DA3FF' },
];

const OBJECT_HINTS: { label: string; color: string }[] = [
  { label: '对接系统 System ◇', color: '#5B8DEF' },
  { label: '数据源 Data ▱', color: '#3FB9A0' },
  { label: '工具 Tool ⬡', color: '#D4A64A' },
  { label: '动作 Action △', color: '#A98BE0' },
];

export function StandardGraphPage() {
  const { data: standardGraph } = useOntologyArtifact('standard');
  const compileMutation = useOntologyCompile();
  const [selectedDomain, setSelectedDomain] = useState('ALL');
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [showLabels, setShowLabels] = useState(false);

  const allNodes = standardGraph?.nodes || [];
  const allEdges = standardGraph?.edges || [];
  const edgeStats = standardGraph?.edge_stats || {};
  const layerCounts = standardGraph?.layer_counts || {};
  const domains = useMemo(() => (standardGraph?.domains || []).map((d: any) => d.id), [standardGraph]);

  const nodesById = useMemo(() => {
    const m: Record<string, any> = {};
    allNodes.forEach((n: any) => { m[n.id] = n; });
    return m;
  }, [allNodes]);

  const subcapCount = layerCounts.subcapabilities ?? allNodes.filter((n: any) => n.type === 'SubCapability').length;
  const objectCount = layerCounts.objects ?? allNodes.filter((n: any) => n.type === 'Object').length;
  const semanticCount = edgeStats.semantic ?? allEdges.filter((e: any) => e.kind === 'semantic').length;

  const nodes = useMemo(() => {
    if (selectedDomain === 'ALL') return allNodes;
    return allNodes.filter((n: any) => n.domain === selectedDomain || (n.type === 'Domain' && n.id === selectedDomain));
  }, [allNodes, selectedDomain]);

  // when a domain is filtered, keep edges whose both ends survive
  const visibleIds = useMemo(() => new Set(nodes.map((n: any) => n.id)), [nodes]);
  const edges = useMemo(
    () => (selectedDomain === 'ALL' ? allEdges : allEdges.filter((e: any) => visibleIds.has(e.source) && visibleIds.has(e.target))),
    [allEdges, visibleIds, selectedDomain]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 anim-fade-up">
        <div>
          <div className="eyebrow mb-1">Onboarding · 标准本体</div>
          <h1 className="text-3xl font-bold font-display text-gradient">AISOC Standard Graph</h1>
          <p className="text-sm text-[color:var(--ink-mid)] mt-1.5">
            Schema 编译生成的标准能力本体图谱 · 数据源：
            <span className="font-mono text-[color:var(--ink-lo)]"> standard-graph.json</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MutationStatus
            isSuccess={compileMutation.isSuccess}
            isError={compileMutation.isError}
            successMessage={`Recompile 完成 · Score ${Number(compileMutation.data?.score ?? 0).toFixed(1)}`}
            errorMessage={extractErrorMessage(compileMutation.error, '编译失败')}
          />
          <button className="btn-ghost" data-active={showLabels} onClick={() => setShowLabels((v) => !v)}>
            <Tag className="h-4 w-4" />关系注释
          </button>
          <button className="btn-ghost" disabled={compileMutation.isPending} onClick={() => compileMutation.mutate()}>
            <RefreshCw className={`h-4 w-4 ${compileMutation.isPending ? 'animate-spin' : ''}`} />
            {compileMutation.isPending ? '编译中…' : 'Recompile'}
          </button>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Weight Total" value={standardGraph?.weight_total ?? '—'} sub="二级功能权重合计" accent="#38E1FF" icon={<Scale className="h-4 w-4" />} />
        <StatCard label="Domains" value={domains.length} sub="① 核心域" accent="#4DA3FF" icon={<Database className="h-4 w-4" />} />
        <StatCard label="Sub-capabilities" value={subcapCount} sub="② 二级功能" accent="#34E5A3" icon={<Boxes className="h-4 w-4" />} />
        <StatCard label="Objects" value={objectCount} sub="③ 三级对象(共享)" accent="#C084FC" icon={<Tag className="h-4 w-4" />} />
        <StatCard label="Semantic Links" value={semanticCount} sub={`跨域 ${edgeStats.cross_domain ?? 0} 条`} accent="#FFC24B" icon={<Share2 className="h-4 w-4" />} />
      </div>

      {/* Domain filter */}
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" data-active={selectedDomain === 'ALL'} onClick={() => setSelectedDomain('ALL')}>ALL</button>
        {domains.map((d: string) => (
          <button key={d} className="btn-ghost" data-active={selectedDomain === d} onClick={() => setSelectedDomain(d)}>
            <span className="h-2 w-2 rounded-full" style={{ background: DOMAIN_META[d]?.color || '#94A3B8' }} />
            {d}
          </button>
        ))}
      </div>

      {/* Graph — full width */}
      <div className="glass p-3">
        <GraphCanvas nodes={nodes} edges={edges} onSelect={setSelectedNode} selectedId={selectedNode?.id} colorMode="domain" height={600} showEdgeLabels={showLabels} />
        {/* Edge legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-2 pt-3 text-xs">
          <span className="eyebrow">连线图例</span>
          {RELATION_HINTS.map((r) => (
            <span key={r.type} className="flex items-center gap-1.5 text-[color:var(--ink-mid)]">
              <span className="inline-block h-0.5 w-6 rounded" style={{ background: r.color }} />
              {r.label}
            </span>
          ))}
          <span className="text-[color:var(--ink-lo)]">· hover 节点高亮邻居关系并显示注释</span>
        </div>
        {/* Object-type legend (Layer-3 color register) */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-2 pt-2 text-xs">
          <span className="eyebrow">三级对象</span>
          {OBJECT_HINTS.map((o) => (
            <span key={o.label} className="flex items-center gap-1.5 text-[color:var(--ink-mid)]">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: o.color, boxShadow: `0 0 8px ${o.color}66` }} />
              {o.label}
            </span>
          ))}
        </div>
      </div>

      {/* Detail — below graph */}
      <NodeDetail node={selectedNode} layout="wide" ctx={{ nodesById, edges: allEdges, mode: 'standard' }} />
    </div>
  );
}
