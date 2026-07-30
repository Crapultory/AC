import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { domainColor, statusColor, objectTypeColor } from '../design/tokens';

interface GraphEdge { id: string; source: string; target: string; type?: string; label?: string; kind?: string; cross_domain?: boolean }

type ColorMode = 'domain' | 'status';

export function GraphCanvas({
  nodes,
  edges = [],
  onSelect,
  selectedId,
  colorMode = 'domain',
  height = 560,
  showEdgeLabels = true,
}: {
  nodes: any[];
  edges?: GraphEdge[];
  onSelect: (n: any) => void;
  selectedId?: string | null;
  colorMode?: ColorMode;
  height?: number;
  showEdgeLabels?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [ready, setReady] = useState(false);

  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const paint = (node: any) => {
    if (colorMode === 'status' && node.status) return statusColor(node.status);
    // Layer-3 objects are painted by object_type (distinct visual register)
    if (node.type === 'Object' || node.object_type) return objectTypeColor(node.object_type);
    return domainColor(node.domain || node.id);
  };

  const layerOf = (node: any): number =>
    node.layer || (node.type === 'Domain' ? 1 : (node.type === 'Object' || node.object_type) ? 3 : 2);

  const elements = useMemo(() => {
    const nodeEls = nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.label || node.name_zh || node.name_en || node.id,
        color: paint(node),
        weight: Number(node.importance_weight ?? node.subtotal ?? 2.2),
        ratio: Number(node.fulfillment_ratio ?? 1),
        isDomain: node.type === 'Domain' || undefined,
        layer: layerOf(node),
        otype: node.object_type || undefined,
        raw: node,
      },
    }));
    const edgeEls = edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label || e.type || '',
          kind: e.kind || 'semantic',
          cross: e.cross_domain ? 'yes' : 'no',
        },
      }));
    return [...nodeEls, ...edgeEls];
  }, [nodes, edges, nodeIds, colorMode]);

  useEffect(() => {
    if (!ref.current) return;
    setReady(false);
    cyRef.current?.destroy();
    const cy = cytoscape({
      container: ref.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.92,
            label: 'data(label)',
            color: '#DCE8FF',
            'font-family': 'Inter, sans-serif',
            'font-size': 11,
            'font-weight': 500,
            'text-wrap': 'wrap',
            'text-max-width': '96px',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-outline-color': '#05070D',
            'text-outline-width': 3,
            'min-zoomed-font-size': 7,
            width: (e: any) => `${Math.min(46, Math.max(22, Number(e.data('weight')) * 8))}`,
            height: (e: any) => `${Math.min(46, Math.max(22, Number(e.data('weight')) * 8))}`,
            shape: 'ellipse',
            'border-width': 2,
            'border-color': 'data(color)',
            'border-opacity': 0.5,
            'transition-property': 'opacity, border-width, border-opacity',
            'transition-duration': 160,
          } as any,
        },
        {
          selector: 'node[isDomain]',
          style: {
            shape: 'ellipse',
            width: (e: any) => `${Math.min(120, 60 + Number(e.data('weight')) * 3.5)}`,
            height: (e: any) => `${Math.min(120, 60 + Number(e.data('weight')) * 3.5)}`,
            'font-family': 'Orbitron, Inter, sans-serif',
            'font-size': 13,
            'font-weight': 700,
            'text-valign': 'center',
            'text-margin-y': 0,
            'text-max-width': '90px',
            'border-width': 3,
            'border-opacity': 0.9,
            'background-opacity': 0.22,
            'z-index': 10,
          } as any,
        },
        { selector: 'node:selected', style: { 'border-width': 5, 'border-opacity': 1, 'border-color': '#7FE9FF' } },
        // Layer-2 subcapability — medium ellipse, domain-tinted, soft glow
        {
          selector: 'node[layer = 2]',
          style: {
            shape: 'round-rectangle',
            'background-opacity': 0.9,
            'border-width': 1.5,
            'border-opacity': 0.7,
          } as any,
        },
        // Layer-3 objects — smaller, low-saturation "metallic" register, shape by type
        {
          selector: 'node[layer = 3]',
          style: {
            'background-opacity': 0.72,
            'font-size': 9,
            'text-max-width': '80px',
            width: 18,
            height: 18,
            'border-width': 1,
            'border-opacity': 0.4,
          } as any,
        },
        { selector: 'node[otype = "system"]', style: { shape: 'round-diamond' } as any },
        { selector: 'node[otype = "data_source"]', style: { shape: 'round-tag' } as any },
        { selector: 'node[otype = "tool"]', style: { shape: 'round-hexagon' } as any },
        { selector: 'node[otype = "action"]', style: { shape: 'round-triangle' } as any },
        { selector: 'node.hl', style: { 'border-width': 4, 'border-opacity': 1 } },
        { selector: '.dim', style: { opacity: 0.12 } },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#2A3E5C',
            'curve-style': 'bezier',
            'target-arrow-shape': 'none',
            opacity: 0.28,
            'transition-property': 'opacity, line-color, width',
            'transition-duration': 160,
          } as any,
        },
        {
          selector: 'edge[kind = "semantic"]',
          style: {
            width: 1.4,
            'line-color': '#3C5A86',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#3C5A86',
            'arrow-scale': 0.8,
            opacity: 0.5,
            label: showEdgeLabels ? 'data(label)' : '',
            'font-size': 10,
            'font-family': 'Inter, sans-serif',
            color: '#AEC4E6',
            'text-background-color': '#060A12',
            'text-background-opacity': 0.85,
            'text-background-padding': '3px',
            'text-rotation': 'autorotate',
          } as any,
        },
        {
          selector: 'edge[cross = "yes"]',
          style: {
            width: 1.8,
            'line-color': '#4DA3FF',
            'target-arrow-color': '#4DA3FF',
            opacity: 0.6,
            color: '#9CC4FF',
          } as any,
        },
        {
          selector: 'edge.hl',
          style: {
            'line-color': '#7FE9FF',
            'target-arrow-color': '#7FE9FF',
            'target-arrow-shape': 'triangle',
            width: 2.6,
            opacity: 1,
            'line-style': 'dashed',
            'line-dash-pattern': [6, 4],
            label: 'data(label)',
            'font-size': 11,
            'font-weight': 600,
            color: '#EAF2FF',
            'text-background-color': '#060A12',
            'text-background-opacity': 0.9,
            'text-background-padding': '3px',
            'text-rotation': 'autorotate',
            'z-index': 999,
          } as any,
        },
      ],
      layout: {
        name: 'cose',
        fit: true,
        padding: 40,
        animate: true,
        animationDuration: 700,
        nodeDimensionsIncludeLabels: true,
        nodeRepulsion: () => 42000,
        nodeOverlap: 32,
        idealEdgeLength: () => 165,
        edgeElasticity: () => 120,
        gravity: 32,
        componentSpacing: 160,
        numIter: 2500,
        coolingFactor: 0.96,
        initialTemp: 220,
        randomize: true,
      } as any,
      minZoom: 0.25,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
    });

    cy.on('tap', 'node', (evt) => onSelect(evt.target.data('raw')));
    cy.on('tap', (evt) => { if (evt.target === cy) onSelect(null as any); });
    cy.on('mouseover', 'node', (evt) => {
      const nb = evt.target.closedNeighborhood();
      cy.elements().addClass('dim');
      nb.removeClass('dim').addClass('hl');
    });
    cy.on('mouseout', 'node', () => cy.elements().removeClass('dim').removeClass('hl'));
    cy.one('layoutstop', () => setReady(true));

    // link-flow animation via marching-ants offset on hovered edges
    let offset = 0;
    let raf = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flow = () => {
      offset = (offset + 0.6) % 10;
      cy.edges('.hl').style('line-dash-offset', -offset);
      raf = requestAnimationFrame(flow);
    };
    if (!reduced) flow();

    cyRef.current = cy;
    return () => { cancelAnimationFrame(raf); cy.destroy(); };
  }, [elements, onSelect, colorMode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().unselect();
    if (selectedId) {
      const n = cy.getElementById(selectedId);
      if (n && n.length) {
        n.select();
        cy.animate({ fit: { eles: n.closedNeighborhood(), padding: 90 }, duration: 300, easing: 'ease-out' });
      }
    }
  }, [selectedId]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div
        ref={ref}
        className="h-full w-full rounded-2xl border overflow-hidden"
        style={{
          borderColor: 'var(--stroke-soft)',
          background:
            'radial-gradient(600px 400px at 30% 15%, rgba(56,225,255,0.06), transparent 55%), radial-gradient(600px 400px at 75% 80%, rgba(167,139,250,0.06), transparent 55%), #060A12',
        }}
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-[color:var(--ink-lo)] font-mono">
          <span className="anim-pulse">compiling graph layout…</span>
        </div>
      )}
    </div>
  );
}
