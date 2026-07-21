import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionWorkflow from '../SessionWorkflow';
import { Conversation } from '../../types';

afterEach(() => cleanup());

function completedConversation(): Conversation {
  return {
    id: 'conversation-1',
    title: 'Phishing Investigation',
    timestamp: '10:00',
    messages: [
      {
        id: 'user-1',
        sender: 'user',
        kind: 'chat',
        text: 'Investigate the suspicious phishing message and inspect every linked domain',
        timestamp: '10:00',
        turnId: 'turn-1',
        source: 'main',
      },
      {
        id: 'assistant-1',
        sender: 'aegis',
        kind: 'chat',
        text: 'The investigation is complete with one confirmed phishing domain.',
        timestamp: '10:01',
        turnId: 'turn-1',
        source: 'main',
      },
    ],
    workflowTraceVersion: 1,
    workflowTrace: [
      {
        id: 'accepted',
        type: 'message.accepted',
        timestamp: 1,
        turnId: 'turn-1',
        source: 'main',
      },
      {
        id: 'tool',
        type: 'tool.completed',
        timestamp: 2,
        turnId: 'turn-1',
        source: 'main',
        toolName: 'terminal',
        toolCallId: 'tool-1',
        argsPreview: '{"cmd":"pwd"}',
        resultPreview: '/Users/demo',
      },
      {
        id: 'final',
        type: 'message.completed',
        timestamp: 2.5,
        turnId: 'turn-1',
        source: 'main',
        messageId: 'assistant-1',
        content: 'The investigation is complete with one confirmed phishing domain.',
      },
      {
        id: 'idle',
        type: 'run.state',
        timestamp: 3,
        turnId: 'turn-1',
        source: 'main',
        state: 'idle',
      },
    ],
  };
}

describe('SessionWorkflow', () => {
  it('keeps node labels compact and reveals full details only after selection', () => {
    render(
      <SessionWorkflow
        conversation={completedConversation()}
        fullscreen={false}
        onFullscreenChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Investigate the suspicio…')).toBeInTheDocument();
    expect(
      screen.queryByText('Investigate the suspicious phishing message and inspect every linked domain'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /select investigate the suspicious/i }));

    expect(screen.getByText('NODE DETAILS')).toBeInTheDocument();
    expect(
      screen.getByText('Investigate the suspicious phishing message and inspect every linked domain'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('workflow-node-turn:turn-1')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('workflow-node-session:conversation-1')).toHaveAttribute(
      'data-highlighted',
      'true',
    );
  });

  it('supports zoom controls and fullscreen and close actions', async () => {
    const onFullscreenChange = vi.fn();
    const onClose = vi.fn();
    render(
      <SessionWorkflow
        conversation={completedConversation()}
        fullscreen={false}
        onFullscreenChange={onFullscreenChange}
        onClose={onClose}
      />,
    );

    const canvas = screen.getByTestId('workflow-canvas');
    const initialScale = Number(canvas.getAttribute('data-scale'));
    fireEvent.click(screen.getByRole('button', { name: /zoom in workflow/i }));
    await waitFor(() => {
      expect(Number(canvas.getAttribute('data-scale'))).toBeGreaterThan(initialScale);
    });

    expect(screen.getByRole('button', { name: /fit workflow to view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset workflow view/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /enter workflow fullscreen/i }));
    expect(onFullscreenChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /close workflow visualization/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps trackpad scrolling inside node details from zooming the workflow canvas', async () => {
    render(
      <SessionWorkflow
        conversation={completedConversation()}
        fullscreen={false}
        onFullscreenChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const canvas = screen.getByTestId('workflow-canvas');
    fireEvent.click(screen.getByTestId('workflow-node-end:main:turn-1'));
    const detailScroll = screen.getByTestId('workflow-node-details-scroll');
    const scaleBeforeDetailWheel = canvas.getAttribute('data-scale');

    fireEvent.wheel(detailScroll, { deltaY: 100, clientX: 300, clientY: 300 });
    expect(canvas).toHaveAttribute('data-scale', scaleBeforeDetailWheel);
    expect(screen.getByText('FINAL MESSAGE')).toBeInTheDocument();
    expect(
      screen.getByText('The investigation is complete with one confirmed phishing domain.'),
    ).toBeInTheDocument();

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 300, clientY: 300 });
    await waitFor(() => {
      expect(canvas.getAttribute('data-scale')).not.toBe(scaleBeforeDetailWheel);
    });
  });

  it('pans the canvas and clears a selected node when the user clicks blank canvas', async () => {
    const onClose = vi.fn();
    render(
      <SessionWorkflow
        conversation={completedConversation()}
        fullscreen={false}
        onFullscreenChange={vi.fn()}
        onClose={onClose}
      />,
    );

    const canvas = screen.getByTestId('workflow-canvas');
    const initialX = Number(canvas.getAttribute('data-offset-x'));
    fireEvent.pointerDown(canvas, { pointerId: 7, clientX: 30, clientY: 40 });
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 90, clientY: 70 });
    fireEvent.pointerUp(canvas, { pointerId: 7 });
    await waitFor(() => {
      expect(Number(canvas.getAttribute('data-offset-x'))).toBeGreaterThan(initialX);
    });

    fireEvent.click(screen.getByRole('button', { name: /select investigate the suspicious/i }));
    expect(screen.getByText('NODE DETAILS')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Session execution tree'));
    expect(screen.queryByText('NODE DETAILS')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('preserves selection and a user-adjusted viewport as live events extend the same session', async () => {
    const initialConversation = completedConversation();
    const { rerender } = render(
      <SessionWorkflow
        conversation={initialConversation}
        fullscreen={false}
        onFullscreenChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const canvas = screen.getByTestId('workflow-canvas');
    await waitFor(() => expect(canvas).not.toHaveAttribute('data-scale', '1.00'));
    fireEvent.click(screen.getByRole('button', { name: /zoom in workflow/i }));
    fireEvent.click(screen.getByRole('button', { name: /select investigate the suspicious/i }));
    const adjustedScale = canvas.getAttribute('data-scale');

    rerender(
      <SessionWorkflow
        conversation={{
          ...initialConversation,
          workflowTrace: [
            ...(initialConversation.workflowTrace || []),
            {
              id: 'late-tool',
              type: 'tool.completed',
              timestamp: 4,
              turnId: 'turn-1',
              source: 'main',
              toolName: 'report_builder',
              toolCallId: 'tool-2',
            },
          ],
        }}
        fullscreen={false}
        onFullscreenChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('NODE DETAILS')).toBeInTheDocument());
    expect(canvas).toHaveAttribute('data-scale', adjustedScale);
    expect(screen.getByTestId('workflow-node-tool:turn-1:tool-2')).toBeInTheDocument();
  });

  it('renders a partial static tree from legacy cached messages without a trace', () => {
    const legacyConversation: Conversation = {
      id: 'legacy-conversation',
      title: 'Legacy Investigation',
      timestamp: '10:00',
      messages: [
        {
          id: 'legacy-user',
          sender: 'user',
          kind: 'chat',
          text: 'Review the legacy alert',
          timestamp: '10:00',
        },
        {
          id: 'legacy-tools',
          sender: 'aegis',
          kind: 'main-tools',
          text: 'Main orchestration activity',
          timestamp: '10:01',
          turnId: 'legacy-turn-id',
          source: 'main',
          chainSteps: [
            {
              id: 'legacy-tool',
              agentName: 'terminal',
              type: 'vip_tool',
              status: 'Completed',
              message: 'done',
              timestamp: '10:01',
            },
          ],
        },
        {
          id: 'legacy-delegate-tools',
          sender: 'aegis',
          kind: 'delegate-tools',
          text: 'Delegate Tool Activity',
          timestamp: '10:02',
          turnId: 'legacy-turn-id',
          source: 'delegate',
          srcagent: 'threat-intel',
          delegateTools: [
            {
              id: 'legacy-delegate-tool',
              toolName: 'ioc_lookup',
              argsPreview: 'example.com',
              resultPreview: 'malicious',
              status: 'completed',
            },
          ],
        },
      ],
    };

    render(
      <SessionWorkflow
        conversation={legacyConversation}
        fullscreen={false}
        onFullscreenChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('PARTIAL TRACE')).toBeInTheDocument();
    expect(screen.getByText('Review the legacy alert')).toBeInTheDocument();
    expect(screen.getByText('terminal')).toBeInTheDocument();
    expect(screen.getByText('threat-intel')).toBeInTheDocument();
    expect(screen.getByText('ioc_lookup')).toBeInTheDocument();
  });

  it('does not invent a legacy node for a newly submitted message awaiting acceptance', () => {
    render(
      <SessionWorkflow
        conversation={{
          id: 'live-conversation',
          title: 'Live Investigation',
          timestamp: '10:00',
          messages: [
            {
              id: 'optimistic-user',
              sender: 'user',
              kind: 'chat',
              text: 'New live turn',
              timestamp: '10:00',
              clientMsgId: 'client-live',
            },
          ],
        }}
        fullscreen={false}
        onFullscreenChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('AWAITING FIRST TURN')).toBeInTheDocument();
    expect(screen.queryByText('New live turn')).not.toBeInTheDocument();
    expect(screen.queryByText('PARTIAL TRACE')).not.toBeInTheDocument();
  });
});
