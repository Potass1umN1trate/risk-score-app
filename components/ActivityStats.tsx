// components/ActivityStats.tsx
import type { ActivityStats } from '@/lib/types';

interface Props {
  stats: ActivityStats;
}

export default function ActivityStats({ stats }: Props) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-2">
      <h2 className="text-lg font-semibold">Транзакционная активность</h2>
      <ul className="text-sm text-slate-300 space-y-1">
        <li>Всего транзакций: {stats.totalTx}</li>
        <li>Доля мелких переводов: {(stats.smallTxShare * 100).toFixed(1)}%</li>
        <li>Максимум транзакций за день: {stats.peakDayTx}</li>
      </ul>
    </div>
  );
}
