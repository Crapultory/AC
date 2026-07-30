import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Activity, Server } from 'lucide-react';

import { ApiError, fetchJSON } from '../lib/api';
import SystemInstructManager from './SystemInstructManager';

interface HealthResponse {
  status: string;
  pid?: number;
}

interface RestartResponse {
  accepted: boolean;
  already_requested: boolean;
  service: string;
  pid: number;
}

type SettingsView = 'status' | 'license' | 'system_instruct';

const RESTART_CONFIRMATION_PHRASE = 'RESTART AEGIS';
const DEFAULT_RECOVERY_POLL_MS = 1_000;
const SETTINGS_VIEWS: SettingsView[] = ['status', 'license', 'system_instruct'];
const LICENSE_MOCK = {
  id: 'AEG-ENT-EVAL-2026-LOCAL',
  edition: 'Enterprise Evaluation',
  status: 'Active',
  issuedTo: 'Aegis Local Security Console',
  expiresAt: '2026-12-31 23:59 UTC',
  seats: '12 / 25',
  agentNodes: '8 / 16',
  modules: ['A2A Orchestration', 'Audit Evidence', 'VIP Integration'],
};

interface SettingsTabProps {
  onAuthExpired?: () => void;
  reloadPage?: () => void;
  recoveryPollMs?: number;
}

function reloadWindow() {
  window.location.reload();
}

export default function SettingsTab({
  onAuthExpired,
  reloadPage = reloadWindow,
  recoveryPollMs = DEFAULT_RECOVERY_POLL_MS,
}: SettingsTabProps) {
  const [activeView, setActiveView] = useState<SettingsView>('status');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [confirmationStage, setConfirmationStage] = useState<'warning' | 'phrase' | null>(null);
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [restartSubmitting, setRestartSubmitting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState('');
  const [restartPid, setRestartPid] = useState<number | null>(null);
  const restartButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const phraseInputRef = useRef<HTMLInputElement>(null);
  const dialogWasOpenRef = useRef(false);
  const restartAbortControllerRef = useRef<AbortController | null>(null);
  const settingsTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetchJSON<HealthResponse>('/health', {}, false);
        if (!cancelled) {
          setHealth(response);
          setHealthError(false);
        }
      } catch {
        if (!cancelled) {
          setHealthError(true);
        }
      }
    }

    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    restartAbortControllerRef.current?.abort();
    restartAbortControllerRef.current = null;
  }, []);

  useEffect(() => {
    if (!restarting) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let outageObserved = false;

    function scheduleNextCheck() {
      timer = window.setTimeout(() => void checkRecovery(), recoveryPollMs);
    }

    async function checkRecovery() {
      try {
        const response = await fetchJSON<HealthResponse>('/health', {}, false);
        if (cancelled) {
          return;
        }
        if (restartPid !== null && typeof response.pid === 'number') {
          if (response.pid !== restartPid) {
            reloadPage();
            return;
          }
          scheduleNextCheck();
          return;
        }
        if (outageObserved) {
          reloadPage();
          return;
        }
        scheduleNextCheck();
      } catch {
        if (!cancelled) {
          outageObserved = true;
          scheduleNextCheck();
        }
      }
    }

    scheduleNextCheck();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [recoveryPollMs, reloadPage, restartPid, restarting]);

  useEffect(() => {
    if (confirmationStage === null) {
      if (dialogWasOpenRef.current && !restarting) {
        restartButtonRef.current?.focus();
      }
      dialogWasOpenRef.current = false;
      return;
    }

    dialogWasOpenRef.current = true;
    if (confirmationStage === 'phrase') {
      phraseInputRef.current?.focus();
    } else {
      dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    }
  }, [confirmationStage, restarting]);

  useEffect(() => {
    if (restartSubmitting) {
      dialogRef.current?.focus();
    }
  }, [restartSubmitting]);

  function closeConfirmation() {
    if (restartSubmitting) {
      return;
    }
    setConfirmationStage(null);
    setConfirmationPhrase('');
  }

  async function requestRestart() {
    if (confirmationPhrase !== RESTART_CONFIRMATION_PHRASE || restartSubmitting || restarting) {
      return;
    }

    const controller = new AbortController();
    restartAbortControllerRef.current = controller;
    setRestartSubmitting(true);
    setRestartError('');
    try {
      const response = await fetchJSON<RestartResponse>('/api/system/restart', {
        method: 'POST',
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      setRestartPid(response.pid);
      setRestarting(true);
      setConfirmationStage(null);
      setConfirmationPhrase('');
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        setConfirmationStage(null);
        setConfirmationPhrase('');
        onAuthExpired?.();
        return;
      }
      setRestartError('Restart request failed. Aegis is still running.');
    } finally {
      if (restartAbortControllerRef.current === controller) {
        restartAbortControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setRestartSubmitting(false);
      }
    }
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!restartSubmitting) {
        closeConfirmation();
      }
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function selectSettingsView(view: SettingsView) {
    setActiveView(view);
  }

  function handleSettingsTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentView: SettingsView) {
    const currentIndex = SETTINGS_VIEWS.indexOf(currentView);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % SETTINGS_VIEWS.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + SETTINGS_VIEWS.length) % SETTINGS_VIEWS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = SETTINGS_VIEWS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextView = SETTINGS_VIEWS[nextIndex];
    selectSettingsView(nextView);
    settingsTabRefs.current[nextIndex]?.focus();
  }

  return (
    <main className="aegis-admin-page" aria-labelledby="settings-heading">
      <div className="aegis-admin-page__inner">
        <header className="aegis-page-intro">
          <div>
            <h1 id="settings-heading" className="aegis-page-intro__title">System Settings</h1>
            <p className="aegis-page-intro__description">Inspect the active Aegis runtime and perform guarded service operations.</p>
          </div>
          <div className="aegis-page-intro__badge"><span className="aegis-page-intro__badge-label">Access:</span> administrator only</div>
        </header>

        <div className="aegis-page-tabs aegis-page-tabs--compact" role="tablist" aria-label="System settings views">
          <button
            ref={(element) => { settingsTabRefs.current[0] = element; }}
            id="settings-status-tab"
            type="button"
            role="tab"
            tabIndex={activeView === 'status' ? 0 : -1}
            aria-selected={activeView === 'status'}
            aria-controls="settings-status-panel"
            onClick={() => selectSettingsView('status')}
            onKeyDown={(event) => handleSettingsTabKeyDown(event, 'status')}
            className="aegis-page-tab"
          >
            Status
          </button>
          <button
            ref={(element) => { settingsTabRefs.current[1] = element; }}
            id="settings-license-tab"
            type="button"
            role="tab"
            tabIndex={activeView === 'license' ? 0 : -1}
            aria-selected={activeView === 'license'}
            aria-controls="settings-license-panel"
            onClick={() => selectSettingsView('license')}
            onKeyDown={(event) => handleSettingsTabKeyDown(event, 'license')}
            className="aegis-page-tab"
          >
            LIC Management
          </button>
          <button
            ref={(element) => { settingsTabRefs.current[2] = element; }}
            id="settings-system-instruct-tab"
            type="button"
            role="tab"
            tabIndex={activeView === 'system_instruct' ? 0 : -1}
            aria-selected={activeView === 'system_instruct'}
            aria-controls="settings-system-instruct-panel"
            onClick={() => selectSettingsView('system_instruct')}
            onKeyDown={(event) => handleSettingsTabKeyDown(event, 'system_instruct')}
            className="aegis-page-tab"
          >
            System Instruct
          </button>
        </div>

        {activeView === 'status' ? <section id="settings-status-panel" role="tabpanel" aria-labelledby="settings-status-tab" className="aegis-page-content">
          <header className="aegis-page-content__header">
            <div>
              <h2 id="runtime-status-title" className="aegis-page-content__title">Runtime Status</h2>
              <p className="aegis-page-content__description">Current service availability and protected operational controls.</p>
            </div>
            <Activity className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          </header>
          <div className="aegis-page-content__body aegis-page-content__body--padded">
            <section aria-labelledby="runtime-status-title">
              <dl className="grid gap-3 sm:grid-cols-3">
                <div className="aegis-page-metric">
                  <dt className="aegis-page-metric__label">Service</dt>
                  <dd className="aegis-page-metric__value flex items-center gap-2">
                    <Server className="h-4 w-4 text-cyan-400" aria-hidden="true" /> Aegis
                  </dd>
                </div>
                <div className="aegis-page-metric">
                  <dt className="aegis-page-metric__label">Health</dt>
                  <dd className={`aegis-page-metric__value ${healthError ? 'aegis-page-metric__value--warning' : 'aegis-page-metric__value--success'}`}>
                    {healthError ? 'Unavailable' : health?.status || 'Checking…'}
                  </dd>
                </div>
                <div className="aegis-page-metric">
                  <dt className="aegis-page-metric__label">Process ID</dt>
                  <dd className="aegis-page-metric__value font-mono">
                    {typeof health?.pid === 'number' ? health.pid : 'Unavailable'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="aegis-danger-zone mt-6" aria-labelledby="dangerous-actions-title">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="aegis-danger-zone__eyebrow font-mono text-[10px] font-bold uppercase tracking-[0.24em]">Restricted Operation</p>
                  <h2 id="dangerous-actions-title" className="mt-2 text-lg font-bold text-white">Dangerous Actions</h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-400">
                    Restarting temporarily disconnects this console and interrupts active operations.
                  </p>
                  {restartError ? <p className="aegis-status-text--danger mt-3 text-sm" role="alert">{restartError}</p> : null}
                  {restarting ? <p className="aegis-status-text--warning mt-3 font-mono text-xs" role="status">Restarting Aegis. Waiting for the replacement process…</p> : null}
                </div>
                <button ref={restartButtonRef} type="button" onClick={() => setConfirmationStage('warning')} disabled={restartSubmitting || restarting} className="aegis-btn aegis-btn--danger shrink-0 px-5 py-3 text-sm">
                  {restarting ? 'Restarting…' : 'Restart Aegis'}
                </button>
              </div>
            </section>
          </div>
        </section> : null}

        {activeView === 'license' ? <section id="settings-license-panel" role="tabpanel" aria-labelledby="settings-license-tab" className="aegis-page-content">
          <header className="aegis-page-content__header">
            <div>
              <h2 className="aegis-page-content__title">License Management</h2>
              <p className="aegis-page-content__description">Read-only entitlement details for this local Aegis console.</p>
            </div>
            <span className="aegis-status-badge aegis-status-badge--warning">LOCAL MOCK / DEMO DATA</span>
          </header>
          <div className="aegis-page-content__body aegis-page-content__body--padded">
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="aegis-page-metric"><dt className="aegis-page-metric__label">License ID</dt><dd className="aegis-page-metric__value break-all font-mono text-xs">{LICENSE_MOCK.id}</dd></div>
              <div className="aegis-page-metric"><dt className="aegis-page-metric__label">Edition</dt><dd className="aegis-page-metric__value">{LICENSE_MOCK.edition}</dd></div>
              <div className="aegis-page-metric"><dt className="aegis-page-metric__label">Status</dt><dd className="mt-2"><span className="aegis-status-badge aegis-status-badge--success">{LICENSE_MOCK.status}</span></dd></div>
              <div className="aegis-page-metric"><dt className="aegis-page-metric__label">Expires</dt><dd className="aegis-page-metric__value font-mono text-xs">{LICENSE_MOCK.expiresAt}</dd></div>
            </dl>

            <div className="aegis-license-grid mt-6">
              <div className="aegis-license-detail"><p className="aegis-page-metric__label">Issued To</p><p className="aegis-license-detail__value">{LICENSE_MOCK.issuedTo}</p></div>
              <div className="aegis-license-detail"><p className="aegis-page-metric__label">Seat Allocation</p><p className="aegis-license-detail__value">{LICENSE_MOCK.seats} seats assigned</p></div>
              <div className="aegis-license-detail"><p className="aegis-page-metric__label">Agent Node Allocation</p><p className="aegis-license-detail__value">{LICENSE_MOCK.agentNodes} nodes registered</p></div>
            </div>

            <section className="mt-6 border-t border-slate-800 pt-5" aria-labelledby="licensed-modules-title">
              <h3 id="licensed-modules-title" className="aegis-page-content__title text-base">Licensed Modules</h3>
              <p className="aegis-page-content__description">Enabled modules included in the mock entitlement.</p>
              <ul className="mt-4 flex flex-wrap gap-2">{LICENSE_MOCK.modules.map((module) => <li key={module} className="aegis-license-module">{module}</li>)}</ul>
            </section>
          </div>
        </section> : null}

        {activeView === 'system_instruct' ? <section id="settings-system-instruct-panel" role="tabpanel" aria-labelledby="settings-system-instruct-tab" className="aegis-page-content">
          <SystemInstructManager onAuthExpired={onAuthExpired} />
        </section> : null}
      </div>

      {confirmationStage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              closeConfirmation();
            }
          }}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-busy={restartSubmitting}
            aria-labelledby="restart-dialog-title"
            aria-describedby="restart-dialog-description"
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className="w-full max-w-lg rounded-2xl border border-rose-950/80 bg-[#05080F] p-6 shadow-2xl"
          >
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-rose-400">Dangerous Operation</p>
            <h2 id="restart-dialog-title" className="mt-2 text-xl font-bold text-white">
              {confirmationStage === 'warning' ? 'Service interruption' : 'Final confirmation'}
            </h2>
            {confirmationStage === 'warning' ? (
              <>
                <p id="restart-dialog-description" className="mt-3 text-sm leading-relaxed text-slate-400">
                  Aegis will stop accepting requests while the process restarts. Active work may be interrupted.
                </p>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={closeConfirmation} data-initial-focus className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white">
                    Cancel
                  </button>
                  <button type="button" onClick={() => setConfirmationStage('phrase')} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500">
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p id="restart-dialog-description" className="mt-3 text-sm leading-relaxed text-slate-400">
                  Type <code className="rounded bg-[#020408] px-1.5 py-0.5 font-mono text-rose-300">{RESTART_CONFIRMATION_PHRASE}</code> exactly to authorize the restart.
                </p>
                {restartSubmitting ? (
                  <p className="aegis-status-text--warning mt-4 font-mono text-xs" role="status">
                    Restart request in progress. Waiting for the server response…
                  </p>
                ) : null}
                <label className="mt-5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Confirmation phrase
                  <input
                    ref={phraseInputRef}
                    type="text"
                    aria-label="Restart confirmation phrase"
                    autoComplete="off"
                    spellCheck={false}
                    value={confirmationPhrase}
                    onChange={(event) => setConfirmationPhrase(event.target.value)}
                    disabled={restartSubmitting}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-[#020408] px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-rose-500 disabled:opacity-60"
                  />
                </label>
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={closeConfirmation} disabled={restartSubmitting} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void requestRestart()}
                    disabled={confirmationPhrase !== RESTART_CONFIRMATION_PHRASE || restartSubmitting}
                    className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {restartSubmitting ? 'Requesting…' : 'Confirm restart'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
