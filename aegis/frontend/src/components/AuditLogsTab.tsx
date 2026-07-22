import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Search } from 'lucide-react';

import { ApiError, alertApiError, fetchJSON } from '../lib/api';
import { DelegateAuditPage } from '../types';

interface AuditLogsTabProps {
  onAuthExpired?: () => void;
}

type Filters = Record<string, string>;
type BusyAction = 'refresh' | 'search' | 'reset' | 'page-prev' | 'page-next' | null;

const EMPTY_FILTERS: Filters = {
  id: '', platform: '', user_id: '', user_name: '', agent_name: '', goal: '',
  session_id: '', status: '', is_loop: '', is_delegate_output: '',
  timestamp_from: '', timestamp_to: '',
};

const TEXT_FILTERS = [
  ['id', 'Audit ID'], ['platform', 'Platform'], ['user_id', 'User ID'],
  ['user_name', 'User Name'], ['agent_name', 'Agent Name'], ['goal', 'Goal'],
  ['session_id', 'Session ID'],
] as const;

export default function AuditLogsTab({ onAuthExpired }: AuditLogsTabProps) {
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activeFilters, setActiveFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<DelegateAuditPage>({ logs: [], total: 0, page: 1, page_size: 50 });
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [expandedId, setExpandedId] = useState('');
  const requestSequence = useRef(0);
  const busy = busyAction !== null;

  async function load(page: number, filters: Filters = activeFilters, action: Exclude<BusyAction, null> = 'refresh') {
    const requestId = ++requestSequence.current;
    setBusyAction(action);
    const params = new URLSearchParams({ page: String(page), page_size: '50' });
    Object.entries(filters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim());
    });
    try {
      const response = await fetchJSON<DelegateAuditPage>(`/api/audit/a2a-delegates?${params.toString()}`);
      if (requestId === requestSequence.current) setData(response);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      if (error instanceof ApiError && error.status === 401) {
        onAuthExpired?.();
        return;
      }
      alertApiError(error, 'Failed to load audit logs.');
    } finally {
      if (requestId === requestSequence.current) setBusyAction(null);
    }
  }

  useEffect(() => { void load(1, EMPTY_FILTERS); }, []);

  function search(event: FormEvent) {
    event.preventDefault();
    const next = { ...draftFilters };
    setActiveFilters(next);
    void load(1, next, 'search');
  }

  function reset() {
    setDraftFilters(EMPTY_FILTERS);
    setActiveFilters(EMPTY_FILTERS);
    void load(1, EMPTY_FILTERS, 'reset');
  }

  const lastPage = Math.max(1, Math.ceil(data.total / data.page_size));

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#020408] p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-400">Security Evidence</p><h2 className="mt-2 text-2xl font-black uppercase italic text-white">Audit Logs</h2><p className="mt-1 text-sm text-slate-400">Search A2A delegate authorization and execution outcomes.</p></div>
        <button type="button" aria-busy={busyAction === 'refresh'} onClick={() => void load(data.page, activeFilters, 'refresh')} className={`aegis-btn aegis-btn--secondary flex items-center gap-2 rounded px-3 py-2 ${busyAction === 'refresh' ? 'aegis-btn--busy' : ''}`}><RefreshCw className={`h-4 w-4 ${busyAction === 'refresh' ? 'animate-spin' : ''}`} /> Refresh</button>
      </div>

      <form onSubmit={search} className="mb-4 grid items-end gap-2 rounded-xl border border-slate-800 bg-[#05080F] p-4 md:grid-cols-3 xl:grid-cols-6">
        {TEXT_FILTERS.map(([key, label]) => <input key={key} aria-label={`Audit ${label}`} value={draftFilters[key]} onChange={(event) => setDraftFilters((current) => ({ ...current, [key]: event.target.value }))} placeholder={label} className="h-10 rounded border border-slate-800 bg-[#020408] px-3 py-2 text-xs text-white" />)}
        <select aria-label="Audit Status" value={draftFilters.status} onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))} className="h-10 rounded border border-slate-800 bg-[#020408] px-3 py-2 text-xs"><option value="">Any status</option><option value="succ">succ</option><option value="fail">fail</option><option value="auth_denied">auth_denied</option></select>
        <select aria-label="Audit Loop" value={draftFilters.is_loop} onChange={(event) => setDraftFilters((current) => ({ ...current, is_loop: event.target.value }))} className="h-10 rounded border border-slate-800 bg-[#020408] px-3 py-2 text-xs"><option value="">Any loop mode</option><option value="true">Loop</option><option value="false">Non-loop</option></select>
        <select aria-label="Audit Delegate Output" value={draftFilters.is_delegate_output} onChange={(event) => setDraftFilters((current) => ({ ...current, is_delegate_output: event.target.value }))} className="h-10 rounded border border-slate-800 bg-[#020408] px-3 py-2 text-xs"><option value="">Any output mode</option><option value="true">Output enabled</option><option value="false">Output disabled</option></select>
        <label className="flex flex-col justify-end text-[10px] text-slate-500">From UTC<input aria-label="Audit Timestamp From" type="datetime-local" value={draftFilters.timestamp_from.replace(':00Z', '')} onChange={(event) => setDraftFilters((current) => ({ ...current, timestamp_from: event.target.value ? `${event.target.value}:00Z` : '' }))} className="mt-1 h-10 w-full rounded border border-slate-800 bg-[#020408] px-3 py-2 text-xs text-white" /></label>
        <label className="flex flex-col justify-end text-[10px] text-slate-500">To UTC<input aria-label="Audit Timestamp To" type="datetime-local" value={draftFilters.timestamp_to.replace(':00Z', '')} onChange={(event) => setDraftFilters((current) => ({ ...current, timestamp_to: event.target.value ? `${event.target.value}:00Z` : '' }))} className="mt-1 h-10 w-full rounded border border-slate-800 bg-[#020408] px-3 py-2 text-xs text-white" /></label>
        <div className="flex items-end gap-2"><button type="submit" aria-busy={busyAction === 'search'} className={`aegis-btn aegis-btn--primary flex items-center gap-1 rounded px-3 py-2 font-bold ${busyAction === 'search' ? 'aegis-btn--busy' : ''}`}><Search className="h-3.5 w-3.5" /> Search</button><button type="button" aria-busy={busyAction === 'reset'} onClick={reset} className={`aegis-btn aegis-btn--secondary flex items-center gap-1 rounded px-3 py-2 ${busyAction === 'reset' ? 'aegis-btn--busy' : ''}`}><RotateCcw className="h-3.5 w-3.5" /> Reset</button></div>
      </form>

      <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-[#05080F]">
        <table className="w-full border-collapse text-left text-xs"><thead className="sticky top-0 bg-[#03060C] font-mono text-[9px] uppercase tracking-wider text-slate-500"><tr><th className="p-3">Timestamp</th><th className="p-3">Caller</th><th className="p-3">Agent</th><th className="p-3">Goal</th><th className="p-3">Session</th><th className="p-3">Options</th><th className="p-3">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-800/60">{data.logs.length === 0 ? <tr><td colSpan={7} className="p-10 text-center text-slate-500">No audit logs match the active filters.</td></tr> : data.logs.map((log) => <tr key={log.id} className="align-top hover:bg-[#03060C]/60"><td className="whitespace-nowrap p-3 font-mono text-slate-400"><div>{log.timestamp}</div><div className="mt-1 text-[9px] text-slate-600">{log.id}</div></td><td className="p-3"><div>{log.platform || '—'} / {log.user_name || '—'}</div><div className="font-mono text-[10px] text-slate-500">{log.user_id || '—'}</div></td><td className="p-3 font-mono text-cyan-400">{log.agent_name}</td><td className="max-w-md p-3"><button type="button" aria-expanded={expandedId === log.id} className={`aegis-btn rounded px-1 py-0.5 text-left ${expandedId === log.id ? 'aegis-btn--secondary aegis-btn--selected whitespace-pre-wrap' : 'aegis-btn--ghost line-clamp-2'}`} onClick={() => setExpandedId((current) => current === log.id ? '' : log.id)}>{log.goal || '—'}</button></td><td className="p-3 font-mono text-[10px]">{log.session_id || '—'}</td><td className="p-3 font-mono text-[10px]">loop={String(log.is_loop)}<br />output={String(log.is_delegate_output)}</td><td className="p-3"><span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${log.status === 'succ' ? 'border-emerald-900/40 text-emerald-400' : 'border-rose-900/40 text-rose-400'}`}>{log.status}</span></td></tr>)}</tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-400"><span>{data.total} results · page {data.page} of {lastPage}</span><div className="flex gap-2"><button type="button" aria-label="Previous audit page" disabled={data.page <= 1 || busy} aria-busy={busyAction === 'page-prev'} onClick={() => void load(data.page - 1, activeFilters, 'page-prev')} className={`aegis-btn aegis-btn--secondary aegis-btn--icon rounded p-2 ${busyAction === 'page-prev' ? 'aegis-btn--busy' : ''}`}><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="Next audit page" disabled={data.page >= lastPage || busy} aria-busy={busyAction === 'page-next'} onClick={() => void load(data.page + 1, activeFilters, 'page-next')} className={`aegis-btn aegis-btn--secondary aegis-btn--icon rounded p-2 ${busyAction === 'page-next' ? 'aegis-btn--busy' : ''}`}><ChevronRight className="h-4 w-4" /></button></div></div>
    </div>
  );
}
