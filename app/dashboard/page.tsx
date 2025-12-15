'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/LanguageProvider';
import { BadAddressesImport } from '@/components/BadAddressesImport';
import type { SupportedBlockchain, UserRole } from '@/lib/types';

type MeUser = {
  userId: number;
  email: string;
  role: UserRole;
};

type HistoryItem = {
  id: number;
  userId: string | null;
  blockchain: SupportedBlockchain;
  rootAddress: string;
  depth: number;
  globalRiskScore: number;
  createdAt: string;
};

type BadAddressRow = {
  id: number;
  blockchain: string;
  address: string;
  tag: string | null;
  risk_level: number;
  source: string | null;
  evidence_url: string | null;
  user_id: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type AdminUserRow = {
  id: number;
  email: string;
  role: UserRole;
  createdAt: string;
};

type TabKey = 'history' | 'bad' | 'admin';

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const [me, setMe] = useState<MeUser | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<TabKey>('history');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [badAddresses, setBadAddresses] = useState<BadAddressRow[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);

  // форма добавления плохого адреса
  const [newBadAddr, setNewBadAddr] = useState({
    blockchain: 'bitcoin',
    address: '',
    tag: '',
    riskLevel: '80',
    source: '',
    evidenceUrl: '',
  });
  const [savingBad, setSavingBad] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        // 1. кто мы
        const meRes = await fetch('/api/auth/me');
        const meData = await meRes.json();
        const user: MeUser | null = meData.user ?? null;

        if (!user) {
          router.push('/login');
          return;
        }
        if (cancelled) return;
        setMe(user);

        // 2. параллельно грузим историю и плохие адреса
        const [historyRes, badRes] = await Promise.all([
          fetch('/api/history'),
          fetch('/api/bad-addresses'),
        ]);

        const historyData: HistoryItem[] = await historyRes.json();
        const badData: BadAddressRow[] = await badRes.json();

        if (cancelled) return;
        setHistory(historyData);
        setBadAddresses(badData);

        // 3. если админ – подгрузим ещё список пользователей
        if (user.role === 'admin') {
          const usersRes = await fetch('/api/admin/users');
          if (usersRes.ok) {
            const usersData: AdminUserRow[] = await usersRes.json();
            if (!cancelled) setAdminUsers(usersData);
          }
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError('Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // 👉 клик по строке истории → редирект на /analysis с нужными query
  function handleHistoryRowClick(item: HistoryItem) {
    const params = new URLSearchParams({
      addr: item.rootAddress,
      blockchain: item.blockchain,
      depth: String(item.depth ?? 1),
    });
    router.push(`/analysis?${params.toString()}`);
  }

  async function handleAddBadAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!me || (me.role !== 'pusher' && me.role !== 'admin')) return;

    setSavingBad(true);
    setError(null);

    try {
      const res = await fetch('/api/bad-addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blockchain: newBadAddr.blockchain,
          address: newBadAddr.address.trim(),
          tag: newBadAddr.tag.trim() || null,
          riskLevel: Number(newBadAddr.riskLevel) || 80,
          source: newBadAddr.source.trim() || null,
          evidenceUrl: newBadAddr.evidenceUrl.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to save bad address');
      }

      // обновляем таблицу
      const updatedRow: BadAddressRow = await res.json();
      setBadAddresses((prev) => [updatedRow, ...prev]);

      setNewBadAddr({
        blockchain: 'bitcoin',
        address: '',
        tag: '',
        riskLevel: '80',
        source: '',
        evidenceUrl: '',
      });
    } catch (e: any) {
      setError(e.message || 'Failed to save bad address');
    } finally {
      setSavingBad(false);
    }
  }

  async function handleDeleteBadAddress(row: BadAddressRow) {
    if (!me) return;
    const canDelete =
      me.role === 'admin' || String(me.userId) === String(row.user_id);
    if (!canDelete) return;

    if (!confirm(`Delete bad address ${row.address}?`)) return;

    try {
      const res = await fetch(`/api/bad-addresses/${row.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to delete');
      }

      setBadAddresses((prev) => prev.filter((b) => b.id !== row.id));
    } catch (e: any) {
      setError(e.message || 'Failed to delete');
    }
  }

  async function handleChangeUserRole(
    id: number,
    newRole: UserRole,
  ) {
    if (!me || me.role !== 'admin') return;

    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to update role');
      }

      const updated: AdminUserRow = await res.json();
      setAdminUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
    } catch (e: any) {
      setError(e.message || 'Failed to update role');
    }
  }

  async function handleDeleteUser(id: number) {
    if (!me || me.role !== 'admin') return;
    if (!confirm(`Delete user #${id}?`)) return;

    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to delete user');
      }

      setAdminUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (e: any) {
      setError(e.message || 'Failed to delete user');
    }
  }

  function exportBadCsv() {
    window.location.href = '/api/bad-addresses?format=csv';
  }

  if (loading || me === undefined) {
    return (
      <section className="max-w-6xl mx-auto mt-12 px-4">
        <p className="text-slate-300 text-sm">Loading…</p>
      </section>
    );
  }

  if (!me) {
    // на всякий случай
    return null;
  }

  return (
    <section className="max-w-6xl mx-auto mt-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">
            {t.dashboard?.title ?? 'Personal cabinet'}
          </h1>
          <p className="text-sm text-slate-400">
            {me.email} · role: {me.role}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800">
        <button
          className={`px-3 py-2 text-sm ${
            activeTab === 'history'
              ? 'border-b-2 border-emerald-400 text-emerald-300'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          onClick={() => setActiveTab('history')}
        >
          {t.dashboard?.historyTab ?? 'History'}
        </button>
        <button
          className={`px-3 py-2 text-sm ${
            activeTab === 'bad'
              ? 'border-b-2 border-emerald-400 text-emerald-300'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          onClick={() => setActiveTab('bad')}
        >
          {t.dashboard?.badTab ?? 'Bad addresses'}
        </button>
        {me.role === 'admin' && (
          <button
            className={`px-3 py-2 text-sm ${
              activeTab === 'admin'
                ? 'border-b-2 border-emerald-400 text-emerald-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setActiveTab('admin')}
          >
            {t.dashboard?.adminTab ?? 'Users & roles'}
          </button>
        )}
      </div>

      {/* TAB: HISTORY */}
      {activeTab === 'history' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-lg font-medium mb-3">
            {t.dashboard?.historyTitle ?? 'Your recent analyses'}
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">
              {t.dashboard?.historyEmpty ??
                'No analyses yet. Run one on the "Wallet analysis" page.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-400 border-b border-slate-800">
                  <tr className="text-left">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Blockchain</th>
                    <th className="py-2 pr-2">Address</th>
                    <th className="py-2 pr-2">Depth</th>
                    <th className="py-2 pr-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr
                      key={h.id}
                      onClick={() => handleHistoryRowClick(h)}
                      className="border-b border-slate-900 cursor-pointer hover:bg-slate-800/40"
                    >
                      <td className="py-2 pr-2 text-slate-300">
                        {new Date(h.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-2 text-slate-300">
                        {h.blockchain}
                      </td>
                      <td className="py-2 pr-2 text-slate-400 max-w-[260px] truncate">
                        {h.rootAddress}
                      </td>
                      <td className="py-2 pr-2 text-slate-300">
                        {h.depth}
                      </td>
                      <td className="py-2 pr-2 text-slate-300">
                        {h.globalRiskScore.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB: BAD ADDRESSES */}
      {activeTab === 'bad' && (
        <div className="space-y-4">
          {/* форма добавления – только pusher/admin */}
          {(me.role === 'pusher' || me.role === 'admin') && (
            <form
              onSubmit={handleAddBadAddress}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3"
            >
              <h2 className="text-lg font-medium mb-1">
                {t.dashboard?.badAddTitle ?? 'Add bad address'}
              </h2>

              {/* импорт CSV */}
              <BadAddressesImport
                onImported={(rows) => {
                  setBadAddresses((prev) => [...rows, ...prev]);
                }}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="block text-xs mb-1 text-slate-400">
                    Blockchain
                  </label>
                  <select
                    value={newBadAddr.blockchain}
                    onChange={(e) =>
                      setNewBadAddr((s) => ({
                        ...s,
                        blockchain: e.target.value,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-sm"
                  >
                    <option value="bitcoin">Bitcoin</option>
                    <option value="ethereum">Ethereum</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs mb-1 text-slate-400">
                    Address
                  </label>
                  <input
                    value={newBadAddr.address}
                    onChange={(e) =>
                      setNewBadAddr((s) => ({ ...s, address: e.target.value }))
                    }
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1 text-slate-400">
                    Risk level (0–100)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={newBadAddr.riskLevel}
                    onChange={(e) =>
                      setNewBadAddr((s) => ({
                        ...s,
                        riskLevel: e.target.value,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs mb-1 text-slate-400">
                    Tag
                  </label>
                  <input
                    value={newBadAddr.tag}
                    onChange={(e) =>
                      setNewBadAddr((s) => ({ ...s, tag: e.target.value }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1 text-slate-400">
                    Source
                  </label>
                  <input
                    value={newBadAddr.source}
                    onChange={(e) =>
                      setNewBadAddr((s) => ({ ...s, source: e.target.value }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1 text-slate-400">
                    Evidence URL
                  </label>
                  <input
                    value={newBadAddr.evidenceUrl}
                    onChange={(e) =>
                      setNewBadAddr((s) => ({
                        ...s,
                        evidenceUrl: e.target.value,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingBad}
                className="mt-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 px-4 py-2 rounded-md text-sm font-medium"
              >
                {savingBad
                  ? t.common?.saving ?? 'Saving…'
                  : t.dashboard?.badAddBtn ?? 'Add address'}
              </button>
            </form>
          )}

          {/* Таблица плохих адресов + экспорт */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-medium">
                {t.dashboard?.badListTitle ?? 'Bad address database'}
              </h2>
              <button
                type="button"
                onClick={exportBadCsv}
                className="text-xs border border-slate-600 rounded-md px-3 py-1 text-slate-200 hover:bg-slate-800"
              >
                {t.dashboard?.exportCsv ?? 'Export CSV'}
              </button>
            </div>

            {badAddresses.length === 0 ? (
              <p className="text-sm text-slate-400">
                {t.dashboard?.badEmpty ?? 'No bad addresses yet.'}
              </p>
            ) : (
              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-xs">
                  <thead className="text-slate-400 border-b border-slate-800 sticky top-0 bg-slate-900">
                    <tr className="text-left">
                      <th className="py-2 pr-2">ID</th>
                      <th className="py-2 pr-2">Blockchain</th>
                      <th className="py-2 pr-2">Address</th>
                      <th className="py-2 pr-2">Tag</th>
                      <th className="py-2 pr-2">Risk</th>
                      <th className="py-2 pr-2">Source</th>
                      <th className="py-2 pr-2">Evidence</th>
                      <th className="py-2 pr-2">Owner</th>
                      <th className="py-2 pr-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {badAddresses.map((b) => {
                      const canDelete =
                        me.role === 'admin' ||
                        String(me.userId) === String(b.user_id);

                      return (
                        <tr key={b.id} className="border-b border-slate-900">
                          <td className="py-1 pr-2 text-slate-400">
                            {b.id}
                          </td>
                          <td className="py-1 pr-2 text-slate-300">
                            {b.blockchain}
                          </td>
                          <td className="py-1 pr-2 text-slate-300 max-w-[260px] truncate">
                            {b.address}
                          </td>
                          <td className="py-1 pr-2 text-slate-300">
                            {b.tag}
                          </td>
                          <td className="py-1 pr-2 text-slate-300">
                            {b.risk_level}
                          </td>
                          <td className="py-1 pr-2 text-slate-300 max-w-[160px] truncate">
                            {b.source}
                          </td>
                          <td className="py-1 pr-2 text-slate-300 max-w-[200px] truncate">
                            {b.evidence_url}
                          </td>
                          <td className="py-1 pr-2 text-slate-400">
                            {b.user_id ?? '—'}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => handleDeleteBadAddress(b)}
                                className="text-[11px] text-red-400 hover:text-red-300"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: ADMIN – юзеры и роли */}
      {activeTab === 'admin' && me.role === 'admin' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-lg font-medium mb-3">
            {t.dashboard?.adminUsersTitle ?? 'Users & roles'}
          </h2>

          {adminUsers.length === 0 ? (
            <p className="text-sm text-slate-400">
              No users found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-400 border-b border-slate-800">
                  <tr className="text-left">
                    <th className="py-2 pr-2">ID</th>
                    <th className="py-2 pr-2">Email</th>
                    <th className="py-2 pr-2">Role</th>
                    <th className="py-2 pr-2">Created</th>
                    <th className="py-2 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((u) => (
                    <tr key={u.id} className="border-b border-slate-900">
                      <td className="py-2 pr-2 text-slate-400">
                        {u.id}
                      </td>
                      <td className="py-2 pr-2 text-slate-300">
                        {u.email}
                      </td>
                      <td className="py-2 pr-2 text-slate-300">
                        <select
                          value={u.role}
                          onChange={(e) =>
                            handleChangeUserRole(
                              u.id,
                              e.target.value as UserRole,
                            )
                          }
                          className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs"
                        >
                          <option value="user">user</option>
                          <option value="pusher">pusher</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="py-2 pr-2 text-slate-400">
                        {new Date(u.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u.id)}
                          className="text-[11px] text-red-400 hover:text-red-300"
                        >
                          Delete user
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
