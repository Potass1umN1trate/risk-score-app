'use client';

import type { WalletAnalysisResult } from '@/lib/types';
import { useLanguage } from './LanguageProvider';

interface Props {
  result: WalletAnalysisResult;
}

export default function RiskSummary({ result }: Props) {
  const { t } = useLanguage();

  const level =
    result.globalRiskScore >= 70
      ? t.riskSummary.levelHigh
      : result.globalRiskScore >= 40
      ? t.riskSummary.levelMedium
      : t.riskSummary.levelLow;

  const levelColor =
    result.globalRiskScore >= 70
      ? 'text-red-400'
      : result.globalRiskScore >= 40
      ? 'text-yellow-300'
      : 'text-emerald-400';

  const partial = result.meta?.partial;

  return (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-2">
      <h2 className="text-lg font-semibold">{t.riskSummary.title}</h2>

      <p className="text-3xl font-bold">
        {result.globalRiskScore}
        <span className="text-base font-normal text-slate-400">
          {' '}
          / 100
        </span>
      </p>

      <p className={levelColor}>{level}</p>

      {partial && (
        <p className="text-xs text-yellow-300">
          {t.meta.partialAnalysis}
        </p>
      )}

      <p className="text-xs text-slate-400">
        {t.riskSummary.address}: {result.rootAddress} ·{' '}
        {t.riskSummary.blockchain}: {result.blockchain} ·{' '}
        {/* Display analysis depth level */}
        {t.riskSummary.depth}: {result.depth}
      </p>
      <p className="text-xs text-slate-500">
        {t.riskSummary.performedAt}:{' '}
        {new Date(result.createdAt).toLocaleString('ru-RU')}
      </p>
    </div>
  );
}
