// app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import type { WalletAnalysisResult } from '@/lib/types';
import HistoryTable from '@/components/HistoryTable';

export default function DashboardPage() {
  const [data, setData] = useState<WalletAnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/history');
      const json = await res.json();
      setData(json);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Личный кабинет</h1>
      {loading ? (
        <p className="text-slate-300 text-sm">Загружаем историю анализов…</p>
      ) : (
        <HistoryTable items={data} />
      )}
    </section>
  );
}
