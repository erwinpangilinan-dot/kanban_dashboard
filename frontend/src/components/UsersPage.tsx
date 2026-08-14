import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { api } from '../api/client';
import {
  ASSIGNABLE_VIEWS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  VIEW_LABELS,
} from '../types';
import type { AssignableView, DashboardUser, UserRole } from '../types';

interface UsersPageProps {
  currentUsername: string | null;
  refreshToken?: number;
}

const ROLES: UserRole[] = ['admin', 'editor', 'viewer'];

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export function UsersPage({ currentUsername, refreshToken = 0 }: UsersPageProps) {
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DashboardUser | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await api.getUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  async function handleDelete(user: DashboardUser) {
    if (!window.confirm(`Delete "${user.username}"? This cannot be undone.`)) return;
    try {
      await api.deleteUser(user.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }

  async function handleToggleActive(user: DashboardUser) {
    try {
      await api.updateUser(user.id, { is_active: !user.is_active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-gray-500">
          Administrators see every tab. For full-access and read-only accounts, tick the tabs the
          user should be able to open — the API enforces the same list, so hidden tabs cannot be
          reached by other means.
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <UserPlus className="h-4 w-4" />
          Add user
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-surface-border text-[11px] uppercase tracking-widest text-gray-600">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Access</th>
                <th className="px-4 py-3 font-semibold">Tabs</th>
                <th className="px-4 py-3 font-semibold">Last sign-in</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.username === currentUsername;
                return (
                  <tr key={user.id} className="border-b border-surface-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{user.username}</span>
                        {isSelf && <span className="text-[11px] text-gray-600">(you)</span>}
                      </div>
                      {!user.is_active && (
                        <span className="mt-1 inline-block rounded-full border border-gray-600/40 bg-gray-500/10 px-2 py-0.5 text-[11px] text-gray-400">
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          user.role === 'admin'
                            ? 'border border-accent/40 bg-accent/10 text-accent-hover'
                            : user.role === 'editor'
                              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : 'border border-amber-500/30 bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {user.role === 'admin'
                        ? 'All tabs'
                        : user.allowed_views.length === 0
                          ? 'None'
                          : ASSIGNABLE_VIEWS.filter((view) => user.allowed_views.includes(view))
                              .map((view) => VIEW_LABELS[view])
                              .join(', ')}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(user.last_login_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(user)}
                          className="rounded-lg border border-surface-border p-1.5 text-gray-400 transition-colors hover:border-accent/40 hover:text-accent-hover"
                          aria-label={`Edit ${user.username}`}
                          title="Edit access"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(user)}
                          disabled={isSelf}
                          className="rounded-lg border border-surface-border px-2 py-1 text-[11px] font-medium text-gray-400 transition-colors hover:border-accent/40 hover:text-accent-hover disabled:opacity-40"
                          title={isSelf ? 'You cannot disable your own account' : undefined}
                        >
                          {user.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(user)}
                          disabled={isSelf}
                          className="rounded-lg border border-surface-border p-1.5 text-gray-400 transition-colors hover:border-red-500/40 hover:text-red-400 disabled:opacity-40"
                          aria-label={`Delete ${user.username}`}
                          title={isSelf ? 'You cannot delete your own account' : 'Delete user'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <UserModal
          user={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

interface UserModalProps {
  user: DashboardUser | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function UserModal({ user, onClose, onSaved }: UserModalProps) {
  const isEdit = Boolean(user);
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'viewer');
  const [views, setViews] = useState<AssignableView[]>(() =>
    ASSIGNABLE_VIEWS.filter((view) => user?.allowed_views.includes(view) ?? view === 'overview')
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleView(view: AssignableView) {
    setViews((prev) =>
      prev.includes(view) ? prev.filter((v) => v !== view) : [...prev, view]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);
    try {
      if (isEdit && user) {
        await api.updateUser(user.id, {
          role,
          allowed_views: views,
          ...(password ? { password } : {}),
        });
      } else {
        await api.createUser({ username: username.trim(), password, role, allowed_views: views });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-surface-border bg-surface-raised p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">
          {isEdit ? `Edit ${user?.username}` : 'Add user'}
        </h3>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {!isEdit && (
            <div>
              <label htmlFor="new-username" className="mb-1.5 block text-sm text-gray-400">
                Username
              </label>
              <input
                id="new-username"
                type="text"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white outline-none focus:border-accent"
              />
            </div>
          )}

          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm text-gray-400">
              {isEdit ? 'New password' : 'Password'}
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600" />
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEdit ? 'Leave blank to keep current' : 'At least 8 characters'}
                className="w-full rounded-lg border border-surface-border bg-surface pl-9 pr-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-accent"
              />
            </div>
            {isEdit && (
              <p className="mt-1.5 text-xs text-gray-600">
                Changing the password signs this user out of other sessions.
              </p>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 text-sm text-gray-400">Access level</legend>
            <div className="space-y-1.5">
              {ROLES.map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                    role === option
                      ? 'border-accent/50 bg-accent/10'
                      : 'border-surface-border hover:border-surface-border/80'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option}
                    checked={role === option}
                    onChange={() => setRole(option)}
                    className="mt-0.5 accent-accent"
                  />
                  <span>
                    <span className="block text-sm font-medium text-white">
                      {ROLE_LABELS[option]}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {ROLE_DESCRIPTIONS[option]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset disabled={role === 'admin'} className={role === 'admin' ? 'opacity-50' : ''}>
            <legend className="mb-2 text-sm text-gray-400">Visible tabs</legend>
            {role === 'admin' ? (
              <p className="text-xs text-gray-500">
                Administrators always see every tab, including Users.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {ASSIGNABLE_VIEWS.map((view) => (
                  <label
                    key={view}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-sm text-gray-300 transition-colors hover:border-surface-border/80"
                  >
                    <input
                      type="checkbox"
                      checked={views.includes(view)}
                      onChange={() => toggleView(view)}
                      className="accent-accent"
                    />
                    {VIEW_LABELS[view]}
                  </label>
                ))}
              </div>
            )}
            {role !== 'admin' && views.length === 0 && (
              <p className="mt-2 text-xs text-amber-400">
                With no tabs selected this user can sign in but will not see anything.
              </p>
            )}
          </fieldset>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-surface-border px-4 py-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {!isEdit && <Plus className="h-4 w-4" />}
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
