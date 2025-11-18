// components/HistoryTable.tsx
import type { WalletAnalysisResult } from '@/lib/types';

interface Props {
  items: WalletAnalysisResult[];
}

export default function HistoryTable({ items }: Props) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-300">Вы ещё не запускали анализ.</p>;
  }

  return (
    <div className="overflow-x-auto bg-slate-900 border border-slate-800 rounded-xl">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-800 text-slate-200">
          <tr>
            <th className="px-3 py-2 text-left">Адрес</th>
            <th className="px-3 py-2 text-left">Блокчейн</th>
            <th className="px-3 py-2 text-left">Глубина</th>
            <th className="px-3 py-2 text-left">Risk score</th>
            <th className="px-3 py-2 text-left">Дата</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={i} className="border-t border-slate-800">
              <td className="px-3 py-2">{r.rootAddress}</td>
              <td className="px-3 py-2">{r.blockchain}</td>
              <td className="px-3 py-2">{r.depth}</td>
              <td className="px-3 py-2">{r.globalRiskScore}</td>
              <td className="px-3 py-2">
                {new Date(r.createdAt).toLocaleString('ru-RU')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
