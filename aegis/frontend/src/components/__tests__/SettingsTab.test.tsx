import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsTab from '../SettingsTab';


function jsonResponse(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}


describe('Aegis Settings restart controls', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('aegis_session_token', 'settings-jwt');
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('groups the current settings content in the selected Status tab', () => {
    global.fetch = vi.fn(async () => jsonResponse({ status: 'ok', pid: 123 })) as typeof global.fetch;

    render(<SettingsTab />);

    const tab = screen.getByRole('tab', { name: 'Status' });
    const panel = screen.getByRole('tabpanel');
    expect(screen.getByRole('tablist')).toHaveClass('aegis-page-tabs--compact');
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(within(panel).getByRole('heading', { name: /runtime status/i })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: /dangerous actions/i })).toBeInTheDocument();
  });

  it('switches the local License mock with click and standard tab keyboard navigation', () => {
    global.fetch = vi.fn(async () => jsonResponse({ status: 'ok', pid: 123 })) as typeof global.fetch;

    render(<SettingsTab />);

    const statusTab = screen.getByRole('tab', { name: 'Status' });
    const licenseTab = screen.getByRole('tab', { name: 'LIC Management' });
    expect(licenseTab).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(licenseTab);
    const licensePanel = screen.getByRole('tabpanel');
    expect(licenseTab).toHaveAttribute('aria-selected', 'true');
    expect(licensePanel).toHaveAttribute('aria-labelledby', licenseTab.id);
    expect(within(licensePanel).getByRole('heading', { name: /license management/i })).toBeInTheDocument();
    expect(within(licensePanel).getByText('AEG-ENT-EVAL-2026-LOCAL')).toBeInTheDocument();
    expect(within(licensePanel).getByText('A2A Orchestration')).toBeInTheDocument();
    expect(screen.getByText('LOCAL MOCK / DEMO DATA')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(licenseTab, { key: 'Home' });
    expect(statusTab).toHaveFocus();
    expect(statusTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(statusTab, { key: 'ArrowRight' });
    expect(licenseTab).toHaveFocus();
    expect(licenseTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(licenseTab, { key: 'ArrowLeft' });
    expect(statusTab).toHaveFocus();
    expect(statusTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(statusTab, { key: 'End' });
    expect(licenseTab).toHaveFocus();
    expect(licenseTab).toHaveAttribute('aria-selected', 'true');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('requires both confirmation stages and the exact phrase before an authenticated restart', async () => {
    const requests: Array<{ url: string; method: string; auth: string | null }> = [];
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      const headers = new Headers(init?.headers || {});
      requests.push({ url, method, auth: headers.get('Authorization') });
      if (url === '/health') {
        return jsonResponse({ status: 'ok', pid: 123 });
      }
      if (url === '/api/system/restart' && method === 'POST') {
        return jsonResponse({
          accepted: true,
          already_requested: false,
          service: 'aegis',
          pid: 123,
        }, 202);
      }
      throw new Error(`Unhandled request: ${method} ${url}`);
    }) as typeof global.fetch;

    render(<SettingsTab />);

    fireEvent.click(screen.getByRole('button', { name: /restart aegis/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/service interruption/i);
    expect(requests.some((request) => request.url === '/api/system/restart')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    const confirmation = screen.getByLabelText(/restart confirmation phrase/i);
    const confirmButton = screen.getByRole('button', { name: /confirm restart/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(confirmation, { target: { value: 'RESTART AEGIS ' } });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: 'RESTART AEGIS' } });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /restarting/i })).toBeDisabled();
    });
    expect(requests).toContainEqual({
      url: '/api/system/restart',
      method: 'POST',
      auth: 'Bearer settings-jwt',
    });
  });

  it('delegates an expired restart session to the app auth-expiry flow', async () => {
    const onAuthExpired = vi.fn();
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') {
        return jsonResponse({ status: 'ok', pid: 123 });
      }
      if (url === '/api/system/restart' && init?.method === 'POST') {
        return jsonResponse({ detail: 'Token expired' }, 401);
      }
      throw new Error(`Unhandled request: ${url}`);
    }) as typeof global.fetch;

    render(<SettingsTab onAuthExpired={onAuthExpired} />);
    fireEvent.click(screen.getByRole('button', { name: /restart aegis/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/restart confirmation phrase/i), {
      target: { value: 'RESTART AEGIS' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm restart/i }));

    await waitFor(() => {
      expect(onAuthExpired).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/restart request failed/i)).not.toBeInTheDocument();
  });

  it('keeps a dispatched restart modal busy and contained until the response starts polling', async () => {
    const reloadPage = vi.fn();
    let healthCalls = 0;
    let restartSignal: AbortSignal | undefined;
    let resolveRestart: ((response: Response) => void) | undefined;
    global.fetch = vi.fn((input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') {
        healthCalls += 1;
        return Promise.resolve(jsonResponse({ status: 'ok', pid: healthCalls === 1 ? 123 : 456 }));
      }
      if (url === '/api/system/restart' && init?.method === 'POST') {
        const signal = init.signal;
        if (!signal) {
          throw new Error('Restart request must include an AbortSignal');
        }
        restartSignal = signal;
        return new Promise<Response>((resolve, reject) => {
          resolveRestart = resolve;
          signal.addEventListener('abort', () => {
            reject(new DOMException('Settings unmounted', 'AbortError'));
          }, { once: true });
        });
      }
      throw new Error(`Unhandled request: ${url}`);
    }) as typeof global.fetch;

    render(<SettingsTab reloadPage={reloadPage} recoveryPollMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: /restart aegis/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/restart confirmation phrase/i), {
      target: { value: 'RESTART AEGIS' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm restart/i }));

    const dialog = await screen.findByRole('dialog');
    const cancel = screen.getByRole('button', { name: /cancel/i });
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(dialog).toHaveAttribute('tabindex', '-1');
    expect(dialog).toHaveFocus();
    expect(cancel).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/restart request in progress/i);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(cancel);
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(restartSignal?.aborted).toBe(false);

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog).toHaveFocus();

    await act(async () => {
      resolveRestart?.(jsonResponse({
        accepted: true,
        already_requested: false,
        service: 'aegis',
        pid: 123,
      }, 202));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(reloadPage).toHaveBeenCalledTimes(1);
    });
    expect(restartSignal?.aborted).toBe(false);
  });

  it('aborts an in-flight restart only when Settings unmounts', async () => {
    let restartSignal: AbortSignal | undefined;
    global.fetch = vi.fn((input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') {
        return Promise.resolve(jsonResponse({ status: 'ok', pid: 123 }));
      }
      if (url === '/api/system/restart' && init?.method === 'POST') {
        restartSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          restartSignal?.addEventListener('abort', () => {
            reject(new DOMException('Settings unmounted', 'AbortError'));
          }, { once: true });
        });
      }
      throw new Error(`Unhandled request: ${url}`);
    }) as typeof global.fetch;

    const { unmount } = render(<SettingsTab />);
    fireEvent.click(screen.getByRole('button', { name: /restart aegis/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/restart confirmation phrase/i), {
      target: { value: 'RESTART AEGIS' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm restart/i }));
    await waitFor(() => expect(restartSignal).toBeDefined());

    unmount();
    expect(restartSignal?.aborted).toBe(true);
    await act(async () => Promise.resolve());
  });

  it('waits through the old process and reloads only after health reports a new pid', async () => {
    vi.useFakeTimers();
    const reloadPage = vi.fn();
    let healthCalls = 0;
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/system/restart' && init?.method === 'POST') {
        return jsonResponse({ accepted: true, already_requested: false, service: 'aegis', pid: 123 }, 202);
      }
      if (url === '/health') {
        healthCalls += 1;
        return jsonResponse({ status: 'ok', pid: healthCalls < 3 ? 123 : 456 });
      }
      throw new Error(`Unhandled request: ${url}`);
    }) as typeof global.fetch;

    render(<SettingsTab reloadPage={reloadPage} recoveryPollMs={100} />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /restart aegis/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/restart confirmation phrase/i), {
      target: { value: 'RESTART AEGIS' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm restart/i }));
    await act(async () => Promise.resolve());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(reloadPage).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('uses downtime followed by a healthy response as the missing-pid fallback', async () => {
    vi.useFakeTimers();
    const reloadPage = vi.fn();
    let healthCalls = 0;
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/system/restart' && init?.method === 'POST') {
        return jsonResponse({ accepted: true, already_requested: false, service: 'aegis', pid: 123 }, 202);
      }
      if (url === '/health') {
        healthCalls += 1;
        if (healthCalls === 2) {
          throw new TypeError('Aegis is restarting');
        }
        return jsonResponse(healthCalls === 1 ? { status: 'ok', pid: 123 } : { status: 'ok' });
      }
      throw new Error(`Unhandled request: ${url}`);
    }) as typeof global.fetch;

    render(<SettingsTab reloadPage={reloadPage} recoveryPollMs={100} />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /restart aegis/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/restart confirmation phrase/i), {
      target: { value: 'RESTART AEGIS' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm restart/i }));
    await act(async () => Promise.resolve());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(reloadPage).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('cleans up recovery timers when the settings page unmounts', async () => {
    vi.useFakeTimers();
    let healthCalls = 0;
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/system/restart' && init?.method === 'POST') {
        return jsonResponse({ accepted: true, already_requested: false, service: 'aegis', pid: 123 }, 202);
      }
      if (url === '/health') {
        healthCalls += 1;
        return jsonResponse({ status: 'ok', pid: 123 });
      }
      throw new Error(`Unhandled request: ${url}`);
    }) as typeof global.fetch;

    const { unmount } = render(<SettingsTab recoveryPollMs={100} />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: /restart aegis/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/restart confirmation phrase/i), {
      target: { value: 'RESTART AEGIS' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm restart/i }));
    await act(async () => Promise.resolve());
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(healthCalls).toBe(1);
  });

  it('focuses, traps, closes with Escape, and restores focus for the restart dialog', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ status: 'ok', pid: 123 })) as typeof global.fetch;
    render(<SettingsTab />);

    const trigger = screen.getByRole('button', { name: /restart aegis/i });
    trigger.focus();
    fireEvent.click(trigger);
    const initialCancel = screen.getByRole('button', { name: /cancel/i });
    expect(initialCancel).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    const input = screen.getByLabelText(/restart confirmation phrase/i);
    const cancel = screen.getByRole('button', { name: /cancel/i });
    expect(input).toHaveFocus();

    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    const reopenedDialog = screen.getByRole('dialog');
    fireEvent.mouseDown(reopenedDialog.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
