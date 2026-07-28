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
    <main className="aegis-admin-page" aria-labelledby="user-management-heading">
      <div className="aegis-admin-page__inner">
        <header className="aegis-page-intro">
          <div>
            <h1 id="user-management-heading" className="aegis-page-intro__title">User Management</h1>
            <p className="aegis-page-intro__description">
              管理注册账号、启停状态、管理员新增用户与密码重置。
            </p>
          </div>
          <div className="aegis-page-intro__badge">
            <span className="aegis-page-intro__badge-label">Directory:</span> {users.length} accounts
          </div>
        </header>

        <section className="aegis-page-content" aria-labelledby="user-directory-heading">
          <header className="aegis-page-content__header">
            <div>
              <h2 id="user-directory-heading" className="aegis-page-content__title">User Directory</h2>
              <p className="aegis-page-content__description">Review account access, reset credentials, and maintain account status.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void onRefresh()} className="aegis-btn aegis-btn--secondary px-4 py-2 text-sm">
                Refresh
              </button>
              <button type="button" onClick={() => setShowCreateForm((current) => !current)} className="aegis-btn aegis-btn--primary px-4 py-2 text-sm">
                新增用户
              </button>
            </div>
          </header>

          {showCreateForm ? (
            <form className="grid gap-3 border-b border-slate-800 p-4 md:grid-cols-5" onSubmit={handleCreate}>
          <input
            aria-label="Create Username"
            value={draft.username}
            onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
            placeholder="username"
            className="aegis-page-field px-3 py-2 text-sm"
          />
          <input
            aria-label="Create Password"
            type="password"
            value={draft.password}
            onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
            placeholder="password"
            className="aegis-page-field px-3 py-2 text-sm"
          />
          <input
            aria-label="Create Email"
            type="email"
            value={draft.email}
            onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
            placeholder="email@example.com"
            className="aegis-page-field px-3 py-2 text-sm"
          />
          <select
            aria-label="Create Status"
            value={draft.status}
            onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as 'enabled' | 'disabled' }))}
            className="aegis-page-field px-3 py-2 text-sm"
          >
            <option value="enabled">enabled</option>
            <option value="disabled">disabled</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="aegis-btn aegis-btn--primary px-4 py-2 text-sm"
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

          <div className="aegis-page-content__body overflow-auto px-6 py-4">
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
              <tr key={user.uid} className="aegis-table-row align-top text-sm text-slate-300">
                <td className="px-3 py-4">
                  <div className="font-semibold text-white">{user.username}</div>
                </td>
                <td className="px-3 py-4">{user.email}</td>
                <td className="px-3 py-4">
                  <span className={`aegis-status-badge ${
                    user.status === 'enabled'
                      ? 'aegis-status-badge--success'
                      : 'aegis-status-badge--warning'
                  }`}>
                    {user.status}
                  </span>
                </td>
                <td className="px-3 py-4 text-slate-400">{user.last_login || 'Never'}</td>
                <td className="px-3 py-4">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void handleToggleStatus(user)} className="aegis-btn aegis-btn--secondary px-3 py-1 text-xs">
                      {user.status === 'enabled' ? `Disable ${user.username}` : `Enable ${user.username}`}
                    </button>
                    <button type="button" onClick={() => {
                      setResetPasswordUid(user.uid);
                      setResetPasswordValue('');
                    }} className="aegis-btn aegis-btn--secondary px-3 py-1 text-xs">
                      {`Reset password ${user.username}`}
                    </button>
                    {!user.is_admin ? (
                      <button type="button" onClick={() => void handleDelete(user.uid)} className="aegis-btn aegis-btn--danger px-3 py-1 text-xs">
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
                        className="aegis-page-field px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void handleResetPassword(user.uid)}
                        className="aegis-btn aegis-btn--primary px-3 py-2 text-xs"
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
        </section>
      </div>
    </main>
  );
}
