import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AgentTab from '../AgentTab';
import type { Agent } from '../../types';

const agents: Agent[] = [
  { id: 'active', name: 'Active agent', type: 'agent', description: 'Running checks', status: 'Active', tasksCount: 1, lastUpdated: 'now' },
  { id: 'idle', name: 'Idle agent', type: 'agent', description: 'Waiting for work', status: 'Idle', tasksCount: 0, lastUpdated: 'now' },
  { id: 'offline', name: 'Offline agent', type: 'agent', description: 'Unavailable', status: 'Offline', tasksCount: 0, lastUpdated: 'now' },
];

describe('AgentTab status presentation', () => {
  afterEach(() => cleanup());

  it('uses semantic status badges and indicators for every runtime state', () => {
    render(
      <AgentTab
        agents={agents}
        busy={false}
        onCreate={vi.fn(async () => {})}
        onDelete={vi.fn(async () => {})}
        onRefresh={vi.fn(async () => {})}
        onUpdate={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText('Active', { selector: '.aegis-status-badge' })).toHaveClass('aegis-status-badge--success');
    expect(screen.getByText('Idle', { selector: '.aegis-status-badge' })).toHaveClass('aegis-status-badge--warning');
    expect(screen.getByText('Offline', { selector: '.aegis-status-badge' })).toHaveClass('aegis-status-badge--danger');
    expect(document.querySelectorAll('.aegis-status-indicator--success')).toHaveLength(1);
    expect(document.querySelectorAll('.aegis-status-indicator--warning')).toHaveLength(1);
    expect(document.querySelectorAll('.aegis-status-indicator--danger')).toHaveLength(1);
  });
});
