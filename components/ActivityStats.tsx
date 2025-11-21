'use client';

import type { ActivityStats } from '@/lib/types';
import { useLanguage } from './LanguageProvider';

interface Props {
  stats: ActivityStats;
}

export default function ActivityStatsCard({ stats }: Props) {
  const { t } = useLanguage();

  return (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-2">
      <h2 className="text-lg font-semibold">
        {t.activityStats.title}
      </h2>
      <ul className="text-sm text-slate-300 space-y-1">
        <li>
          {t.activityStats.totalTx}: {stats.totalTx}
        </li>
        <li>
          {t.activityStats.smallTxShare}:{' '}
          {(stats.smallTxShare * 100).toFixed(1)}%
        </li>
        <li>
          {t.activityStats.peakDayTx}: {stats.peakDayTx}
        </li>
      </ul>
    </div>
  );
}
