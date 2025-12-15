'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/components/LanguageProvider';
import WalletAnalysisForm from '@/components/WalletAnalysisForm';
import RiskSummary from '@/components/RiskSummary';
import ActivityStats from '@/components/ActivityStats';
import GraphView from '@/components/GraphView';
import type {
  WalletAnalysisResult,
  WalletAnalysisRequest,
  SupportedBlockchain,
} from '@/lib/types';

function AnalysisPageInner() {
  const { t } = useLanguage();
  const [result, setResult] = useState<WalletAnalysisResult | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  // searchParams по типам может быть null – аккуратно достаём
  const urlAddress = searchParams?.get('addr') ?? '';
  const urlDepthStr = searchParams?.get('depth') ?? null;
  const urlBlockchainParam = (searchParams?.get('blockchain') as
    | SupportedBlockchain
    | null) ?? null;

  const parsedDepth = urlDepthStr ? Number(urlDepthStr) : NaN;
  const depth =
    Number.isFinite(parsedDepth) && parsedDepth > 0 && parsedDepth <= 5
      ? parsedDepth
      : 2;

  const blockchain: SupportedBlockchain =
    urlBlockchainParam === 'bitcoin' || urlBlockchainParam === 'ethereum'
      ? urlBlockchainParam
      : 'bitcoin';

  // автозапуск анализа при наличии addr в URL
  useEffect(() => {
    if (!urlAddress) return;

    const payload: WalletAnalysisRequest = {
      address: urlAddress,
      blockchain,
      depth,
    };

    (async () => {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          console.error('Auto /api/analyze failed', await res.text());
          return;
        }

        const data: WalletAnalysisResult = await res.json();
        setResult(data);
      } catch (e) {
        console.error('Auto analysis from URL failed', e);
      }
    })();
  }, [urlAddress, depth, blockchain]);

  // сабмит формы
  async function handleSubmit(payload: WalletAnalysisRequest) {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Request failed');
    }

    const data: WalletAnalysisResult = await res.json();
    setResult(data);

    router.push(
      `/analysis?addr=${encodeURIComponent(
        data.rootAddress,
      )}&depth=${data.depth}&blockchain=${data.blockchain}`,
    );
  }

  // клик по ноде → новый URL, useEffect сам запустит анализ
  function handleNodeClick(address: string) {
    const currentDepth = result?.depth ?? depth;
    const currentChain = result?.blockchain ?? blockchain;

    router.push(
      `/analysis?addr=${encodeURIComponent(
        address,
      )}&depth=${currentDepth}&blockchain=${currentChain}`,
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">
        {t.analysisPage.title}
      </h1>

      <WalletAnalysisForm
        onSubmit={handleSubmit}
        initialAddress={urlAddress}
        initialDepth={depth}
        initialBlockchain={blockchain}
      />

      {result && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <ActivityStats stats={result.stats} />
            <RiskSummary result={result} />
          </div>

          <GraphView
            graph={result.graph}
            rootAddress={result.rootAddress}
            onNodeClick={handleNodeClick}
          />
        </div>
      )}
    </section>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={null}>
      <AnalysisPageInner />
    </Suspense>
  );
}
