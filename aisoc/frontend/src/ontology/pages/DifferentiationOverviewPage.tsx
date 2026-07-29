import { useMemo, useState, type ReactNode } from 'react';
import { Radar, AlertTriangle, CheckCircle2, MinusCircle, PlusCircle, ArrowUpRight } from 'lucide-react';
import { useOntologyArtifact, useOntologyOverview, useOntologyRoadmap, useOntologyScan } from '../hooks/useOntology';
import { GraphCanvas } from '../components/GraphCanvas';
import { NodeDetail } from '../components/NodeDetail';
import { StatCard, ProgressBar } from '../components/ui/Stat';
import { STATUS_META, DOMAIN_META } from '../design/tokens';
import { EmptyScan, isNoScan404 } from '../components/EmptyScan';
import { MutationStatus, extractErrorMessage } from '../components/MutationStatus';

const STATE_FILTERS = ['ALL', 'satisfied', 'partial', 'missing', 'extra'] as const;

export function DifferentiationOverviewPage() {
  const overviewQuery = useOntologyOverview();
  const overview = overviewQuery.data;
  const { data: mappedGraph } = useOntologyArtifact('mapped');
  const { data: standardGraph } = useOntologyArtifact('standard');
  const { data: gap } = useOntologyArtifact('gap');
  const { data: scorecard } = useOntologyArtifact('scorecard');
  const { data: roadmap } = useOntologyRoadmap();
  const scanMutation = useOntologyScan();
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [stateFilter, setStateFilter] = useState<(typeof STATE_FILTERS)[number]>('ALL');

  const rawMapped = useMemo(() => mappedGraph?.mapped_nodes || [], [mappedGraph]);
  const extraNodes = useMemo(() => mappedGraph?.extra_nodes || gap?.extra || [], [mappedGraph, gap]);
  // enrich mapped nodes with standard metadata (definition/business_value/type)
  const stdById = useMemo(() => {
    const m: Record<string, any> = {};
    (standardGraph?.nodes || []).forEach((n: any) => { m[n.id] = n; });
    return m;
  }, [standardGraph]);
  // mapped node lookup (carries object_detail for L2 subcaps)
  const mappedById = useMemo(() => {
    const m: Record<string, any> = {};
    rawMapped.forEach((n: any) => { m[n.id] = n; });
    return m;
  }, [rawMapped]);
  const nodesById = useMemo(() => {
    const m: Record<string, any> = {};
    (standardGraph?.nodes || []).forEach((n: any) => { m[n.id] = n; });
    return m;
  }, [standardGraph]);
  const allNodes = useMemo(
    () => rawMapped.map((n: any) => {
      const s = stdById[n.id] || {};
      return {
        ...s,
        ...n,
        definition: n.definition ?? s.definition,
        business_value: n.business_value ?? s.business_value,
        type: n.type ?? s.type,
        layer: n.layer ?? s.layer ?? 2,
      };
    }),
    [rawMapped, stdById]
  );
  const counts = mappedGraph?.status_counts || overview?.status_counts || {};
  const total = allNodes.length || 1;
  const score = overview?.score ?? scorecard?.completeness_score ?? 0;

  const nodes = useMemo(() => {
    const filtered = stateFilter === 'ALL' ? allNodes : allNodes.filter((n: any) => n.status === stateFilter);
    // prepend domain anchor nodes so hierarchy stays legible (主次分明)
    const activeDomains = new Set(filtered.map((n: any) => n.domain));
    const domainNodes = (standardGraph?.nodes || [])
      .filter((n: any) => n.type === 'Domain' && activeDomains.has(n.id));
    return [...domainNodes, ...filtered];
  }, [allNodes, stateFilter, standardGraph]);

  const visibleIds = useMemo(() => new Set(nodes.map((n: any) => n.id)), [nodes]);
  const edges = useMemo(
    () => (standardGraph?.edges || []).filter((e: any) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [standardGraph, visibleIds]
  );

  // recommendation map from roadmap by node_id
  const recByNode = useMemo(() => {
    const m: Record<string, any> = {};
    (roadmap?.items || []).forEach((it: any) => { m[it.node_id] = it; });
    return m;
  }, [roadmap]);

  // remediation list driven directly by roadmap (already weighted-gap sorted + structured)
  const gapItems = useMemo(() => (roadmap?.items || []).slice(0, 8), [roadmap]);

  if (isNoScan404(overviewQuery.error)) {
    return (
      <div className="space-y-6">
        <div className="anim-fade-up">
          <div className="eyebrow mb-1">Onboarding · 环境差异</div>
          <h1 className="text-3xl font-bold font-display text-gradient">Differentiation Overview</h1>
        </div>
        <EmptyScan
          onRunScan={() => scanMutation.mutate()}
          scanPending={scanMutation.isPending}
          scanError={scanMutation.isError ? extractErrorMessage(scanMutation.error, '扫描失败') : null}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 anim-fade-up">
        <div>
          <div className="eyebrow mb-1">Onboarding · 环境差异</div>
          <h1 className="text-3xl font-bold font-display text-gradient">Differentiation Overview</h1>
          <p className="text-sm text-[color:var(--ink-mid)] mt-1.5">
            真实环境 vs 标准本体差异分析 · 数据源：
            <span className="font-mono text-[color:var(--ink-lo)]"> mapped-graph.json · gap-report.json · scorecard.json</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MutationStatus
            isSuccess={scanMutation.isSuccess}
            isError={scanMutation.isError}
            successMessage={`扫描完成 · Score ${Number(scanMutation.data?.score ?? 0).toFixed(1)}`}
            errorMessage={extractErrorMessage(scanMutation.error, '扫描失败')}
          />
          <button className="btn-primary" disabled={scanMutation.isPending} onClick={() => scanMutation.mutate()}>
            <Radar className={`h-4 w-4 ${scanMutation.isPending ? 'animate-spin' : ''}`} />
            {scanMutation.isPending ? '扫描中…' : 'Run Environment Scan'}
          </button>
        </div>
      </div>

      {/* Completeness banner */}
      <div className="glass p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow">Completeness Score</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-4xl font-bold font-display text-gradient glow-text-cyan">{Number(score).toFixed(1)}</span>
              <span className="text-lg text-[color:var(--ink-lo)] mb-1">/ 100</span>
            </div>
          </div>
          <div className="flex-1 min-w-[240px] max-w-xl">
            <div className="flex justify-between text-xs text-[color:var(--ink-lo)] mb-1.5">
              <span>Mapped {total} nodes</span>
              <span>Last scan: <span className="font-mono">{overview?.latest_scan_id || 'N/A'}</span></span>
            </div>
            <ProgressBar ratio={Number(score) / 100} />
          </div>
        </div>
      </div>

      {/* 4-state encoded stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StateCard status="satisfied" count={counts.satisfied ?? 0} total={total} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StateCard status="partial" count={counts.partial ?? 0} total={total} icon={<AlertTriangle className="h-4 w-4" />} />
        <StateCard status="missing" count={counts.missing ?? 0} total={total} icon={<MinusCircle className="h-4 w-4" />} />
        <StateCard status="extra" count={counts.extra ?? 0} total={total} icon={<PlusCircle className="h-4 w-4" />} />
      </div>

      {/* State filter */}
      <div className="flex flex-wrap gap-2">
        {STATE_FILTERS.map((s) => (
          <button key={s} className="btn-ghost" data-active={stateFilter === s} onClick={() => setStateFilter(s)}>
            {s !== 'ALL' && <span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[s]?.color }} />}
            {s === 'ALL' ? 'ALL' : STATUS_META[s].label}
          </button>
        ))}
      </div>

      {/* Graph full width, status-colored */}
      <div className="glass p-3">
        <GraphCanvas nodes={nodes} edges={edges} onSelect={setSelectedNode} selectedId={selectedNode?.id} colorMode="status" height={560} showEdgeLabels={false} />
      </div>

      {/* Detail below graph */}
      <NodeDetail node={selectedNode} layout="wide" ctx={{ nodesById, edges: standardGraph?.edges || [], mappedById, mode: 'diff' }} />

      {/* Extra — real environment capabilities absent from the standard graph */}
      {extraNodes.length > 0 && (
        <div className="glass p-5">
          <div className="flex items-center gap-2 mb-4">
            <PlusCircle className="h-4 w-4" style={{ color: '#A78BFA' }} />
            <h2 className="text-lg font-semibold text-[color:var(--ink-hi)]">Extra · 标准图谱外的真实能力</h2>
            <span className="text-xs text-[color:var(--ink-lo)]">真实环境存在但通用标准图谱未纳入 · {extraNodes.length} 项</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {extraNodes.map((ex: any) => (
              <div key={ex.id} className="rounded-xl border p-4 glass-hover flex flex-col gap-2" style={{ borderColor: 'rgba(167,139,250,0.35)', background: 'rgba(167,139,250,0.05)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-[color:var(--ink-hi)] truncate">{ex.name_zh}</div>
                    <div className="text-xs font-mono text-[color:var(--ink-lo)] mt-0.5">{ex.id} · {ex.name_en}</div>
                  </div>
                  <span className="chip chip-extra shrink-0">Extra</span>
                </div>
                <div className="text-sm text-[color:var(--ink-mid)] leading-relaxed">{ex.definition}</div>
                {Array.isArray(ex.evidence) && ex.evidence.length > 0 && (
                  <div className="pt-1">
                    <div className="eyebrow mb-1">证据 ({ex.evidence_count ?? ex.evidence.length})</div>
                    <div className="space-y-1">
                      {ex.evidence.slice(0, 3).map((e: any, i: number) => (
                        <div key={i} className="text-[11px] font-mono text-[color:var(--ink-lo)] break-all rounded bg-white/[0.02] border px-2 py-1" style={{ borderColor: 'var(--stroke-soft)' }}>{e.source_path}</div>
                      ))}
                    </div>
                  </div>
                )}
                {ex.recommendation && (
                  <div className="flex gap-2 leading-relaxed text-sm pt-1">
                    <span className="shrink-0 text-[11px] font-semibold mt-0.5 px-1.5 rounded" style={{ color: '#A78BFA', background: '#A78BFA14' }}>建议</span>
                    <span className="text-[color:var(--ink-mid)]">{ex.recommendation}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Remediation recommendations */}
      <div className="glass p-5">
        <div className="flex items-center gap-2 mb-4">
          <ArrowUpRight className="h-4 w-4" style={{ color: '#7FE9FF' }} />
          <h2 className="text-lg font-semibold text-[color:var(--ink-hi)]">整改建议 · Remediation</h2>
          <span className="text-xs text-[color:var(--ink-lo)]">按 权重 × 缺口 排序，Top {gapItems.length}</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {gapItems.map((rec: any) => {
            const sm = STATUS_META[rec.status] || STATUS_META.partial;
            const dm = DOMAIN_META[rec.domain];
            const prio = rec.priority;
            const prioColor: Record<string, string> = { immediate: '#FF5C7A', high: '#FFA33C', medium: '#38E1FF', low: '#6B7B99' };
            return (
              <div key={rec.node_id} className="rounded-xl border p-4 glass-hover flex flex-col gap-3" style={{ borderColor: 'var(--stroke-soft)' }}>
                {/* header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-[color:var(--ink-hi)] truncate">{rec.title}</div>
                    <div className="text-xs font-mono text-[color:var(--ink-lo)] mt-0.5">{rec.node_id} · {dm?.label_zh || rec.domain}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {prio && (
                      <span className="chip" style={{ background: `${prioColor[prio]}1a`, color: prioColor[prio], borderColor: `${prioColor[prio]}55`, textTransform: 'uppercase', fontSize: 10 }}>
                        {prio}
                      </span>
                    )}
                    <span className={`chip ${sm.chip}`}>{sm.label}</span>
                  </div>
                </div>

                {/* metrics row */}
                <div className="flex items-center gap-3 text-xs text-[color:var(--ink-lo)]">
                  <span>权重 <span className="text-[color:var(--ink-hi)]">{rec.importance_weight}</span></span>
                  <div className="flex-1"><ProgressBar ratio={rec.fulfillment_ratio ?? 0} color={sm.color} /></div>
                  <span>{Math.round((rec.fulfillment_ratio ?? 0) * 100)}%</span>
                  {rec.effort && <span className="chip" style={{ fontSize: 10, color: '#9CB3D6', background: 'rgba(156,179,214,0.10)', borderColor: 'rgba(156,179,214,0.3)' }}>Effort {rec.effort}</span>}
                </div>

                {/* structured remediation */}
                <div className="space-y-2 text-sm">
                  {rec.gap && <RecRow label="缺口" color="#FFA33C">{rec.gap}</RecRow>}
                  {rec.action && <RecRow label="建议" color="#34E5A3">{rec.action}</RecRow>}
                  {rec.assets && <RecRow label="数据源" color="#38E1FF">{rec.assets}</RecRow>}
                  {rec.impact && <RecRow label="影响" color="#FF5C7A">{rec.impact}</RecRow>}
                  {Array.isArray(rec.evidence_samples) && rec.evidence_samples.length > 0 && (
                    <div className="pt-1">
                      <div className="eyebrow mb-1">证据样本 ({rec.evidence_count})</div>
                      <div className="space-y-1">
                        {rec.evidence_samples.slice(0, 3).map((p: string, i: number) => (
                          <div key={i} className="text-[11px] font-mono text-[color:var(--ink-lo)] break-all rounded bg-white/[0.02] border px-2 py-1" style={{ borderColor: 'var(--stroke-soft)' }}>{p}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!rec.gap && !rec.action && (
                    <RecRow label="建议" color="#34E5A3">{rec.recommendation}</RecRow>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RecRow({ label, color, children }: { label: string; color: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 leading-relaxed">
      <span className="shrink-0 text-[11px] font-semibold mt-0.5 px-1.5 rounded" style={{ color, background: `${color}14` }}>{label}</span>
      <span className="text-[color:var(--ink-mid)]">{children}</span>
    </div>
  );
}

function StateCard({ status, count, total, icon }: { status: string; count: number; total: number; icon: ReactNode }) {
  const sm = STATUS_META[status];
  return (
    <div className="glass glass-hover p-4">
      <div className="flex items-center justify-between">
        <span className={`chip ${sm.chip}`}>{icon}{sm.label}</span>
        <span className="text-2xl font-bold font-display" style={{ color: sm.color }}>{count}</span>
      </div>
      <div className="mt-3"><ProgressBar ratio={count / total} color={sm.color} /></div>
      <div className="mt-1.5 text-xs text-[color:var(--ink-lo)]">{Math.round((count / total) * 100)}% of mapped nodes</div>
    </div>
  );
}
