'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/LanguageProvider';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

export default function RegisterPage() {
  const { t } = useLanguage();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');

  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }

    setLoadingEmail(true);

    try {
      const em = email.trim().toLowerCase();

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Registration failed');
      }

      const result = await signIn('credentials', {
        redirect: false,
        email: em,
        password,
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'Login failed after registration');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Unknown error');
    } finally {
      setLoadingEmail(false);
    }
  }

  async function handleMetaMask() {
    setError(null);
    setLoadingWallet(true);

    try {
      const ethereum = (window as any)?.ethereum;
      if (!ethereum) {
        throw new Error('MetaMask не найден. Установи расширение MetaMask.');
      }

      // 1) nonce (ставится в httpOnly cookie на сервере)
      const nonceRes = await fetch('/api/auth/metamask/nonce', { method: 'GET' });
      if (!nonceRes.ok) throw new Error('Не удалось получить nonce (server error)');
      const { nonce } = await nonceRes.json();

      if (!nonce) throw new Error('Nonce пустой (server bug)');

      // 2) connect
      const accounts: string[] = await ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0];
      if (!address) throw new Error('MetaMask не вернул адрес');

      // 3) message (должен совпадать с парсером на сервере!)
      const domain = window.location.host;
      const message =
        `Risk Score Crypto App Login\n` +
        `Domain: ${domain}\n` +
        `Address: ${address}\n` +
        `Nonce: ${nonce}\n` +
        `Issued At: ${new Date().toISOString()}`;

      // 4) signature
      const signature: string = await ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      });

      if (!signature) throw new Error('Не удалось получить подпись');

      // 5) NextAuth signIn (credentials provider "metamask")
      const result = await signIn('metamask', {
        redirect: false,
        message,
        signature,
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'MetaMask login failed');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      // нормальные ошибки metamask часто приходят как { code, message }
      setError(err?.message || 'MetaMask login failed');
    } finally {
      setLoadingWallet(false);
    }
  }

  const disabledAll = loadingEmail || loadingWallet;

  return (
    <section className="max-w-md mx-auto mt-12">
      <h1 className="text-2xl font-semibold mb-4">{t.auth.register}</h1>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 bg-slate-900 border border-slate-800 p-4 rounded-xl"
      >
        <div>
          <label className="block text-sm mb-1">{t.auth.emailLabel}</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={disabledAll}
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm disabled:opacity-60"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">{t.auth.passwordLabel}</label>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={disabledAll}
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Повторите пароль</label>
          <input
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
            disabled={disabledAll}
            className="w-full px-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-sm disabled:opacity-60"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={disabledAll}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 px-4 py-2 rounded-md text-sm font-medium"
        >
          {loadingEmail ? '…' : t.auth.register}
        </button>

        {/* OAuth / Wallet */}
        <div className="pt-2 space-y-2">
          <button
            type="button"
            disabled={disabledAll}
            onClick={() => signIn('github', { callbackUrl: '/dashboard' })}
            className="w-full border border-slate-700 rounded-md px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            {loadingWallet ? '…' : 'Sign up with GitHub'}
          </button>

          <button
            type="button"
            disabled={disabledAll}
            onClick={handleMetaMask}
            className="w-full border border-slate-700 rounded-md px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            {loadingWallet ? 'Connecting…' : 'Sign up with MetaMask'}
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
