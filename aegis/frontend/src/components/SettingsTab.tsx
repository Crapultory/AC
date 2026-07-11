import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Activity, Server } from 'lucide-react';

import { ApiError, fetchJSON } from '../lib/api';

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

const RESTART_CONFIRMATION_PHRASE = 'RESTART AEGIS';
const DEFAULT_RECOVERY_POLL_MS = 1_000;

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

  return (
    <div className="flex-1 overflow-y-auto bg-[#020408] p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="border-b border-slate-800 pb-6">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-500">
            Restricted Control Plane
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">System Settings</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Inspect the active Aegis runtime and perform guarded service operations.
          </p>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-[#05080F] p-6" aria-labelledby="runtime-status-title">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500">System Telemetry</p>
              <h2 id="runtime-status-title" className="mt-2 text-lg font-bold text-white">Runtime Status</h2>
            </div>
            <Activity className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-[#020408] p-4">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Service</dt>
              <dd className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
                <Server className="h-4 w-4 text-cyan-400" aria-hidden="true" /> Aegis
              </dd>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#020408] p-4">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Health</dt>
              <dd className={`mt-2 text-sm font-semibold ${healthError ? 'text-amber-300' : 'text-emerald-300'}`}>
                {healthError ? 'Unavailable' : health?.status || 'Checking…'}
              </dd>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#020408] p-4">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Process ID</dt>
              <dd className="mt-2 font-mono text-sm font-semibold text-slate-200">
                {typeof health?.pid === 'number' ? health.pid : 'Unavailable'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-6 rounded-2xl border border-rose-950/60 bg-[#070509] p-6" aria-labelledby="dangerous-actions-title">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-rose-400">Restricted Operation</p>
              <h2 id="dangerous-actions-title" className="mt-2 text-lg font-bold text-white">Dangerous Actions</h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Restarting temporarily disconnects this console and interrupts active operations.
              </p>
              {restartError ? <p className="mt-3 text-sm text-rose-300" role="alert">{restartError}</p> : null}
              {restarting ? (
                <p className="mt-3 font-mono text-xs text-amber-300" role="status">
                  Restarting Aegis. Waiting for the replacement process…
                </p>
              ) : null}
            </div>
            <button
              ref={restartButtonRef}
              type="button"
              onClick={() => setConfirmationStage('warning')}
              disabled={restartSubmitting || restarting}
              className="shrink-0 rounded-xl border border-rose-800 bg-rose-950/40 px-5 py-3 text-sm font-bold text-rose-200 transition hover:bg-rose-950/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {restarting ? 'Restarting…' : 'Restart Aegis'}
            </button>
          </div>
        </section>
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
                  <p className="mt-4 font-mono text-xs text-amber-300" role="status">
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
    </div>
  );
}
