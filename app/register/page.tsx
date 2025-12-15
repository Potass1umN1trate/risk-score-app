'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/LanguageProvider';
import Link from 'next/link';

export default function RegisterPage() {
  const { t } = useLanguage();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Registration failed');
      }

      // после успешной регистрации сразу логин/сессия — редирект
      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="max-w-md mx-auto mt-12">
      <h1 className="text-2xl font-semibold mb-4">
        {t.auth.register}
      </h1>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 bg-slate-900 border border-slate-800 p-4 rounded-xl"
      >
        <div>
          <label className="block text-sm mb-1">
            {t.auth.emailLabel}
          </label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">
            {t.auth.passwordLabel}
          </label>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">
            Повторите пароль
          </label>
          <input
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm"
          />
        </div>

        {error && (
          <p className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 px-4 py-2 rounded-md text-sm font-medium"
        >
          {loading ? '…' : t.auth.register}
        </button>

        {/* Кнопки под GitHub/MetaMask — пока заглушки */}
        <div className="pt-2 space-y-2">
          <button
            type="button"
            disabled
            className="w-full border border-slate-700 rounded-md px-4 py-2 text-sm text-slate-300 disabled:opacity-60"
          >
            Sign up with GitHub (soon)
          </button>
          <button
            type="button"
            disabled
            className="w-full border border-slate-700 rounded-md px-4 py-2 text-sm text-slate-300 disabled:opacity-60"
          >
            Sign up with MetaMask (soon)
          </button>
        </div>

        <p className="text-xs text-slate-400 pt-2">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-emerald-400 hover:underline">
            {t.auth.login}
          </Link>
        </p>
      </form>
    </section>
  );
}
