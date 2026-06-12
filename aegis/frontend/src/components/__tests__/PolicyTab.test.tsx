import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PolicyTab from '../PolicyTab';
import { initialRules } from '../../data/mockData';

describe('PolicyTab', () => {
  it('shows only the global routing rules entry point', () => {
    render(
      <PolicyTab
        rules={initialRules}
        setRules={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /global routing rules/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /agent card rules/i }),
    ).not.toBeInTheDocument();
  });
});
