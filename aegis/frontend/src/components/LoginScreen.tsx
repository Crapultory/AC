import { FormEvent, useState } from 'react';

interface LoginScreenProps {
  error: string;
  onSubmit: (token: string) => Promise<void>;
  pending: boolean;
}

export default function LoginScreen({ error, onSubmit, pending }: LoginScreenProps) {
  const [token, setToken] = useState('');
  const [localError, setLocalError] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) {
      setLocalError('请输入 AEGIS_SESSION_TOKEN。');
      return;
    }

    setLocalError('');
    await onSubmit(token);
  }

  return (
    <section className="min-h-screen bg-[#020408] text-slate-200 flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-[#05080F] p-8 shadow-[0_0_40px_rgba(8,145,178,0.15)]">
        <p className="text-[11px] font-mono tracking-[0.32em] uppercase text-cyan-400">Aegis Access</p>
        <h1 className="mt-3 text-3xl font-black uppercase italic tracking-tight text-white">
          Authenticate
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          输入后端启动时显示的会话令牌，进入 Agent Orchestration 与 Routing Policy 控制台。
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.24em] text-slate-500">
              Session Token
            </span>
            <input
              aria-label="Session Token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste AEGIS_SESSION_TOKEN"
              className="w-full rounded-xl border border-slate-800 bg-[#020408] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Verifying...' : 'Sign In'}
          </button>
          {localError ? <p className="text-sm text-rose-400">{localError}</p> : null}
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        </form>
      </div>
    </section>
  );
}
