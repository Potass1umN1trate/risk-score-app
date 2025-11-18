// components/RiskSummary.tsx
import type { WalletAnalysisResult } from '@/lib/types';

interface Props {
  result: WalletAnalysisResult;
}

export default function RiskSummary({ result }: Props) {
  const level =
    result.globalRiskScore >= 70
      ? 'Высокий риск'
      : result.globalRiskScore >= 40
      ? 'Средний риск'
      : 'Низкий риск';

  const levelColor =
    result.globalRiskScore >= 70
      ? 'text-red-400'
      : result.globalRiskScore >= 40
      ? 'text-yellow-300'
      : 'text-emerald-400';

  return (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-2">
      <h2 className="text-lg font-semibold">Итоговый risk score</h2>
      <p className="text-3xl font-bold">
        {result.globalRiskScore}
        <span className="text-base font-normal text-slate-400"> / 100</span>
      </p>
      <p className={levelColor}>{level}</p>

      <p className="text-xs text-slate-400">
        Адрес: {result.rootAddress} · Блокчейн: {result.blockchain} · Глубина анализа:{' '}
        {result.depth}
      </p>
      <p className="text-xs text-slate-500">
        Анализ выполнен: {new Date(result.createdAt).toLocaleString('ru-RU')}
      </p>
    </div>
  );
}
