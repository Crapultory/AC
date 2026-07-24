import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import StarmappingTopology from '../StarmappingTopology';
import type { StarmappingTopology as StarmappingTopologyData } from '../../types';

const topology: StarmappingTopologyData = {
  schema_version: '1.0.0',
  updated_at: '2026-07-24',
  center: {
    id: 'aegis', layer: 'center', name: 'Aegis', symbol: 'aegis-connection',
    role: 'Security & Operations Orchestration Core', description: '统一编排中枢。',
    capabilities: ['agent-delegation'], layout: { x: 0.5, y: 0.5, radius: 'core' },
  },
  agents: [{
    id: 'ai-soc', layer: 'agent_ring', business_domain: 'AI-SOC', name: 'Argus', display_name: 'AI-SOC · Argus', marketing_name: '[ Argus ]', symbol: 'argus-eyes',
    cultural_origin: '希腊神话·百眼巨人', business_fit: '全天候、零死角威胁监控与感知', role: '安全运营',
    layout: { ring_position: 0, angle_degrees: 270, radius: 'agent' }, runtime: { status: 'active', source: 'a2a_registry' },
    star_nodes: Array.from({ length: 10 }, (_, index) => ({
      id: `argus-star-${index}`, layer: 'star_field' as const, kind: index === 0 ? 'tool' as const : 'data' as const,
      name: index === 0 ? 'SIEM 检索与关联' : `安全数据 ${index}`, integration: index === 0 ? 'Splunk API' : 'Data lake API',
      purpose: index === 0 ? '检索、关联和回溯安全事件' : '提供安全证据', required: true,
    })),
  }],
  edges: [
    { source: 'aegis', target: 'ai-soc', mode: 'orchestrates' },
    ...Array.from({ length: 10 }, (_, index) => ({ source: 'ai-soc', target: `argus-star-${index}`, mode: 'requires' as const })),
  ],
};

afterEach(cleanup);

describe('StarmappingTopology', () => {
  it('shows and illuminates API-backed node details on hover', () => {
    render(<StarmappingTopology topology={topology} error="" />);

    expect(screen.getByTestId('star-map-background')).toBeInTheDocument();
    expect(screen.getByTestId('topology-symbol-aegis')).toBeInTheDocument();
    expect(screen.getByTestId('topology-symbol-ai-soc')).toBeInTheDocument();
    expect(screen.getAllByTestId('topology-flow')).toHaveLength(1);
    expect(screen.getAllByTestId('topology-twinkle')).toHaveLength(10);

    const agent = screen.getByLabelText(/AI-SOC · Argus/);
    fireEvent.pointerEnter(agent, { clientX: 100, clientY: 100 });
    expect(screen.getByText('全天候、零死角威胁监控与感知')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();

    const star = screen.getByLabelText(/SIEM 检索与关联/);
    fireEvent.pointerEnter(star, { clientX: 220, clientY: 180 });
    expect(screen.getByText('检索、关联和回溯安全事件')).toBeInTheDocument();
    expect(screen.getByText(/Splunk API · REQUIRED/)).toBeInTheDocument();
  });

  it('requests native fullscreen mode from the topology control', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    render(<StarmappingTopology topology={topology} error="" />);

    fireEvent.click(screen.getByRole('button', { name: 'Enter topology fullscreen' }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });
});
