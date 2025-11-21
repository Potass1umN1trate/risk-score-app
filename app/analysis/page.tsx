'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import WalletAnalysisForm from '@/components/WalletAnalysisForm';
import RiskSummary from '@/components/RiskSummary';
import ActivityStats from '@/components/ActivityStats';
import GraphView from '@/components/GraphView';
import type { WalletAnalysisResult } from '@/lib/types';

export default function AnalysisPage() {
  const { t } = useLanguage();
  const [result, setResult] = useState<WalletAnalysisResult | null>(null);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {t.analysisPage.title}
      </h1>

      <WalletAnalysisForm onResult={setResult} />

      {result && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <ActivityStats stats={result.stats} />
            <RiskSummary result={result} />
          </div>
          <GraphView 
            graph={result.graph}
            rootAddress={result.rootAddress} 
          />
        </div>
      )}
    </section>
  );
}
