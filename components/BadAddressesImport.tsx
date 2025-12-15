// components/BadAddressesImport.tsx
'use client';

import { useState } from 'react';

type BadAddressRow = {
  id: number;
  blockchain: string;
  address: string;
  tag: string | null;
  risk_level: number;
  source: string | null;
  evidence_url: string | null;
  user_id: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type Props = {
  /** Вызываем после успешного импорта — отдаём добавленные строки */
  onImported?: (rows: BadAddressRow[]) => void;
};

export function BadAddressesImport({ onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/bad-addresses/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.message || 'Import failed');
      }

      // data.insertedRows — то, что мы возвращаем из API
      const inserted = (data.insertedRows ?? []) as BadAddressRow[];

      if (inserted.length > 0 && onImported) {
        onImported(inserted);
      }

      setSuccess(
        `Imported ${data.insertedCount ?? inserted.length} rows`,
      );
      setFile(null);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleUpload}
      className="flex flex-col md:flex-row items-start md:items-center gap-2"
    >
      <div>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs text-slate-300"
        />
        <p className="text-[11px] text-slate-500">
          CSV: blockchain,address,tag,risk_level,source,evidence_url
        </p>
      </div>

      <button
        type="submit"
        disabled={!file || loading}
        className="text-xs border border-slate-600 rounded-md px-3 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {loading ? 'Importing…' : 'Import CSV'}
      </button>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
      {success && (
        <p className="text-xs text-emerald-400">{success}</p>
      )}
    </form>
  );
}
