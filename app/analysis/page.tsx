// app/analysis/page.tsx
'use client';

import { useState } from 'react';
import WalletAnalysisForm from '@/components/WalletAnalysisForm';
import RiskSummary from '@/components/RiskSummary';
import ActivityStats from '@/components/ActivityStats';
import GraphView from '@/components/GraphView';
import type { WalletAnalysisResult } from '@/lib/types';

export default function AnalysisPage() {
  const [result, setResult] = useState<WalletAnalysisResult | null>(null);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Анализ криптовалютного кошелька</h1>

      {/* Форма ввода параметров */}
      <WalletAnalysisForm onResult={setResult} />

      {/* Блок результатов появляется только после успешного анализа */}
      {result && (
        <div className="space-y-4">
          <RiskSummary result={result} />
          <div className="grid md:grid-cols-2 gap-4">
            <ActivityStats stats={result.stats} />
            <GraphView graph={result.graph} />
          </div>
        </div>
      )}
    </section>
  );
}
