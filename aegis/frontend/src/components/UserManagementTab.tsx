import { FormEvent, useMemo, useState } from 'react';
import { alertApiError } from '../lib/api';
import { AuthenticatedUser, UserDraft } from '../types';

interface UserManagementTabProps {
  busy: boolean;
  users: AuthenticatedUser[];
  onCreate: (draft: UserDraft) => Promise<void>;
  onDelete: (uid: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onResetPassword: (uid: string, password: string) => Promise<void>;
  onUpdateStatus: (uid: string, status: 'enabled' | 'disabled') => Promise<void>;
}

const EMPTY_DRAFT: UserDraft = {
  username: '',
  password: '',
  email: '',
  status: 'enabled',
};

export default function UserManagementTab({
  busy,
  users,
  onCreate,
  onDelete,
  onRefresh,
  onResetPassword,
  onUpdateStatus,
}: UserManagementTabProps) {
  const [draft, setDraft] = useState<UserDraft>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [resetPasswordUid, setResetPasswordUid] = useState('');
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const sortedUsers = useMemo(
    () => [...users].sort((left, right) => left.username.localeCompare(right.username)),
    [users],
  );

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    try {
      await onCreate(draft);
      setDraft(EMPTY_DRAFT);
      setShowCreateForm(false);
      setError('');
    } catch (nextError) {
      alertApiError(nextError, 'Failed to create user.');
    }
  }

  async function handleToggleStatus(user: AuthenticatedUser) {
    const nextStatus = user.status === 'enabled' ? 'disabled' : 'enabled';
    const actionLabel = nextStatus === 'disabled' ? 'Disable' : 'Enable';
    if (!window.confirm(`${actionLabel} ${user.username}? (确定要${nextStatus}该用户吗？)`)) {
      return;
    }

    try {
      await onUpdateStatus(user.uid, nextStatus);
      setError('');
    } catch (nextError) {
      alertApiError(nextError, 'Failed to update user status.');
    }
  }

  async function handleDelete(uid: string) {
    const user = users.find((entry) => entry.uid === uid);
    if (!user) {
      return;
    }
    if (!window.confirm(`Delete ${user.username}? (确定删除该用户吗？此操作不可逆)`)) {
      return;
    }

    try {
      await onDelete(uid);
      setError('');
    } catch (nextError) {
      alertApiError(nextError, 'Failed to delete user.');
    }
  }

  async function handleResetPassword(uid: string) {
    if (!resetPasswordValue.trim()) {
      setError('请输入重置后的密码。');
      return;
    }
    try {
      await onResetPassword(uid, resetPasswordValue);
      setResetPasswordUid('');
      setResetPasswordValue('');
      setError('');
    } catch (nextError) {
      alertApiError(nextError, 'Failed to reset password.');
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#020408]">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.32em] text-cyan-400">Administration</p>
          <h2 className="mt-2 text-2xl font-black uppercase italic tracking-tight text-white">
            User Management
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            管理注册账号、启停状态、管理员新增用户与密码重置。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-cyan-500 hover:text-white"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm((current) => !current)}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-600"
          >
            新增用户
          </button>
        </div>
      </div>

      {showCreateForm ? (
        <form className="grid gap-3 border-b border-slate-800 bg-[#05080F] px-6 py-4 md:grid-cols-5" onSubmit={handleCreate}>
          <input
            aria-label="Create Username"
            value={draft.username}
            onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
            placeholder="username"
            className="rounded-lg border border-slate-800 bg-[#020408] px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-500"
          />
          <input
            aria-label="Create Password"
            type="password"
            value={draft.password}
            onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
            placeholder="password"
            className="rounded-lg border border-slate-800 bg-[#020408] px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-500"
          />
          <input
            aria-label="Create Email"
            type="email"
            value={draft.email}
            onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
            placeholder="email@example.com"
            className="rounded-lg border border-slate-800 bg-[#020408] px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-500"
          />
          <select
            aria-label="Create Status"
            value={draft.status}
            onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as 'enabled' | 'disabled' }))}
            className="rounded-lg border border-slate-800 bg-[#020408] px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-500"
          >
            <option value="enabled">enabled</option>
            <option value="disabled">disabled</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Create User
          </button>
        </form>
      ) : null}

      {error ? (
        <div className="border-b border-rose-900/30 bg-rose-950/20 px-6 py-3 text-sm text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto px-6 py-4">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-800 font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500">
              <th className="px-3 py-3">Username</th>
              <th className="px-3 py-3">Email</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Last Login</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {sortedUsers.map((user) => (
              <tr key={user.uid} className="align-top text-sm text-slate-300">
                <td className="px-3 py-4">
                  <div className="font-semibold text-white">{user.username}</div>
                </td>
                <td className="px-3 py-4">{user.email}</td>
                <td className="px-3 py-4">
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    user.status === 'enabled'
                      ? 'border-emerald-900/40 bg-emerald-950/30 text-emerald-300'
                      : 'border-amber-900/40 bg-amber-950/30 text-amber-300'
                  }`}>
                    {user.status}
                  </span>
                </td>
                <td className="px-3 py-4 text-slate-400">{user.last_login || 'Never'}</td>
                <td className="px-3 py-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggleStatus(user)}
                      className="rounded border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:border-cyan-500 hover:text-white"
                    >
                      {user.status === 'enabled' ? `Disable ${user.username}` : `Enable ${user.username}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResetPasswordUid(user.uid);
                        setResetPasswordValue('');
                      }}
                      className="rounded border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:border-cyan-500 hover:text-white"
                    >
                      {`Reset password ${user.username}`}
                    </button>
                    {!user.is_admin ? (
                      <button
                        type="button"
                        onClick={() => void handleDelete(user.uid)}
                        className="rounded border border-rose-900/40 px-3 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-950/30"
                      >
                        {`Delete ${user.username}`}
                      </button>
                    ) : null}
                  </div>
                  {resetPasswordUid === user.uid ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        aria-label={`Reset Password ${user.username}`}
                        type="password"
                        value={resetPasswordValue}
                        onChange={(event) => setResetPasswordValue(event.target.value)}
                        placeholder="new password"
                        className="rounded-lg border border-slate-800 bg-[#020408] px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-500"
                      />
                      <button
                        type="button"
                        onClick={() => void handleResetPassword(user.uid)}
                        className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-cyan-600"
                      >
                        Save Password
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
