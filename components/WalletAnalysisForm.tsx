'use client';

import { useState } from 'react';
import type {
  SupportedBlockchain,
  WalletAnalysisRequest,
  WalletAnalysisResult,
} from '@/lib/types';
import { useLanguage } from './LanguageProvider';

interface Props {
  onResult: (result: WalletAnalysisResult) => void;
}

export default function WalletAnalysisForm({ onResult }: Props) {
  const { t } = useLanguage();

  const [address, setAddress] = useState('');
  const [blockchain, setBlockchain] = useState<SupportedBlockchain>('bitcoin');
  const [depth, setDepth] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload: WalletAnalysisRequest = {
      address: address.trim(),
      blockchain,
      depth: Number(depth),
    };

    try {
      setLoading(true);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Request failed');
      }

      const result: WalletAnalysisResult = await res.json();
      onResult(result);
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 bg-slate-900 border border-slate-800 p-4 rounded-xl"
    >
      <div>
        <label className="block text-sm mb-1">
          {t.analysisForm.addressLabel}
        </label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          required
          className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm"
          placeholder={t.analysisForm.addressPlaceholder}
        />
      </div>

      <div className="flex flex-col md:flex-row md:items-end gap-4">
        <div className="flex-1">
          <label className="block text-sm mb-1">
            {t.analysisForm.blockchainLabel}
          </label>
          <select
            value={blockchain}
            onChange={(e) =>
              setBlockchain(e.target.value as SupportedBlockchain)
            }
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm"
          >
            <option value="bitcoin">Bitcoin</option>
            <option value="ethereum">Ethereum</option>
          </select>
        </div>

        <div className="w-40">
          <label className="block text-sm mb-1">
            {t.analysisForm.depthLabel}
          </label>
          <input
            type="number"
            min={1}
            max={5}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 px-4 py-2 rounded-md text-sm font-medium"
      >
        {loading ? t.analysisForm.submitLoading : t.analysisForm.submit}
      </button>
    </form>
  );
}
