import type { ReactNode } from 'react';
import { Sparkles, FileText, Layers, ArrowUp, ArrowDown, Boxes, Wrench, Database, Terminal, Server, Lightbulb } from 'lucide-react';
import { DOMAIN_META, STATUS_META, domainColor } from '../design/tokens';

const OBJ_TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  system: { label: '对接系统', icon: Server, color: '#4DA3FF' },
  data_source: { label: '数据源', icon: Database, color: '#34E5A3' },
  tool: { label: '工具', icon: Wrench, color: '#FFC24B' },
  action: { label: '动作', icon: Terminal, color: '#C084FC' },
};

interface NeighborCtx {
  nodesById?: Record<string, any>;
  edges?: any[];
  mappedById?: Record<string, any>; // diff mode: subcap id -> mapped node (has object_detail)
  mode?: 'standard' | 'diff';
}

export function NodeDetail({ node, layout = 'panel', ctx }: { node: any | null; layout?: 'panel' | 'wide'; ctx?: NeighborCtx }) {
  if (!node) {
    return (
      <div className="glass border-dashed min-h-[120px] flex flex-col sm:flex-row items-center justify-center text-center sm:text-left gap-4 p-5">
        <div className="h-11 w-11 rounded-full flex items-center justify-center anim-pulse shrink-0" style={{ background: 'rgba(56,225,255,0.1)', border: '1px solid rgba(56,225,255,0.3)' }}>
          <Sparkles className="h-5 w-5" style={{ color: '#7FE9FF' }} />
        </div>
        <div>
          <div className="text-sm font-medium text-[color:var(--ink-hi)]">选择一个节点查看详情</div>
          <div className="text-xs text-[color:var(--ink-lo)] max-w-[420px] leading-relaxed mt-0.5">
            点击图谱中的任意节点：查看定义、业务价值、权重/满足状态、关联上下级节点，以及三级对象的数据支撑建议。
          </div>
        </div>
      </div>
    );
  }

  const dm = DOMAIN_META[node.domain || ''];
  const sm = STATUS_META[node.status || ''];
  const accent = domainColor(node.domain || node.id);
  const grid = layout === 'wide' ? 'md:grid-cols-4' : 'grid-cols-2';
  const layer: number = node.layer || (node.type === 'Domain' ? 1 : node.type === 'Object' ? 3 : node.object_type ? 3 : 2);
  const nodesById = ctx?.nodesById || {};
  const edges = ctx?.edges || [];
  const mode = ctx?.mode || 'standard';

  // compute up (parents/incoming) and down (children/outgoing) neighbors
  const up: any[] = [];
  const down: any[] = [];
  edges.forEach((e: any) => {
    if (e.target === node.id) up.push({ ...e, other: nodesById[e.source] });
    if (e.source === node.id) down.push({ ...e, other: nodesById[e.target] });
  });

  const isObject = layer === 3 || !!node.object_type;
  const otm = isObject ? OBJ_TYPE_META[node.object_type || ''] : null;

  // diff mode: for a subcapability, pull object_detail (real evidence + unmet)
  const mapped = ctx?.mappedById?.[node.id];
  const objectDetail: any[] = mapped?.object_detail || [];

  return (
    <div className="glass p-5 space-y-4 anim-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent, boxShadow: `0 0 10px ${accent}` }} />
            <div className="text-lg font-semibold text-[color:var(--ink-hi)] truncate">{node.label || node.name_zh || node.name_en}</div>
            <LayerBadge layer={layer} />
          </div>
          <div className="text-xs font-mono text-[color:var(--ink-lo)] mt-1 break-all">{node.id}{node.name_en ? ` · ${node.name_en}` : ''}</div>
        </div>
        {sm && <span className={`chip ${sm.chip} shrink-0`}>{sm.label}</span>}
      </div>

      <div className="hairline" />

      <div className={`grid ${grid} gap-3 text-sm`}>
        <Field label="Layer" value={layer === 1 ? '① 核心域' : layer === 2 ? '② 二级功能' : '③ 三级对象'} />
        <Field label="Domain" value={dm ? `${node.domain} · ${dm.label_zh}` : (node.domain || (isObject ? '共享对象' : 'N/A'))} />
        {otm ? <Field label="Object Type" value={otm.label} /> : <Field label="Type" value={node.type || 'Capability'} />}
        {'importance_weight' in node && node.importance_weight != null && <Field label="Weight" value={String(node.importance_weight)} />}
        {'subtotal' in node && node.subtotal != null && <Field label="Subtotal" value={String(node.subtotal)} />}
        {'fulfillment_ratio' in node && node.fulfillment_ratio != null && <Field label="Fulfillment" value={`${Math.round((node.fulfillment_ratio ?? 0) * 100)}%`} />}
      </div>

      {node.definition && <Block icon={<Layers className="h-3.5 w-3.5" />} label="定义 Definition">{node.definition}</Block>}
      {node.business_value && <Block icon={<Sparkles className="h-3.5 w-3.5" />} label="业务价值 Business Value">{node.business_value}</Block>}

      {/* ── Object support suggestion (Layer 3, standard mode) ── */}
      {isObject && node.support && (
        <Block icon={<Lightbulb className="h-3.5 w-3.5" />} label="满足该对象所需的数据支撑建议">
          {node.support}
        </Block>
      )}

      {/* ── Related up/down neighbors ── */}
      {(up.length > 0 || down.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-4">
          <NeighborList title="上级 / 输入关联" icon={<ArrowUp className="h-3.5 w-3.5" />} items={up} />
          <NeighborList title="下级 / 输出关联" icon={<ArrowDown className="h-3.5 w-3.5" />} items={down} />
        </div>
      )}

      {/* ── Diff mode: subcapability's Layer-3 object realisation (real tools/elements + optimization) ── */}
      {mode === 'diff' && objectDetail.length > 0 && (
        <div>
          <div className="eyebrow mb-2 flex items-center gap-1.5"><Boxes className="h-3.5 w-3.5" /> 三级对象实现情况 ({objectDetail.filter((o) => o.satisfied).length}/{objectDetail.length})</div>
          <div className="space-y-2">
            {objectDetail.map((o: any) => {
              const t = OBJ_TYPE_META[o.object_type] || OBJ_TYPE_META.tool;
              const Icon = t.icon;
              const sat = o.satisfaction ?? (o.satisfied ? 1 : 0);
              const statusColor = sat >= 1 ? '#34E5A3' : sat > 0 ? '#FFC24B' : '#FF6B8A';
              const statusLabel = sat >= 1 ? '已满足' : sat > 0 ? '部分满足' : '缺失';
              return (
                <div key={o.object_id} className="rounded-lg border p-2.5 text-xs" style={{ borderColor: 'var(--stroke-soft)', background: 'rgba(255,255,255,0.02)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[color:var(--ink-hi)]">
                      <Icon className="h-3.5 w-3.5" style={{ color: t.color }} />
                      {o.name_zh}
                      <span className="text-[10px] text-[color:var(--ink-lo)]">{t.label}</span>
                    </span>
                    <span className="chip" style={{ background: `${statusColor}1a`, color: statusColor, borderColor: `${statusColor}55`, fontSize: 10 }}>{statusLabel}</span>
                  </div>
                  {o.satisfied && o.evidence?.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      <div className="text-[10px] text-[color:var(--ink-lo)] uppercase tracking-wide">当前关联的真实工具/元素</div>
                      {o.evidence.slice(0, 2).map((ev: any, i: number) => (
                        <div key={i} className="font-mono text-[11px] text-[color:var(--ink-mid)] break-all">{ev.source_path}</div>
                      ))}
                    </div>
                  )}
                  {!o.satisfied && (
                    <div className="mt-1.5 flex gap-1.5">
                      <span className="shrink-0 text-[10px] font-semibold px-1.5 rounded" style={{ color: '#34E5A3', background: '#34E5A314' }}>优化建议</span>
                      <span className="text-[color:var(--ink-mid)] leading-relaxed">{o.support}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Evidence (subcapability roll-up, when present) ── */}
      {mode !== 'diff' && Array.isArray(node.evidence) && node.evidence.length > 0 && (
        <div>
          <div className="eyebrow mb-2 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Evidence ({node.evidence.length})</div>
          <div className="space-y-2">
            {node.evidence.slice(0, 4).map((ev: any, i: number) => (
              <div key={i} className="rounded-lg border p-2.5 text-xs font-mono break-all" style={{ borderColor: 'var(--stroke-soft)', background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-[color:var(--ink-mid)]">{ev.source_path}</div>
                <div className="text-[color:var(--ink-lo)] mt-1">{[ev.confidence, ev.discovery_method].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LayerBadge({ layer }: { layer: number }) {
  const map: Record<number, { t: string; c: string }> = {
    1: { t: 'L1 域', c: '#4DA3FF' }, 2: { t: 'L2 功能', c: '#34E5A3' }, 3: { t: 'L3 对象', c: '#C084FC' },
  };
  const m = map[layer] || map[2];
  return <span className="chip shrink-0" style={{ background: `${m.c}1a`, color: m.c, borderColor: `${m.c}55`, fontSize: 10 }}>{m.t}</span>;
}

function NeighborList({ title, icon, items }: { title: string; icon: ReactNode; items: any[] }) {
  if (items.length === 0) return (
    <div>
      <div className="eyebrow mb-1.5 flex items-center gap-1.5">{icon} {title}</div>
      <div className="text-xs text-[color:var(--ink-lo)] italic">无</div>
    </div>
  );
  return (
    <div>
      <div className="eyebrow mb-1.5 flex items-center gap-1.5">{icon} {title} ({items.length})</div>
      <div className="space-y-1">
        {items.slice(0, 8).map((it: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="chip" style={{ fontSize: 9, color: '#9CB3D6', background: 'rgba(156,179,214,0.10)', borderColor: 'rgba(156,179,214,0.3)' }}>{it.label || it.type}</span>
            <span className="text-[color:var(--ink-mid)] truncate">{it.other?.label || it.other?.name_zh || (it.target === undefined ? it.source : it.target)}</span>
            <span className="text-[10px] font-mono text-[color:var(--ink-lo)] shrink-0">{it.other?.id || ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-[color:var(--ink-hi)]">{value}</div>
    </div>
  );
}

function Block({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5 flex items-center gap-1.5">{icon} {label}</div>
      <div className="text-sm text-[color:var(--ink-mid)] leading-relaxed">{children}</div>
    </div>
  );
}
